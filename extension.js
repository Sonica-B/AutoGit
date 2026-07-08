const vscode = require('vscode');
const path = require('path');
const crypto = require('crypto');

const { compilePatterns, isExcluded } = require('./lib/patterns');
const {
    parseStatusZ,
    generateFallbackFromEntries,
    buildCommitPrompt,
    sanitizeAiMessage
} = require('./lib/commitMessage');
const { GitService } = require('./lib/gitService');
const { scanDiff, compileIgnorePatterns } = require('./lib/secretScanner');
const {
    normalizeRatingState,
    shouldPromptForRating,
    applyRatingOutcome,
    shouldShowWhatsNew
} = require('./lib/engagement');

const CONFIG_SECTION = 'autoGitCopilot';
const AI_REQUEST_TIMEOUT_MS = 20_000;
/** Above this many changed lines, skip fetching the full diff to scan. */
const SECRET_SCAN_MAX_LINES = 50_000;

// globalState keys for engagement features.
const STATE_RATING = 'autoGit.ratingState';
const STATE_VERSION = 'autoGit.installedVersion';
const MARKETPLACE_ITEM = 'ShreyaBoyane.auto-git-copilot';
const REVIEW_URL = `https://marketplace.visualstudio.com/items?itemName=${MARKETPLACE_ITEM}&ssr=false#review-details`;
const CHANGELOG_URL = 'https://github.com/Sonica-B/AutoGit/blob/main/CHANGELOG.md';

/** @type {vscode.ExtensionContext | undefined} */
let extensionContext;

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
/** Workspace folder relative to the repo root ('' when at the root). */
let scopePrefix = '';
const changeTracker = new Set();
/** @type {RegExp[]} */
let compiledExcludes = [];

// Guards against overlapping git pipelines (e.g. manual commit while a
// scheduled one is running). If changes arrive mid-run, we run once more.
let isRunning = false;
let rerunRequested = false;

// Fingerprint (hash of the staged diff) the user approved via "Commit Anyway".
// The scan is skipped only for the exact content that was reviewed; any other
// staged content still gets scanned, so a stale approval can never leak a new
// secret. Cleared on consumption and when the extension is disabled.
/** @type {string | null} */
let approvedFingerprint = null;

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

/** @returns {string} the configured notification level ('all' | 'errors' | 'none') */
function notificationLevel() {
    return /** @type {string} */ (getConfig().get('notificationLevel', 'errors'));
}

/**
 * Show a user notification respecting the configured notification level.
 * @param {'info' | 'error' | 'warn'} kind
 * @param {string} message
 */
function notify(kind, message) {
    const level = notificationLevel();
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
async function activate(context) {
    extensionContext = context;
    outputChannel = vscode.window.createOutputChannel('Auto Git');
    context.subscriptions.push(outputChannel);
    log('Auto Git extension activating...');

    // Surface a one-time "what's new" notice after a genuine upgrade.
    maybeShowWhatsNew(context);

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

    // Resolve the repository root so all git commands run from a consistent
    // location, and compute the workspace's path within the repo so operations
    // stay scoped to it (a workspace that is a subdirectory of a larger repo
    // must not sweep in unrelated changes).
    git = await createGitService(workspacePath);
    log(`Workspace initialized: ${workspacePath} (repo scope: ${scopePrefix || '.'})`);

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
 * Build a GitService rooted at the repository containing `folder`, scoped to
 * that folder. Falls back to the folder itself if the repo root cannot be
 * resolved (e.g. not a repo yet, or git missing) — the pipeline then surfaces
 * the specific error on first run.
 * @param {string} folder
 * @returns {Promise<GitService>}
 */
async function createGitService(folder) {
    const probe = new GitService(folder, (msg) => log(msg));
    try {
        const root = await probe.repositoryRoot();
        const rel = path.relative(root, folder).replace(/\\/g, '/');
        scopePrefix = rel && rel !== '.' && !rel.startsWith('..') ? rel : '';
        const scope = scopePrefix === '' ? '.' : scopePrefix;
        return new GitService(root, (msg) => log(msg), scope);
    } catch (err) {
        scopePrefix = '';
        log(`Could not resolve repository root (${errorText(err)}); operating on the workspace folder.`);
        return probe;
    }
}

/**
 * Convert a repo-root-relative path to one relative to the workspace folder,
 * so exclude patterns are matched with the same base as the file watcher.
 * @param {string} repoRelativePath
 * @returns {string}
 */
function toWorkspaceRelative(repoRelativePath) {
    if (scopePrefix && repoRelativePath.startsWith(`${scopePrefix}/`)) {
        return repoRelativePath.slice(scopePrefix.length + 1);
    }
    return repoRelativePath;
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
        }),
        vscode.commands.registerCommand('autoGitCopilot.rate', () => {
            vscode.env.openExternal(vscode.Uri.parse(REVIEW_URL));
            if (extensionContext) {
                const state = normalizeRatingState(extensionContext.globalState.get(STATE_RATING));
                state.rated = true;
                extensionContext.globalState.update(STATE_RATING, state);
            }
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
        approvedFingerprint = null;
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

        // isRepository throws on a missing git binary (mapped to a clear
        // message below); it returns false only for a genuine non-repo.
        if (!(await gitSvc.isRepository())) {
            log('Not a git repository; skipping.');
            notify('error', 'Auto Git: This workspace is not a git repository.');
            updateStatusBar();
            return;
        }

        // Do not auto-commit while a merge/rebase/cherry-pick/revert is in
        // progress: staging would record conflict markers and complete the
        // operation with a corrupted tree.
        const pending = await gitSvc.pendingOperation();
        if (pending) {
            log(`A ${pending} is in progress; skipping auto-commit until it is resolved.`);
            notify('warn', `Auto Git: Skipped — a ${pending} is in progress. Finish it first.`);
            updateStatusBar();
            return;
        }

        // Never commit onto a detached HEAD (checked-out tag/commit, mid-bisect):
        // it would create orphan commits and cannot be pushed.
        if (await gitSvc.isDetachedHead()) {
            log('HEAD is detached; skipping auto-commit.');
            notify('warn', 'Auto Git: Skipped — HEAD is detached (not on a branch).');
            updateStatusBar();
            return;
        }

        // Never auto-commit on protected branches.
        const protectedBranches = /** @type {string[]} */ (config.get('protectedBranches', []));
        if (protectedBranches.length > 0) {
            const branch = await gitSvc.currentBranch();
            if (branch && protectedBranches.includes(branch)) {
                log(`Branch "${branch}" is protected; skipping auto-commit.`);
                notify('warn', `Auto Git: Skipped commit — branch "${branch}" is protected.`);
                updateStatusBar();
                return;
            }
        }

        // Decide exactly which paths to stage: scoped to the workspace,
        // honoring includeUntracked, and filtered through excludePatterns so
        // excluded files (.env, dist, logs) are never committed even when an
        // included file triggers the run.
        const stageEntries = await selectPathsToStage(gitSvc, config);
        if (stageEntries.length === 0) {
            log('No eligible (non-excluded) changes to stage.');
            updateStatusBar();
            return;
        }

        const paths = [];
        for (const entry of stageEntries) {
            paths.push(entry.path);
            if (entry.origPath) paths.push(entry.origPath);
        }
        await gitSvc.stagePaths(paths);

        if (!(await gitSvc.hasStagedChanges())) {
            log('Nothing staged after applying filters; skipping commit.');
            updateStatusBar();
            return;
        }

        if (!(await guardAgainstSecrets(gitSvc))) {
            log('Commit blocked by secret scan.');
            updateStatusBar();
            return;
        }

        const commitMessage = await generateCommitMessage(stageEntries, gitSvc);
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

        // A successful commit is our engagement signal for the rating prompt.
        recordSuccessfulCommit();

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
 * Determine which changed paths should be staged: scoped to the workspace,
 * respecting includeUntracked, and excluding anything matching the configured
 * exclude patterns (matched against workspace-relative paths, as the watcher
 * does).
 * @param {GitService} gitSvc
 * @param {vscode.WorkspaceConfiguration} config
 * @returns {Promise<{ path: string, origPath?: string, code: string, status: string }[]>}
 */
async function selectPathsToStage(gitSvc, config) {
    const includeUntracked = config.get('includeUntracked', true);
    const entries = parseStatusZ(await gitSvc.statusZ());

    return entries.filter((entry) => {
        if (!includeUntracked && entry.status === 'Untracked') {
            return false;
        }
        if (isExcluded(toWorkspaceRelative(entry.path), compiledExcludes)) {
            log(`Excluding ${entry.path} from commit (matches an exclude pattern).`);
            return false;
        }
        if (entry.origPath && isExcluded(toWorkspaceRelative(entry.origPath), compiledExcludes)) {
            return false;
        }
        return true;
    });
}

/** @param {unknown} err */
function isMaxBufferError(err) {
    const e = /** @type {any} */ (err);
    return !!e && (e.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' || /maxBuffer/i.test(e.message || ''));
}

/** @param {string} text */
function sha256(text) {
    return crypto.createHash('sha256').update(text).digest('hex');
}

/**
 * Scan the staged diff for secrets before committing. Returns true when the
 * pipeline may proceed. Security notifications intentionally bypass the
 * notificationLevel setting — the secret gate must never fail silently.
 *
 * The commit is BLOCKED (fail closed) both when a secret is found and when the
 * diff cannot be scanned (too large). The user can override per exact content
 * via "Commit Anyway", which records a fingerprint of the reviewed diff; a new
 * or different staged change is always scanned again.
 * @param {GitService} gitSvc
 * @returns {Promise<boolean>}
 */
async function guardAgainstSecrets(gitSvc) {
    const config = getConfig();
    if (!config.get('scanForSecrets', true)) {
        return true;
    }

    /** @type {string | null} */
    let diff = null;
    let fingerprint;
    try {
        const lineCount = await gitSvc.stagedDiffLineCount();
        if (lineCount > SECRET_SCAN_MAX_LINES) {
            fingerprint = `oversize:${sha256(String(lineCount))}:${await stagedNameFingerprint(gitSvc)}`;
        } else {
            diff = await gitSvc.stagedDiff();
            fingerprint = sha256(diff);
        }
    } catch (err) {
        if (!isMaxBufferError(err)) throw err;
        fingerprint = `oversize:${await stagedNameFingerprint(gitSvc)}`;
    }

    // Consume a prior approval, but only for the exact content it covered.
    if (approvedFingerprint && approvedFingerprint === fingerprint) {
        approvedFingerprint = null;
        log('Secret scan skipped: user approved this exact staged content.');
        return true;
    }

    if (diff === null) {
        return blockUnscannable(
            fingerprint,
            'The staged change is too large to scan for secrets safely.'
        );
    }

    const ignorePatterns = compileIgnorePatterns(
        /** @type {string[]} */ (config.get('secretScanIgnorePatterns', [])),
        (msg) => log(`WARN: ${msg}`)
    );
    const result = scanDiff(diff, {
        ignorePatterns,
        onSuppressed: (f) =>
            log(`Secret finding suppressed by ignore pattern: ${f.file}:${f.line} [${f.ruleId}]`)
    });

    if (result.suppressedCount > 0) {
        log(`${result.suppressedCount} secret finding(s) suppressed by ignore patterns.`);
    }
    if (result.skipped) {
        return blockUnscannable(
            fingerprint,
            'The staged change is too large to scan for secrets safely.'
        );
    }
    if (result.findings.length === 0) {
        return true;
    }

    for (const finding of result.findings) {
        log(
            `SECRET BLOCKED: ${finding.description} [${finding.ruleId}] at ${finding.file}:${finding.line} (${finding.preview})`
        );
    }
    if (result.truncated) {
        log(`WARN: Secret findings truncated at ${result.findings.length}; fix and re-run for a full report.`);
    }

    const first = result.findings[0];
    const summary =
        result.findings.length === 1
            ? `${first.description} in ${first.file}:${first.line}`
            : `${result.findings.length} potential secrets (first: ${first.file}:${first.line})`;

    promptOverride(
        `Auto Git blocked the commit: ${summary}. Remove it, add an ignore pattern, or commit anyway.`,
        fingerprint
    );
    return false;
}

/**
 * A short, stable fingerprint of the staged file set, used when the full diff
 * cannot be hashed (too large to fetch).
 * @param {GitService} gitSvc
 * @returns {Promise<string>}
 */
async function stagedNameFingerprint(gitSvc) {
    try {
        const stat = await gitSvc.stagedDiffStat();
        return sha256(stat);
    } catch {
        return sha256('unknown-staged-set');
    }
}

/**
 * Block a commit that could not be scanned and offer an override.
 * @param {string} fingerprint
 * @param {string} reason
 * @returns {boolean} always false (fail closed)
 */
function blockUnscannable(fingerprint, reason) {
    log(`WARN: ${reason} Commit blocked until confirmed.`);
    promptOverride(`Auto Git: ${reason} Commit anyway?`, fingerprint);
    return false;
}

/**
 * Show the blocking warning with a "Commit Anyway" override bound to the exact
 * reviewed content via its fingerprint.
 * @param {string} message
 * @param {string} fingerprint
 */
function promptOverride(message, fingerprint) {
    vscode.window
        .showWarningMessage(message, 'Show Logs', 'Commit Anyway')
        .then((choice) => {
            if (choice === 'Show Logs' && outputChannel) {
                outputChannel.show(true);
            } else if (choice === 'Commit Anyway') {
                log('User approved committing this staged content despite the secret gate.');
                approvedFingerprint = fingerprint;
                performGitOperations();
            }
        });
}

/**
 * Map raw git errors to actionable messages. Returns '' for benign cases.
 * @param {any} error
 * @returns {string}
 */
function friendlyErrorMessage(error) {
    if (error && error.code === 'ENOENT') {
        return 'Git was not found on your PATH. Install Git and restart VS Code.';
    }
    if (error && error.detachedHead) {
        return 'HEAD is detached — checkout a branch before auto-committing.';
    }
    if (error && error.noRemote) {
        return 'No remote configured. Add one with "git remote add origin <url>" or disable autoPush.';
    }

    const text = `${(error && error.message) || ''} ${(error && error.stderr) || ''}`;

    if (text.includes('nothing to commit')) {
        return '';
    }
    if (isMaxBufferError(error)) {
        return 'A staged file is too large to process. Add it to .gitignore or your exclude patterns.';
    }
    if (text.includes('Permission denied') || /authentication|could not read Username/i.test(text)) {
        return 'Git authentication failed. Check your SSH keys or credentials.';
    }
    if (/remote rejected|non-fast-forward|fetch first/i.test(text)) {
        return 'Push rejected by remote — pull the latest changes first.';
    }
    if (/does not appear to be a git repository|no configured push destination|could not read from remote/i.test(text)) {
        return 'Push failed — check that a reachable remote is configured, or disable autoPush.';
    }
    if (/user.name|user.email|Please tell me who you are/i.test(text)) {
        return 'Git identity not configured. Run "git config --global user.name/user.email".';
    }
    return `Git operation failed: ${(error && error.message) || 'unknown error'}`;
}

/**
 * Generate a commit message, preferring the Copilot language model API and
 * falling back to a deterministic summary. Driven by the exact set of staged
 * entries so the message always matches what is committed.
 * @param {{ path: string, status: string, code: string }[]} entries
 * @param {GitService} gitSvc
 * @returns {Promise<string>}
 */
async function generateCommitMessage(entries, gitSvc) {
    const config = getConfig();
    const maxLength = /** @type {number} */ (config.get('maxCommitMessageLength', 72));

    if (!config.get('useAI', true)) {
        return generateFallbackFromEntries(entries);
    }

    try {
        if (!vscode.lm || typeof vscode.lm.selectChatModels !== 'function') {
            log('Language Model API unavailable; using fallback commit message.');
            return generateFallbackFromEntries(entries);
        }

        // Prefer any available Copilot model; do not pin a model family so the
        // extension keeps working as Copilot rotates its lineup.
        let models = await vscode.lm.selectChatModels({ vendor: 'copilot' });
        if (!models || models.length === 0) {
            models = await vscode.lm.selectChatModels({});
        }
        if (!models || models.length === 0) {
            log('No language models available; using fallback commit message.');
            return generateFallbackFromEntries(entries);
        }

        const model = models[0];
        log(`Using language model: ${model.vendor}/${model.family}`);

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

    return generateFallbackFromEntries(entries);
}

// --- Engagement: "what's new" notice and rating prompt ----------------------

/**
 * Show a one-time notice after the extension is upgraded, then record the new
 * version. Never shown on a fresh install. Respects the "none" notification
 * level so users who silenced popups stay silent.
 * @param {vscode.ExtensionContext} context
 */
function maybeShowWhatsNew(context) {
    try {
        const current = String(context.extension?.packageJSON?.version || '');
        const previous = context.globalState.get(STATE_VERSION);
        if (current) {
            context.globalState.update(STATE_VERSION, current);
        }
        if (notificationLevel() === 'none') return;
        if (!shouldShowWhatsNew(typeof previous === 'string' ? previous : undefined, current)) {
            return;
        }
        vscode.window
            .showInformationMessage(`AutoGit-AI updated to v${current}.`, "See what's new")
            .then((choice) => {
                if (choice) {
                    vscode.env.openExternal(vscode.Uri.parse(CHANGELOG_URL));
                }
            });
    } catch (err) {
        log(`WARN: what's-new check failed: ${errorText(err)}`);
    }
}

/**
 * Increment the persisted successful-commit counter and, when the heuristics
 * allow, invite the user to rate the extension. Best-effort and never throws
 * into the commit pipeline.
 */
function recordSuccessfulCommit() {
    if (!extensionContext) return;
    const context = extensionContext;
    try {
        const state = normalizeRatingState(context.globalState.get(STATE_RATING));
        state.commitCount += 1;

        const wantPrompt =
            getConfig().get('enableRatingPrompt', true) &&
            notificationLevel() !== 'none' &&
            shouldPromptForRating(state);

        if (!wantPrompt) {
            context.globalState.update(STATE_RATING, state);
            return;
        }

        // Persist optimistically as a "Later" *before* awaiting the click, so
        // commits that land while the toast is open can't re-read stale state
        // and stack duplicate prompts. The click only upgrades the outcome.
        const prompted = applyRatingOutcome(state, 'later');
        context.globalState.update(STATE_RATING, prompted);

        vscode.window
            .showInformationMessage(
                'Enjoying AutoGit-AI? A quick rating on the Marketplace really helps.',
                'Rate it ★',
                'Later',
                "Don't ask again"
            )
            .then((choice) => {
                if (choice === 'Rate it ★') {
                    vscode.env.openExternal(vscode.Uri.parse(REVIEW_URL));
                    context.globalState.update(STATE_RATING, { ...prompted, rated: true });
                } else if (choice === "Don't ask again") {
                    context.globalState.update(STATE_RATING, { ...prompted, dismissed: true });
                }
                log(`Rating prompt shown; outcome: ${choice || 'dismissed (no click)'}.`);
            });
    } catch (err) {
        log(`WARN: rating prompt failed: ${errorText(err)}`);
    }
}

function deactivate() {
    clearPendingTimeout();
    changeTracker.clear();
    // Disposables registered on context.subscriptions (status bar, watcher,
    // output channel, commands) are disposed by VS Code.
    statusBarItem = undefined;
    outputChannel = undefined;
    git = undefined;
    extensionContext = undefined;
}

module.exports = {
    activate,
    deactivate
};
