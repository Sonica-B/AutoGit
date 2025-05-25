# Auto Git with Copilot

A VS Code extension that automatically stages, commits, and pushes your changes with AI-generated commit messages using GitHub Copilot.

## Features

- **Automatic Git Operations**: Automatically stages, commits, and pushes changes when you save files
- **AI-Powered Commit Messages**: Uses GitHub Copilot to generate meaningful, concise commit messages
- **Smart File Filtering**: Excludes common build artifacts and sensitive files
- **Configurable Delays**: Debounces commits to avoid excessive git operations
- **Manual Override**: Option to commit immediately or toggle auto-commit on/off
- **Status Bar Integration**: See current status and toggle functionality from the status bar

## Prerequisites

1. **Git**: Ensure Git is installed and configured on your system
2. **GitHub Copilot**: Must have the GitHub Copilot extension installed and active in VS Code
3. **Git Repository**: Your workspace must be a valid Git repository with a remote configured

## Installation

### Option 1: Install from VSIX (Recommended)
1. Download the `.vsix` file
2. Open VS Code
3. Go to Extensions view (`Ctrl+Shift+X`)
4. Click the `...` menu and select "Install from VSIX..."
5. Select the downloaded `.vsix` file

### Option 2: Build from Source
1. Clone or download this repository
2. Open terminal in the extension directory
3. Run `npm install` to install dependencies
4. Run `vsce package` to create a `.vsix` file
5. Install the generated `.vsix` file

## Setup

1. **Configure Git**: Ensure your Git user name and email are set:
   ```bash
   git config --global user.name "Your Name"
   git config --global user.email "your.email@example.com"
   ```

2. **Enable GitHub Copilot**: Make sure the GitHub Copilot extension is installed and you're signed in

3. **Open a Git Repository**: The extension only works in VS Code workspaces that are Git repositories

## Usage

### Basic Usage

1. **Enable Auto Git**: Click the status bar item "Auto Git: OFF" to enable, or use the command palette (`Ctrl+Shift+P`) and search for "Toggle Auto Git"

2. **Save Files**: Once enabled, simply save any file in your project. The extension will:
   - Wait for the configured delay (default: 3 seconds)
   - Stage all changes
   - Generate an AI commit message
   - Commit the changes
   - Push to the remote repository

3. **Manual Commit**: Use the command "Commit Changes Now" to immediately trigger a commit without waiting

### Commands

- `Auto Git: Toggle Auto Git` - Enable/disable automatic git operations
- `Auto Git: Commit Changes Now` - Immediately commit current changes

### Status Bar

The status bar shows the current state:
- `Auto Git: OFF` (orange background) - Auto-commit disabled
- `Auto Git: ON` - Auto-commit enabled and ready
- `Auto Git: Pending...` - Waiting for delay timer
- `Auto Git: Working...` - Currently performing git operations

## Configuration

Access settings via File → Preferences → Settings, then search for "Auto Git":

### Available Settings

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `autoGitCopilot.enabled` | boolean | `false` | Enable automatic git operations on file save |
| `autoGitCopilot.delayMs` | number | `3000` | Delay in milliseconds before triggering git operations |
| `autoGitCopilot.includeUntracked` | boolean | `true` | Include untracked files in automatic commits |
| `autoGitCopilot.maxCommitMessageLength` | number | `72` | Maximum length for commit messages |
| `autoGitCopilot.excludePatterns` | array | See below | File patterns to exclude from auto-commit |

### Default Exclude Patterns

```json
[
  "node_modules/**",
  ".git/**",
  "*.log",
  ".env*",
  "dist/**",
  "build/**"
]
```

### Example Configuration

```json
{
  "autoGitCopilot.enabled": true,
  "autoGitCopilot.delayMs": 5000,
  "autoGitCopilot.includeUntracked": false,
  "autoGitCopilot.maxCommitMessageLength": 50,
  "autoGitCopilot.excludePatterns": [
    "node_modules/**",
    "*.log",
    ".env*",
    "dist/**",
    "coverage/**",
    "*.tmp"
  ]
}
```

## AI Commit Messages

The extension uses GitHub Copilot to generate contextual commit messages based on:

- Files that were changed
- Type of changes (added, modified, deleted)
- File paths and names

### Message Format

The AI attempts to follow conventional commit formats:
- `feat: add new user authentication`
- `fix: resolve login validation issue`
- `docs: update API documentation`
- `refactor: simplify error handling`

### Fallback Messages

If Copilot is unavailable, the extension generates simple descriptive messages:
- `Auto-commit: 3 modified files`
- `Auto-commit: 1 added, 2 modified files`

## Best Practices

1. **Use in Development**: This extension is designed for development workflows, not production deployments

2. **Review Changes**: While convenient, always review your changes before enabling auto-commit

3. **Configure Exclusions**: Make sure to exclude sensitive files, build artifacts, and temporary files

4. **Set Appropriate Delay**: Use a delay that gives you time to make related changes without creating too many commits

5. **Monitor Status**: Keep an eye on the status bar to understand what the extension is doing

## Troubleshooting

### Common Issues

**Extension not working:**
- Ensure you're in a Git repository
- Check that GitHub Copilot is installed and active
- Verify Git is properly configured

**No commit messages generated:**
- Ensure GitHub Copilot is working (try using it in a file)
- Check that you have an active Copilot subscription
- The extension will fall back to simple messages if Copilot is unavailable

**Too many commits:**
- Increase the delay setting
- Review your exclude patterns
- Consider disabling for large file operations

**Push failures:**
- Ensure you have push permissions to the remote repository
- Check your Git authentication (SSH keys, tokens)
- Verify the remote repository is accessible

### Logs and Debugging

Check the VS Code Developer Console for detailed logs:
1. Help → Toggle Developer Tools
2. Go to Console tab
3. Look for "Auto Git" messages

## Security Considerations

- The extension only works with files you explicitly save
- Sensitive files can be excluded via patterns
- All Git operations use your existing Git configuration
- Commit messages are generated locally using Copilot

## Contributing

This extension is open for contributions. Feel free to submit issues, feature requests, or pull requests.

## License

MIT License

Copyright (c) 2025 Shreya Boyane

## Version History

### 1.0.0
- Initial release
- Auto-commit functionality
- Copilot integration
- Configurable exclude patterns
- Status bar integration