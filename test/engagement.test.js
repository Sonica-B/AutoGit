const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
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
} = require('../lib/engagement');

test('initial state never prompts before the first threshold', () => {
    const state = initialRatingState();
    assert.equal(shouldPromptForRating(state), false);
    state.commitCount = DEFAULT_FIRST_PROMPT_AT - 1;
    assert.equal(shouldPromptForRating(state), false);
});

test('first prompt fires exactly at the threshold', () => {
    const state = { ...initialRatingState(), commitCount: DEFAULT_FIRST_PROMPT_AT };
    assert.equal(shouldPromptForRating(state), true);
});

test('rated or dismissed states are never prompted again', () => {
    const big = DEFAULT_FIRST_PROMPT_AT + DEFAULT_REPROMPT_INTERVAL * 5;
    assert.equal(shouldPromptForRating({ ...initialRatingState(), commitCount: big, rated: true }), false);
    assert.equal(
        shouldPromptForRating({ ...initialRatingState(), commitCount: big, dismissed: true }),
        false
    );
});

test('"Later" defers by the reprompt interval', () => {
    let state = { ...initialRatingState(), commitCount: DEFAULT_FIRST_PROMPT_AT };
    assert.equal(shouldPromptForRating(state), true);

    state = applyRatingOutcome(state, 'later');
    assert.equal(state.promptCount, 1);
    assert.equal(state.lastPromptAt, DEFAULT_FIRST_PROMPT_AT);

    // Just short of the interval: no prompt.
    state.commitCount = DEFAULT_FIRST_PROMPT_AT + DEFAULT_REPROMPT_INTERVAL - 1;
    assert.equal(shouldPromptForRating(state), false);

    // At the interval: prompt again.
    state.commitCount = DEFAULT_FIRST_PROMPT_AT + DEFAULT_REPROMPT_INTERVAL;
    assert.equal(shouldPromptForRating(state), true);
});

test('never prompts more than the max number of times', () => {
    let state = { ...initialRatingState(), commitCount: DEFAULT_FIRST_PROMPT_AT };
    for (let i = 0; i < DEFAULT_MAX_PROMPTS; i++) {
        assert.equal(shouldPromptForRating(state), true, `prompt ${i + 1} should be allowed`);
        state = applyRatingOutcome(state, 'later');
        state.commitCount += DEFAULT_REPROMPT_INTERVAL;
    }
    assert.equal(state.promptCount, DEFAULT_MAX_PROMPTS);
    assert.equal(shouldPromptForRating(state), false);
});

test('applyRatingOutcome records the terminal outcomes', () => {
    const base = { ...initialRatingState(), commitCount: 20 };
    assert.equal(applyRatingOutcome(base, 'rated').rated, true);
    assert.equal(applyRatingOutcome(base, 'dismissed').dismissed, true);
    const later = applyRatingOutcome(base, 'later');
    assert.equal(later.rated, false);
    assert.equal(later.dismissed, false);
});

test('normalizeRatingState tolerates missing and corrupt data', () => {
    assert.deepEqual(normalizeRatingState(undefined), initialRatingState());
    assert.deepEqual(normalizeRatingState(null), initialRatingState());
    assert.deepEqual(normalizeRatingState('garbage'), initialRatingState());
    assert.deepEqual(normalizeRatingState({ commitCount: 'x', rated: 1 }), initialRatingState());
    assert.deepEqual(normalizeRatingState({ commitCount: 5, rated: true, promptCount: 2, lastPromptAt: 5 }), {
        commitCount: 5,
        rated: true,
        dismissed: false,
        promptCount: 2,
        lastPromptAt: 5
    });
});

test('parseVersion handles partial and suffixed versions', () => {
    assert.deepEqual(parseVersion('1.4.0'), [1, 4, 0]);
    assert.deepEqual(parseVersion('2.0'), [2, 0, 0]);
    assert.deepEqual(parseVersion('1.4.0-beta.1'), [1, 4, 0]);
    assert.deepEqual(parseVersion(''), [0, 0, 0]);
});

test('compareVersions orders correctly across components', () => {
    assert.equal(compareVersions('1.4.0', '1.3.9'), 1);
    assert.equal(compareVersions('1.3.0', '1.3.1'), -1);
    assert.equal(compareVersions('2.0.0', '1.9.9'), 1);
    assert.equal(compareVersions('1.4.0', '1.4.0'), 0);
});

test('what\'s new shows only on a genuine upgrade', () => {
    // Fresh install (no previous version) must stay silent.
    assert.equal(shouldShowWhatsNew(undefined, '1.4.0'), false);
    assert.equal(shouldShowWhatsNew('', '1.4.0'), false);
    // Upgrade shows.
    assert.equal(shouldShowWhatsNew('1.3.0', '1.4.0'), true);
    // Same version or downgrade/reinstall stays silent.
    assert.equal(shouldShowWhatsNew('1.4.0', '1.4.0'), false);
    assert.equal(shouldShowWhatsNew('1.5.0', '1.4.0'), false);
});
