const vscode = require('vscode');
const { exec } = require('child_process');
const { promisify } = require('util');

const execAsync = promisify(exec);

let isEnabled = false;
let statusBarItem;
let workspacePath;

/**
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {
    console.log('Auto Git extension is activating...');
    
    try {
        // Get workspace
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) {
            vscode.window.showWarningMessage('Auto Git: No workspace folder found');
            return;
        }

        workspacePath = workspaceFolders[0].uri.fsPath;
        console.log('Auto Git: Workspace path:', workspacePath);

        // Create status bar item
        statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
        statusBarItem.command = 'autoGitCopilot.toggle';
        updateStatusBar();
        statusBarItem.show();
        context.subscriptions.push(statusBarItem);

        // Register toggle command
        const toggleCommand = vscode.commands.registerCommand('autoGitCopilot.toggle', () => {
            isEnabled = !isEnabled;
            updateStatusBar();
            vscode.window.showInformationMessage(`Auto Git ${isEnabled ? 'enabled' : 'disabled'}`);
            console.log(`Auto Git toggled: ${isEnabled}`);
        });

        // Register commit now command
        const commitNowCommand = vscode.commands.registerCommand('autoGitCopilot.commitNow', () => {
            vscode.window.showInformationMessage('Auto Git: Commit command triggered');
            performGitOperations();
        });

        context.subscriptions.push(toggleCommand, commitNowCommand);

        // Try to register save listener after a delay
        setTimeout(() => {
            try {
                if (vscode.workspace && typeof vscode.workspace.onDidSaveDocument === 'function') {
                    const saveListener = vscode.workspace.onDidSaveDocument((document) => {
                        if (isEnabled) {
                            vscode.window.showInformationMessage(`Auto Git: File saved: ${document.fileName}`);
                            performGitOperations();
                        }
                    });
                    context.subscriptions.push(saveListener);
                    console.log('Auto Git: Save listener registered successfully');
                } else {
                    console.log('Auto Git: onDidSaveDocument not available');
                }
            } catch (error) {
                console.error('Auto Git: Save listener error:', error);
            }
        }, 1000);

        vscode.window.showInformationMessage('Auto Git extension loaded!');
        console.log('Auto Git extension activated successfully');

    } catch (error) {
        console.error('Auto Git activation error:', error);
        vscode.window.showErrorMessage(`Auto Git failed to load: ${error.message}`);
    }
}

function updateStatusBar() {
    if (!statusBarItem) return;
    
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
    if (!workspacePath) {
        vscode.window.showErrorMessage('Auto Git: No workspace path');
        return;
    }

    try {
        // Simple git status check
        const { stdout } = await execAsync('git status --porcelain', { cwd: workspacePath });
        
        if (stdout.trim().length === 0) {
            vscode.window.showInformationMessage('Auto Git: No changes to commit');
            return;
        }

        // Stage all files
        await execAsync('git add .', { cwd: workspacePath });
        
        // Create simple commit message
        const commitMessage = `Auto-commit: Update files at ${new Date().toISOString()}`;
        
        // Commit
        await execAsync(`git commit -m "${commitMessage}"`, { cwd: workspacePath });
        
        // Push
        await execAsync('git push', { cwd: workspacePath });
        
        vscode.window.showInformationMessage(`Auto Git: Successfully committed and pushed`);
        
    } catch (error) {
        console.error('Auto Git operation error:', error);
        vscode.window.showErrorMessage(`Auto Git error: ${error.message}`);
    }
}

function deactivate() {
    console.log('Auto Git extension deactivated');
}

module.exports = {
    activate,
    deactivate
};