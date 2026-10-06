/**
 * LOCKSTEP twin of bridge/src/speech-limits.test.ts — keep vectors identical.
 * Run: ./bridge/node_modules/.bin/tsx --test messaging/src/speech-limits.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { countSpeech, isEmptySpeech, resolveLimits, exceedsLimits, DEFAULT_MAX_SPEAK_WORDS } from './speech-limits.js';

test('counts words on raw text, excluding bracketed tag tokens', () => {
  assert.deepEqual(countSpeech('done, tests pass'), { words: 3, chars: 16, effectiveText: 'done, tests pass' });
  const c = countSpeech('[sighs] all good [pause] one thing to check');
  assert.equal(c.words, 6);
  assert.equal(c.effectiveText, 'all good one thing to check');
  assert.equal(c.chars, '[sighs] all good [pause] one thing to check'.length);
  assert.equal(countSpeech('  a  \n b\tc ').words, 3);
  assert.equal(countSpeech('').words, 0);
});

test('empty detection: tags only, punctuation only, whitespace', () => {
  assert.equal(isEmptySpeech('[pause] [sighs]'), true);
  assert.equal(isEmptySpeech('... !!! ---'), true);
  assert.equal(isEmptySpeech('   '), true);
  assert.equal(isEmptySpeech(''), true);
  assert.equal(isEmptySpeech('ok.'), false);
  assert.equal(isEmptySpeech('日本語のテスト'), false);
  assert.equal(isEmptySpeech('42'), false);
});

test('CJK text is one word but many chars; a long token is one word', () => {
  const cjk = countSpeech('これはとても長い日本語の文章ですがスペースがありません');
  assert.equal(cjk.words, 1);
  assert.ok(cjk.chars > 20);
  const hash = 'a'.repeat(500);
  assert.equal(countSpeech(hash).words, 1);
  assert.equal(countSpeech(hash).chars, 500);
});

test('resolveLimits clamps, defaults and reports unreadable', () => {
  assert.deepEqual(resolveLimits({}), { maxWords: DEFAULT_MAX_SPEAK_WORDS, maxChars: DEFAULT_MAX_SPEAK_WORDS * 8 });
  assert.deepEqual(resolveLimits(undefined), { maxWords: 60, maxChars: 480 });
  assert.deepEqual(resolveLimits({ maxSpeakWords: 0 }), { maxWords: 1, maxChars: 8 });
  assert.deepEqual(resolveLimits({ maxSpeakWords: 999 }), { maxWords: 200, maxChars: 1600 });
  assert.deepEqual(resolveLimits({ maxSpeakWords: 30.4 }), { maxWords: 30, maxChars: 240 });
  assert.deepEqual(resolveLimits({ maxSpeakWords: 'lots' }), { maxWords: 60, maxChars: 480 });
  assert.deepEqual(resolveLimits({ maxSpeakWords: NaN }), { maxWords: 60, maxChars: 480 });
  assert.equal(resolveLimits(null), null);
});

test('boundary is inclusive; chars guard bites independently', () => {
  const limits = { maxWords: 3, maxChars: 24 };
  assert.equal(exceedsLimits(countSpeech('one two three'), limits), false);
  assert.equal(exceedsLimits(countSpeech('one two three four'), limits), true);
  assert.equal(exceedsLimits(countSpeech('x'.repeat(24)), limits), false);
  assert.equal(exceedsLimits(countSpeech('x'.repeat(25)), limits), true);
  assert.equal(exceedsLimits(countSpeech('[tag] [tag] [tag] [tag] [tag]'), { maxWords: 3, maxChars: 20 }), true);
});

test('multi-word square tags and known angle tags are direction, not words (feature 087)', () => {
  assert.equal(countSpeech('[short pause]').words, 0);
  assert.equal(countSpeech('[short pause] all good').words, 2);
  assert.equal(countSpeech('[continues after a beat] the migration failed').words, 3);
  assert.equal(countSpeech('<laugh>').words, 0);
  assert.equal(countSpeech('<laugh> ok <short pause> done').words, 2);
  assert.equal(countSpeech('<LAUGH> ok').words, 1);
  assert.equal(countSpeech('x < 5').words, 3);
  assert.equal(countSpeech('a <b> c').words, 3);
  assert.equal(countSpeech('[short pause] <sigh> ok').effectiveText, 'ok');
  assert.equal(isEmptySpeech('[short pause] <laugh> [long pause]'), true);
  assert.equal(countSpeech('[short pause] ok').chars, '[short pause] ok'.length);
});
