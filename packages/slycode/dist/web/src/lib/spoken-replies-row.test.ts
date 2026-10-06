/**
 *   cd web && ../bridge/node_modules/.bin/tsx --test src/lib/spoken-replies-row.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SPEAKER_OFF_TEXT, SPEAKER_ON_TEXT, spokenRepliesRow } from './spoken-replies-row';

const base = { available: true, messagingRunning: true, ttsReason: null };

test('available: the switch shows and drives on/off with plain status text', () => {
  assert.deepEqual(spokenRepliesRow({ ...base, enabled: true }), { dot: 'ok', text: SPEAKER_ON_TEXT, toggle: { checked: true, disabled: false } });
  assert.deepEqual(spokenRepliesRow({ ...base, enabled: false }), { dot: 'ok', text: SPEAKER_OFF_TEXT, toggle: { checked: false, disabled: false } });
  assert.equal(SPEAKER_ON_TEXT, 'On: agents may speak in the browser');
});

test('unknown: no switch until the bridge has reported', () => {
  assert.deepEqual(spokenRepliesRow({ ...base, enabled: null }), { dot: 'pending', text: 'Checking the voice service…', toggle: null });
});

test('unavailable: wording unchanged; OFF stays possible, ON is blocked (same rule as the speaker button)', () => {
  const down = spokenRepliesRow({ enabled: true, available: false, messagingRunning: false, ttsReason: null });
  assert.equal(down.text, 'Unavailable: the messaging service is off. Start it to allow spoken replies.');
  assert.deepEqual(down.toggle, { checked: true, disabled: false }, 'an outage never traps sound on');
  const noKey = spokenRepliesRow({ enabled: false, available: false, messagingRunning: true, ttsReason: 'TTS provider (Gemini): GEMINI_API_KEY is not set.' });
  assert.equal(noKey.text, 'Unavailable: TTS provider (Gemini): GEMINI_API_KEY is not set.');
  assert.deepEqual(noKey.toggle, { checked: false, disabled: true });
  assert.equal(noKey.dot, 'warn');
});
