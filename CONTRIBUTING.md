# Contributing to AutoGit-AI

Thanks for your interest! This project is plain JavaScript with strict JSDoc
type-checking — no build step, no framework.

## Project layout

```
extension.js          VS Code wiring (activation, commands, status bar, pipeline)
lib/patterns.js       glob → regex exclude matching
lib/commitMessage.js  git status parsing, AI prompt, fallback messages
lib/gitService.js     git via execFile (no shell)
lib/secretScanner.js  staged-diff secret detection
lib/engagement.js     rating-prompt / what's-new timing (pure)
test/                 node:test unit + integration tests
docs/adr/             architecture decision records
```

Pure logic lives in `lib/` with no `vscode` dependency, so it is unit-testable.
See [docs/adr/ADR-0001](docs/adr/ADR-0001-extension-architecture.md) for the why.

## Getting started

```bash
npm install
npm run lint        # eslint
npm run typecheck   # tsc --noEmit over JSDoc types
npm test            # node --test (unit + integration; needs git installed)
```

Press **F5** in VS Code to launch the Extension Development Host and try changes
against a scratch git repo.

## Making a change

1. Branch off `main`.
2. Keep new logic in `lib/` pure where possible and add tests in `test/`.
3. Run `npm run lint && npm run typecheck && npm test` — all must pass.
4. Add a `CHANGELOG.md` entry.
5. Open a PR; CI runs lint + typecheck + tests + packaging on every push.

## Releasing (maintainers)

Publishing is automated by [`.github/workflows/publish.yml`](.github/workflows/publish.yml),
triggered by a version tag. Keeping a **steady cadence** (small, frequent
releases) keeps the Marketplace "Last updated" fresh, which helps ranking and
signals active maintenance.

**Checklist:**

1. Ensure `main` is green (CI passing).
2. Bump `version` in `package.json` (semver: patch for fixes, minor for
   features).
3. Move the `CHANGELOG.md` entry under the new version with today's date.
4. Commit to `main` (e.g. `chore: release vX.Y.Z`).
5. Tag and push — this publishes:
   ```bash
   git tag vX.Y.Z    # must match package.json version exactly
   git push origin vX.Y.Z
   ```
6. Watch the **Actions → Publish** run. It packages the VSIX, publishes to every
   configured registry, and creates a GitHub Release with the VSIX attached.

To rehearse without publishing, run the workflow from the Actions tab with
**Run workflow → dry_run = true**.

### Publish targets and secrets

The workflow publishes to whichever of these repository secrets is set (at least
one is required):

| Secret     | Registry              | Notes |
|------------|-----------------------|-------|
| `VSCE_PAT` | VS Code Marketplace   | Azure DevOps PAT, **Marketplace → Manage** scope. The account must own the `ShreyaBoyane` publisher. |
| `OVSX_PAT` | [Open VSX](https://open-vsx.org) | **Free**, GitHub login — no Azure DevOps. Reaches Cursor, VSCodium, Windsurf, and Gitpod users. |

**Enabling Open VSX (recommended — roughly doubles reachable users):**

1. Sign in at <https://open-vsx.org> with GitHub and create an access token.
2. Create the publisher namespace once:
   `npx ovsx create-namespace ShreyaBoyane -p <token>`
3. Add the token as the `OVSX_PAT` repository secret. The next tag publishes to
   both registries automatically.

## Reporting bugs / requesting features

Use the issue templates. For anything involving the secret scanner, please
redact the actual secret from logs and diffs.
