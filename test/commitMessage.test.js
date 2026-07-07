const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
    parseGitStatus,
    describeStatusCode,
    summarizeChanges,
    generateFallbackCommitMessage,
    buildCommitPrompt,
    sanitizeAiMessage,
    MAX_PROMPT_FILES
} = require('../lib/commitMessage');

test('parseGitStatus parses modified, added, deleted and untracked entries', () => {
    const output = [
        ' M src/app.js',
        'A  src/new.js',
        ' D old.txt',
        '?? notes.md'
    ].join('\n');

    const entries = parseGitStatus(output);
    assert.equal(entries.length, 4);
    assert.deepEqual(entries[0], { path: 'src/app.js', code: ' M', status: 'Modified' });
    assert.deepEqual(entries[1], { path: 'src/new.js', code: 'A ', status: 'Added' });
    assert.deepEqual(entries[2], { path: 'old.txt', code: ' D', status: 'Deleted' });
    assert.deepEqual(entries[3], { path: 'notes.md', code: '??', status: 'Untracked' });
});

test('parseGitStatus handles renames and quoted paths', () => {
    const entries = parseGitStatus('R  old-name.js -> new-name.js\n M "path with spaces.txt"');
    assert.equal(entries[0].path, 'new-name.js');
    assert.equal(entries[0].status, 'Renamed');
    assert.equal(entries[1].path, 'path with spaces.txt');
});

test('parseGitStatus tolerates empty and CRLF input', () => {
    assert.deepEqual(parseGitStatus(''), []);
    assert.deepEqual(parseGitStatus(null), []);
    const entries = parseGitStatus(' M a.js\r\n M b.js\r\n');
    assert.equal(entries.length, 2);
    assert.equal(entries[1].path, 'b.js');
});

test('describeStatusCode covers all porcelain codes', () => {
    assert.equal(describeStatusCode('??'), 'Untracked');
    assert.equal(describeStatusCode('A '), 'Added');
    assert.equal(describeStatusCode(' M'), 'Modified');
    assert.equal(describeStatusCode(' D'), 'Deleted');
    assert.equal(describeStatusCode('R '), 'Renamed');
    assert.equal(describeStatusCode('C '), 'Copied');
    assert.equal(describeStatusCode('  '), 'Changed');
});

test('summarizeChanges counts by kind', () => {
    const entries = parseGitStatus(' M a.js\nA  b.js\n?? c.js\n D d.js\nR  e.js -> f.js');
    assert.deepEqual(summarizeChanges(entries), {
        added: 2,
        modified: 1,
        deleted: 1,
        renamed: 1
    });
});

test('fallback message describes a single file precisely', () => {
    assert.equal(generateFallbackCommitMessage(' M src/app.js'), 'chore: update src/app.js');
    assert.equal(generateFallbackCommitMessage('?? readme.md'), 'chore: add readme.md');
    assert.equal(generateFallbackCommitMessage(' D junk.txt'), 'chore: remove junk.txt');
});

test('fallback message summarizes multiple files', () => {
    const message = generateFallbackCommitMessage(' M a.js\n M b.js\n?? c.js');
    assert.equal(message, 'chore: add 1, update 2 files');
});

test('fallback message handles empty status', () => {
    assert.equal(generateFallbackCommitMessage(''), 'chore: update files');
});

test('buildCommitPrompt lists files and includes diff summary', () => {
    const entries = parseGitStatus(' M src/app.js\n?? docs/notes.md');
    const prompt = buildCommitPrompt(entries, ' src/app.js | 10 +++++-----');
    assert.match(prompt, /Modified: src\/app\.js/);
    assert.match(prompt, /Untracked: docs\/notes\.md/);
    assert.match(prompt, /Diff summary:/);
    assert.match(prompt, /conventional commit/i);
});

test('buildCommitPrompt truncates very long file lists', () => {
    const entries = Array.from({ length: MAX_PROMPT_FILES + 10 }, (_, i) => ({
        path: `file${i}.js`,
        status: 'Modified',
        code: ' M'
    }));
    const prompt = buildCommitPrompt(entries, '');
    assert.match(prompt, /and 10 more files/);
});

test('sanitizeAiMessage strips quotes, fences and prefixes', () => {
    assert.equal(sanitizeAiMessage('"feat: add login"'), 'feat: add login');
    assert.equal(sanitizeAiMessage("'fix: typo'"), 'fix: typo');
    assert.equal(sanitizeAiMessage('`docs: update readme`'), 'docs: update readme');
    assert.equal(sanitizeAiMessage('```\nfeat: add api\n```'), 'feat: add api');
    assert.equal(sanitizeAiMessage('Commit message: fix: null check'), 'fix: null check');
});

test('sanitizeAiMessage keeps only the first line', () => {
    assert.equal(
        sanitizeAiMessage('feat: add auth\n\nThis adds a full auth system.'),
        'feat: add auth'
    );
});

test('sanitizeAiMessage enforces max length with ellipsis', () => {
    const long = 'feat: ' + 'x'.repeat(200);
    const result = sanitizeAiMessage(long, 72);
    assert.equal(result.length <= 72, true);
    assert.match(result, /\.\.\.$/);
});

test('sanitizeAiMessage returns empty string for unusable input', () => {
    assert.equal(sanitizeAiMessage(''), '');
    assert.equal(sanitizeAiMessage('   \n  '), '');
    assert.equal(sanitizeAiMessage(undefined), '');
    assert.equal(sanitizeAiMessage(null), '');
});

// --- regression tests for v1.3.0 fixes --------------------------------------

const {
    parseStatusZ,
    decodePorcelainPath,
    generateFallbackFromEntries
} = require('../lib/commitMessage');

test('arrow split applies only to rename/copy entries', () => {
    // A modified file whose name legitimately contains " -> " must not be split.
    const entries = parseGitStatus(' M weird -> name.js');
    assert.equal(entries[0].path, 'weird -> name.js');
    assert.equal(entries[0].status, 'Modified');
});

test('rename entries are still split to the destination path', () => {
    const entries = parseGitStatus('R  old.js -> new.js');
    assert.equal(entries[0].path, 'new.js');
    assert.equal(entries[0].status, 'Renamed');
});

test('decodePorcelainPath decodes C-style octal-escaped non-ASCII paths', () => {
    // git quotes "café/config.js" as "caf\303\251/config.js" with quotepath on.
    assert.equal(decodePorcelainPath('"caf\\303\\251/config.js"'), 'café/config.js');
    assert.equal(decodePorcelainPath('"tab\\there.txt"'), 'tab\there.txt');
    assert.equal(decodePorcelainPath('plain.txt'), 'plain.txt');
});

test('parseGitStatus decodes quoted non-ASCII filenames', () => {
    const entries = parseGitStatus(' M "caf\\303\\251/config.js"');
    assert.equal(entries[0].path, 'café/config.js');
});

test('parseStatusZ parses NUL-delimited entries including renames', () => {
    const z = ' M src/app.js\0?? new.txt\0R  dest.js\0orig.js\0';
    const entries = parseStatusZ(z);
    assert.equal(entries.length, 3);
    assert.equal(entries[0].path, 'src/app.js');
    assert.equal(entries[1].path, 'new.txt');
    assert.equal(entries[1].status, 'Untracked');
    assert.equal(entries[2].path, 'dest.js');
    assert.equal(entries[2].origPath, 'orig.js');
    assert.equal(entries[2].status, 'Renamed');
});

test('parseStatusZ handles empty input', () => {
    assert.deepEqual(parseStatusZ(''), []);
    assert.deepEqual(parseStatusZ(null), []);
});

test('sanitizeAiMessage never splits a surrogate pair at the boundary', () => {
    const message = 'feat: add ' + 'x'.repeat(58) + '😀 more';
    const result = sanitizeAiMessage(message, 72);
    assert.ok(result.length <= 72);
    assert.ok(result.isWellFormed(), 'result must not contain a lone surrogate');
    assert.match(result, /\.\.\.$/);
});

test('generateFallbackFromEntries matches string-based fallback', () => {
    const entries = parseGitStatus(' M a.js\nA  b.js\n?? c.js');
    assert.equal(generateFallbackFromEntries(entries), 'chore: add 2, update 1 files');
    assert.equal(generateFallbackFromEntries([]), 'chore: update files');
});
