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

## Publishing to the Marketplace

Publishing is automated by [`.github/workflows/publish.yml`](.github/workflows/publish.yml).
It runs on any version tag (`v*.*.*`): it lints, type-checks, and tests, verifies
the tag matches `package.json`, packages the VSIX, publishes to the VS Code
Marketplace (and Open VSX if configured), and attaches the VSIX to a GitHub
Release.

### One-time setup

1. Create a publisher (`ShreyaBoyane`) at https://marketplace.visualstudio.com/manage
2. Create an Azure DevOps **Personal Access Token** with the *Marketplace →
   Manage* scope
3. Add it as a repository secret named **`VSCE_PAT`**
   (GitHub repo → Settings → Secrets and variables → Actions → New repository secret)
4. *(Optional, for Cursor / VSCodium / Windsurf users)* create an
   [Open VSX](https://open-vsx.org/) token and add it as **`OVSX_PAT`**. If this
   secret is absent, the Open VSX step is skipped automatically.

### Cutting a release

```bash
# 1. Bump the version in package.json (e.g. 1.3.0 -> 1.3.1) and commit to main
# 2. Tag and push — this triggers the publish workflow:
git tag v1.3.1
git push origin v1.3.1
```

The tag **must** match `package.json`'s `version` or the workflow fails before
publishing anything. To rehearse without publishing, run the workflow manually
from the Actions tab with **Run workflow → dry_run = true**.

### Manual publish (fallback)

```bash
npx @vscode/vsce login ShreyaBoyane   # paste your PAT once
npx @vscode/vsce publish              # publishes the version in package.json
```

## Troubleshooting

- **`vsce` not found** — use `npx @vscode/vsce`, the old standalone `vsce` package is deprecated
- **Packaging warnings about missing repository** — ensure `repository.url` in `package.json` is reachable
- **Dependency issues** — `npm cache clean --force`, delete `node_modules` and `package-lock.json`, re-run `npm install`
