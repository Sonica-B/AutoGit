/**
 * Secret scanning over staged diffs.
 *
 * Auto-commit + auto-push removes the human review step between "saved a
 * file" and "pushed to a remote", so this module acts as the safety gate:
 * it scans the lines being ADDED by the pending commit for credential
 * patterns and blocks the pipeline when it finds one.
 *
 * Pure functions — no VS Code or child_process dependencies.
 */

/** Skip scanning diffs larger than this many characters (log a warning). */
const MAX_SCAN_CHARS = 2 * 1024 * 1024;
/** Cap reported findings so one pasted .env file doesn't flood the UI. */
const MAX_FINDINGS = 50;
/** Inline pragma that exempts a single line from scanning. */
const ALLOW_PRAGMA = 'autogit:allow-secret';

/**
 * Detection rules. `regex` must have the global flag OFF (applied per line).
 * Rules with `entropyCheck` capture the candidate value in group 1 and only
 * report when the value looks random enough to be a real credential.
 * @type {{ id: string, description: string, regex: RegExp, entropyCheck?: boolean }[]}
 */
const RULES = [
    {
        id: 'private-key-block',
        description: 'Private key material',
        regex: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP |ENCRYPTED )?PRIVATE KEY(?: BLOCK)?-----/
    },
    {
        id: 'aws-access-key-id',
        description: 'AWS access key ID',
        regex: /\b(?:A3T[A-Z0-9]|AKIA|AGPA|AIDA|AROA|AIPA|ANPA|ANVA|ASIA)[A-Z0-9]{16}\b/
    },
    {
        id: 'github-token',
        description: 'GitHub token',
        regex: /\b(?:gh[pousr]_[A-Za-z0-9]{36,255}|github_pat_[A-Za-z0-9]{22}_[A-Za-z0-9]{59})\b/
    },
    {
        id: 'gitlab-pat',
        description: 'GitLab personal access token',
        regex: /\bglpat-[A-Za-z0-9_-]{20,}\b/
    },
    {
        id: 'anthropic-api-key',
        description: 'Anthropic API key',
        regex: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/
    },
    {
        id: 'openai-api-key',
        description: 'OpenAI API key',
        regex: /\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{32,}\b/
    },
    {
        id: 'google-api-key',
        description: 'Google API key',
        regex: /\bAIza[0-9A-Za-z_-]{35}\b/
    },
    {
        id: 'slack-token',
        description: 'Slack token',
        regex: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/
    },
    {
        id: 'stripe-live-key',
        description: 'Stripe live key',
        regex: /\b[srp]k_live_[A-Za-z0-9]{20,}\b/
    },
    {
        id: 'npm-token',
        description: 'npm access token',
        regex: /\bnpm_[A-Za-z0-9]{36}\b/
    },
    {
        id: 'sendgrid-api-key',
        description: 'SendGrid API key',
        regex: /\bSG\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}\b/
    },
    {
        id: 'jwt',
        description: 'JSON Web Token',
        regex: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/
    },
    {
        id: 'connection-string-credentials',
        description: 'Connection string with embedded password',
        regex: /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|amqps?|ftp):\/\/[^\s:@/]+:([^\s@/]{4,})@/i,
        entropyCheck: true
    },
    {
        id: 'generic-credential-assignment',
        description: 'Hardcoded credential assignment',
        regex: /(?:password|passwd|pwd|secret|api[_-]?key|apikey|auth[_-]?token|access[_-]?token|access[_-]?key|client[_-]?secret|private[_-]?key|secret[_-]?key)["']?\s*[:=]\s*["']([^"']{8,})["']/i,
        entropyCheck: true
    },
    {
        // Unquoted assignments — the standard format of .env files, INI
        // credential files, and YAML. The value runs to end of line.
        id: 'generic-credential-unquoted',
        description: 'Hardcoded credential assignment',
        regex: /(?:password|passwd|pwd|secret|api[_-]?key|apikey|auth[_-]?token|access[_-]?token|access[_-]?key|client[_-]?secret|private[_-]?key|secret[_-]?key)\s*[:=]\s*([^\s"'`,;#]{8,})\s*$/i,
        entropyCheck: true
    }
];

/**
 * Values that look like placeholders/templating rather than real secrets.
 * Applied to entropy-checked captures only.
 */
const PLACEHOLDER_RE = new RegExp(
    [
        '^\\$\\{', // ${VAR}
        '^\\$[A-Z_]', // $VAR
        '^%[A-Za-z_]+%$', // %VAR%
        '^<[^>]*>$', // <your-key-here>
        '^\\{\\{', // {{ template }}
        'process\\.env',
        'os\\.environ',
        '^(?:your|my|the|a|an)[-_]',
        '^(?:x{4,}|\\*{4,}|\\.{4,})',
        '^(?:example|changeme|change-me|placeholder|dummy|sample|test|fake|todo|redacted|password|secret|123456)',
        '^(?:0123456789|abcdefgh)'
    ].join('|'),
    'i'
);

/**
 * Shannon entropy of a string in bits per character.
 * @param {string} value
 * @returns {number}
 */
function shannonEntropy(value) {
    if (!value) return 0;
    /** @type {Map<string, number>} */
    const counts = new Map();
    for (const ch of value) {
        counts.set(ch, (counts.get(ch) || 0) + 1);
    }
    let entropy = 0;
    for (const count of counts.values()) {
        const p = count / value.length;
        entropy -= p * Math.log2(p);
    }
    return entropy;
}

/**
 * Decide whether an entropy-checked capture looks like a real credential.
 * @param {string} value
 * @returns {boolean}
 */
function looksLikeRealSecret(value) {
    if (!value || value.length < 8) return false;
    if (PLACEHOLDER_RE.test(value)) return false;
    // All one character ("aaaaaaaa") or trivially repetitive.
    if (/^(.)\1+$/.test(value)) return false;
    // Random credentials have high per-character entropy; prose and
    // identifiers ("my database password") sit well below 3 bits/char
    // at these lengths.
    return shannonEntropy(value) >= 3.0;
}

/**
 * Redact a matched secret for display: keep a short prefix, mask the rest.
 * @param {string} match
 * @returns {string}
 */
function redact(match) {
    const visible = Math.min(6, Math.floor(match.length / 4));
    return `${match.slice(0, visible)}${'*'.repeat(Math.min(12, match.length - visible))}`;
}

/**
 * Strip a git diff prefix (`b/`, `a/`, or any single-letter `x/`) and any
 * surrounding quotes from a diff header target path.
 * @param {string} target
 * @returns {string}
 */
function cleanDiffPath(target) {
    let path = target.trim();
    if (path.startsWith('"') && path.endsWith('"') && path.length >= 2) {
        path = path.slice(1, -1);
    }
    // Prefixes are pinned to a/ b/ by the caller, but tolerate i/ w/ c/ o/ etc.
    const prefixMatch = path.match(/^[a-z]\/(.*)$/);
    if (prefixMatch) {
        path = prefixMatch[1];
    }
    return path;
}

/**
 * Parse a unified diff (`git diff --cached`) into added lines per file.
 *
 * A file header (`+++ b/path`) is recognized only in header context —
 * immediately after a `--- ` line and outside any hunk — so a legitimate
 * added content line whose text begins with `++ ` (which appears in the diff
 * as `+++ ...`) is scanned as content, not misread as a header.
 *
 * @param {string} diffText
 * @returns {{ file: string, line: number, text: string }[]}
 */
function parseAddedLines(diffText) {
    /** @type {{ file: string, line: number, text: string }[]} */
    const added = [];
    let currentFile = '';
    let newLineNo = 0;
    let inHunk = false;
    let sawMinusHeader = false;

    for (const rawLine of String(diffText || '').split('\n')) {
        const line = rawLine.replace(/\r$/, '');

        if (line.startsWith('diff --git ')) {
            inHunk = false;
            sawMinusHeader = false;
            continue;
        }

        if (!inHunk && line.startsWith('--- ')) {
            sawMinusHeader = true;
            continue;
        }

        if (!inHunk && sawMinusHeader && line.startsWith('+++ ')) {
            const target = line.substring(4);
            currentFile = cleanDiffPath(target);
            sawMinusHeader = false;
            continue;
        }

        const hunk = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
        if (hunk) {
            newLineNo = parseInt(hunk[1], 10);
            inHunk = true;
            sawMinusHeader = false;
            continue;
        }

        if (!inHunk) {
            // Still in the header block (index/mode/similarity lines): ignore.
            continue;
        }

        if (line.startsWith('+')) {
            added.push({ file: currentFile, line: newLineNo, text: line.substring(1) });
            newLineNo++;
        } else if (line.startsWith('-')) {
            // Removed line: does not exist in the new file, do not advance.
        } else if (line.startsWith('\\')) {
            // "\ No newline at end of file": not a real line.
        } else {
            // Context line.
            if (newLineNo > 0) newLineNo++;
        }
    }
    return added;
}

/**
 * @typedef {object} SecretFinding
 * @property {string} file path within the repository
 * @property {number} line 1-based line number in the new file version
 * @property {string} ruleId
 * @property {string} description
 * @property {string} preview redacted matched text — never the full secret
 */

/**
 * Scan a staged unified diff for secrets.
 *
 * @param {string} diffText output of `git diff --cached`
 * @param {object} [options]
 * @param {RegExp[]} [options.ignorePatterns] findings whose matched text or
 *        `file:line` location matches any pattern are suppressed
 * @param {(finding: SecretFinding) => void} [options.onSuppressed] called for
 *        each finding suppressed by an ignore pattern (for visibility)
 * @returns {{ findings: SecretFinding[], truncated: boolean, skipped: boolean, suppressedCount: number }}
 */
function scanDiff(diffText, options = {}) {
    const ignorePatterns = options.ignorePatterns || [];
    const text = String(diffText || '');

    if (text.length > MAX_SCAN_CHARS) {
        // Refuse to half-scan: the caller decides how to treat oversized diffs.
        return { findings: [], truncated: false, skipped: true, suppressedCount: 0 };
    }

    /** @type {SecretFinding[]} */
    const findings = [];
    let truncated = false;
    let suppressedCount = 0;

    for (const { file, line, text: lineText } of parseAddedLines(text)) {
        if (lineText.includes(ALLOW_PRAGMA)) continue;

        for (const rule of RULES) {
            const match = rule.regex.exec(lineText);
            if (!match) continue;

            if (rule.entropyCheck) {
                // Use the first defined capture group (rules may have several
                // alternatives), falling back to the whole match.
                const candidate = match.slice(1).find((g) => g !== undefined) ?? match[0];
                if (!looksLikeRealSecret(candidate)) continue;
            }

            const matchedText = match[0];
            const location = `${file}:${line}`;
            const finding = {
                file,
                line,
                ruleId: rule.id,
                description: rule.description,
                preview: redact(matchedText)
            };

            // Bound the input length when testing user-supplied ignore regexes
            // to blunt catastrophic-backtracking pathological patterns.
            const probeText = matchedText.slice(0, 256);
            const isIgnored = ignorePatterns.some(
                (re) => re.test(probeText) || re.test(location)
            );
            if (isIgnored) {
                suppressedCount++;
                if (options.onSuppressed) options.onSuppressed(finding);
                continue;
            }

            findings.push(finding);

            if (findings.length >= MAX_FINDINGS) {
                truncated = true;
                return { findings, truncated, skipped: false, suppressedCount };
            }
            break; // one finding per line is enough to block
        }
    }

    return { findings, truncated, skipped: false, suppressedCount };
}

/** Max length of a user-supplied ignore pattern (defense against huge inputs). */
const MAX_IGNORE_PATTERN_LENGTH = 200;
/**
 * Detects a nested quantifier inside a group followed by another quantifier —
 * the classic catastrophic-backtracking shape, e.g. `(a+)+`, `([A-Za-z]+)*`.
 */
const NESTED_QUANTIFIER_RE = /[+*][^()]*\)[+*?{]/;

/**
 * Compile user-supplied ignore pattern strings, dropping invalid or unsafe
 * ones. Patterns that are too long or contain an obvious nested-quantifier
 * ReDoS construct are rejected with a warning rather than compiled.
 * @param {string[]} patterns
 * @param {(msg: string) => void} [warn]
 * @returns {RegExp[]}
 */
function compileIgnorePatterns(patterns, warn) {
    /** @type {RegExp[]} */
    const compiled = [];
    for (const pattern of Array.isArray(patterns) ? patterns : []) {
        if (typeof pattern !== 'string' || pattern.trim() === '') continue;
        if (pattern.length > MAX_IGNORE_PATTERN_LENGTH) {
            if (warn) warn(`Secret-scan ignore pattern too long, ignored: ${pattern.slice(0, 40)}...`);
            continue;
        }
        if (NESTED_QUANTIFIER_RE.test(pattern)) {
            if (warn) warn(`Secret-scan ignore pattern rejected (possible ReDoS): ${pattern}`);
            continue;
        }
        try {
            compiled.push(new RegExp(pattern));
        } catch {
            if (warn) warn(`Invalid secret-scan ignore pattern: ${pattern}`);
        }
    }
    return compiled;
}

module.exports = {
    scanDiff,
    parseAddedLines,
    cleanDiffPath,
    shannonEntropy,
    looksLikeRealSecret,
    redact,
    compileIgnorePatterns,
    RULES,
    ALLOW_PRAGMA,
    MAX_SCAN_CHARS,
    MAX_FINDINGS,
    MAX_IGNORE_PATTERN_LENGTH
};
