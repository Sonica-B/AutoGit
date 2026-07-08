# Changelog

All notable changes to the AutoGit-AI extension are documented here.

## [1.4.0] — 2026-07-07

Engagement, discoverability, and contributor experience.

### Added

- **Rate prompt** — after many successful commits (at most 3 times, ever),
  AutoGit gently invites a Marketplace rating. Fully opt-out via the new
  `autoGitCopilot.enableRatingPrompt` setting, and silent when
  `notificationLevel` is `none`. New **Auto Git: Rate AutoGit-AI on the
  Marketplace** command to rate any time.
- **"What's new" notice** — a one-time notification after a genuine upgrade
  (never on fresh install) linking to the changelog.
- Issue/PR templates, a `CONTRIBUTING.md` with a release checklist, and a
  "how it works" diagram in the README.

### Marketplace

- Sharper `displayName`, `description`, and search `keywords` (auto commit, auto
  push, AI commit message, conventional commits, secret scanning, …).
- Added the `AI` category and an explicit `Free` pricing tag.
- README leads with a positioning line and social-proof badges (version,
  installs, rating).

All engagement timing lives in the pure, unit-tested `lib/engagement.js`
(10 new tests; 117 total).

## [1.3.0] — 2026-07-07

Hardening release from an exhaustive multi-agent code review: 30 adversarially
verified findings across staging, git-state handling, the secret scanner, glob
matching, and publishing. All fixes are covered by new tests (107 total,
including integration tests against real temporary git repositories).

### Security / data-integrity (high severity)

- **Exclude patterns are now enforced at commit time.** Previously
  `excludePatterns` only decided whether a file *triggered* a run; the pipeline
  then ran a blanket `git add .`, so an excluded, non-gitignored `.env` (or
  `dist/`, `*.log`) could be committed and pushed anyway. The pipeline now
  stages an explicit, exclude-filtered path list.
- **Operations are scoped to the workspace folder.** Git runs from the repo
  root with a scope pathspec, so a workspace that is a subdirectory of a larger
  repo no longer sweeps in unrelated changes (the old `git add -u` staged the
  whole repo).
- **No auto-commit during merge/rebase/cherry-pick/revert or on a detached
  HEAD.** Conflict markers and orphan commits are never auto-committed/pushed.
- **The secret scanner no longer fails open.** It now runs `git diff` with
  `--no-ext-diff` and pinned prefixes/quoting, so a configured external diff
  tool (e.g. difftastic) or `diff.mnemonicPrefix`/`core.quotepath` can't cause
  the scan to silently see nothing. Oversized diffs now **block** the commit
  (fail closed) instead of proceeding unscanned.
- **Unquoted credential detection.** `.env` / INI / YAML assignments
  (`DB_PASSWORD=…`, `aws_secret_access_key = …`) are now caught, not just
  quoted code literals.

### Correctness (medium/low severity)

- `push()` resolves the remote (`remote.pushDefault`, else the sole remote,
  preferring `origin`) instead of hardcoding `origin`; detached-HEAD pushes are
  rejected with a clear message.
- `currentBranch()` works on an unborn branch (fresh `git init`), so a first
  commit with `protectedBranches` set no longer errors.
- A missing git binary is reported as "Git not found on PATH", not "not a git
  repository".
- Exclude globs: leading-slash (root-anchored) patterns like `/dist` now match;
  trailing-slash directory patterns (`build/`) match at any depth; backslash
  patterns anchor consistently; repeated `**/` runs can no longer cause
  catastrophic backtracking (ReDoS) that froze the extension host.
- `secretScanIgnorePatterns`: nested-quantifier / over-long patterns are
  rejected (ReDoS guard), suppressed findings are logged (no more silent
  disablement), and ignore-matching input is length-bounded.
- Diff parsing: an added line whose content starts with `++ ` is scanned, not
  misread as a file header; file paths are reported correctly under mnemonic
  prefixes; non-ASCII paths are decoded.
- Commit-message truncation is surrogate-safe (no lone-surrogate → U+FFFD);
  `git status` rename parsing only splits ` -> ` for rename/copy entries.
- The **"Commit Anyway"** override is now bound to a fingerprint of the exact
  reviewed diff, closing a TOCTOU hole where a stale/global skip could let
  later, unreviewed content bypass the scanner.

### Tooling

- `check` npm script now covers `lib/secretScanner.js`; CI runs on all branches;
  README/BUILD install commands are version-agnostic; marketplace README links
  are absolute so they resolve on the listing page.

## [1.2.0] — 2026-07-07

### Added — built-in secret scanning (on by default)

Auto-commit + auto-push removes human review at exactly the moment secrets
leak: 28.65M hardcoded secrets hit public GitHub in 2025 (+34% YoY), with
AI-assisted commits leaking at ~2× the baseline rate (GitGuardian, State of
Secrets Sprawl 2026). See `docs/gap-analysis-2026.md` for the full analysis.

- Every staged diff is scanned **before** commit (`lib/secretScanner.js`,
  zero dependencies). 15 rule classes: AWS, GitHub, GitLab, Anthropic,
  OpenAI, Google, Slack, Stripe, npm, SendGrid, JWTs, private-key blocks,
  credential-bearing connection strings, and entropy-checked generic
  `password/api_key = "..."` assignments with placeholder filtering.
- On a hit the commit is **blocked**; findings are logged with redacted
  previews (the secret is never echoed) and a warning is shown even when
  `notificationLevel` is `"none"`.
- Escape hatches: **Commit Anyway** notification action (one-shot),
  `autoGitCopilot.secretScanIgnorePatterns` (regex vs finding text or
  `file:line`), and an `autogit:allow-secret` line pragma.
- New settings: `autoGitCopilot.scanForSecrets` (default `true`),
  `autoGitCopilot.secretScanIgnorePatterns` (default `[]`).
- Safety limits: diffs > 2 MB are skipped with a logged warning (never
  half-scanned); findings capped at 50 per run; only *added* lines are
  scanned.
- 38 new unit tests (64 total): rule detection, false-positive resistance,
  diff parsing, entropy heuristics, redaction, pragma/ignore handling,
  size limits.
- `docs/gap-analysis-2026.md` — 7-gap analysis of the 2026 landscape that
  motivated this feature, and `docs/adr/ADR-0001` — architecture decision
  record for the v1.1.0 design.

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
