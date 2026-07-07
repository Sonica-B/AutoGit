# Build Instructions — AutoGit-AI

## Prerequisites

- [Node.js](https://nodejs.org/) 20 or newer
- Git
- VS Code 1.90+

No global installs are required — the packager runs through `npx`.

## Project Layout

```
AutoGit/
├── extension.js          # VS Code wiring (activation, commands, status bar)
├── lib/
│   ├── patterns.js       # exclude-pattern glob matching (pure)
│   ├── commitMessage.js  # status parsing, AI prompt, fallback messages (pure)
│   └── gitService.js     # git commands via execFile (no shell)
├── test/                 # node:test unit tests for lib/
├── package.json          # extension manifest
├── eslint.config.js      # lint configuration
└── .github/workflows/ci.yml  # lint + test + package on every push
```

## Build and Install

```bash
# 1. Install dev dependencies
npm install

# 2. Lint and test
npm run lint
npm test

# 3. Package the extension
npx @vscode/vsce package

# 4. Install in VS Code
code --uninstall-extension ShreyaBoyane.auto-git-copilot
code --install-extension auto-git-copilot-*.vsix
```

Alternatively run `rebuild.bat` on Windows to do steps 3–4 in one go.

## Development Mode

1. Open this folder in VS Code
2. Press `F5` to launch an Extension Development Host
3. Open any git repository in the new window and test

## Verification Checklist

1. Restart VS Code after installing
2. Open a git repository — the status bar shows **Auto Git: OFF**
3. Run **Auto Git: Show Logs** — you should see "Auto Git extension activated."
4. Toggle it on, save a file, and watch: `Pending (1)` → `Working...` → `ON`
5. Check `git log --oneline -3` for the new commit

## Publishing to the Marketplace (optional)

1. Create a publisher account: https://marketplace.visualstudio.com/manage
2. Get a Personal Access Token from Azure DevOps
3. ```bash
   npx @vscode/vsce login <publisher-name>
   npx @vscode/vsce publish
   ```

## Troubleshooting

- **`vsce` not found** — use `npx @vscode/vsce`, the old standalone `vsce` package is deprecated
- **Packaging warnings about missing repository** — ensure `repository.url` in `package.json` is reachable
- **Dependency issues** — `npm cache clean --force`, delete `node_modules` and `package-lock.json`, re-run `npm install`
