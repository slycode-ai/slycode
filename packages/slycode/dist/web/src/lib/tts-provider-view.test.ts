/**
 * Tests for the voice provider switch view logic (feature 087).
 *
 *   cd web && ../bridge/node_modules/.bin/tsx --test src/lib/tts-provider-view.test.ts
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MESSAGING_DOWN_MESSAGE,
  NOT_IN_THIS_VERSION,
  interpretLoadResponse,
  interpretSwitchResponse,
  isSpeechProviderId,
  parseSpeechHealth,
  providerOptions,
  providerSourceHint,
  unverifiedSummary,
  voiceLabel,
} from './tts-provider-view';

function payload(over: Record<string, unknown> = {}) {
  return {
    ok: true,
    provider: 'elevenlabs',
    providerSource: 'state',
    revision: 3,
    ready: true,
    reason: null,
    providers: {
      elevenlabs: { configured: true, available: true, defaultVoice: { id: 'v1', name: 'Rachel' }, defaultVoiceSource: 'env' },
      gemini: { configured: true, available: true, defaultVoice: { id: 'Kore', name: 'Kore' }, defaultVoiceSource: 'builtin' },
    },
    warnings: [],
    ...over,
  };
}

test('isSpeechProviderId accepts only the two providers', () => {
  assert.equal(isSpeechProviderId('elevenlabs'), true);
  assert.equal(isSpeechProviderId('gemini'), true);
  assert.equal(isSpeechProviderId('openai'), false);
  assert.equal(isSpeechProviderId(undefined), false);
  assert.equal(isSpeechProviderId(null), false);
});

test('parseSpeechHealth reads the DTO and drops envelope fields', () => {
  const h = parseSpeechHealth({ ...payload(), unverified: [] });
  assert.ok(h);
  assert.equal(h.provider, 'elevenlabs');
  assert.equal(h.providerSource, 'state');
  assert.equal(h.revision, 3);
  assert.equal(h.ready, true);
  assert.deepEqual(h.providers.gemini.defaultVoice, { id: 'Kore', name: 'Kore' });
  assert.equal('ok' in h, false);
  assert.equal('unverified' in h, false);
});

test('parseSpeechHealth rejects non-DTO bodies', () => {
  assert.equal(parseSpeechHealth(null), null);
  assert.equal(parseSpeechHealth('nope'), null);
  assert.equal(parseSpeechHealth({ ok: false, error: 'messaging_down', message: 'x' }), null);
  assert.equal(parseSpeechHealth(payload({ provider: 'openai' })), null);
  assert.equal(parseSpeechHealth(payload({ providers: undefined })), null);
});

test('parseSpeechHealth treats a provider missing from the payload as not available', () => {
  const h = parseSpeechHealth(payload({ providers: { elevenlabs: payload().providers.elevenlabs } }));
  assert.ok(h);
  assert.deepEqual(h.providers.gemini, { configured: false, available: false, defaultVoice: null, defaultVoiceSource: null });
  assert.equal(h.providerSource, 'state');
  const h2 = parseSpeechHealth(payload({ providerSource: 'weird', warnings: ['a', 3] }));
  assert.equal(h2?.providerSource, 'auto');
  assert.deepEqual(h2?.warnings, ['a']);
});

test('providerOptions: active is pressed and not disabled; the other is selectable', () => {
  const [el, gem] = providerOptions(parseSpeechHealth(payload()));
  assert.equal(el.id, 'elevenlabs');
  assert.equal(el.label, 'ElevenLabs');
  assert.equal(el.active, true);
  assert.equal(el.disabled, false);
  assert.equal(el.reason, null);
  assert.equal(el.title, 'Spoken replies use ElevenLabs.');
  assert.equal(gem.active, false);
  assert.equal(gem.disabled, false);
  assert.equal(gem.title, 'Switch spoken replies to Gemini');
});

test('providerOptions: not in this build vs key missing', () => {
  const base = payload();
  const unavailable = providerOptions(parseSpeechHealth(payload({
    providers: { ...base.providers, gemini: { configured: true, available: false, defaultVoice: null, defaultVoiceSource: null } },
  })));
  assert.equal(unavailable[1].disabled, true);
  assert.equal(unavailable[1].reason, NOT_IN_THIS_VERSION);
  assert.equal(unavailable[1].title, 'Not available in this version of SlyCode.');

  const noKey = providerOptions(parseSpeechHealth(payload({
    providers: { ...base.providers, gemini: { configured: false, available: true, defaultVoice: null, defaultVoiceSource: null } },
  })));
  assert.equal(noKey[1].disabled, true);
  assert.match(noKey[1].reason ?? '', /^GEMINI_API_KEY is not set in \.env\./);

  // "not available" wins over "no key"
  const both = providerOptions(parseSpeechHealth(payload({
    providers: { ...base.providers, gemini: { configured: false, available: false, defaultVoice: null, defaultVoiceSource: null } },
  })));
  assert.equal(both[1].reason, NOT_IN_THIS_VERSION);
});

test('providerOptions: an active provider without its key stays active, not disabled, and says why', () => {
  const base = payload();
  const [el] = providerOptions(parseSpeechHealth(payload({
    ready: false,
    providers: { ...base.providers, elevenlabs: { configured: false, available: true, defaultVoice: null, defaultVoiceSource: null } },
  })));
  assert.equal(el.active, true);
  assert.equal(el.disabled, false);
  assert.match(el.title, /^Spoken replies use ElevenLabs\. ELEVENLABS_API_KEY is not set in \.env\./);
});

test('providerOptions with no health: nothing active, everything disabled, reason passed through', () => {
  const opts = providerOptions(null, MESSAGING_DOWN_MESSAGE);
  assert.equal(opts.length, 2);
  for (const o of opts) {
    assert.equal(o.active, false);
    assert.equal(o.disabled, true);
    assert.equal(o.title, MESSAGING_DOWN_MESSAGE);
  }
  assert.equal(providerOptions(null)[0].reason, 'Checking the voice service…');
});

test('providerSourceHint only speaks up for .env', () => {
  assert.equal(providerSourceHint('state'), null);
  assert.equal(providerSourceHint('auto'), null);
  assert.equal(providerSourceHint('env')?.text, 'from .env');
});

test('interpretLoadResponse', () => {
  assert.equal(interpretLoadResponse(200, payload()).health?.provider, 'elevenlabs');
  assert.deepEqual(
    interpretLoadResponse(503, { ok: false, error: 'messaging_down', message: MESSAGING_DOWN_MESSAGE }),
    { health: null, error: MESSAGING_DOWN_MESSAGE },
  );
  assert.equal(interpretLoadResponse(503, null).error, MESSAGING_DOWN_MESSAGE);
  assert.match(interpretLoadResponse(500, null).error ?? '', /HTTP 500/);
  assert.match(interpretLoadResponse(200, { ok: true }).error ?? '', /HTTP 200/);
});

test('interpretSwitchResponse: 200 switched, with unverified voices', () => {
  const r = interpretSwitchResponse(200, payload({
    provider: 'gemini',
    revision: 4,
    unverified: [
      { projectId: 'p1', projectName: 'Alpha', voice: { id: 'Kore', name: 'Kore' }, reason: 'Gemini voice list unreachable' },
      { projectId: 'p2', projectName: '', voice: null, reason: 'Gemini voice list unreachable' },
      'junk',
    ],
  }));
  assert.equal(r.kind, 'switched');
  if (r.kind !== 'switched') return;
  assert.equal(r.health.provider, 'gemini');
  assert.equal(r.health.revision, 4);
  assert.equal(r.unverified.length, 2);
  assert.equal(r.unverified[1].projectName, 'p2'); // falls back to the id
  assert.equal(r.unverified[1].voice, null);
});

test('interpretSwitchResponse: 200 without unverified is a clean switch', () => {
  const r = interpretSwitchResponse(200, payload({ provider: 'gemini' }));
  assert.equal(r.kind, 'switched');
  if (r.kind === 'switched') assert.deepEqual(r.unverified, []);
});

test('interpretSwitchResponse: 409 refusals keep message, reason and fix', () => {
  const r = interpretSwitchResponse(409, {
    ok: false,
    error: 'unusable_voices',
    message: 'Not switched: 1 project uses a voice Gemini cannot play.',
    refusals: [{ projectId: 'p1', projectName: 'Alpha', voice: { id: 'v1', name: 'Rachel' }, reason: 'ElevenLabs voice', fix: 'Run sly-messaging voice set Kore --project Alpha' }],
  });
  assert.equal(r.kind, 'refused');
  if (r.kind !== 'refused') return;
  assert.equal(r.message, 'Not switched: 1 project uses a voice Gemini cannot play.');
  assert.deepEqual(r.refusals, [{ projectId: 'p1', projectName: 'Alpha', voice: { id: 'v1', name: 'Rachel' }, reason: 'ElevenLabs voice', fix: 'Run sly-messaging voice set Kore --project Alpha' }]);
});

test('interpretSwitchResponse: 400 / 503 / 504 / unknown show the message or a plain fallback', () => {
  assert.deepEqual(
    interpretSwitchResponse(400, { ok: false, error: 'provider_unconfigured', message: 'GEMINI_API_KEY is not set.' }),
    { kind: 'error', message: 'GEMINI_API_KEY is not set.' },
  );
  assert.deepEqual(interpretSwitchResponse(503, null), { kind: 'error', message: MESSAGING_DOWN_MESSAGE });
  assert.deepEqual(
    interpretSwitchResponse(504, { ok: false, error: 'messaging_timeout', message: 'slow' }),
    { kind: 'error', message: 'slow' },
  );
  assert.deepEqual(interpretSwitchResponse(500, 'oops'), { kind: 'error', message: 'The voice provider was not changed (HTTP 500).' });
  // a 409 that isn't unusable_voices is just an error
  assert.equal(interpretSwitchResponse(409, { ok: false, error: 'other', message: 'm' }).kind, 'error');
  // a 200 the app can't read is an error, never a silent "switched"
  assert.equal(interpretSwitchResponse(200, { ok: true }).kind, 'error');
});

test('unverifiedSummary lists project (voice) and the reason once when shared', () => {
  const same = unverifiedSummary([
    { projectId: 'a', projectName: 'Alpha', voice: { id: 'Kore', name: 'Kore' }, reason: 'API down' },
    { projectId: 'b', projectName: 'Beta', voice: null, reason: 'API down' },
  ]);
  assert.deepEqual(same.items, ['Alpha (Kore)', 'Beta (no voice set)']);
  assert.equal(same.sharedReason, 'API down');

  const mixed = unverifiedSummary([
    { projectId: 'a', projectName: 'Alpha', voice: { id: 'Kore', name: 'Kore' }, reason: 'API down' },
    { projectId: 'b', projectName: 'Beta', voice: { id: 'Puck', name: 'Puck' }, reason: 'timeout' },
  ]);
  assert.equal(mixed.sharedReason, null);

  const blank = unverifiedSummary([{ projectId: 'a', projectName: 'Alpha', voice: null, reason: '' }]);
  assert.equal(blank.sharedReason, null);
});

test('voiceLabel', () => {
  assert.equal(voiceLabel({ name: 'Kore' }), 'Kore');
  assert.equal(voiceLabel(null), 'no voice set');
  assert.equal(voiceLabel({ name: '' }), 'no voice set');
});
