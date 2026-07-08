/**
 * Engagement heuristics: decide when to surface a one-time Marketplace rating
 * prompt and a "what's new" notice after an update.
 *
 * Pure functions — no vscode or globalState dependency — so the timing rules
 * are unit-testable and deliberately conservative (a rating prompt that nags
 * costs more goodwill than it earns).
 */

/** Successful commits before the first rating ask. */
const DEFAULT_FIRST_PROMPT_AT = 15;
/** Commits between re-asks after the user clicks "Later". */
const DEFAULT_REPROMPT_INTERVAL = 60;
/** Never prompt more than this many times, ever. */
const DEFAULT_MAX_PROMPTS = 3;

/**
 * @typedef {Object} RatingState
 * @property {number} commitCount   total successful auto-commits observed
 * @property {boolean} rated        user clicked "Rate"
 * @property {boolean} dismissed    user clicked "Don't ask again"
 * @property {number} promptCount   how many times we have prompted
 * @property {number} lastPromptAt  commitCount at the most recent prompt
 */

/** @returns {RatingState} a fresh, never-prompted state */
function initialRatingState() {
    return { commitCount: 0, rated: false, dismissed: false, promptCount: 0, lastPromptAt: 0 };
}

/**
 * Coerce arbitrary persisted data into a valid RatingState, tolerating missing
 * or corrupted globalState.
 * @param {unknown} raw
 * @returns {RatingState}
 */
function normalizeRatingState(raw) {
    const base = initialRatingState();
    if (!raw || typeof raw !== 'object') return base;
    const r = /** @type {Record<string, unknown>} */ (raw);
    return {
        commitCount: Number.isFinite(r.commitCount) ? Number(r.commitCount) : 0,
        rated: r.rated === true,
        dismissed: r.dismissed === true,
        promptCount: Number.isFinite(r.promptCount) ? Number(r.promptCount) : 0,
        lastPromptAt: Number.isFinite(r.lastPromptAt) ? Number(r.lastPromptAt) : 0
    };
}

/**
 * Decide whether to show the rating prompt right now.
 * @param {RatingState} state
 * @param {{ firstPromptAt?: number, repromptInterval?: number, maxPrompts?: number }} [opts]
 * @returns {boolean}
 */
function shouldPromptForRating(state, opts = {}) {
    const firstAt = opts.firstPromptAt ?? DEFAULT_FIRST_PROMPT_AT;
    const interval = opts.repromptInterval ?? DEFAULT_REPROMPT_INTERVAL;
    const maxPrompts = opts.maxPrompts ?? DEFAULT_MAX_PROMPTS;

    if (!state || state.rated || state.dismissed) return false;
    if (state.promptCount >= maxPrompts) return false;
    if (state.commitCount < firstAt) return false;
    if (state.promptCount === 0) return true;
    return state.commitCount - state.lastPromptAt >= interval;
}

/**
 * Fold the result of showing a prompt back into the state.
 * @param {RatingState} state
 * @param {'rated' | 'later' | 'dismissed'} outcome
 * @returns {RatingState}
 */
function applyRatingOutcome(state, outcome) {
    const next = { ...state };
    if (outcome === 'rated') {
        next.rated = true;
    } else if (outcome === 'dismissed') {
        next.dismissed = true;
    }
    next.promptCount += 1;
    next.lastPromptAt = state.commitCount;
    return next;
}

/**
 * Parse a semver-ish "x.y.z" string into numeric parts. Non-numeric or missing
 * parts become 0; pre-release/build suffixes are ignored.
 * @param {string} version
 * @returns {[number, number, number]}
 */
function parseVersion(version) {
    const core = String(version || '').split(/[-+]/)[0];
    const parts = core.split('.').map((p) => parseInt(p, 10));
    return [parts[0] || 0, parts[1] || 0, parts[2] || 0];
}

/**
 * @param {string} a
 * @param {string} b
 * @returns {-1 | 0 | 1} sign of (a - b)
 */
function compareVersions(a, b) {
    const pa = parseVersion(a);
    const pb = parseVersion(b);
    for (let i = 0; i < 3; i++) {
        if (pa[i] > pb[i]) return 1;
        if (pa[i] < pb[i]) return -1;
    }
    return 0;
}

/**
 * Whether to show the "what's new" notice. Suppressed on a fresh install
 * (no previously stored version) and on downgrades/reinstalls of the same
 * version — only a genuine upgrade shows it.
 * @param {string | undefined} previousVersion
 * @param {string} currentVersion
 * @returns {boolean}
 */
function shouldShowWhatsNew(previousVersion, currentVersion) {
    if (!previousVersion) return false;
    return compareVersions(currentVersion, previousVersion) > 0;
}

module.exports = {
    DEFAULT_FIRST_PROMPT_AT,
    DEFAULT_REPROMPT_INTERVAL,
    DEFAULT_MAX_PROMPTS,
    initialRatingState,
    normalizeRatingState,
    shouldPromptForRating,
    applyRatingOutcome,
    parseVersion,
    compareVersions,
    shouldShowWhatsNew
};
