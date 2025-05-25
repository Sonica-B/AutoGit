# Build Instructions for Auto Git with Copilot Extension

## Quick Build and Install

### Prerequisites
```bash
# Install Node.js (if not already installed)
# Download from: https://nodejs.org/

# Install VS Code Extension Manager globally
npm install -g vsce
```

### Build Steps

1. **Download/Copy all the files** from the artifacts into your project directory

2. **Set up the project structure:**
```
auto-git-copilot-extension/
├── extension.js
├── package.json
├── README.md
├── tsconfig.json
├── .vscodeignore
├── .gitignore
├── LICENSE
└── BUILD_INSTRUCTIONS.md
```

3. **Open terminal in the project directory:**
```bash
cd "D:\WPI Assignments\AutoGit_Extension\auto-git-copilot-extension"
```

4. **Install dependencies:**
```bash
npm install
```

5. **Package the extension:**
```bash
vsce package
```

6. **Install in VS Code:**
```bash
# Uninstall any existing version
code --uninstall-extension shreya-boyane.auto-git-copilot

# Install the new version
code --install-extension auto-git-copilot-1.0.2.vsix
```

## Verification Steps

1. **Restart VS Code completely**

2. **Open a Git repository**

3. **Check for "Auto Git: OFF" in the status bar**

4. **Open Developer Console** (Help → Toggle Developer Tools → Console)
   - Look for: "Auto Git with Copilot extension is activating..."
   - Should see: "Auto Git extension activation completed successfully"

5. **Test the extension:**
   - Click status bar to toggle: "Auto Git: OFF" → "Auto Git: ON"
   - Save a file and watch for "Pending..." → "Working..." → "ON"
   - Check git log: `git log --oneline -5`

## Troubleshooting Build Issues

### Common Problems:

**Missing vsce:**
```bash
npm install -g vsce
```

**Permission errors on Windows:**
```bash
# Run PowerShell as Administrator, then:
npm install -g vsce
```

**Package.json errors:**
- Ensure all commas are correct
- Verify JSON syntax with a validator

**Version conflicts:**
```bash
npm cache clean --force
rm -rf node_modules package-lock.json
npm install
```

## Publishing to Marketplace (Optional)

If you want to publish to VS Code Marketplace:

1. **Create publisher account:** https://marketplace.visualstudio.com/manage

2. **Get Personal Access Token from Azure DevOps**

3. **Login and publish:**
```bash
vsce login your-publisher-name
vsce publish
```

## Development Mode

For testing during development:

1. **Open project in VS Code**
2. **Press F5** to open Extension Development Host
3. **Test in the new VS Code window**

## File Descriptions

- **`extension.js`** - Main extension logic with all features
- **`package.json`** - Extension manifest and configuration
- **`README.md`** - Complete user documentation
- **`tsconfig.json`** - TypeScript configuration for development
- **`.vscodeignore`** - Files to exclude from extension package
- **`.gitignore`** - Git ignore patterns
- **`LICENSE`** - MIT license

## Features Included

✅ **AI-Powered Commit Messages** - Uses GitHub Copilot for intelligent commits  
✅ **Auto Stage/Commit/Push** - Automatic git operations on file save  
✅ **Smart File Filtering** - Configurable exclude patterns  
✅ **Status Bar Integration** - Visual feedback and control  
✅ **Configurable Settings** - All aspects customizable  
✅ **Manual Override** - Toggle and immediate commit commands  
✅ **Error Handling** - Robust error handling and recovery  
✅ **Logging** - Comprehensive logging for debugging  

## Support

If you encounter any issues:

1. Check the VS Code Developer Console for error messages
2. Verify you're in a valid Git repository
3. Ensure GitHub Copilot is installed and active
4. Test basic git operations manually: `git status`, `git push`

---

**Happy coding with automated git commits! 🚀**