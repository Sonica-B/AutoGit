/**
 * Glob-style exclude pattern matching.
 *
 * Semantics follow gitignore conventions closely enough for exclude lists:
 * - `*`  matches within a single path segment
 * - `**` matches across path segments
 * - `?`  matches a single non-separator character
 * - A pattern with an interior `/` (e.g. `dist/**`, `a/b`) is anchored to the
 *   workspace root. A leading `/` also anchors (and is otherwise ignored).
 * - A pattern with no interior `/` — including a bare directory name written
 *   `build/` — matches a path segment at any depth.
 * - A trailing `/` marks a directory pattern; it does not by itself anchor.
 * - Windows separators are normalized before matching.
 */

/**
 * Normalize a raw pattern: convert backslashes, strip a leading `/` (an
 * anchoring signal handled separately) and any trailing slash. Consecutive
 * globstar-slash runs are collapsed so a pathological pattern cannot expand
 * into a stack of ambiguous quantifiers (exponential backtracking / ReDoS).
 * @param {string} pattern
 * @returns {{ normalized: string, anchored: boolean }}
 */
function normalizePattern(pattern) {
    const hadLeadingSlash = /^[\\/]/.test(pattern);
    let normalized = pattern
        .replace(/\\/g, '/')
        .replace(/^\/+/, '')
        .replace(/\/+$/, '');
    // Collapse consecutive globstar-slash runs and long star runs — they are
    // semantically equivalent but compile to stacked quantifiers otherwise.
    normalized = normalized.replace(/(?:\*\*\/)+/g, '**/').replace(/\*\*(?:\*)+/g, '**');
    // A pattern is anchored to the root if it had a leading slash or contains
    // an interior separator. A trailing-slash-only pattern is NOT anchored.
    const anchored = hadLeadingSlash || normalized.includes('/');
    return { normalized, anchored };
}

/**
 * Convert an already-normalized glob pattern to a regex source string.
 * @param {string} p normalized pattern (no leading/trailing slash)
 * @returns {string}
 */
function globToRegExpSource(p) {
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
        const { normalized, anchored } = normalizePattern(pattern.trim());
        if (normalized === '') {
            return null;
        }
        const body = globToRegExpSource(normalized);
        // Anchored patterns must match from the root; unanchored patterns may
        // match a segment at any depth.
        return anchored
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
    normalizePattern,
    globToRegExpSource,
    compilePattern,
    compilePatterns,
    isExcluded
};
