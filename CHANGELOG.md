# Changelog

All notable changes to the AutoGit-AI extension are documented here.

## [1.1.0] — 2026-07-07

### Security
- **Fixed a shell-injection risk in commit execution.** Commit messages are now
  passed to git as discrete arguments via `execFile` instead of being
  interpolated into a shell command string.

### Fixed
- **Exclude patterns now work on Windows.** Paths are normalized to forward
  slashes before matching, so patterns like `node_modules/**` match
  `node_modules\lodash\index.js`.
- **Exclude patterns no longer over- or under-match.** Regex special characters
  in patterns are escaped (`.env*` no longer matches `xenvrc`), patterns are
  anchored to path-segment boundaries, and `*` no longer crosses directory
  boundaries (use `**` for that).
- **Concurrent git operations can no longer interleave.** A run guard queues a
  follow-up pipeline instead of racing two `git add/commit/push` sequences.
- **Copilot model selection no longer pins the retired `gpt-4` family.** The
  extension now picks any available Copilot model and falls back to any
  language model, so AI messages keep working as Copilot's lineup rotates.
- **Rename entries in `git status` are parsed correctly** (`old -> new` lines),
  as are quoted paths containing spaces and CRLF line endings.
- **First push on a new branch works.** When the branch has no upstream, the
  extension pushes with `-u origin <branch>` instead of failing.

### Added
- `autoGitCopilot.autoPush` (default `true`) — disable to commit locally
  without pushing.
- `autoGitCopilot.protectedBranches` (default `[]`) — branch names on which
  auto-commit is skipped, e.g. `["main", "master"]`.
- `autoGitCopilot.useAI` (default `true`) — turn off Copilot message
  generation and always use the deterministic fallback.
- `autoGitCopilot.notificationLevel` (`all` | `errors` | `none`, default
  `errors`) — control popup noise; everything is always logged.
- **Auto Git output channel** with timestamped logs (`Auto Git: Show Logs`
  command) replacing developer-console `console.log` calls.
- New commands: `Auto Git: Enable`, `Auto Git: Disable`,
  `Auto Git: Show Logs`.
- **Diff-aware AI prompts.** The Copilot prompt now includes a truncated
  `git diff --cached --stat` summary alongside the file list for more accurate
  messages, and caps the file list at 40 entries.
- AI requests time out after 20 seconds instead of hanging the pipeline.
- The status bar pending state shows how many files are queued.
- Smarter fallback messages: single-file changes are described precisely
  (`chore: update src/app.js`).
- Unit test suite (`npm test`, zero-dependency `node:test`), ESLint flat
  config (`npm run lint`), `.editorconfig`, and a GitHub Actions CI workflow
  that lints, tests, and packages the VSIX.

### Changed
- Success notifications are no longer shown by default
  (`notificationLevel: "errors"`); set it to `"all"` to restore the old
  behavior. The "loaded successfully" popup on startup was removed.
- Code refactored into testable modules: `lib/patterns.js`,
  `lib/commitMessage.js`, `lib/gitService.js`.
- Minimum VS Code version raised to 1.90 (first stable release of the
  Language Model API used for Copilot commit messages).
- The `Auto Git: Test Extension` debug command was removed; use
  `Auto Git: Show Logs` instead.
- Empty commits are avoided: if staging produces no staged changes (e.g.
  everything was filtered), the commit is skipped.

## [1.0.6] and earlier

- AI-powered commit messages via GitHub Copilot with fallback messages.
- Automatic stage/commit/push on file save with configurable delay.
- Exclude patterns, status bar toggle, manual commit command.
