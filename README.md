# Auto Git 

A VS Code extension that automatically stages, commits, and pushes your changes with AI-generated commit messages using GitHub Copilot.

## ✨ Features

- **🤖 AI-Powered Commit Messages**: Uses GitHub Copilot to generate meaningful, contextual commit messages
- **🔄 Automatic Git Operations**: Automatically stages, commits, and pushes changes when you save files
- **🎯 Smart File Filtering**: Excludes build artifacts, logs, and sensitive files automatically
- **⏱️ Configurable Delays**: Debounces commits to batch related changes together
- **🎮 Manual Override**: Toggle auto-commit on/off or trigger immediate commits
- **📊 Status Bar Integration**: See current status and control extension from the status bar
- **⚙️ Highly Configurable**: Customize behavior through VS Code settings

## 📋 Prerequisites

1. **Git**: Ensure Git is installed and configured on your system
2. **GitHub Copilot**: Must have the GitHub Copilot extension installed and active in VS Code
3. **Git Repository**: Your workspace must be a valid Git repository with a remote configured

## 🚀 Installation

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

## ⚡ Quick Setup

1. **Configure Git** (if not already done):
   ```bash
   git config --global user.name "Your Name"
   git config --global user.email "your.email@example.com"
   ```

2. **Enable GitHub Copilot**: Make sure the GitHub Copilot extension is installed and you're signed in

3. **Open a Git Repository**: The extension only works in VS Code workspaces that are Git repositories

## 📖 Usage

### Basic Usage

1. **Enable Auto Git**: Click the status bar item "Auto Git: OFF" to enable, or use the command palette (`Ctrl+Shift+P`) and search for "Toggle Auto Git"

2. **Save Files**: Once enabled, simply save any file in your project. The extension will:
   - Wait for the configured delay (default: 3 seconds)
   - Stage all changes (respecting exclude patterns)
   - Generate an AI-powered commit message using Copilot
   - Commit the changes with the generated message
   - Push to the remote repository

3. **Manual Commit**: Use the command "Commit Changes Now" to immediately trigger a commit without waiting

### 🎯 Commands

| Command | Description | Shortcut |
|---------|-------------|----------|
| `Auto Git: Toggle Auto Git` | Enable/disable automatic git operations | Click status bar |
| `Auto Git: Commit Changes Now` | Immediately commit current changes without delay | Command palette |

### 📊 Status Bar Indicators

The status bar shows the current state:
- **`Auto Git: OFF`** (orange background) - Auto-commit disabled
- **`Auto Git: ON`** - Auto-commit enabled and ready
- **`Auto Git: Pending...`** - Waiting for delay timer after file save
- **`Auto Git: Working...`** - Currently performing git operations (stage, commit, push)

## ⚙️ Configuration

Access settings via **File → Preferences → Settings**, then search for "Auto Git":

### Available Settings

| Setting | Type | Default | Range | Description |
|---------|------|---------|-------|-------------|
| `autoGitCopilot.enabled` | boolean | `false` | - | Enable automatic git operations on file save |
| `autoGitCopilot.delayMs` | number | `3000` | 1000-30000 | Delay in milliseconds before triggering git operations |
| `autoGitCopilot.includeUntracked` | boolean | `true` | - | Include untracked files in automatic commits |
| `autoGitCopilot.maxCommitMessageLength` | number | `72` | 20-200 | Maximum length for commit messages |
| `autoGitCopilot.excludePatterns` | array | See below | - | File patterns to exclude from auto-commit |

### Default Exclude Patterns

```json
[
  "node_modules/**",
  ".git/**",
  "*.log",
  ".env*",
  "dist/**",
  "build/**",
  "*.tmp",
  "*.temp",
  ".DS_Store",
  "Thumbs.db",
  "*.vsix",
  ".vscode-test/**"
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
    "*.tmp",
    "*.test.js",
    "screenshots/**"
  ]
}
```

## 🤖 AI Commit Messages

The extension uses GitHub Copilot to generate contextual commit messages based on:

- **Files changed** and their types
- **Type of changes** (added, modified, deleted)
- **File paths** and naming patterns
- **Common conventions** and best practices

### Message Format Examples

The AI attempts to follow conventional commit formats:
- `feat: add user authentication system`
- `fix: resolve login validation issue`
- `docs: update API documentation`
- `refactor: simplify error handling logic`
- `style: improve code formatting`
- `test: add unit tests for user service`
- `chore: update dependencies`

### Fallback Messages

If Copilot is unavailable, the extension generates descriptive fallback messages:
- `Auto-commit: 3 modified files`
- `Auto-commit: 1 added, 2 modified files`
- `Auto-commit: Update files`

## 💡 Best Practices

1. **🔧 Development Use**: This extension is designed for development workflows, not production deployments

2. **👀 Review Changes**: Always review your changes before enabling auto-commit for important projects

3. **🚫 Configure Exclusions**: Make sure to exclude sensitive files, build artifacts, and temporary files

4. **⏱️ Set Appropriate Delay**: Use a delay that gives you time to make related changes without creating too many commits

5. **📊 Monitor Status**: Keep an eye on the status bar to understand what the extension is doing

6. **🔄 Batch Related Changes**: Save multiple related files within the delay window to create logical commits

7. **🎯 Use Meaningful File Names**: AI commit messages are more accurate with descriptive file names

## 🔧 Troubleshooting

### Common Issues

**🚫 Extension not working:**
- Ensure you're in a Git repository (`git status` should work)
- Check that GitHub Copilot is installed and active
- Verify Git is properly configured with user name and email
- Restart VS Code after installation

**🤖 No AI commit messages generated:**
- Ensure GitHub Copilot is working (try using it in a file)
- Check that you have an active Copilot subscription
- Look for "Auto Git: Copilot model found" in console logs
- The extension will fall back to simple messages if Copilot is unavailable

**🔄 Too many commits:**
- Increase the delay setting (`autoGitCopilot.delayMs`)
- Review and improve your exclude patterns
- Consider temporarily disabling for large file operations
- Use "includeUntracked": false to avoid committing new temp files

**🚫 Push failures:**
- Ensure you have push permissions to the remote repository
- Check your Git authentication (SSH keys, personal access tokens)
- Verify the remote repository is accessible
- Try a manual `git push` to test connectivity

**📁 Files not being committed:**
- Check your exclude patterns configuration
- Verify files are not in `.gitignore`
- Ensure files are actually saved (check auto-save settings)
- Look for "excluding file" messages in console

### 🔍 Debugging

**View Extension Logs:**
1. Help → Toggle Developer Tools
2. Go to Console tab
3. Filter by "Auto Git" to see detailed operation logs
4. Look for activation, file save, and git operation messages

**Test Git Operations Manually:**
```bash
# Test basic git functionality
git status
git add .
git commit -m "test"
git push

# Check git configuration
git config --list | grep user
```

**Common Console Messages:**
- ✅ "Auto Git: Workspace initialized" - Extension loaded successfully
- ✅ "Auto Git: File save listener registered successfully" - File detection working
- ✅ "Auto Git: Copilot model found" - AI commit messages available
- ⚠️ "Auto Git: Using fallback commit message" - Copilot unavailable but working
- ❌ "Auto Git: Not a git repository" - Not in a valid git workspace

## 🔒 Security Considerations

- ✅ **File Safety**: The extension only processes files you explicitly save
- ✅ **Pattern Exclusions**: Sensitive files can be excluded via configurable patterns
- ✅ **Git Configuration**: All Git operations use your existing Git configuration and credentials
- ✅ **Local Processing**: Commit messages are generated locally using Copilot
- ✅ **No Data Collection**: Extension doesn't collect or transmit your code or data
- ✅ **Respect .gitignore**: Works with your existing git ignore rules

## 🤝 Contributing

This extension is open for contributions! Feel free to:
- 🐛 Submit bug reports and feature requests via GitHub Issues
- 🔧 Create pull requests for improvements
- 📖 Improve documentation
- ⭐ Star the repository if you find it useful
- 💡 Suggest new features or improvements

## 📄 License

Apache-2.0 license - see [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- GitHub Copilot for providing AI-powered commit message generation
- VS Code team for the excellent extension API
- The open-source community for inspiration and feedback

## 📝 Version History

### 1.0.5 (Latest)
- ✅ Fixed function declaration order
- ✅ Resolved shouldExcludeFile is not defined error
- ✅ Proper function hoisting


### 1.0.2 (Latest)
- ✅ Full AI-powered commit message generation with GitHub Copilot
- ✅ Advanced configuration options with validation
- ✅ Improved error handling and user feedback
- ✅ Enhanced status bar integration with visual indicators
- ✅ Smart file exclusion patterns with regex support
- ✅ Comprehensive logging and debugging support
- ✅ Better escape handling for commit messages
- ✅ Fallback commit message system

### 1.0.1
- ✅ Basic auto-commit functionality
- ✅ Manual commit commands
- ✅ Status bar integration
- ✅ File save detection

### 1.0.0
- 🎉 Initial release
- ✅ Core git automation
- ✅ Simple commit messages

---

**Made with ❤️ for developers who love automation and clean commit histories!**

*Auto Git - Because great commits shouldn't require great effort.*