const vscode = require('vscode');
const { exec } = require('child_process');
const path = require('path');
const { promisify } = require('util');

const execAsync = promisify(exec);

let isEnabled = false;
let statusBarItem;
let pendingTimeout;
let workspacePath;
let fileSystemWatcher;
let changeTracker = new Set();
let lastCheckTime = 0;

/**
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {
    console.log('Auto Git with Copilot extension is activating...');
    
    try {
        // Get workspace
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
                
                // Start or stop file monitoring based on enabled state
                if (isEnabled) {
                    startFileMonitoring();
                } else {
                    stopFileMonitoring();
                }
                
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
                vscode.window.showInformationMessage('Auto Git: Manual commit triggered');
                performGitOperations();
                console.log('Auto Git: Manual commit triggered');
            } catch (error) {
                console.error('Error in commit now command:', error);
                vscode.window.showErrorMessage(`Auto Git commit failed: ${error.message}`);
            }
        });

        // Add test command for debugging
        const testCommand = vscode.commands.registerCommand('autoGitCopilot.test', () => {
            try {
                vscode.window.showInformationMessage('Auto Git: Test command executed!');
                console.log('Auto Git: Test command executed successfully');
                console.log('Auto Git: Current enabled state:', isEnabled);
                console.log('Auto Git: Workspace path:', workspacePath);
                console.log('Auto Git: File system watcher active:', !!fileSystemWatcher);
                console.log('Auto Git: Changes tracked:', changeTracker.size);
            } catch (error) {
                console.error('Error in test command:', error);
            }
        });

        context.subscriptions.push(toggleCommand, commitNowCommand, testCommand);
        console.log('Auto Git: Commands registered successfully');

        // ALTERNATIVE APPROACH: Use multiple file change detection methods
        setupFileChangeDetection(context);

        // Register configuration change listener
        try {
            const configListener = vscode.workspace.onDidChangeConfiguration((e) => {
                if (e.affectsConfiguration('autoGitCopilot.enabled')) {
                    const config = vscode.workspace.getConfiguration('autoGitCopilot');
                    const newEnabled = config.get('enabled', false);
                    if (newEnabled !== isEnabled) {
                        isEnabled = newEnabled;
                        updateStatusBar();
                        
                        if (isEnabled) {
                            startFileMonitoring();
                        } else {
                            stopFileMonitoring();
                        }
                        
                        console.log(`Auto Git: Configuration changed, enabled: ${isEnabled}`);
                    }
                }
            });
            context.subscriptions.push(configListener);
            console.log('Auto Git: Configuration listener registered');
        } catch (configError) {
            console.error('Auto Git: Failed to register config listener:', configError);
        }

        console.log('Auto Git extension activation completed successfully');
        vscode.window.showInformationMessage('Auto Git with Copilot loaded successfully!');
        
    } catch (error) {
        console.error('Auto Git extension activation failed:', error);
        vscode.window.showErrorMessage(`Auto Git extension failed to load: ${error.message}`);
    }
}

function setupFileChangeDetection(context) {
    console.log('Auto Git: Setting up alternative file change detection...');
    
    // Method 1: File System Watcher (watches for any file changes in workspace)
    try {
        // Watch all files except those in exclude patterns
        const pattern = new vscode.RelativePattern(workspacePath, '**/*');
        fileSystemWatcher = vscode.workspace.createFileSystemWatcher(pattern);
        
        // Handle file changes
        fileSystemWatcher.onDidChange((uri) => {
            handleFileChange(uri, 'changed');
        });
        
        // Handle file creation
        fileSystemWatcher.onDidCreate((uri) => {
            handleFileChange(uri, 'created');
        });
        
        // Handle file deletion
        fileSystemWatcher.onDidDelete((uri) => {
            handleFileChange(uri, 'deleted');
        });
        
        context.subscriptions.push(fileSystemWatcher);
        console.log('Auto Git: File system watcher created successfully');
    } catch (fsWatcherError) {
        console.error('Auto Git: Failed to create file system watcher:', fsWatcherError);
    }
    
    // Method 2: Text Document Change Detection (detects when files are modified)
    try {
        const textChangeListener = vscode.workspace.onDidChangeTextDocument((event) => {
            if (event.document.uri.scheme === 'file') {
                handleFileChange(event.document.uri, 'text-changed');
            }
        });
        
        context.subscriptions.push(textChangeListener);
        console.log('Auto Git: Text change listener created successfully');
    } catch (textChangeError) {
        console.error('Auto Git: Failed to create text change listener:', textChangeError);
    }
    
    // Method 3: Periodic Git Status Check (fallback)
    const periodicCheck = setInterval(() => {
        if (isEnabled && changeTracker.size > 0) {
            const now = Date.now();
            // Check if enough time has passed since last activity
            if (now - lastCheckTime > 5000) { // 5 seconds of inactivity
                console.log('Auto Git: Periodic check triggered git operations');
                scheduleGitOperations();
                changeTracker.clear();
            }
        }
    }, 10000); // Check every 10 seconds
    
    // Clean up interval on deactivation
    context.subscriptions.push({
        dispose: () => clearInterval(periodicCheck)
    });
    
    console.log('Auto Git: Alternative file change detection setup complete');
}

function handleFileChange(uri, changeType) {
    if (!isEnabled) return;
    
    // Check if file should be excluded
    const config = vscode.workspace.getConfiguration('autoGitCopilot');
    const excludePatterns = config.get('excludePatterns', []);
    const relativePath = path.relative(workspacePath, uri.fsPath);
    
    const shouldExclude = excludePatterns.some(pattern => {
        try {
            const regex = new RegExp(pattern.replace(/\*\*/g, '.*').replace(/\*/g, '[^/]*'));
            return regex.test(relativePath);
        } catch (regexError) {
            console.warn(`Auto Git: Invalid pattern ${pattern}:`, regexError);
            return false;
        }
    });

    if (shouldExclude) {
        console.log(`Auto Git: Excluding file ${relativePath} (${changeType})`);
        return;
    }

    console.log(`Auto Git: File ${changeType}: ${relativePath}`);
    
    // Track the change
    changeTracker.add(relativePath);
    lastCheckTime = Date.now();
    
    // Schedule git operations
    scheduleGitOperations();
}

function scheduleGitOperations() {
    // Debounce git operations
    if (pendingTimeout) {
        clearTimeout(pendingTimeout);
    }

    const config = vscode.workspace.getConfiguration('autoGitCopilot');
    const delay = config.get('delayMs', 3000);
    
    if (statusBarItem) {
        statusBarItem.text = `$(sync~spin) Auto Git: Pending...`;
    }
    
    pendingTimeout = setTimeout(() => {
        performGitOperations();
        pendingTimeout = null;
        changeTracker.clear();
    }, delay);
}

function startFileMonitoring() {
    console.log('Auto Git: Starting file monitoring');
    changeTracker.clear();
    lastCheckTime = Date.now();
}

function stopFileMonitoring() {
    console.log('Auto Git: Stopping file monitoring');
    if (pendingTimeout) {
        clearTimeout(pendingTimeout);
        pendingTimeout = null;
    }
    changeTracker.clear();
    updateStatusBar();
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
        if (statusBarItem) {
            statusBarItem.text = `$(sync~spin) Auto Git: Working...`;
        }
        
        console.log('Auto Git: Starting git operations...');
        
        // Check if we're in a git repository
        try {
            await execAsync('git rev-parse --git-dir', { cwd: workspacePath });
            console.log('Auto Git: Confirmed git repository');
        } catch (error) {
            console.error('Auto Git: Not a git repository:', error);
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

        console.log('Auto Git: Changes detected, proceeding with commit');

        // Stage files based on configuration
        const config = vscode.workspace.getConfiguration('autoGitCopilot');
        const includeUntracked = config.get('includeUntracked', true);
        
        if (includeUntracked) {
            await execAsync('git add .', { cwd: workspacePath });
            console.log('Auto Git: Staged all files including untracked');
        } else {
            // Only stage modified files (not untracked)
            await execAsync('git add -u', { cwd: workspacePath });
            console.log('Auto Git: Staged only tracked files');
        }

        // Generate commit message using Copilot
        const commitMessage = await generateCommitMessage(statusOutput);
        console.log(`Auto Git: Generated commit message: "${commitMessage}"`);
        
        // Commit changes with proper escaping
        const escapedMessage = commitMessage.replace(/"/g, '\\"').replace(/'/g, "\\'").replace(/`/g, '\\`');
        await execAsync(`git commit -m "${escapedMessage}"`, { cwd: workspacePath });
        console.log('Auto Git: Changes committed successfully');
        
        // Push changes
        await execAsync('git push', { cwd: workspacePath });
        console.log('Auto Git: Changes pushed successfully');
        
        vscode.window.showInformationMessage(`Auto Git: Committed and pushed: "${commitMessage}"`);
        updateStatusBar();
        
    } catch (error) {
        console.error('Auto Git error:', error);
        let errorMessage = error.message;
        
        // Provide more helpful error messages
        if (errorMessage.includes('nothing to commit')) {
            console.log('Auto Git: Nothing to commit (already up to date)');
            updateStatusBar();
            return;
        } else if (errorMessage.includes('Permission denied') || errorMessage.includes('authentication')) {
            errorMessage = 'Git authentication failed. Check your SSH keys or credentials.';
        } else if (errorMessage.includes('remote rejected')) {
            errorMessage = 'Push rejected by remote. You may need to pull first.';
        } else if (errorMessage.includes('non-zero exit code')) {
            errorMessage = 'Git operation failed. Check repository status.';
        }
        
        vscode.window.showErrorMessage(`Auto Git error: ${errorMessage}`);
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

        // Create context for Copilot
        const context = `Generate a concise commit message for the following changes:
${changedFiles.map(f => `${f.status}: ${f.path}`).join('\n')}

Guidelines:
- Be concise and descriptive (under 72 characters)
- Follow conventional commit format when applicable (feat:, fix:, docs:, refactor:, etc.)
- Describe WHAT was changed, not HOW
- Use present tense ("add" not "added")

Examples:
- "feat: add user authentication system"
- "fix: resolve login validation bug"
- "docs: update API documentation"
- "refactor: simplify error handling logic"
- "style: improve code formatting"
- "test: add unit tests for user service"

Generate only the commit message, no quotes or explanation.`;

        console.log('Auto Git: Attempting to generate AI commit message...');

        // Try to use Copilot Chat API
        try {
            if (vscode.lm && typeof vscode.lm.selectChatModels === 'function') {
                const models = await vscode.lm.selectChatModels({
                    vendor: 'copilot',
                    family: 'gpt-4'
                });

                if (models && models.length > 0) {
                    console.log('Auto Git: Copilot model found, generating message...');
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

                    // Remove any extra explanations after the commit message
                    const lines = commitMessage.split('\n');
                    commitMessage = lines[0].trim();

                    // Remove any remaining quotes or backticks
                    commitMessage = commitMessage.replace(/["`']/g, '');

                    // Ensure it's not too long
                    const config = vscode.workspace.getConfiguration('autoGitCopilot');
                    const maxLength = config.get('maxCommitMessageLength', 72);
                    if (commitMessage.length > maxLength) {
                        commitMessage = commitMessage.substring(0, maxLength - 3) + '...';
                    }

                    if (commitMessage && commitMessage.length > 0) {
                        console.log('Auto Git: AI commit message generated successfully');
                        return commitMessage;
                    }
                } else {
                    console.log('Auto Git: No Copilot models available');
                }
            } else {
                console.log('Auto Git: Copilot Language Model API not available');
            }
        } catch (copilotError) {
            console.warn('Auto Git: Copilot API error:', copilotError.message);
        }
    } catch (error) {
        console.warn('Auto Git: Could not generate AI commit message:', error.message);
    }

    // Fallback to simple commit message
    console.log('Auto Git: Using fallback commit message');
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

    const fileCount = lines.length;
    return `Auto-commit: ${parts.join(', ')} file${fileCount === 1 ? '' : 's'}`;
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
    console.log('Auto Git extension deactivating...');
    
    if (pendingTimeout) {
        clearTimeout(pendingTimeout);
        pendingTimeout = null;
    }
    
    if (fileSystemWatcher) {
        fileSystemWatcher.dispose();
        fileSystemWatcher = null;
    }
    
    changeTracker.clear();
    console.log('Auto Git extension deactivated');
}

module.exports = {
    activate,
    deactivate
};