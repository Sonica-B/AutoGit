const vscode = require('vscode');
const { exec } = require('child_process');
const path = require('path');
const { promisify } = require('util');

const execAsync = promisify(exec);

let isEnabled = false;
let statusBarItem;
let pendingTimeout;
let workspacePath;

/**
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {
    try {
        console.log('Auto Git with Copilot extension is now active!');
        
        // Initialize git
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) {
            console.log('Auto Git: No workspace folder found');
            vscode.window.showWarningMessage('Auto Git: No workspace folder found');
            return;
        }

        workspacePath = workspaceFolders[0].uri.fsPath;
        console.log('Auto Git: Workspace initialized:', workspacePath);

        // Create status bar item
        statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
        statusBarItem.command = 'autoGitCopilot.toggle';
        updateStatusBar();
        statusBarItem.show();
        context.subscriptions.push(statusBarItem);
        console.log('Auto Git: Status bar item created');

        // Get initial configuration
        const config = vscode.workspace.getConfiguration('autoGitCopilot');
        isEnabled = config.get('enabled', false);
        console.log('Auto Git: Initial enabled state:', isEnabled);

        // Register commands
        const toggleCommand = vscode.commands.registerCommand('autoGitCopilot.toggle', () => {
            try {
                isEnabled = !isEnabled;
                const config = vscode.workspace.getConfiguration('autoGitCopilot');
                config.update('enabled', isEnabled, vscode.ConfigurationTarget.Workspace);
                updateStatusBar();
                vscode.window.showInformationMessage(`Auto Git ${isEnabled ? 'enabled' : 'disabled'}`);
                console.log(`Auto Git toggled: ${isEnabled ? 'enabled' : 'disabled'}`);
            } catch (error) {
                console.error('Error in toggle command:', error);
                vscode.window.showErrorMessage(`Auto Git toggle failed: ${error.message}`);
            }
        });

        const commitNowCommand = vscode.commands.registerCommand('autoGitCopilot.commitNow', () => {
            try {
                if (pendingTimeout) {
                    clearTimeout(pendingTimeout);
                    pendingTimeout = null;
                }
                performGitOperations();
                console.log('Auto Git: Manual commit triggered');
            } catch (error) {
                console.error('Error in commit now command:', error);
                vscode.window.showErrorMessage(`Auto Git commit failed: ${error.message}`);
            }
        });

        console.log('Auto Git: Commands registered successfully');

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
        
        console.log('Auto Git extension activation completed successfully');
        vscode.window.showInformationMessage('Auto Git extension loaded successfully!');
        
    } catch (error) {
        console.error('Auto Git extension activation failed:', error);
        vscode.window.showErrorMessage(`Auto Git extension failed to load: ${error.message}`);
    }
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
        try {
            await execAsync('git rev-parse --git-dir', { cwd: workspacePath });
        } catch (error) {
            vscode.window.showErrorMessage('Auto Git: Not a git repository');
            updateStatusBar();
            return;
        }

        // Get git status
        const { stdout: statusOutput } = await execAsync('git status --porcelain', { cwd: workspacePath });
        const hasChanges = statusOutput.trim().length > 0;
        
        if (!hasChanges) {
            console.log('Auto Git: No changes to commit');
            updateStatusBar();
            return;
        }

        // Stage files
        const config = vscode.workspace.getConfiguration('autoGitCopilot');
        const includeUntracked = config.get('includeUntracked', true);
        
        if (includeUntracked) {
            await execAsync('git add .', { cwd: workspacePath });
        } else {
            // Only stage modified files (not untracked)
            await execAsync('git add -u', { cwd: workspacePath });
        }

        // Generate commit message using Copilot
        const commitMessage = await generateCommitMessage(statusOutput);
        
        // Commit changes
        const escapedMessage = commitMessage.replace(/"/g, '\\"');
        await execAsync(`git commit -m "${escapedMessage}"`, { cwd: workspacePath });
        
        // Push changes
        await execAsync('git push', { cwd: workspacePath });
        
        vscode.window.showInformationMessage(`Auto Git: Committed and pushed: "${commitMessage}"`);
        updateStatusBar();
        
    } catch (error) {
        console.error('Auto Git error:', error);
        vscode.window.showErrorMessage(`Auto Git error: ${error.message}`);
        updateStatusBar();
    }
}

async function generateCommitMessage(statusOutput) {
    try {
        // Parse git status output
        const lines = statusOutput.trim().split('\n').filter(line => line.trim());
        const changedFiles = lines.map(line => {
            const status = line.substring(0, 2);
            const filename = line.substring(3);
            return {
                path: filename,
                status: getFileStatusFromCode(status)
            };
        });

        if (changedFiles.length === 0) {
            return 'Auto-commit: Update files';
        }

        const context = `Generate a concise commit message for the following changes:
${changedFiles.map(f => `${f.status}: ${f.path}`).join('\n')}

The commit message should:
- Be concise and descriptive
- Follow conventional commit format if applicable (feat:, fix:, docs:, etc.)
- Be under 72 characters
- Describe what was changed, not how

Example formats:
- "feat: add user authentication system"
- "fix: resolve login validation bug"
- "docs: update API documentation"
- "refactor: simplify user service logic"`;

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
    return generateFallbackCommitMessage(statusOutput);
}

function generateFallbackCommitMessage(statusOutput) {
    const lines = statusOutput.trim().split('\n').filter(line => line.trim());
    
    let added = 0, modified = 0, deleted = 0;
    
    lines.forEach(line => {
        const status = line.substring(0, 2);
        if (status.includes('A') || status.includes('?')) added++;
        else if (status.includes('M')) modified++;
        else if (status.includes('D')) deleted++;
    });

    const parts = [];
    if (added > 0) parts.push(`${added} added`);
    if (modified > 0) parts.push(`${modified} modified`);
    if (deleted > 0) parts.push(`${deleted} deleted`);

    if (parts.length === 0) {
        return 'Auto-commit: Update files';
    }

    return `Auto-commit: ${parts.join(', ')} file${lines.length === 1 ? '' : 's'}`;
}

function getFileStatusFromCode(statusCode) {
    // Git porcelain status codes
    if (statusCode.includes('A')) return 'Added';
    if (statusCode.includes('M')) return 'Modified';
    if (statusCode.includes('D')) return 'Deleted';
    if (statusCode.includes('R')) return 'Renamed';
    if (statusCode.includes('C')) return 'Copied';
    if (statusCode.includes('?')) return 'Untracked';
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