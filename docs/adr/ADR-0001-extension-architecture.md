# ADR-0001: Extension architecture — modular plain JavaScript with execFile-based git execution

**Status:** Accepted
**Date:** 2026-07-07
**Deciders:** Shreya Boyane (maintainer)

## Context

AutoGit-AI watches a workspace, debounces file changes, stages/commits/pushes,
and asks the Copilot language model for commit messages. Through v1.0.6 the
extension was a single ~540-line `extension.js` that:

- built git commands as shell strings (`exec('git commit -m "..."')`), making
  commit messages a shell-injection surface and escaping fragile;
- converted exclude globs to regex naively (unescaped dots, no anchoring,
  broken on Windows backslash paths);
- had no unit tests, lint, type checking, or CI — every change was verified by
  hand-installing a VSIX;
- pinned the Copilot `gpt-4` model family, which silently broke as Copilot
  rotated its lineup.

Forces at play: a solo maintainer; the extension runs arbitrary-frequency git
operations on users' real repositories (correctness and safety matter more
than features); Windows is a first-class target; the VS Code extension host is
Node.js, so JavaScript is native; publishing needs a small, dependency-light
VSIX.

## Decision

Restructure the extension as **plain JavaScript modules with strict JSDoc type
checking**, and execute git via **`child_process.execFile` argument arrays**
wrapped in a dedicated `GitService`:

```
extension.js          # VS Code wiring only (activation, commands, status bar)
lib/patterns.js       # pure: glob → regex exclude matching
lib/commitMessage.js  # pure: status parsing, AI prompt, fallback messages
lib/gitService.js     # git via execFile — no shell, no interpolation
test/                 # node:test unit tests over the pure modules
```

Pure logic is isolated from the `vscode` module so it is testable with
zero-dependency `node:test`. Type safety comes from `tsc --noEmit` with
`strict` + `checkJs` over JSDoc annotations rather than a TypeScript build.

## Options Considered

### Option A: Keep the single-file design, patch bugs in place

| Dimension | Assessment |
|-----------|------------|
| Complexity | Low |
| Cost | Lowest short-term |
| Scalability (of codebase) | Poor — logic and VS Code wiring stay entangled |
| Team familiarity | High |

**Pros:** No structural churn; smallest diff.
**Cons:** Pure logic untestable without stubbing `vscode`; shell-string git
execution is hard to make safe by escaping alone; every future fix repeats the
hand-verification cycle.

### Option B: Modular plain JS + JSDoc strict checking + execFile git (chosen)

| Dimension | Assessment |
|-----------|------------|
| Complexity | Medium |
| Cost | Moderate one-time refactor |
| Scalability | Good — pure modules grow and test independently |
| Team familiarity | High — still JavaScript, no build step |

**Pros:** Shell injection eliminated structurally (argument arrays), not by
escaping; unit tests run in milliseconds with no dependencies; `tsc checkJs`
gives ~90% of TypeScript's safety with zero build pipeline; VSIX stays tiny.
**Cons:** JSDoc annotations are wordier than TS syntax; type casts
(`/** @type {string[]} */`) needed around VS Code config getters.

### Option C: TypeScript rewrite + VS Code built-in Git extension API

| Dimension | Assessment |
|-----------|------------|
| Complexity | High |
| Cost | Highest — full rewrite plus build pipeline |
| Scalability | Good |
| Team familiarity | Medium |

**Pros:** First-class types; the `vscode.git` API reuses the user's git
integration (auth, rebase state awareness) instead of spawning processes.
**Cons:** The Git extension API is semi-stable (`git.d.ts` is copied, not
published) and does not expose everything we need (porcelain status text,
`push -u`); adds compile step, source maps, and packaging complexity; a
rewrite risks regressions in a working product for little user-visible gain.

### Option D: Git library (simple-git / isomorphic-git)

**Pros:** Structured results, no argv assembly.
**Cons:** Adds a runtime dependency to a currently dependency-free VSIX;
simple-git still shells out to git (same trust boundary, plus a dependency);
isomorphic-git reimplements git and diverges from the user's hooks, config,
and credential helpers — unacceptable for a tool that pushes to real remotes.

## Trade-off Analysis

The decisive trade-offs were:

1. **Safety by construction vs. safety by escaping.** Option A keeps
   escaping commit messages for a shell; history shows this fails (the v1.0.x
   escaping missed `$(...)` and backslash cases). `execFile` argument arrays
   remove the class of bug rather than an instance of it.
2. **Testability vs. churn.** The bugs that motivated this work (Windows
   pattern matching, status parsing) live in pure logic. Only Option B/C make
   that logic unit-testable; B achieves it without a build system.
3. **Type safety vs. toolchain weight.** `checkJs` strict mode caught 28 real
   type gaps during the refactor at the cost of JSDoc verbosity — a better
   ratio than a full TS migration for a codebase this size (~1 kLOC).
4. **Process-spawned git vs. embedded git.** Spawning the user's own git
   binary inherits their credentials, hooks, and config exactly — the correct
   behavior for an automation tool. Latency (~10–50 ms per call) is
   irrelevant behind a 3-second debounce.

## Consequences

**Easier now:**
- Adding logic (new message styles, new filters) with fast unit tests and CI.
- Reasoning about safety: one module (`gitService`) owns process execution.
- Reviewing changes: VS Code wiring diffs are separate from logic diffs.

**Harder / accepted costs:**
- JSDoc type annotations must be maintained by hand.
- `extension.js` still holds module-level state (status bar, timers), so
  extension-host behavior (debounce, status transitions) is only verifiable
  via the F5 development host, not unit tests.

**Revisit when:**
- Multi-root workspace support is prioritized — `GitService`-per-folder is the
  natural extension, but the watcher/state wiring assumes one root today.
- The `vscode.git` API stabilizes enough to expose status + push semantics —
  it would remove process management entirely (supersede via a new ADR).
- The codebase grows past ~3 kLOC or gains contributors — reevaluate a
  TypeScript migration (the JSDoc types make that migration mechanical).

## Action Items

1. [x] Extract pure modules and cover with unit tests (26 tests, v1.1.0)
2. [x] Replace shell-string git with `GitService` on `execFile` (v1.1.0)
3. [x] Enforce lint + strict typecheck + tests + packaging in CI (v1.1.0)
4. [ ] Add extension-host integration tests (`@vscode/test-electron`) for the
       debounce/status-bar lifecycle
5. [ ] Design multi-root workspace support (one `GitService` per folder)
6. [ ] Track `vscode.git` API maturity; draft superseding ADR if it becomes
       viable
