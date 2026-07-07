/**
 * Git operations for a single repository.
 *
 * All commands run through execFile (argument arrays, no shell), which
 * removes the shell-injection risk of interpolating commit messages into
 * a command string.
 */

const { execFile } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);

const DEFAULT_TIMEOUT_MS = 60_000;
const MAX_BUFFER_BYTES = 10 * 1024 * 1024;

class GitService {
    /**
     * @param {string} cwd repository working directory
     * @param {(msg: string) => void} [log] optional logger
     */
    constructor(cwd, log) {
        this.cwd = cwd;
        this.log = log || (() => {});
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

    /** @returns {Promise<boolean>} whether cwd is inside a git work tree */
    async isRepository() {
        try {
            const { stdout } = await this.run(['rev-parse', '--is-inside-work-tree']);
            return stdout.trim() === 'true';
        } catch {
            return false;
        }
    }

    /** @returns {Promise<string>} repository root path */
    async repositoryRoot() {
        const { stdout } = await this.run(['rev-parse', '--show-toplevel']);
        return stdout.trim();
    }

    /** @returns {Promise<string>} raw `git status --porcelain` output */
    async status() {
        const { stdout } = await this.run(['status', '--porcelain']);
        return stdout;
    }

    /** @returns {Promise<string>} current branch name (or 'HEAD' when detached) */
    async currentBranch() {
        const { stdout } = await this.run(['rev-parse', '--abbrev-ref', 'HEAD']);
        return stdout.trim();
    }

    /**
     * Stage changes.
     * @param {boolean} includeUntracked stage untracked files too
     */
    async stageAll(includeUntracked) {
        await this.run(['add', includeUntracked ? '.' : '-u']);
    }

    /** @returns {Promise<string>} staged diff stat for prompt context */
    async stagedDiffStat() {
        const { stdout } = await this.run(['diff', '--cached', '--stat']);
        return stdout;
    }

    /** @returns {Promise<boolean>} whether anything is staged */
    async hasStagedChanges() {
        try {
            await this.run(['diff', '--cached', '--quiet']);
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
     * Push the current branch, setting the upstream on first push.
     */
    async push() {
        if (await this.hasUpstream()) {
            await this.run(['push'], { timeout: 120_000 });
            return;
        }
        const branch = await this.currentBranch();
        this.log(`No upstream configured; pushing with -u origin ${branch}`);
        await this.run(['push', '-u', 'origin', branch], { timeout: 120_000 });
    }
}

module.exports = { GitService };
