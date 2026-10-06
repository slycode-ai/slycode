/** Designed-voice expiry window and fix wording (feature 087 phase 4). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EXPIRY_WARNING_DAYS, customVoiceFix, expiryState, expiryWarning, noRecipeMessage, sampleSlug, unusableVoiceMessage } from './custom-voices.js';
const NOW = Date.parse('2026-10-03T12:00:00Z');
const inDays = (d) => new Date(NOW + d * 86_400_000).toISOString();
const voice = (expiresAt) => ({ id: 'voice_ab12', name: 'Astronomer', expiresAt });
test('expiry window: warn within 30 days and after expiry; quiet before; no date → nothing', () => {
    assert.equal(EXPIRY_WARNING_DAYS, 30);
    assert.equal(expiryState(inDays(31), NOW)?.state, 'ok');
    assert.equal(expiryState(inDays(30), NOW)?.state, 'expiring');
    assert.equal(expiryState(inDays(1), NOW)?.state, 'expiring');
    assert.equal(expiryState(inDays(-1), NOW)?.state, 'expired');
    assert.equal(expiryState(new Date(NOW).toISOString(), NOW)?.state, 'expired', 'the expiry moment itself counts as expired');
    assert.equal(expiryState(undefined, NOW), null);
    assert.equal(expiryState('not a date', NOW), null);
    assert.equal(expiryWarning('Project \'A\'', voice(inDays(31)), true, NOW), null);
    assert.match(expiryWarning('Project \'A\'', voice(inDays(12)), true, NOW), /^Project 'A' voice 'Astronomer' \(voice_ab12\) expires on 2026-10-15 \(in 12 days\)/);
    assert.match(expiryWarning('Project \'A\'', voice(inDays(1)), true, NOW), /\(tomorrow\)/);
    assert.match(expiryWarning('Project \'A\'', voice(inDays(-3)), true, NOW), /expired on 2026-09-30/);
    assert.equal(expiryWarning('Project \'A\'', voice(undefined), true, NOW), null);
});
test('fixes suggest --recreate ONLY when a recipe exists', () => {
    assert.match(customVoiceFix('voice_ab12', true), /voice design --recreate voice_ab12 --set.*similar, not identical/);
    assert.doesNotMatch(customVoiceFix('voice_ab12', false), /--recreate/);
    assert.match(customVoiceFix('voice_ab12', false), /voice design "<description>" --name <name>.*voice set/);
    assert.doesNotMatch(expiryWarning('X', voice(inDays(5)), false, NOW), /--recreate/);
    assert.match(unusableVoiceMessage('Gemini', 'expired', voice('2026-09-30T00:00:00Z'), true), /^TTS provider \(Gemini\): custom voice 'Astronomer' \(voice_ab12\) expired on 2026-09-30\. To fix it, recreate/);
    assert.match(unusableVoiceMessage('Gemini', 'missing', voice(), false), /no longer exists\. To fix it, design a new one/);
    assert.equal(noRecipeMessage('voice_zz'), 'No recipe for voice_zz; run voice design "<description>" --name <name> to make a new voice.');
});
test('sample slug is file-safe', () => {
    assert.equal(sampleSlug('Isla — the Narrator!'), 'isla-the-narrator');
    assert.equal(sampleSlug('***'), 'voice');
});
//# sourceMappingURL=custom-voices.test.js.map