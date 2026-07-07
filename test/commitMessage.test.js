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
