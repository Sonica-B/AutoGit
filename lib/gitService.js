/**
 * Git operations for a single repository.
 *
 * All commands run through execFile (argument arrays, no shell), which
 * removes the shell-injection risk of interpolating commit messages into
 * a command string.
 *
 * The service is constructed with the repository ROOT as its working
 * directory and an optional `scope` pathspec (the workspace folder relative
 * to that root, or '.' when the workspace is the repo root). All staging,
 * status, and diff operations are limited to that scope so a workspace that
 * is a subdirectory of a larger repo never sweeps in unrelated changes.
 */

const { execFile } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);

const DEFAULT_TIMEOUT_MS = 60_000;
const PUSH_TIMEOUT_MS = 120_000;
const MAX_BUFFER_BYTES = 64 * 1024 * 1024;
/** Batch size for explicit `git add` pathspec lists (argv length safety). */
const ADD_BATCH_SIZE = 100;

/**
 * Config flags pinned on every diff/status call so the scanner and parser see
 * a stable format regardless of the user's git configuration:
 * - core.quotepath=false: emit UTF-8 paths, not octal-escaped
 * - diff.mnemonicPrefix=false / diff.noprefix=false: keep the a/ b/ prefixes
 */
const STABLE_CONFIG = [
    '-c', 'core.quotepath=false',
    '-c', 'diff.mnemonicPrefix=false',
    '-c', 'diff.noprefix=false'
];

class GitService {
    /**
     * @param {string} cwd repository root (or any path inside the work tree)
     * @param {(msg: string) => void} [log] optional logger
     * @param {string} [scope] pathspec limiting operations (default '.')
     */
    constructor(cwd, log, scope) {
        this.cwd = cwd;
        this.log = log || (() => {});
        this.scope = scope || '.';
    }

    /**
     * Run a git command with an argument array.
     * @param {string[]} args
     * @param {{ timeout?: number }} [options]
     * @returns {Promise<{ stdout: string, stderr: string }>}
     */
    async run(args, options = {}) {
        this.log(`git ${args.join(' ')}`);
        return execFileAsync('git', args, {
            cwd: this.cwd,
            timeout: options.timeout || DEFAULT_TIMEOUT_MS,
            maxBuffer: MAX_BUFFER_BYTES,
            windowsHide: true
        });
    }

    /**
     * @returns {Promise<boolean>} whether cwd is inside a git work tree
     * @throws if the git executable itself cannot be found (ENOENT)
     */
    async isRepository() {
        try {
            const { stdout } = await this.run(['rev-parse', '--is-inside-work-tree']);
            return stdout.trim() === 'true';
        } catch (err) {
            // A missing git binary is not "not a repository" — surface it so the
            // caller can tell the user to install git rather than run git init.
            if (err && /** @type {any} */ (err).code === 'ENOENT') {
                throw err;
            }
            return false;
        }
    }

    /** @returns {Promise<string>} repository root path */
    async repositoryRoot() {
        const { stdout } = await this.run(['rev-parse', '--show-toplevel']);
        return stdout.trim();
    }

    /** @returns {Promise<string>} raw scoped `git status --porcelain` output */
    async status() {
        const { stdout } = await this.run([
            ...STABLE_CONFIG,
            'status',
            '--porcelain',
            '--',
            this.scope
        ]);
        return stdout;
    }

    /** @returns {Promise<string>} NUL-delimited scoped porcelain status (v1 -z) */
    async statusZ() {
        const { stdout } = await this.run([
            ...STABLE_CONFIG,
            'status',
            '--porcelain=v1',
            '-z',
            '--',
            this.scope
        ]);
        return stdout;
    }

    /**
     * @returns {Promise<string>} current branch name, or '' when detached or
     * on an unborn branch. Works on a repo with zero commits.
     */
    async currentBranch() {
        const { stdout } = await this.run(['branch', '--show-current']);
        return stdout.trim();
    }

    /** @returns {Promise<boolean>} true when HEAD is detached (not on a branch) */
    async isDetachedHead() {
        return (await this.currentBranch()) === '';
    }

    /**
     * @returns {Promise<boolean>} true when the repo has no commits yet
     * (an unborn HEAD, e.g. immediately after `git init`).
     */
    async isUnborn() {
        try {
            await this.run(['rev-parse', '--verify', '--quiet', 'HEAD']);
            return false;
        } catch {
            return true;
        }
    }

    /**
     * @returns {Promise<string|null>} the in-progress operation name
     * ('merge', 'rebase', 'cherry-pick', 'revert', 'bisect') or null.
     */
    async pendingOperation() {
        const checks = [
            ['MERGE_HEAD', 'merge'],
            ['CHERRY_PICK_HEAD', 'cherry-pick'],
            ['REVERT_HEAD', 'revert']
        ];
        for (const [ref, name] of checks) {
            try {
                await this.run(['rev-parse', '--verify', '--quiet', ref]);
                return name;
            } catch {
                // ref absent — not that operation
            }
        }
        // rebase / bisect are directory-based, not ref-based.
        try {
            const { stdout } = await this.run(['rev-parse', '--git-path', 'rebase-merge']);
            const alt = await this.run(['rev-parse', '--git-path', 'rebase-apply']);
            const fs = require('fs');
            if (fs.existsSync(stdout.trim()) || fs.existsSync(alt.stdout.trim())) {
                return 'rebase';
            }
        } catch {
            // ignore — treat as no rebase in progress
        }
        return null;
    }

    /**
     * Stage an explicit list of repo-root-relative paths. Deletions are
     * staged too (modern `git add <path>` records removals). Paths are passed
     * as discrete argv, so spaces and special characters need no quoting.
     * @param {string[]} paths
     */
    async stagePaths(paths) {
        const unique = [...new Set(paths.filter((p) => p && p.length > 0))];
        for (let i = 0; i < unique.length; i += ADD_BATCH_SIZE) {
            const batch = unique.slice(i, i + ADD_BATCH_SIZE);
            await this.run(['add', '--', ...batch]);
        }
    }

    /** @returns {Promise<string>} scoped staged diff stat for prompt context */
    async stagedDiffStat() {
        const { stdout } = await this.run([
            ...STABLE_CONFIG,
            'diff',
            '--cached',
            '--stat',
            '--',
            this.scope
        ]);
        return stdout;
    }

    /**
     * Full scoped staged unified diff for secret scanning. Prefixes and quoting
     * are pinned and external diff drivers disabled so the scanner always sees
     * a standard unified diff it can parse.
     * @returns {Promise<string>}
     */
    async stagedDiff() {
        const { stdout } = await this.run([
            ...STABLE_CONFIG,
            'diff',
            '--cached',
            '--no-color',
            '--no-ext-diff',
            '--unified=0',
            '--',
            this.scope
        ]);
        return stdout;
    }

    /**
     * Cheap size probe for the staged diff (added + removed line count),
     * used to decide whether the full diff is worth fetching for scanning.
     * @returns {Promise<number>} total changed lines, or Infinity if unknown
     */
    async stagedDiffLineCount() {
        try {
            const { stdout } = await this.run([
                'diff',
                '--cached',
                '--numstat',
                '--',
                this.scope
            ]);
            let total = 0;
            for (const line of stdout.split('\n')) {
                const match = line.match(/^(\d+|-)\t(\d+|-)\t/);
                if (!match) continue;
                // Binary files report '-'; treat as 0 added/removed text lines.
                const added = match[1] === '-' ? 0 : parseInt(match[1], 10);
                const removed = match[2] === '-' ? 0 : parseInt(match[2], 10);
                total += added + removed;
            }
            return total;
        } catch {
            return Infinity;
        }
    }

    /** @returns {Promise<boolean>} whether anything is staged (scoped) */
    async hasStagedChanges() {
        try {
            await this.run(['diff', '--cached', '--quiet', '--', this.scope]);
            return false;
        } catch {
            return true;
        }
    }

    /**
     * Commit staged changes. The message is passed as a discrete argument,
     * never interpolated into a shell string.
     * @param {string} message
     */
    async commit(message) {
        await this.run(['commit', '-m', message]);
    }

    /** @returns {Promise<boolean>} whether the current branch has an upstream */
    async hasUpstream() {
        try {
            await this.run(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']);
            return true;
        } catch {
            return false;
        }
    }

    /**
     * Resolve the remote to push to: `remote.pushDefault` if set, else the
     * sole remote, preferring one named 'origin'.
     * @returns {Promise<string>} remote name
     * @throws if no remote is configured
     */
    async resolveRemote() {
        try {
            const { stdout } = await this.run(['config', '--get', 'remote.pushDefault']);
            const preferred = stdout.trim();
            if (preferred) return preferred;
        } catch {
            // no pushDefault configured
        }
        const { stdout } = await this.run(['remote']);
        const remotes = stdout.split('\n').map((r) => r.trim()).filter(Boolean);
        if (remotes.length === 0) {
            const err = new Error('No git remote is configured for this repository.');
            /** @type {any} */ (err).noRemote = true;
            throw err;
        }
        return remotes.includes('origin') ? 'origin' : remotes[0];
    }

    /**
     * Push the current branch, setting the upstream on first push. Resolves the
     * remote name instead of assuming 'origin'.
     * @throws if HEAD is detached (there is no branch to push)
     */
    async push() {
        if (await this.hasUpstream()) {
            await this.run(['push'], { timeout: PUSH_TIMEOUT_MS });
            return;
        }
        const branch = await this.currentBranch();
        if (branch === '') {
            const err = new Error('Cannot push a detached HEAD — no branch to publish.');
            /** @type {any} */ (err).detachedHead = true;
            throw err;
        }
        const remote = await this.resolveRemote();
        this.log(`No upstream configured; pushing with -u ${remote} ${branch}`);
        await this.run(['push', '-u', remote, branch], { timeout: PUSH_TIMEOUT_MS });
    }
}

module.exports = { GitService, STABLE_CONFIG };
