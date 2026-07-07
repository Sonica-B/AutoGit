/**
 * Commit message helpers: git status parsing, AI prompt construction,
 * AI response sanitization, and deterministic fallback messages.
 * Pure functions — no VS Code or child_process dependencies.
 */

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
        const arrowIndex = filePath.indexOf(' -> ');
        if (arrowIndex !== -1) {
            filePath = filePath.substring(arrowIndex + 4);
        }
        // Paths with special characters come back quoted.
        if (filePath.startsWith('"') && filePath.endsWith('"')) {
            filePath = filePath.slice(1, -1);
        }
        return { path: filePath, code, status: describeStatusCode(code) };
    });
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
 * Deterministic commit message used when no AI model is available.
 * @param {string} statusOutput raw `git status --porcelain` output
 * @returns {string}
 */
function generateFallbackCommitMessage(statusOutput) {
    const entries = parseGitStatus(statusOutput);
    if (entries.length === 0) {
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

    return `chore: ${parts.join(', ')} file${entries.length === 1 ? '' : 's'}`;
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

    if (message.length > maxLength) {
        message = message.substring(0, Math.max(1, maxLength - 3)).trimEnd() + '...';
    }

    return message;
}

module.exports = {
    parseGitStatus,
    describeStatusCode,
    summarizeChanges,
    generateFallbackCommitMessage,
    buildCommitPrompt,
    sanitizeAiMessage,
    MAX_PROMPT_FILES,
    MAX_DIFF_CHARS
};
