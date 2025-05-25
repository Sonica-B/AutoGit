const vscode = require('vscode');
const simpleGit = require('simple-git');
const path = require('path');

let isEnabled = false;
let statusBarItem;
let pendingTimeout;
let git;

/**
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {
    console.log('Auto Git with Copilot extension is now active!');

    // Initialize git
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
        vscode.window.showWarningMessage('Auto Git: No workspace folder found');
        return;
    }

    git = simpleGit(workspaceFolders[0].uri.fsPath);

    // Create status bar item
    statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    statusBarItem.command = 'autoGitCopilot.toggle';
    updateStatusBar();
    statusBarItem.show();
    context.subscriptions.push(statusBarItem);

    // Get initial configuration
    const config = vscode.workspace.getConfiguration('autoGitCopilot');
    isEnabled = config.get('enabled', false);

    // Register commands
    const toggleCommand = vscode.commands.registerCommand('autoGitCopilot.toggle', () => {
        isEnabled = !isEnabled;
        const config = vscode.workspace.getConfiguration('autoGitCopilot');
        config.update('enabled', isEnabled, vscode.ConfigurationTarget.Workspace);
        updateStatusBar();
        vscode.window.showInformationMessage(`Auto Git ${isEnabled ? 'enabled' : 'disabled'}`);
    });

    const commitNowCommand = vscode.commands.registerCommand('autoGitCopilot.commitNow', () => {
        if (pendingTimeout) {
            clearTimeout(pendingTimeout);
            pendingTimeout = null;
        }
        performGitOperations();
    });

    // Register file save listener
    const saveListener = vscode.workspace.onDidSaveDocument((document) => {
        if (!isEnabled) return;
        
        const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
        if (!workspaceFolder) return;

        // Check if file should be excluded
        const config = vscode.workspace.getConfiguration('autoGitCopilot');
        const excludePatterns = config.get('excludePatterns', []);
        const relativePath = path.relative(workspaceFolder.uri.fsPath, document.uri.fsPath);
        
        const shouldExclude = excludePatterns.some(pattern => {
            const regex = new RegExp(pattern.replace(/\*\*/g, '.*').replace(/\*/g, '[^/]*'));
            return regex.test(relativePath);
        });

        if (shouldExclude) {
            console.log(`Auto Git: Excluding file ${relativePath}`);
            return;
        }

        // Debounce git operations
        if (pendingTimeout) {
            clearTimeout(pendingTimeout);
        }

        const delay = config.get('delayMs', 3000);
        statusBarItem.text = `$(sync~spin) Auto Git: Pending...`;
        
        pendingTimeout = setTimeout(() => {
            performGitOperations();
            pendingTimeout = null;
        }, delay);
    });

    // Register configuration change listener
    const configListener = vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration('autoGitCopilot.enabled')) {
            const config = vscode.workspace.getConfiguration('autoGitCopilot');
            isEnabled = config.get('enabled', false);
            updateStatusBar();
        }
    });

    context.subscriptions.push(toggleCommand, commitNowCommand, saveListener, configListener);
}

function updateStatusBar() {
    if (isEnabled) {
        statusBarItem.text = `$(git-branch) Auto Git: ON`;
        statusBarItem.tooltip = 'Auto Git is enabled. Click to disable.';
        statusBarItem.backgroundColor = undefined;
    } else {
        statusBarItem.text = `$(git-branch) Auto Git: OFF`;
        statusBarItem.tooltip = 'Auto Git is disabled. Click to enable.';
        statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
    }
}

async function performGitOperations() {
    try {
        statusBarItem.text = `$(sync~spin) Auto Git: Working...`;
        
        // Check if we're in a git repository
        const isRepo = await git.checkIsRepo();
        if (!isRepo) {
            vscode.window.showErrorMessage('Auto Git: Not a git repository');
            updateStatusBar();
            return;
        }

        // Get git status
        const status = await git.status();
        const hasChanges = status.files.length > 0;
        
        if (!hasChanges) {
            console.log('Auto Git: No changes to commit');
            updateStatusBar();
            return;
        }

        // Stage files
        const config = vscode.workspace.getConfiguration('autoGitCopilot');
        const includeUntracked = config.get('includeUntracked', true);
        
        if (includeUntracked) {
            await git.add('.');
        } else {
            // Only stage modified files
            const modifiedFiles = status.files
                .filter(file => file.index !== '?' && file.working_dir !== '?')
                .map(file => file.path);
            
            if (modifiedFiles.length > 0) {
                await git.add(modifiedFiles);
            }
        }

        // Generate commit message using Copilot
        const commitMessage = await generateCommitMessage(status);
        
        // Commit changes
        await git.commit(commitMessage);
        
        // Push changes
        await git.push();
        
        vscode.window.showInformationMessage(`Auto Git: Committed and pushed: "${commitMessage}"`);
        updateStatusBar();
        
    } catch (error) {
        console.error('Auto Git error:', error);
        vscode.window.showErrorMessage(`Auto Git error: ${error.message}`);
        updateStatusBar();
    }
}

async function generateCommitMessage(status) {
    try {
        // Prepare context for Copilot
        const changedFiles = status.files.map(file => ({
            path: file.path,
            status: getFileStatus(file)
        }));

        const context = `Generate a concise commit message for the following changes:
${changedFiles.map(f => `${f.status}: ${f.path}`).join('\n')}

The commit message should:
- Be concise and descriptive
- Follow conventional commit format if applicable (feat:, fix:, docs:, etc.)
- Be under 72 characters
- Describe what was changed, not how

Example formats:
- "feat: add user authentication system in file(s)"
- "fix: resolve login validation bug in file(s)"
- "chore: update dependencies and clean up code"
- "docs: update API documentation in file(s)"
- "refactor: simplify user service logic in file(s)"
- "test: add unit tests for user service in file(s)"
- "style: improve code formatting and readability in file(s)"
- "ci: update CI configuration for better testing in file(s)"
- "build: update build scripts for better performance in file(s)"
- "perf: optimize image loading in file(s)"
- "revert: revert changes from commit <hash> in file(s)"
- "release: v1.0.0 - Initial release with basic features in file(s)"`;

        // Try to use Copilot Chat API
        const models = await vscode.lm.selectChatModels({
            vendor: 'copilot',
            family: 'gpt-4'
        });

        if (models && models.length > 0) {
            const model = models[0];
            const messages = [
                vscode.LanguageModelChatMessage.User(context)
            ];

            const response = await model.sendRequest(messages, {}, new vscode.CancellationTokenSource().token);
            
            let commitMessage = '';
            for await (const fragment of response.text) {
                commitMessage += fragment;
            }

            // Clean up the response
            commitMessage = commitMessage.trim();
            
            // Remove quotes if present
            if ((commitMessage.startsWith('"') && commitMessage.endsWith('"')) ||
                (commitMessage.startsWith("'") && commitMessage.endsWith("'"))) {
                commitMessage = commitMessage.slice(1, -1);
            }

            // Ensure it's not too long
            const config = vscode.workspace.getConfiguration('autoGitCopilot');
            const maxLength = config.get('maxCommitMessageLength', 72);
            if (commitMessage.length > maxLength) {
                commitMessage = commitMessage.substring(0, maxLength - 3) + '...';
            }

            return commitMessage;
        }
    } catch (error) {
        console.warn('Auto Git: Could not generate AI commit message:', error.message);
    }

    // Fallback to simple commit message
    return generateFallbackCommitMessage(status);
}

function generateFallbackCommitMessage(status) {
    const added = status.files.filter(f => f.index === 'A' || f.working_dir === '?').length;
    const modified = status.files.filter(f => f.index === 'M' || f.working_dir === 'M').length;
    const deleted = status.files.filter(f => f.index === 'D' || f.working_dir === 'D').length;

    const parts = [];
    if (added > 0) parts.push(`${added} added`);
    if (modified > 0) parts.push(`${modified} modified`);
    if (deleted > 0) parts.push(`${deleted} deleted`);

    if (parts.length === 0) {
        return 'Auto-commit: Update files';
    }

    return `Auto-commit: ${parts.join(', ')} file${status.files.length === 1 ? '' : 's'}`;
}

function getFileStatus(file) {
    if (file.index === 'A' || file.working_dir === '?') return 'Added';
    if (file.index === 'M' || file.working_dir === 'M') return 'Modified';
    if (file.index === 'D' || file.working_dir === 'D') return 'Deleted';
    if (file.index === 'R') return 'Renamed';
    if (file.index === 'C') return 'Copied';
    return 'Changed';
}

function deactivate() {
    if (pendingTimeout) {
        clearTimeout(pendingTimeout);
    }
}

module.exports = {
    activate,
    deactivate
};