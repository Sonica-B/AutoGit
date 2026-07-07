/**
 * Integration tests: GitService against real temporary git repositories.
 *
 * These exercise the actual git binary — the same code path the extension
 * uses at runtime — covering scenarios unit tests cannot: empty repos with
 * no HEAD, hostile commit messages passed as argv, rename detection, and
 * the staged-diff → secret-scanner data path end to end.
 */

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { GitService } = require('../lib/gitService');
const {
    parseGitStatus,
    parseStatusZ,
    generateFallbackCommitMessage
} = require('../lib/commitMessage');
const { scanDiff } = require('../lib/secretScanner');

/**
 * Stage changes the way the extension pipeline does: list scoped changes,
 * optionally drop untracked, and stage the explicit path list.
 * @param {GitService} git
 * @param {boolean} [includeUntracked]
 */
async function stageChanges(git, includeUntracked = true) {
    const entries = parseStatusZ(await git.statusZ());
    const paths = [];
    for (const entry of entries) {
        if (!includeUntracked && entry.status === 'Untracked') continue;
        paths.push(entry.path);
        if (entry.origPath) paths.push(entry.origPath);
    }
    await git.stagePaths(paths);
}

/** @type {string[]} directories to clean up */
const tempDirs = [];

function makeTempDir(prefix) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
    tempDirs.push(dir);
    return dir;
}

/**
 * Create an isolated git repo: local identity, no signing, no hooks —
 * immune to whatever global config the host machine has.
 * @returns {Promise<{ dir: string, git: GitService }>}
 */
async function makeRepo() {
    const dir = makeTempDir('autogit-test-');
    const git = new GitService(dir);
    await git.run(['init', '--initial-branch=main']);
    await git.run(['config', 'user.name', 'AutoGit Test']);
    await git.run(['config', 'user.email', 'test@example.com']);
    await git.run(['config', 'commit.gpgsign', 'false']);
    const hooksDir = path.join(dir, '.empty-hooks');
    fs.mkdirSync(hooksDir);
    await git.run(['config', 'core.hooksPath', hooksDir]);
    return { dir, git };
}

function write(dir, file, content) {
    const full = path.join(dir, file);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
}

before(async () => {
    // Fail fast with a clear message if git is unavailable.
    const probe = new GitService(os.tmpdir());
    await probe.run(['--version']);
});

after(() => {
    for (const dir of tempDirs) {
        try {
            fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
        } catch {
            // Best-effort cleanup; Windows can hold transient locks.
        }
    }
});

test('isRepository distinguishes repos from plain directories', async () => {
    const { git } = await makeRepo();
    assert.equal(await git.isRepository(), true);

    const plain = new GitService(makeTempDir('autogit-plain-'));
    assert.equal(await plain.isRepository(), false);
});

test('empty repo (no HEAD yet): staging, diffing, and first commit all work', async () => {
    const { dir, git } = await makeRepo();
    write(dir, 'app.js', 'console.log("hello");\n');

    // This is the brand-new-repo path the extension hits on first use.
    await stageChanges(git, true);
    assert.equal(await git.hasStagedChanges(), true);

    const diff = await git.stagedDiff();
    assert.match(diff, /\+console\.log\("hello"\);/);

    const stat = await git.stagedDiffStat();
    assert.match(stat, /app\.js/);

    await git.commit('chore: first commit');
    const { stdout } = await git.run(['log', '--format=%s', '-1']);
    assert.equal(stdout.trim(), 'chore: first commit');
});

test('hostile commit messages are passed literally, never shell-interpreted', async () => {
    const { dir, git } = await makeRepo();
    write(dir, 'canary.txt', 'safe\n');
    await stageChanges(git, true);

    const hostile = 'fix: "quoted" $(echo pwned) `backtick` \'single\' ; rm -rf --no-preserve-root 🚀';
    await git.commit(hostile);

    const { stdout } = await git.run(['log', '--format=%s', '-1']);
    assert.equal(stdout.trim(), hostile);
    // The $(echo pwned) must appear literally — proof nothing was executed.
    assert.match(stdout, /\$\(echo pwned\)/);
});

test('commit messages starting with a dash are not parsed as git flags', async () => {
    const { dir, git } = await makeRepo();
    write(dir, 'a.txt', 'x\n');
    await stageChanges(git, true);

    await git.commit('--amend is a great flag');
    const { stdout } = await git.run(['log', '--format=%s', '-1']);
    assert.equal(stdout.trim(), '--amend is a great flag');
});

test('stageAll(false) stages tracked modifications but not untracked files', async () => {
    const { dir, git } = await makeRepo();
    write(dir, 'tracked.txt', 'v1\n');
    await stageChanges(git, true);
    await git.commit('chore: baseline');

    write(dir, 'tracked.txt', 'v2\n');
    write(dir, 'untracked.txt', 'new\n');
    await stageChanges(git, false);

    const { stdout } = await git.run(['diff', '--cached', '--name-only']);
    const staged = stdout.trim().split('\n');
    assert.deepEqual(staged, ['tracked.txt']);

    const status = await git.status();
    assert.match(status, /\?\? untracked\.txt/);
});

test('currentBranch and hasUpstream behave on a local-only repo', async () => {
    const { dir, git } = await makeRepo();
    write(dir, 'a.txt', 'x\n');
    await stageChanges(git, true);
    await git.commit('chore: init');

    assert.equal(await git.currentBranch(), 'main');
    assert.equal(await git.hasUpstream(), false);
});

test('push without any remote fails with a recognizable error', async () => {
    const { dir, git } = await makeRepo();
    write(dir, 'a.txt', 'x\n');
    await stageChanges(git, true);
    await git.commit('chore: init');

    await assert.rejects(() => git.push(), (/** @type {any} */ err) => {
        const text = `${err.message} ${err.stderr || ''}`;
        return /origin|remote|repository/i.test(text);
    });
});

test('rename is reported by porcelain and parsed correctly end to end', async () => {
    const { dir, git } = await makeRepo();
    write(dir, 'old-name.js', 'module.exports = 1;\n');
    await stageChanges(git, true);
    await git.commit('chore: add module');

    await git.run(['mv', 'old-name.js', 'new-name.js']);
    const status = await git.status();
    const entries = parseGitStatus(status);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].status, 'Renamed');
    assert.equal(entries[0].path, 'new-name.js');

    const message = generateFallbackCommitMessage(status);
    assert.equal(message, 'chore: rename new-name.js');
});

test('paths with spaces survive status parsing and fallback messages', async () => {
    const { dir, git } = await makeRepo();
    write(dir, 'my notes.md', '# notes\n');
    await stageChanges(git, true);

    const status = await git.status();
    const entries = parseGitStatus(status);
    assert.equal(entries[0].path, 'my notes.md');
});

test('end to end: a staged secret is caught by the scanner from a real diff', async () => {
    const { dir, git } = await makeRepo();
    write(dir, 'src/config.js', 'const key = "AKIAIOSFODNN7EXAMPLE";\nconst ok = 1;\n');
    await stageChanges(git, true);

    const diff = await git.stagedDiff();
    const { findings, skipped } = scanDiff(diff);
    assert.equal(skipped, false);
    assert.equal(findings.length, 1);
    assert.equal(findings[0].ruleId, 'aws-access-key-id');
    assert.equal(findings[0].file, 'src/config.js');
    assert.equal(findings[0].line, 1);
    assert.ok(!findings[0].preview.includes('EXAMPLE'), 'preview must be redacted');
});

test('end to end: pragma-exempted secret passes the scanner from a real diff', async () => {
    const { dir, git } = await makeRepo();
    write(
        dir,
        'docs/example.js',
        'const demo = "AKIAIOSFODNN7EXAMPLE"; // autogit:allow-secret docs sample\n'
    );
    await stageChanges(git, true);

    const diff = await git.stagedDiff();
    assert.deepEqual(scanDiff(diff).findings, []);
});

test('end to end: secret in a MODIFIED line of an existing file is caught with the right line number', async () => {
    const { dir, git } = await makeRepo();
    write(dir, 'server.js', 'line1\nline2\nline3\nline4\nline5\n');
    await stageChanges(git, true);
    await git.commit('chore: baseline');

    // Token assembled from parts so no literal secret appears in source.
    const ghp = 'ghp' + '_x7K9mQ2wL5nR8vT3bY6cJ1fH4dS0aZ9pE2uW';
    write(dir, 'server.js', `line1\nline2\nline3\nconst t = "${ghp}";\nline5\n`);
    await stageChanges(git, true);

    const diff = await git.stagedDiff();
    const { findings } = scanDiff(diff);
    assert.equal(findings.length, 1);
    assert.equal(findings[0].ruleId, 'github-token');
    assert.equal(findings[0].file, 'server.js');
    assert.equal(findings[0].line, 4);
});

test('deleted lines containing secrets do not block the commit', async () => {
    const { dir, git } = await makeRepo();
    write(dir, 'creds.js', 'const key = "AKIAIOSFODNN7EXAMPLE";\n');
    await git.run(['add', '--', 'creds.js']);
    await git.commit('chore: baseline with secret (test fixture)');

    write(dir, 'creds.js', 'const key = process.env.AWS_KEY;\n');
    await stageChanges(git, true);

    const diff = await git.stagedDiff();
    assert.deepEqual(scanDiff(diff).findings, [], 'removing a secret must not be blocked');
});

test('binary files do not produce spurious findings or crashes', async () => {
    const { dir, git } = await makeRepo();
    fs.writeFileSync(path.join(dir, 'image.bin'), Buffer.from([0, 1, 2, 255, 254, 0, 65, 75]));
    await stageChanges(git, true);

    const diff = await git.stagedDiff();
    const result = scanDiff(diff);
    assert.deepEqual(result.findings, []);
});

// --- regression tests for v1.3.0 fixes --------------------------------------

const { compilePatterns } = require('../lib/patterns');

/** Select paths to stage the way the pipeline does, honoring excludes. */
async function selectFiltered(git, excludePatterns, includeUntracked = true) {
    const compiled = compilePatterns(excludePatterns);
    const { isExcluded } = require('../lib/patterns');
    const entries = parseStatusZ(await git.statusZ());
    return entries.filter((e) => {
        if (!includeUntracked && e.status === 'Untracked') return false;
        return !isExcluded(e.path, compiled);
    });
}

test('excluded files (.env) are not staged even when another file triggers the run', async () => {
    const { dir, git } = await makeRepo();
    write(dir, 'app.js', 'console.log(1);\n');
    write(dir, '.env', 'DB_PASSWORD=q7Xz9Kf2mW8vL4nR3bT6\n');

    const toStage = await selectFiltered(git, ['.env*', 'node_modules/**']);
    await git.stagePaths(toStage.map((e) => e.path));

    const { stdout } = await git.run(['diff', '--cached', '--name-only']);
    const staged = stdout.trim().split('\n').filter(Boolean);
    assert.deepEqual(staged, ['app.js'], '.env must never be staged');
});

test('currentBranch works on an unborn branch (zero commits)', async () => {
    const { git } = await makeRepo();
    // Fresh repo, no commits yet.
    assert.equal(await git.isUnborn(), true);
    assert.equal(await git.currentBranch(), 'main');
    assert.equal(await git.isDetachedHead(), false);
});

test('detached HEAD is detected', async () => {
    const { dir, git } = await makeRepo();
    write(dir, 'a.txt', 'one\n');
    await stageChanges(git, true);
    await git.commit('chore: c1');
    write(dir, 'a.txt', 'two\n');
    await stageChanges(git, true);
    await git.commit('chore: c2');

    const { stdout } = await git.run(['rev-parse', 'HEAD~1']);
    await git.run(['checkout', '--detach', stdout.trim()]);

    assert.equal(await git.isDetachedHead(), true);
    assert.equal(await git.currentBranch(), '');
});

test('pendingOperation detects an in-progress merge conflict', async () => {
    const { dir, git } = await makeRepo();
    write(dir, 'f.txt', 'base\n');
    await stageChanges(git, true);
    await git.commit('chore: base');

    await git.run(['checkout', '-b', 'feature']);
    write(dir, 'f.txt', 'feature change\n');
    await stageChanges(git, true);
    await git.commit('chore: feature');

    await git.run(['checkout', 'main']);
    write(dir, 'f.txt', 'main change\n');
    await stageChanges(git, true);
    await git.commit('chore: main');

    // Attempt the conflicting merge; it will fail and leave MERGE_HEAD.
    await assert.rejects(() => git.run(['merge', 'feature']));
    assert.equal(await git.pendingOperation(), 'merge');
});

test('pendingOperation returns null in a clean repo', async () => {
    const { dir, git } = await makeRepo();
    write(dir, 'a.txt', 'x\n');
    await stageChanges(git, true);
    await git.commit('chore: init');
    assert.equal(await git.pendingOperation(), null);
});

test('resolveRemote prefers origin and falls back to the sole remote', async () => {
    const { dir, git } = await makeRepo();
    write(dir, 'a.txt', 'x\n');
    await stageChanges(git, true);
    await git.commit('chore: init');

    await git.run(['remote', 'add', 'upstream', 'https://example.com/repo.git']);
    assert.equal(await git.resolveRemote(), 'upstream', 'sole remote is used even if not named origin');

    await git.run(['remote', 'add', 'origin', 'https://example.com/origin.git']);
    assert.equal(await git.resolveRemote(), 'origin', 'origin is preferred when present');
});

test('stagedDiff uses stable prefixes and quoting regardless of user config', async () => {
    const { dir, git } = await makeRepo();
    // Turn on the config that used to break the scanner's diff parsing.
    await git.run(['config', 'diff.mnemonicPrefix', 'true']);
    await git.run(['config', 'core.quotepath', 'true']);
    write(dir, 'secret.txt', 'AKIAIOSFODNN7EXAMPLE\n');
    await stageChanges(git, true);

    const diff = await git.stagedDiff();
    const { findings } = scanDiff(diff);
    assert.equal(findings.length, 1);
    assert.equal(findings[0].file, 'secret.txt', 'prefix must be normalized to b/');
});

test('stagedDiffLineCount reports added+removed line totals', async () => {
    const { dir, git } = await makeRepo();
    write(dir, 'a.txt', 'l1\nl2\nl3\n');
    await stageChanges(git, true);
    const count = await git.stagedDiffLineCount();
    assert.equal(count, 3);
});
