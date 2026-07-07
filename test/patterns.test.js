const { test } = require('node:test');
const assert = require('node:assert/strict');

const { compilePattern, compilePatterns, isExcluded } = require('../lib/patterns');

function excluded(relativePath, patterns) {
    return isExcluded(relativePath, compilePatterns(patterns));
}

test('directory globs match nested contents', () => {
    assert.equal(excluded('node_modules/lodash/index.js', ['node_modules/**']), true);
    assert.equal(excluded('node_modules', ['node_modules/**']), true);
    assert.equal(excluded('src/index.js', ['node_modules/**']), false);
});

test('windows-style separators are normalized', () => {
    assert.equal(excluded('node_modules\\lodash\\index.js', ['node_modules/**']), true);
    assert.equal(excluded('dist\\bundle.js', ['dist/**']), true);
    assert.equal(excluded('src\\app.js', ['dist/**']), false);
});

test('extension globs match at any depth', () => {
    assert.equal(excluded('error.log', ['*.log']), true);
    assert.equal(excluded('logs/deep/error.log', ['*.log']), true);
    assert.equal(excluded('error.log.txt', ['*.log']), false);
});

test('dots in patterns are literal, not regex wildcards', () => {
    // The old implementation treated `.env*` as regex `.env.*`,
    // which wrongly matched e.g. `xenvrc`.
    assert.equal(excluded('xenvrc', ['.env*']), false);
    assert.equal(excluded('.env', ['.env*']), true);
    assert.equal(excluded('.env.local', ['.env*']), true);
});

test('bare names match whole segments only', () => {
    assert.equal(excluded('.DS_Store', ['.DS_Store']), true);
    assert.equal(excluded('images/.DS_Store', ['.DS_Store']), true);
    assert.equal(excluded('my.DS_Store.bak', ['.DS_Store']), false);
});

test('single star does not cross directory boundaries', () => {
    assert.equal(excluded('a/b.tmp', ['a/*.tmp']), true);
    assert.equal(excluded('a/c/b.tmp', ['a/*.tmp']), false);
});

test('double star crosses directory boundaries', () => {
    assert.equal(excluded('a/c/b.tmp', ['a/**/*.tmp']), true);
    assert.equal(excluded('a/b.tmp', ['a/**/*.tmp']), true);
});

test('question mark matches exactly one non-separator character', () => {
    assert.equal(excluded('a1.txt', ['a?.txt']), true);
    assert.equal(excluded('a12.txt', ['a?.txt']), false);
    assert.equal(excluded('a/x.txt', ['a?????']), false);
});

test('trailing slash directory patterns work', () => {
    assert.equal(excluded('.git/config', ['.git/']), true);
    assert.equal(excluded('sub/.git/config', ['.git']), true);
});

test('rooted patterns do not match mid-path', () => {
    assert.equal(excluded('vendor/dist/app.js', ['dist/**']), false);
});

test('invalid and empty patterns are dropped without throwing', () => {
    assert.equal(compilePattern(''), null);
    assert.equal(compilePattern('   '), null);
    // @ts-ignore intentionally wrong type
    assert.equal(compilePattern(null), null);

    const warnings = [];
    const compiled = compilePatterns(['*.log', '', null, 42], (msg) => warnings.push(msg));
    assert.equal(compiled.length, 1);
    assert.equal(warnings.length, 3);
});

test('isExcluded handles empty inputs', () => {
    assert.equal(isExcluded('', compilePatterns(['*.log'])), false);
    assert.equal(isExcluded('file.txt', []), false);
});

// --- regression tests for v1.3.0 fixes --------------------------------------

test('leading-slash (root-anchored) patterns now match', () => {
    assert.equal(excluded('dist/app.js', ['/dist']), true);
    assert.equal(excluded('dist/app.js', ['/dist/**']), true);
    assert.equal(excluded('src/dist/app.js', ['/dist']), false);
    assert.equal(excluded('build/x', ['/build']), true);
});

test('trailing-slash directory patterns match at any depth (not anchored)', () => {
    assert.equal(excluded('build/x.js', ['build/']), true);
    assert.equal(excluded('sub/build/x.js', ['build/']), true);
    assert.equal(excluded('sub/dist/pkg/y.js', ['dist/']), true);
});

test('backslash separators anchor like forward slashes', () => {
    // A separator in the pattern anchors it; must not match mid-path.
    assert.equal(excluded('dir/sub/f.txt', ['dir\\sub']), true);
    assert.equal(excluded('x/dir/sub/f.txt', ['dir\\sub']), false);
});

test('repeated globstar patterns do not cause catastrophic backtracking', () => {
    const pattern = '**/'.repeat(20) + 'zzz';
    const compiled = compilePatterns([pattern]);
    const longPath = Array.from({ length: 25 }, (_, i) => `seg${i}`).join('/') + '/nomatch.js';
    const start = process.hrtime.bigint();
    const result = isExcluded(longPath, compiled);
    const elapsedMs = Number(process.hrtime.bigint() - start) / 1e6;
    assert.equal(result, false);
    assert.ok(elapsedMs < 100, `matching should be fast, took ${elapsedMs}ms`);
});

test('collapsed globstar still matches across directories', () => {
    assert.equal(excluded('a/b/c/d.tmp', ['**/'.repeat(5) + '*.tmp']), true);
});
