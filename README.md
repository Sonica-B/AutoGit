# Auto Git (AutoGit-AI)

A VS Code extension that automatically stages, commits, and pushes your changes with AI-generated commit messages using GitHub Copilot.

## ✨ Features

- **🤖 AI-Powered Commit Messages**: Uses GitHub Copilot to generate meaningful, contextual commit messages from your file list *and* a diff summary
- **🔄 Automatic Git Operations**: Automatically stages, commits, and (optionally) pushes changes when files change
- **🎯 Smart File Filtering**: Gitignore-style exclude patterns that work correctly on Windows, macOS, and Linux
- **🛡️ Protected Branches**: Skip auto-commits on branches you designate (e.g. `main`)
- **⏱️ Configurable Delays**: Debounces commits to batch related changes together
- **🎮 Manual Override**: Toggle auto-commit on/off or trigger immediate commits
- **📊 Status Bar Integration**: See current status and control the extension from the status bar
- **📜 Output Channel Logging**: Full timestamped logs in the "Auto Git" output channel
- **⚙️ Highly Configurable**: Push behavior, AI usage, notification noise, and more

## 📋 Prerequisites

1. **Git**: Installed and configured (`user.name` / `user.email`)
2. **GitHub Copilot** *(optional but recommended)*: Needed for AI commit messages; without it the extension writes descriptive fallback messages
3. **Git Repository**: Your workspace must be a git repository (a remote is required only if `autoPush` is enabled)
4. **VS Code 1.90+**

## 🚀 Installation

### Option 1: Install from VSIX
1. Download the `.vsix` file
2. Open VS Code → Extensions view (`Ctrl+Shift+X`)
3. Click the `...` menu and select **Install from VSIX...**

### Option 2: Build from Source
```bash
git clone https://github.com/Sonica-B/AutoGit.git
cd AutoGit
npm install
npm test
npx @vscode/vsce package
code --install-extension auto-git-copilot-1.1.0.vsix
```

## 📖 Usage

1. **Enable Auto Git**: Click the status bar item "Auto Git: OFF", or run **Auto Git: Toggle Auto Git** from the command palette (`Ctrl+Shift+P`)
2. **Save files**: After the configured delay the extension stages changes (respecting exclude patterns), generates a commit message, commits, and pushes (if `autoPush` is on)
3. **Manual commit**: Run **Auto Git: Commit Changes Now** to skip the delay
4. **Watch it work**: Run **Auto Git: Show Logs** to see every git command and decision

### 🎯 Commands

| Command | Description |
|---------|-------------|
| `Auto Git: Toggle Auto Git` | Enable/disable automatic git operations |
| `Auto Git: Enable Auto Git` | Turn auto-commit on |
| `Auto Git: Disable Auto Git` | Turn auto-commit off |
| `Auto Git: Commit Changes Now` | Immediately commit current changes without waiting |
| `Auto Git: Show Logs` | Open the Auto Git output channel |

### 📊 Status Bar Indicators

- **`Auto Git: OFF`** (orange) — auto-commit disabled; click to enable
- **`Auto Git: ON`** — enabled and watching for changes
- **`Auto Git: Pending (n)`** — n changed files queued, waiting out the delay
- **`Auto Git: Working...`** — staging, committing, pushing

## ⚙️ Configuration

Search for "Auto Git" in VS Code settings:

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `autoGitCopilot.enabled` | boolean | `false` | Enable automatic git operations |
| `autoGitCopilot.delayMs` | number | `3000` | Debounce delay (1000–30000 ms) before committing |
| `autoGitCopilot.autoPush` | boolean | `true` | Push after each commit; disable to commit locally only |
| `autoGitCopilot.includeUntracked` | boolean | `true` | Include untracked files in commits |
| `autoGitCopilot.useAI` | boolean | `true` | Use Copilot for commit messages (falls back automatically if unavailable) |
| `autoGitCopilot.maxCommitMessageLength` | number | `72` | Maximum commit message length (20–200) |
| `autoGitCopilot.protectedBranches` | array | `[]` | Branches on which auto-commit is skipped, e.g. `["main"]` |
| `autoGitCopilot.notificationLevel` | string | `"errors"` | Popup noise: `"all"`, `"errors"`, or `"none"` |
| `autoGitCopilot.excludePatterns` | array | see below | Glob patterns excluded from auto-commit |

### Exclude Patterns

Patterns follow gitignore-style semantics:

- `*` matches within one path segment (`*.log` → `error.log`, `logs/error.log`)
- `**` matches across segments (`dist/**` → everything under `dist/`)
- Patterns containing `/` are anchored to the workspace root; bare patterns match at any depth
- Windows backslash paths are handled automatically

Default excludes: `node_modules/**`, `.git/**`, `*.log`, `.env*`, `dist/**`, `build/**`, `out/**`, `*.tmp`, `*.temp`, `.DS_Store`, `Thumbs.db`, `*.vsix`, `.vscode-test/**`, `coverage/**`, `*.lock`, `package-lock.json`

### Example

```json
{
  "autoGitCopilot.enabled": true,
  "autoGitCopilot.delayMs": 5000,
  "autoGitCopilot.autoPush": false,
  "autoGitCopilot.protectedBranches": ["main", "release"],
  "autoGitCopilot.notificationLevel": "all"
}
```

## 🤖 AI Commit Messages

When Copilot is available, the extension sends it the changed-file list plus a truncated `git diff --cached --stat` summary and asks for a conventional-commit-style, single-line message:

- `feat: add user authentication system`
- `fix: resolve login validation issue`
- `docs: update API documentation`

If Copilot is unavailable (or `useAI` is off), a deterministic fallback is used:

- `chore: update src/app.js` (single file)
- `chore: add 1, update 2 files` (multiple files)

AI requests time out after 20 seconds, so a slow model never blocks your commit.

## 💡 Best Practices

1. **Review before enabling** on important repositories — auto-commit is a workflow tool, not a substitute for curated history
2. **Protect your main branch**: `"autoGitCopilot.protectedBranches": ["main"]`
3. **Exclude secrets and artifacts**: extend `excludePatterns` for anything sensitive (note: `.gitignore` is always respected by git itself)
4. **Tune the delay** so related edits batch into one commit
5. **Use commit-only mode** (`"autoPush": false`) when working offline or when you want to review before pushing

## 🔧 Troubleshooting

**Extension not committing:**
- Check the status bar shows `Auto Git: ON`
- Run **Auto Git: Show Logs** — every decision (including excluded files) is logged
- Verify the workspace is a git repository

**No AI commit messages:**
- Ensure GitHub Copilot is installed, signed in, and active
- Look for "Using language model:" in the logs; "using fallback commit message" means Copilot wasn't reachable
- Requires VS Code 1.90+

**Push failures:**
- The extension pushes with `-u origin <branch>` when no upstream exists; make sure a remote named `origin` is configured
- Check credentials (`git push` from a terminal should succeed)
- Set `"autoGitCopilot.autoPush": false` to commit locally only

**Commits on the wrong branch:**
- Add branches to `autoGitCopilot.protectedBranches`

## 🧪 Development

```bash
npm install        # install dev dependencies
npm run lint       # ESLint
npm test           # unit tests (node:test, no extra dependencies)
npm run check      # syntax check all entry points
npx @vscode/vsce package   # build the VSIX
```

Press `F5` in VS Code to launch an Extension Development Host. Pure logic lives in `lib/` (fully unit-tested); VS Code wiring lives in `extension.js`.

CI (GitHub Actions) lints, tests, and packages the VSIX on every push and pull request.

## 🔒 Security

- Git commands are executed with argument arrays (`execFile`) — commit messages are never interpolated into a shell string
- Only your existing git configuration and credentials are used
- No data is collected or transmitted by the extension itself; commit message generation goes through the VS Code Language Model API (Copilot)

## 📄 License

Apache-2.0 — see [LICENSE](LICENSE).

## 📝 Changelog

See [CHANGELOG.md](CHANGELOG.md) for the full version history.

---

**Made with ❤️ for developers who love automation and clean commit histories!**
