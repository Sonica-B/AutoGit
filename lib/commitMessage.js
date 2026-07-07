/**
 * Commit message helpers: git status parsing, AI prompt construction,
 * AI response sanitization, and deterministic fallback messages.
 * Pure functions — no VS Code or child_process dependencies.
 */

/**
 * Decode a git porcelain path. When `core.quotepath` is on (the default),
 * git wraps paths containing non-ASCII or control characters in double quotes
 * and C-style-escapes them (`\t`, `\"`, `\\`, and octal `\NNN` UTF-8 bytes).
 * This reverses that encoding; unquoted paths are returned unchanged.
 * @param {string} raw
 * @returns {string}
 */
function decodePorcelainPath(raw) {
    if (!(raw.startsWith('"') && raw.endsWith('"') && raw.length >= 2)) {
        return raw;
    }
    const inner = raw.slice(1, -1);
    /** @type {number[]} */
    const bytes = [];
    for (let i = 0; i < inner.length; i++) {
        const ch = inner[i];
        if (ch !== '\\') {
            // Push the UTF-8 bytes of this (already-decoded) character.
            for (const b of Buffer.from(ch, 'utf8')) bytes.push(b);
            continue;
        }
        const next = inner[i + 1];
        if (next === undefined) break;
        if (next >= '0' && next <= '7') {
            // Octal escape: exactly up to three octal digits = one byte.
            let oct = '';
            let j = i + 1;
            while (j < inner.length && oct.length < 3 && inner[j] >= '0' && inner[j] <= '7') {
                oct += inner[j];
                j++;
            }
            bytes.push(parseInt(oct, 8) & 0xff);
            i = j - 1;
        } else {
            const simple = { a: 7, b: 8, t: 9, n: 10, v: 11, f: 12, r: 13, '"': 34, '\\': 92 };
            const code = Object.prototype.hasOwnProperty.call(simple, next)
                ? simple[/** @type {keyof typeof simple} */ (next)]
                : next.charCodeAt(0);
            bytes.push(code);
            i += 1;
        }
    }
    return Buffer.from(bytes).toString('utf8');
}

/**
 * Parse `git status --porcelain` output into structured entries.
 * Handles rename/copy lines of the form `R  old -> new`.
 * @param {string} statusOutput
 * @returns {{ path: string, code: string, status: string }[]}
 */
function parseGitStatus(statusOutput) {
    const lines = String(statusOutput || '')
        .split('\n')
        .map((line) => line.replace(/\r$/, ''))
        .filter((line) => line.trim().length > 0);

    return lines.map((line) => {
        const code = line.substring(0, 2);
        let filePath = line.substring(3);
        // Only rename/copy entries use the `orig -> dest` form. Splitting on
        // ' -> ' unconditionally would corrupt ordinary filenames containing
        // that substring.
        if (code.includes('R') || code.includes('C')) {
            const arrowIndex = filePath.indexOf(' -> ');
            if (arrowIndex !== -1) {
                filePath = filePath.substring(arrowIndex + 4);
            }
        }
        return { path: decodePorcelainPath(filePath), code, status: describeStatusCode(code) };
    });
}

/**
 * Parse NUL-delimited `git status --porcelain=v1 -z` output into entries.
 * The `-z` format needs no unquoting and encodes renames/copies as two
 * consecutive records (`XY dest\0orig`), so it is the robust source for
 * deciding which paths to stage.
 * @param {string} zOutput
 * @returns {{ path: string, origPath?: string, code: string, status: string }[]}
 */
function parseStatusZ(zOutput) {
    const tokens = String(zOutput || '').split('\0');
    const entries = [];
    for (let i = 0; i < tokens.length; i++) {
        const token = tokens[i];
        if (!token || token.length < 3) continue;
        const code = token.substring(0, 2);
        const dest = token.substring(3);
        let origPath;
        if (code.includes('R') || code.includes('C')) {
            // The origin path is the next NUL-separated record.
            origPath = tokens[i + 1];
            i++;
        }
        entries.push({
            path: dest,
            ...(origPath ? { origPath } : {}),
            code,
            status: describeStatusCode(code)
        });
    }
    return entries;
}

/**
 * Human-readable label for a porcelain XY status code.
 * @param {string} code
 * @returns {string}
 */
function describeStatusCode(code) {
    if (code === '??') return 'Untracked';
    if (code.includes('A')) return 'Added';
    if (code.includes('R')) return 'Renamed';
    if (code.includes('C')) return 'Copied';
    if (code.includes('D')) return 'Deleted';
    if (code.includes('M')) return 'Modified';
    return 'Changed';
}

/**
 * Aggregate parsed entries into per-kind counts.
 * @param {{ code: string }[]} entries
 * @returns {{ added: number, modified: number, deleted: number, renamed: number }}
 */
function summarizeChanges(entries) {
    const summary = { added: 0, modified: 0, deleted: 0, renamed: 0 };
    for (const entry of entries) {
        const code = entry.code;
        if (code === '??' || code.includes('A')) summary.added++;
        else if (code.includes('R') || code.includes('C')) summary.renamed++;
        else if (code.includes('D')) summary.deleted++;
        else if (code.includes('M')) summary.modified++;
        else summary.modified++;
    }
    return summary;
}

/**
 * Deterministic commit message from parsed status entries.
 * @param {{ path: string, status: string, code: string }[]} entries
 * @returns {string}
 */
function generateFallbackFromEntries(entries) {
    if (!entries || entries.length === 0) {
        return 'chore: update files';
    }

    // Single-file changes can be described precisely.
    if (entries.length === 1) {
        const entry = entries[0];
        const verb = {
            Added: 'add',
            Untracked: 'add',
            Deleted: 'remove',
            Renamed: 'rename',
            Copied: 'copy'
        }[entry.status] || 'update';
        return `chore: ${verb} ${entry.path}`;
    }

    const summary = summarizeChanges(entries);
    const parts = [];
    if (summary.added > 0) parts.push(`add ${summary.added}`);
    if (summary.modified > 0) parts.push(`update ${summary.modified}`);
    if (summary.deleted > 0) parts.push(`remove ${summary.deleted}`);
    if (summary.renamed > 0) parts.push(`rename ${summary.renamed}`);

    return `chore: ${parts.join(', ')} files`;
}

/**
 * Deterministic commit message used when no AI model is available.
 * @param {string} statusOutput raw `git status --porcelain` output
 * @returns {string}
 */
function generateFallbackCommitMessage(statusOutput) {
    return generateFallbackFromEntries(parseGitStatus(statusOutput));
}

/** Maximum number of changed files listed in the AI prompt. */
const MAX_PROMPT_FILES = 40;
/** Maximum characters of diff stat included in the AI prompt. */
const MAX_DIFF_CHARS = 4000;

/**
 * Build the language-model prompt for commit message generation.
 * @param {{ path: string, status: string }[]} entries parsed status entries
 * @param {string} [diffStat] optional `git diff --cached --stat` output
 * @returns {string}
 */
function buildCommitPrompt(entries, diffStat) {
    const shown = entries.slice(0, MAX_PROMPT_FILES);
    const omitted = entries.length - shown.length;

    let fileList = shown.map((f) => `${f.status}: ${f.path}`).join('\n');
    if (omitted > 0) {
        fileList += `\n(and ${omitted} more files)`;
    }

    let diffSection = '';
    if (diffStat && diffStat.trim()) {
        let stat = diffStat.trim();
        if (stat.length > MAX_DIFF_CHARS) {
            stat = stat.slice(0, MAX_DIFF_CHARS) + '\n(truncated)';
        }
        diffSection = `\nDiff summary:\n${stat}\n`;
    }

    return `Generate a concise git commit message for the following changes:

Changed files:
${fileList}
${diffSection}
Guidelines:
- Be concise and descriptive (under 72 characters)
- Follow conventional commit format (feat:, fix:, docs:, refactor:, chore:, test:, style:)
- Describe WHAT was changed, not HOW
- Use present tense imperative mood ("add" not "added")

Respond with ONLY the commit message on a single line — no quotes, no explanation.`;
}

/**
 * Clean up a raw language-model response into a usable one-line message.
 * Returns an empty string if nothing usable remains.
 * @param {string} raw
 * @param {number} [maxLength]
 * @returns {string}
 */
function sanitizeAiMessage(raw, maxLength = 72) {
    if (typeof raw !== 'string') {
        return '';
    }

    let message = raw.trim();

    // Strip markdown code fences.
    message = message.replace(/^```[a-z]*\s*/i, '').replace(/```\s*$/, '').trim();

    // Take the first non-empty line.
    const firstLine = message.split('\n').find((line) => line.trim().length > 0);
    message = (firstLine || '').trim();

    // Strip common prefixes models add despite instructions.
    message = message.replace(/^(commit message|message)\s*[:-]\s*/i, '');

    // Strip wrapping quotes/backticks.
    while (
        message.length >= 2 &&
        ((message.startsWith('"') && message.endsWith('"')) ||
            (message.startsWith("'") && message.endsWith("'")) ||
            (message.startsWith('`') && message.endsWith('`')))
    ) {
        message = message.slice(1, -1).trim();
    }

    // Remove any stray quotes/backticks that could complicate display.
    message = message.replace(/[`"]/g, '').trim();

    return truncateMessage(message, maxLength);
}

/**
 * Truncate a message to at most `maxLength` UTF-16 code units, appending
 * an ellipsis. Whole code points are kept, so a multi-unit character (emoji,
 * astral glyph) is never split into a lone surrogate — which would otherwise
 * become U+FFFD when git encodes the message as UTF-8.
 * @param {string} message
 * @param {number} maxLength
 * @returns {string}
 */
function truncateMessage(message, maxLength) {
    if (message.length <= maxLength) {
        return message;
    }
    const budget = Math.max(1, maxLength - 3);
    let out = '';
    for (const ch of message) {
        if (out.length + ch.length > budget) break;
        out += ch;
    }
    return out.trimEnd() + '...';
}

module.exports = {
    decodePorcelainPath,
    parseGitStatus,
    parseStatusZ,
    describeStatusCode,
    summarizeChanges,
    generateFallbackFromEntries,
    generateFallbackCommitMessage,
    buildCommitPrompt,
    sanitizeAiMessage,
    MAX_PROMPT_FILES,
    MAX_DIFF_CHARS
};
