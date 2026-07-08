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

## Publishing

Publishing is automated by [`.github/workflows/publish.yml`](.github/workflows/publish.yml).
On any version tag (`v*.*.*`) it lints, type-checks, tests, verifies the tag
matches `package.json`, packages the VSIX, publishes to whichever registries
you've configured, and attaches the VSIX to a GitHub Release.

You can publish to **either or both** registries — set the matching secret and
that registry is published to; the other is skipped.

### Option A — Open VSX (free, no Azure DevOps) — recommended

Open VSX is the registry used by **Cursor, VSCodium, Windsurf, Gitpod, and
Theia**. Authentication is just a GitHub login — no Azure DevOps account needed.

One-time setup:

1. Sign in at https://open-vsx.org with your GitHub account.
2. Sign the Eclipse **Publisher Agreement** (open-vsx.org → your avatar →
   *Settings → publisher agreement*). Required once, free.
3. Create an access token at https://open-vsx.org/user-settings/tokens.
4. Create your namespace (must equal `publisher` in package.json), once:
   ```bash
   npx ovsx create-namespace ShreyaBoyane -p <your-open-vsx-token>
   ```
5. Add the token as a repository secret named **`OVSX_PAT`**
   (GitHub repo → Settings → Secrets and variables → Actions → New repository secret).

Manual publish (fallback): `npx ovsx publish auto-git-copilot-*.vsix -p <token>`.

### Option B — official VS Code Marketplace (requires Azure DevOps)

1. Create a publisher (`ShreyaBoyane`) at https://marketplace.visualstudio.com/manage
2. Create an Azure DevOps **Personal Access Token** (free Microsoft account)
   with the *Marketplace → Manage* scope
3. Add it as a repository secret named **`VSCE_PAT`**
4. First publish must establish the publisher — either publish once manually
   (`npx @vscode/vsce login ShreyaBoyane` then `npx @vscode/vsce publish`) or
   let the tagged workflow do it.

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

## Troubleshooting

- **`vsce` not found** — use `npx @vscode/vsce`, the old standalone `vsce` package is deprecated
- **Packaging warnings about missing repository** — ensure `repository.url` in `package.json` is reachable
- **Dependency issues** — `npm cache clean --force`, delete `node_modules` and `package-lock.json`, re-run `npm install`
