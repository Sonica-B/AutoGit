/**
 * Glob-style exclude pattern matching.
 *
 * Semantics follow gitignore conventions closely enough for exclude lists:
 * - `*`  matches within a single path segment
 * - `**` matches across path segments
 * - `?`  matches a single non-separator character
 * - Patterns containing `/` are anchored to the workspace root
 * - Patterns without `/` match a path segment at any depth
 * - Windows separators are normalized before matching
 */

/**
 * Convert a single glob pattern to a regex source string (unanchored).
 * @param {string} pattern
 * @returns {string}
 */
function globToRegExpSource(pattern) {
    // Normalize separators and strip trailing slashes (directory patterns).
    const p = pattern.replace(/\\/g, '/').replace(/\/+$/, '');

    // `dir/**` should exclude the directory itself as well as its contents.
    if (p.endsWith('/**')) {
        return globToRegExpSource(p.slice(0, -3)) + '(?:/.*)?';
    }

    let out = '';
    let i = 0;
    while (i < p.length) {
        const c = p[i];
        if (c === '*') {
            if (p[i + 1] === '*') {
                if (p[i + 2] === '/') {
                    // `**/` — zero or more whole segments
                    out += '(?:[^/]+/)*';
                    i += 3;
                } else {
                    out += '.*';
                    i += 2;
                }
            } else {
                out += '[^/]*';
                i += 1;
            }
        } else if (c === '?') {
            out += '[^/]';
            i += 1;
        } else {
            out += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
            i += 1;
        }
    }
    return out;
}

/**
 * Compile an exclude pattern into a RegExp that tests a normalized
 * relative path. Returns null for patterns that fail to compile.
 * @param {string} pattern
 * @returns {RegExp | null}
 */
function compilePattern(pattern) {
    if (typeof pattern !== 'string' || pattern.trim() === '') {
        return null;
    }
    try {
        const body = globToRegExpSource(pattern.trim());
        // Patterns with a separator are anchored to the root; bare patterns
        // (e.g. `*.log`, `.DS_Store`) match a segment at any depth.
        return pattern.includes('/')
            ? new RegExp(`^(?:${body})(?:/|$)`)
            : new RegExp(`(?:^|/)(?:${body})(?:/|$)`);
    } catch {
        return null;
    }
}

/**
 * Pre-compile a list of patterns, dropping invalid ones.
 * @param {string[]} patterns
 * @param {(msg: string) => void} [warn]
 * @returns {RegExp[]}
 */
function compilePatterns(patterns, warn) {
    const compiled = [];
    for (const pattern of Array.isArray(patterns) ? patterns : []) {
        const regex = compilePattern(pattern);
        if (regex) {
            compiled.push(regex);
        } else if (warn) {
            warn(`Invalid exclude pattern ignored: ${String(pattern)}`);
        }
    }
    return compiled;
}

/**
 * Test whether a workspace-relative path matches any compiled pattern.
 * @param {string} relativePath
 * @param {RegExp[]} compiledPatterns
 * @returns {boolean}
 */
function isExcluded(relativePath, compiledPatterns) {
    if (!relativePath) {
        return false;
    }
    const normalized = relativePath.replace(/\\/g, '/').replace(/^\/+/, '');
    return compiledPatterns.some((regex) => regex.test(normalized));
}

module.exports = {
    globToRegExpSource,
    compilePattern,
    compilePatterns,
    isExcluded
};
