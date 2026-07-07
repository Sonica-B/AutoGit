const vscode = require('vscode');
const path = require('path');

const { compilePatterns, isExcluded } = require('./lib/patterns');
const {
    parseGitStatus,
    generateFallbackCommitMessage,
    buildCommitPrompt,
    sanitizeAiMessage
} = require('./lib/commitMessage');
const { GitService } = require('./lib/gitService');

const CONFIG_SECTION = 'autoGitCopilot';
const AI_REQUEST_TIMEOUT_MS = 20_000;

/** @type {vscode.OutputChannel | undefined} */
let outputChannel;
/** @type {vscode.StatusBarItem | undefined} */
let statusBarItem;
/** @type {NodeJS.Timeout | undefined} */
let pendingTimeout;
/** @type {GitService | undefined} */
let git;

let isEnabled = false;
let workspacePath = '';
const changeTracker = new Set();
/** @type {RegExp[]} */
let compiledExcludes = [];

// Guards against overlapping git pipelines (e.g. manual commit while a
// scheduled one is running). If changes arrive mid-run, we run once more.
let isRunning = false;
let rerunRequested = false;

/** @param {string} message */
function log(message) {
    if (outputChannel) {
        const timestamp = new Date().toISOString().replace('T', ' ').replace(/\.\d+Z$/, '');
        outputChannel.appendLine(`[${timestamp}] ${message}`);
    }
}

/**
 * Extract a readable message from an unknown thrown value.
 * @param {unknown} error
 * @returns {string}
 */
function errorText(error) {
    if (error instanceof Error) return error.message;
    return String(error);
}

function getConfig() {
    return vscode.workspace.getConfiguration(CONFIG_SECTION);
}

/**
 * Show a user notification respecting the configured notification level.
 * @param {'info' | 'error' | 'warn'} kind
 * @param {string} message
 */
function notify(kind, message) {
    const level = /** @type {string} */ (getConfig().get('notificationLevel', 'errors'));
    if (level === 'none') return;
    if (level === 'errors' && kind === 'info') return;

    if (kind === 'error') {
        vscode.window.showErrorMessage(message);
    } else if (kind === 'warn') {
        vscode.window.showWarningMessage(message);
    } else {
        vscode.window.showInformationMessage(message);
    }
}

function refreshCompiledExcludes() {
    const patterns = /** @type {string[]} */ (getConfig().get('excludePatterns', []));
    compiledExcludes = compilePatterns(patterns, (msg) => log(`WARN: ${msg}`));
}

/**
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {
    outputChannel = vscode.window.createOutputChannel('Auto Git');
    context.subscriptions.push(outputChannel);
    log('Auto Git extension activating...');

    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
        log('No workspace folder found; extension idle.');
        registerCommands(context, { workspaceAvailable: false });
        return;
    }

    workspacePath = workspaceFolders[0].uri.fsPath;
    if (workspaceFolders.length > 1) {
        log(`Multi-root workspace detected; using first folder: ${workspacePath}`);
    }
    git = new GitService(workspacePath, (msg) => log(msg));
    log(`Workspace initialized: ${workspacePath}`);

    statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    statusBarItem.command = 'autoGitCopilot.toggle';
    statusBarItem.show();
    context.subscriptions.push(statusBarItem);

    isEnabled = getConfig().get('enabled', false);
    refreshCompiledExcludes();
    updateStatusBar();

    registerCommands(context, { workspaceAvailable: true });
    setupFileChangeDetection(context);

    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration((e) => {
            if (e.affectsConfiguration(`${CONFIG_SECTION}.excludePatterns`)) {
                refreshCompiledExcludes();
                log('Exclude patterns reloaded.');
            }
            if (e.affectsConfiguration(`${CONFIG_SECTION}.enabled`)) {
                const newEnabled = getConfig().get('enabled', false);
                if (newEnabled !== isEnabled) {
                    setEnabled(newEnabled, { persist: false });
                }
            }
        })
    );

    log('Auto Git extension activated.');
}

/**
 * @param {vscode.ExtensionContext} context
 * @param {{ workspaceAvailable: boolean }} options
 */
function registerCommands(context, { workspaceAvailable }) {
    const requireWorkspace = (/** @type {() => void} */ fn) => () => {
        if (!workspaceAvailable) {
            vscode.window.showWarningMessage('Auto Git: Open a folder to use this command.');
            return;
        }
        fn();
    };

    context.subscriptions.push(
        vscode.commands.registerCommand(
            'autoGitCopilot.toggle',
            requireWorkspace(() => setEnabled(!isEnabled, { persist: true }))
        ),
        vscode.commands.registerCommand(
            'autoGitCopilot.enable',
            requireWorkspace(() => setEnabled(true, { persist: true }))
        ),
        vscode.commands.registerCommand(
            'autoGitCopilot.disable',
            requireWorkspace(() => setEnabled(false, { persist: true }))
        ),
        vscode.commands.registerCommand(
            'autoGitCopilot.commitNow',
            requireWorkspace(() => {
                clearPendingTimeout();
                log('Manual commit triggered.');
                performGitOperations();
            })
        ),
        vscode.commands.registerCommand('autoGitCopilot.showLogs', () => {
            if (outputChannel) outputChannel.show(true);
        })
    );
}

/**
 * @param {boolean} enabled
 * @param {{ persist: boolean }} options persist writes the value back to settings
 */
function setEnabled(enabled, { persist }) {
    isEnabled = enabled;
    if (persist) {
        getConfig()
            .update('enabled', enabled, vscode.ConfigurationTarget.Workspace)
            .then(undefined, (err) => log(`WARN: Failed to persist enabled setting: ${err}`));
    }
    if (!enabled) {
        clearPendingTimeout();
        changeTracker.clear();
    }
    updateStatusBar();
    notify('info', `Auto Git ${enabled ? 'enabled' : 'disabled'}`);
    log(`Auto Git ${enabled ? 'enabled' : 'disabled'}.`);
}

/**
 * @param {vscode.ExtensionContext} context
 */
function setupFileChangeDetection(context) {
    const pattern = new vscode.RelativePattern(workspacePath, '**/*');
    const watcher = vscode.workspace.createFileSystemWatcher(pattern);
    watcher.onDidChange((uri) => handleFileChange(uri, 'changed'));
    watcher.onDidCreate((uri) => handleFileChange(uri, 'created'));
    watcher.onDidDelete((uri) => handleFileChange(uri, 'deleted'));
    context.subscriptions.push(watcher);
    log('File system watcher registered.');
}

/**
 * @param {vscode.Uri} uri
 * @param {string} changeType
 */
function handleFileChange(uri, changeType) {
    if (!isEnabled || uri.scheme !== 'file') return;

    const relativePath = path.relative(workspacePath, uri.fsPath);
    // Ignore paths outside the workspace folder.
    if (!relativePath || relativePath.startsWith('..')) return;

    if (isExcluded(relativePath, compiledExcludes)) {
        return;
    }

    log(`File ${changeType}: ${relativePath}`);
    changeTracker.add(relativePath);
    scheduleGitOperations();
}

function scheduleGitOperations() {
    clearPendingTimeout();

    const delay = getConfig().get('delayMs', 3000);
    if (statusBarItem) {
        statusBarItem.text = `$(sync~spin) Auto Git: Pending (${changeTracker.size})`;
        statusBarItem.tooltip = `Auto Git will commit in ${Math.round(delay / 1000)}s. Click to disable.`;
    }

    pendingTimeout = setTimeout(() => {
        pendingTimeout = undefined;
        performGitOperations();
    }, delay);
}

function clearPendingTimeout() {
    if (pendingTimeout) {
        clearTimeout(pendingTimeout);
        pendingTimeout = undefined;
    }
}

function updateStatusBar() {
    if (!statusBarItem) return;

    if (isEnabled) {
        statusBarItem.text = '$(git-branch) Auto Git: ON';
        statusBarItem.tooltip = 'Auto Git is enabled. Click to disable.';
        statusBarItem.backgroundColor = undefined;
    } else {
        statusBarItem.text = '$(git-branch) Auto Git: OFF';
        statusBarItem.tooltip = 'Auto Git is disabled. Click to enable.';
        statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
    }
}

async function performGitOperations() {
    if (!git) {
        notify('error', 'Auto Git: No workspace available.');
        return;
    }

    if (isRunning) {
        rerunRequested = true;
        log('Git pipeline already running; queued a follow-up run.');
        return;
    }
    isRunning = true;

    try {
        await runGitPipeline(git);
    } finally {
        isRunning = false;
        if (rerunRequested) {
            rerunRequested = false;
            log('Running queued follow-up git pipeline.');
            performGitOperations();
        }
    }
}

/**
 * @param {GitService} gitSvc
 */
async function runGitPipeline(gitSvc) {
    const config = getConfig();

    try {
        if (statusBarItem) {
            statusBarItem.text = '$(sync~spin) Auto Git: Working...';
        }

        if (!(await gitSvc.isRepository())) {
            log('Not a git repository; skipping.');
            notify('error', 'Auto Git: This workspace is not a git repository.');
            updateStatusBar();
            return;
        }

        // Never auto-commit on protected branches.
        const protectedBranches = /** @type {string[]} */ (config.get('protectedBranches', []));
        if (protectedBranches.length > 0) {
            const branch = await gitSvc.currentBranch();
            if (protectedBranches.includes(branch)) {
                log(`Branch "${branch}" is protected; skipping auto-commit.`);
                notify('warn', `Auto Git: Skipped commit — branch "${branch}" is protected.`);
                updateStatusBar();
                return;
            }
        }

        const statusOutput = await gitSvc.status();
        if (!statusOutput.trim()) {
            log('No changes to commit.');
            updateStatusBar();
            return;
        }

        await gitSvc.stageAll(config.get('includeUntracked', true));
        if (!(await gitSvc.hasStagedChanges())) {
            log('Nothing staged after applying filters; skipping commit.');
            updateStatusBar();
            return;
        }

        const commitMessage = await generateCommitMessage(statusOutput, gitSvc);
        log(`Commit message: "${commitMessage}"`);
        await gitSvc.commit(commitMessage);
        log('Changes committed.');

        changeTracker.clear();

        if (config.get('autoPush', true)) {
            await gitSvc.push();
            log('Changes pushed.');
            notify('info', `Auto Git: Committed and pushed — "${commitMessage}"`);
        } else {
            notify('info', `Auto Git: Committed — "${commitMessage}"`);
        }

        updateStatusBar();
    } catch (error) {
        const message = friendlyErrorMessage(error);
        log(`ERROR: ${errorText(error)}`);
        if (message) {
            notify('error', `Auto Git: ${message}`);
        }
        updateStatusBar();
    }
}

/**
 * Map raw git errors to actionable messages. Returns '' for benign cases.
 * @param {any} error
 * @returns {string}
 */
function friendlyErrorMessage(error) {
    const text = `${(error && error.message) || ''} ${(error && error.stderr) || ''}`;

    if (text.includes('nothing to commit')) {
        return '';
    }
    if (text.includes('Permission denied') || /authentication|could not read Username/i.test(text)) {
        return 'Git authentication failed. Check your SSH keys or credentials.';
    }
    if (/remote rejected|non-fast-forward|fetch first/i.test(text)) {
        return 'Push rejected by remote — pull the latest changes first.';
    }
    if (/no configured push destination|does not appear to be a git repository/i.test(text)) {
        return 'No remote configured. Add one with "git remote add origin <url>" or disable autoPush.';
    }
    if (/user.name|user.email|Please tell me who you are/i.test(text)) {
        return 'Git identity not configured. Run "git config --global user.name/user.email".';
    }
    return `Git operation failed: ${(error && error.message) || 'unknown error'}`;
}

/**
 * Generate a commit message, preferring the Copilot language model API and
 * falling back to a deterministic summary.
 * @param {string} statusOutput
 * @param {GitService} gitSvc
 * @returns {Promise<string>}
 */
async function generateCommitMessage(statusOutput, gitSvc) {
    const config = getConfig();
    const maxLength = config.get('maxCommitMessageLength', 72);

    if (!config.get('useAI', true)) {
        return generateFallbackCommitMessage(statusOutput);
    }

    try {
        if (!vscode.lm || typeof vscode.lm.selectChatModels !== 'function') {
            log('Language Model API unavailable; using fallback commit message.');
            return generateFallbackCommitMessage(statusOutput);
        }

        // Prefer any available Copilot model; do not pin a model family so the
        // extension keeps working as Copilot rotates its lineup.
        let models = await vscode.lm.selectChatModels({ vendor: 'copilot' });
        if (!models || models.length === 0) {
            models = await vscode.lm.selectChatModels({});
        }
        if (!models || models.length === 0) {
            log('No language models available; using fallback commit message.');
            return generateFallbackCommitMessage(statusOutput);
        }

        const model = models[0];
        log(`Using language model: ${model.vendor}/${model.family}`);

        const entries = parseGitStatus(statusOutput);
        let diffStat = '';
        try {
            diffStat = await gitSvc.stagedDiffStat();
        } catch {
            // Diff context is best-effort; the file list alone is enough.
        }

        const prompt = buildCommitPrompt(entries, diffStat);
        const cancellation = new vscode.CancellationTokenSource();
        const timeout = setTimeout(() => cancellation.cancel(), AI_REQUEST_TIMEOUT_MS);

        try {
            const response = await model.sendRequest(
                [vscode.LanguageModelChatMessage.User(prompt)],
                {},
                cancellation.token
            );

            let raw = '';
            for await (const fragment of response.text) {
                raw += fragment;
            }

            const message = sanitizeAiMessage(raw, maxLength);
            if (message) {
                log('AI commit message generated.');
                return message;
            }
            log('AI returned an empty message; using fallback.');
        } finally {
            clearTimeout(timeout);
            cancellation.dispose();
        }
    } catch (error) {
        log(`WARN: AI commit message failed (${errorText(error)}); using fallback.`);
    }

    return generateFallbackCommitMessage(statusOutput);
}

function deactivate() {
    clearPendingTimeout();
    changeTracker.clear();
    // Disposables registered on context.subscriptions (status bar, watcher,
    // output channel, commands) are disposed by VS Code.
    statusBarItem = undefined;
    outputChannel = undefined;
    git = undefined;
}

module.exports = {
    activate,
    deactivate
};
