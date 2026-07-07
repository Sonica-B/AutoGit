const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
    scanDiff,
    parseAddedLines,
    shannonEntropy,
    looksLikeRealSecret,
    redact,
    compileIgnorePatterns,
    MAX_SCAN_CHARS,
    MAX_FINDINGS
} = require('../lib/secretScanner');

/** Build a minimal staged diff adding the given lines to a file. */
function diffAdding(lines, file = 'src/config.js') {
    return [
        `diff --git a/${file} b/${file}`,
        `--- a/${file}`,
        `+++ b/${file}`,
        `@@ -0,0 +1,${lines.length} @@`,
        ...lines.map((l) => `+${l}`)
    ].join('\n');
}

// --- diff parsing -----------------------------------------------------------

test('parseAddedLines extracts only added lines with file and line numbers', () => {
    const diff = [
        'diff --git a/a.js b/a.js',
        '--- a/a.js',
        '+++ b/a.js',
        '@@ -10,2 +10,3 @@ function x() {',
        ' context line',
        '-removed line',
        '+added line one',
        '+added line two',
        ' trailing context'
    ].join('\n');

    const added = parseAddedLines(diff);
    assert.equal(added.length, 2);
    assert.deepEqual(added[0], { file: 'a.js', line: 11, text: 'added line one' });
    assert.deepEqual(added[1], { file: 'a.js', line: 12, text: 'added line two' });
});

test('parseAddedLines tracks multiple files and hunks', () => {
    const diff = [
        'diff --git a/one.js b/one.js',
        '--- a/one.js',
        '+++ b/one.js',
        '@@ -1 +1 @@',
        '+first file',
        'diff --git a/two.js b/two.js',
        '--- a/two.js',
        '+++ b/two.js',
        '@@ -5 +7,2 @@',
        '+second file line 7',
        '+second file line 8'
    ].join('\n');

    const added = parseAddedLines(diff);
    assert.equal(added.length, 3);
    assert.equal(added[0].file, 'one.js');
    assert.equal(added[1].file, 'two.js');
    assert.equal(added[1].line, 7);
    assert.equal(added[2].line, 8);
});

test('parseAddedLines handles empty input', () => {
    assert.deepEqual(parseAddedLines(''), []);
    assert.deepEqual(parseAddedLines(null), []);
});

// --- rule detection ---------------------------------------------------------

// Vendor tokens are assembled from parts (`p + b`) so no complete secret
// literal ever appears in this source file — which would otherwise trip
// GitHub push protection / secret scanners. The AutoGit scanner still sees the
// full concatenated token at runtime. `AKIAIOSFODNN7EXAMPLE` is AWS's public
// documentation example and is safe to use verbatim.
const p = (prefix, body) => prefix + body;

const REAL_LOOKING_SECRETS = [
    ['AWS access key ID', 'const key = "AKIAIOSFODNN7EXAMPLE";', 'aws-access-key-id'],
    ['GitHub classic PAT', 'token: ' + p('ghp', '_x7K9mQ2wL5nR8vT3bY6cJ1fH4dS0aZ9pE2uW'), 'github-token'],
    ['GitLab PAT', 'GITLAB_TOKEN=' + p('glpat', '-Xy9-Kw2mQ7vL4nR8bT3c'), 'gitlab-pat'],
    ['Anthropic key', 'ANTHROPIC_API_KEY=' + p('sk-ant', '-api03-x7K9mQ2wL5nR8vT3bY6c'), 'anthropic-api-key'],
    ['Google API key', 'key=' + p('AIza', 'SyD8x7K9mQ2wL5nR8vT3bY6cJ1fH4dS0aZ9'), 'google-api-key'],
    ['Slack bot token', 'SLACK=' + p('xoxb', '-2489453091-9832467312-Xw7Km2Qv9Lp4'), 'slack-token'],
    ['Stripe live key', 'stripe.key = "' + p('sk_live', '_x7K9mQ2wL5nR8vT3bY6cJ1fH') + '"', 'stripe-live-key'],
    ['npm token', '//registry.npmjs.org/:_authToken=' + p('npm', '_x7K9mQ2wL5nR8vT3bY6cJ1fH4dS0aZ9pE2uW'), 'npm-token'],
    [
        'SendGrid key',
        'SG_KEY=' + p('SG', '.x7K9mQ2wL5nR8vT3bY6cJw.x7K9mQ2wL5nR8vT3bY6cJ1fH4dS0aZ9pE2uWx7K9mQ2'),
        'sendgrid-api-key'
    ],
    [
        'JWT',
        'auth = "' + p('eyJ', 'hbGciOiJIUzI1NiJ9') + '.' + p('eyJ', 'zdWIiOiIxMjM0NTY3ODkwIn0') + '.dQw4w9WgXcQdQw4w9WgXcQ"',
        'jwt'
    ],
    ['private key block', '-----BEGIN RSA PRIVATE KEY-----', 'private-key-block'],
    [
        'connection string',
        'DATABASE_URL=postgres://admin:xK9mQ2wLp5R8@db.example.com:5432/prod',
        'connection-string-credentials'
    ],
    [
        'generic assignment',
        'const apiKey = "q7Xz9Kf2mW8vL4nR3bT6yJ1c";',
        'generic-credential-assignment'
    ]
];

for (const [name, line, expectedRule] of REAL_LOOKING_SECRETS) {
    test(`detects ${name}`, () => {
        const { findings } = scanDiff(diffAdding([line]));
        assert.equal(findings.length, 1, `expected a finding for: ${line}`);
        assert.equal(findings[0].ruleId, expectedRule);
        assert.equal(findings[0].file, 'src/config.js');
        assert.equal(findings[0].line, 1);
    });
}

// --- false-positive resistance ----------------------------------------------

const BENIGN_LINES = [
    'const apiKey = process.env.API_KEY;',
    'password: "${DB_PASSWORD}"',
    'api_key = "<your-api-key-here>"',
    'secret: "changeme"',
    'const password = "password123";',
    'token = "xxxxxxxxxxxxxxxx"',
    'apiKey: "{{ secrets.API_KEY }}"',
    '// set your password = "example-value" in .env',
    'const url = "https://example.com/path";',
    'if (password === userInput) return;',
    'let apikeyName = "primary";'
];

for (const line of BENIGN_LINES) {
    test(`does not flag benign line: ${line.slice(0, 40)}`, () => {
        const { findings } = scanDiff(diffAdding([line]));
        assert.deepEqual(findings, [], `false positive on: ${line}`);
    });
}

test('does not scan removed or context lines', () => {
    const diff = [
        '+++ b/a.js',
        '@@ -1,2 +1 @@',
        '-const key = "AKIAIOSFODNN7EXAMPLE";',
        ' // context: AKIAIOSFODNN7EXAMPLE',
        '+const key = process.env.AWS_KEY;'
    ].join('\n');
    assert.deepEqual(scanDiff(diff).findings, []);
});

// --- entropy helpers ---------------------------------------------------------

test('shannonEntropy behaves sanely', () => {
    assert.equal(shannonEntropy(''), 0);
    assert.equal(shannonEntropy('aaaa'), 0);
    assert.ok(shannonEntropy('q7Xz9Kf2mW8vL4nR') > 3.5);
    assert.ok(shannonEntropy('aaaabbbb') < 1.5);
});

test('looksLikeRealSecret filters placeholders and prose', () => {
    assert.equal(looksLikeRealSecret('q7Xz9Kf2mW8vL4nR3bT6'), true);
    assert.equal(looksLikeRealSecret('${SECRET}'), false);
    assert.equal(looksLikeRealSecret('<insert-key>'), false);
    assert.equal(looksLikeRealSecret('changeme-now'), false);
    assert.equal(looksLikeRealSecret('aaaaaaaaaa'), false);
    assert.equal(looksLikeRealSecret('short'), false);
});

// --- redaction ----------------------------------------------------------------

test('redact never returns the full secret', () => {
    const secret = 'AKIAIOSFODNN7EXAMPLE';
    const preview = redact(secret);
    assert.notEqual(preview, secret);
    assert.ok(!preview.includes('EXAMPLE'));
    assert.ok(preview.includes('*'));
});

// --- pragma and ignore patterns ------------------------------------------------

test('autogit:allow-secret pragma exempts the line', () => {
    const line = 'const key = "AKIAIOSFODNN7EXAMPLE"; // autogit:allow-secret (docs example)';
    assert.deepEqual(scanDiff(diffAdding([line])).findings, []);
});

test('ignore patterns suppress findings by matched text', () => {
    const diff = diffAdding(['const key = "AKIAIOSFODNN7EXAMPLE";']);
    const ignorePatterns = compileIgnorePatterns(['AKIAIOSFODNN7']);
    assert.deepEqual(scanDiff(diff, { ignorePatterns }).findings, []);
});

test('ignore patterns suppress findings by file:line location', () => {
    const diff = diffAdding(['const key = "AKIAIOSFODNN7EXAMPLE";'], 'test/fixtures/keys.js');
    const ignorePatterns = compileIgnorePatterns(['^test/fixtures/']);
    assert.deepEqual(scanDiff(diff, { ignorePatterns }).findings, []);
});

test('compileIgnorePatterns drops invalid regexes with a warning', () => {
    const warnings = [];
    const compiled = compileIgnorePatterns(['[valid]', '(unclosed', '', null], (m) => warnings.push(m));
    assert.equal(compiled.length, 1);
    assert.equal(warnings.length, 1);
});

// --- limits --------------------------------------------------------------------

test('oversized diffs are skipped, not half-scanned', () => {
    const bigDiff = '+++ b/big.bin\n@@ -0,0 +1 @@\n+' + 'x'.repeat(MAX_SCAN_CHARS + 10);
    const result = scanDiff(bigDiff);
    assert.equal(result.skipped, true);
    assert.deepEqual(result.findings, []);
});

test('findings are capped at MAX_FINDINGS with truncated flag', () => {
    const lines = Array.from(
        { length: MAX_FINDINGS + 20 },
        (_, i) => `key${i} = "AKIAIOSFODNN7EXAMPL${(i % 10)}";`
    );
    const result = scanDiff(diffAdding(lines));
    assert.equal(result.findings.length, MAX_FINDINGS);
    assert.equal(result.truncated, true);
});

test('one finding per line even when multiple rules match', () => {
    const line =
        'const both = "AKIAIOSFODNN7EXAMPLE" + "' + p('ghp', '_x7K9mQ2wL5nR8vT3bY6cJ1fH4dS0aZ9pE2uW') + '";';
    const { findings } = scanDiff(diffAdding([line]));
    assert.equal(findings.length, 1);
});

// --- regression tests for v1.3.0 fixes --------------------------------------

const { cleanDiffPath, MAX_IGNORE_PATTERN_LENGTH } = require('../lib/secretScanner');

test('detects unquoted .env / INI / YAML credential assignments', () => {
    assert.equal(scanDiff(diffAdding(['DB_PASSWORD=q7Xz9Kf2mW8vL4nR3bT6'])).findings.length, 1);
    assert.equal(scanDiff(diffAdding(['aws_secret_access_key = wJa1rXUtnFEK7MDENGbPxR2i9Yz'])).findings.length, 1);
    assert.equal(scanDiff(diffAdding(['api_key: Zk93jdQw7RxTPa2vLm5nB8'])).findings.length, 1);
});

test('unquoted rule still ignores env indirection and placeholders', () => {
    assert.deepEqual(scanDiff(diffAdding(['DB_PASSWORD=${DB_PASSWORD}'])).findings, []);
    assert.deepEqual(scanDiff(diffAdding(['API_KEY=process.env.API_KEY'])).findings, []);
    assert.deepEqual(scanDiff(diffAdding(['password=changeme'])).findings, []);
    assert.deepEqual(scanDiff(diffAdding(['DB_HOST=localhost'])).findings, []);
});

test('added content line beginning with "++ " is scanned, not misread as a header', () => {
    // git renders an added line whose content starts with "++ " as "+++ ...".
    const diff = [
        'diff --git a/main.c b/main.c',
        '--- a/main.c',
        '+++ b/main.c',
        '@@ -1,0 +1,2 @@',
        '++ counters[i];',
        '+const k = "AKIAIOSFODNN7EXAMPLE";'
    ].join('\n');
    const { findings } = scanDiff(diff);
    assert.equal(findings.length, 1);
    assert.equal(findings[0].file, 'main.c', 'file must not be corrupted by the ++ line');
    assert.equal(findings[0].line, 2, 'line number must not be shifted by the ++ line');
});

test('cleanDiffPath strips prefixes and quotes', () => {
    assert.equal(cleanDiffPath('b/src/app.js'), 'src/app.js');
    assert.equal(cleanDiffPath('i/src/app.js'), 'src/app.js');
    assert.equal(cleanDiffPath('"b/src/app.js"'), 'src/app.js');
    assert.equal(cleanDiffPath('/dev/null'), '/dev/null');
});

test('mnemonic-prefix diffs (i/ w/) still report the correct path', () => {
    const diff = [
        'diff --git a/test/keys.js b/test/keys.js',
        '--- i/test/keys.js',
        '+++ w/test/keys.js',
        '@@ -0,0 +1 @@',
        '+const k = "AKIAIOSFODNN7EXAMPLE";'
    ].join('\n');
    const { findings } = scanDiff(diff);
    assert.equal(findings.length, 1);
    assert.equal(findings[0].file, 'test/keys.js');
});

test('nested-quantifier ignore patterns are rejected (ReDoS guard)', () => {
    const warnings = [];
    const compiled = compileIgnorePatterns(['(([A-Za-z0-9_-])+)+$', '(a+)+'], (m) => warnings.push(m));
    assert.equal(compiled.length, 0);
    assert.equal(warnings.length, 2);
});

test('over-long ignore patterns are rejected', () => {
    const warnings = [];
    const compiled = compileIgnorePatterns(['a'.repeat(MAX_IGNORE_PATTERN_LENGTH + 1)], (m) => warnings.push(m));
    assert.equal(compiled.length, 0);
    assert.equal(warnings.length, 1);
});

test('scanDiff reports suppressedCount and calls onSuppressed', () => {
    const diff = diffAdding(['const k = "AKIAIOSFODNN7EXAMPLE";']);
    const ignorePatterns = compileIgnorePatterns(['AKIAIOSFODNN7']);
    const suppressed = [];
    const result = scanDiff(diff, { ignorePatterns, onSuppressed: (f) => suppressed.push(f) });
    assert.deepEqual(result.findings, []);
    assert.equal(result.suppressedCount, 1);
    assert.equal(suppressed.length, 1);
});
