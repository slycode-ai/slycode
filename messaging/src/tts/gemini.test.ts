import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GeminiProvider, STUDIO_VOICES, cloneRefusal } from './gemini.js';
import { RequestLimiter } from './rate-limit.js';
import { TtsProviderError, VoiceLookupError, VoiceUnusableError, VoicesUnavailableError } from './errors.js';
import { parseSpeech, singleChunk } from './speech-markup.js';
import { writeWav } from './audio-encode.js';
import type { VoiceConfig } from '../types.js';

const config = (over: Partial<VoiceConfig> = {}): VoiceConfig => ({
  sttBackend: 'openai', openaiApiKey: '', whisperCliPath: '', whisperModelPath: '', awsTranscribeRegion: '',
  awsTranscribeLanguage: 'en-AU', awsTranscribeS3Bucket: '', elevenlabsApiKey: '', elevenlabsVoiceId: '', elevenlabsSpeed: 1,
  geminiApiKey: 'g-key', geminiTtsModel: 'gemini-3.8-flash-tts', geminiTtsVoice: '', ttsProviderEnv: 'gemini', ttsSpeed: 1, geminiTtsLanguage: 'en', ...over,
});

const PCM = Buffer.alloc(24000 * 2, 1); // 1 s of near-silence
/** Gemini-shaped WAV: fmt, data, then a C2PA chunk. */
function geminiWav(pcm = PCM): Buffer {
  const c2pa = Buffer.alloc(6016, 0x7f);
  const head = Buffer.alloc(8); head.write('C2PA', 0, 'ascii'); head.writeUInt32LE(c2pa.length, 4);
  const wav = writeWav({ data: pcm, sampleRate: 24000 });
  const out = Buffer.concat([wav, head, c2pa]);
  out.writeUInt32LE(out.length - 8, 4);
  return out;
}

type Handler = (url: string, init: RequestInit) => { status?: number; json: unknown } | Promise<{ status?: number; json: unknown }>;
function stub(handler: Handler) {
  const calls: Array<{ url: string; init: RequestInit; body: any }> = [];
  const fetchImpl = (async (url: string, init: RequestInit = {}) => {
    calls.push({ url: String(url), init, body: init.body ? JSON.parse(String(init.body)) : undefined });
    const r = await handler(String(url), init);
    return new Response(JSON.stringify(r.json), { status: r.status ?? 200 });
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}
const audioReply = (data = geminiWav(), finishReason = 'STOP', mimeType = 'audio/wav') =>
  ({ json: { candidates: [{ finishReason, content: { parts: [{ inlineData: { mimeType, data: data.toString('base64') } }] } }] } });

const freeLimiter = () => new RequestLimiter({ limit: 1000, label: 'Gemini TTS' });
const chunk = (text: string) => singleChunk(parseSpeech(text));
const render = (p: GeminiProvider, text: string, extra: Partial<Parameters<GeminiProvider['render']>[0]> = {}) =>
  p.render({ chunk: chunk(text), voiceId: 'kore', signal: new AbortController().signal, deadlineAt: Date.now() + 60_000, ...extra });

test('render: one request, parts per style run, voice + key, PCM is exactly the data chunk (no C2PA)', async () => {
  const s = stub(() => audioReply());
  const p = new GeminiProvider(config(), { fetchImpl: s.fetchImpl, limiter: freeLimiter() });
  const out = await render(p, "[excited] Good news! [laughs] [whispers] Don't tell. [calm] Anyway.");
  assert.equal(s.calls.length, 1);
  assert.match(s.calls[0].url, /\/v1beta\/models\/gemini-3\.8-flash-tts:generateContent$/);
  assert.equal((s.calls[0].init.headers as Record<string, string>)['x-goog-api-key'], 'g-key');
  assert.deepEqual(s.calls[0].body, {
    contents: [{ role: 'user', parts: [
      { text: 'Good news! <laugh>', speech_metadata: { style: 'excited' } },
      { text: "Don't tell.", speech_metadata: { style: 'excited, whispering' } },
      { text: 'Anyway.', speech_metadata: { style: 'calm' } },
    ] }],
    generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { voice: 'kore' } } },
  });
  assert.equal(out.kind, 'pcm');
  assert.ok(out.kind === 'pcm' && out.data.equals(PCM) && out.sampleRate === 24000, 'only the samples, metadata dropped');
});

test('render: L16 replies decode; an early finish reason is truncation; no audio is bad audio', async () => {
  const l16 = new GeminiProvider(config(), { fetchImpl: stub(() => audioReply(PCM, 'STOP', 'audio/l16; rate=24000; channels=1')).fetchImpl, limiter: freeLimiter() });
  const a = await render(l16, 'hello');
  assert.ok(a.kind === 'pcm' && a.data.equals(PCM));
  const cut = new GeminiProvider(config(), { fetchImpl: stub(() => audioReply(geminiWav(), 'OTHER')).fetchImpl, limiter: freeLimiter() });
  await assert.rejects(render(cut, 'hello'), (e: unknown) => e instanceof TtsProviderError && e.code === 'tts_truncated' && /OTHER/.test(e.message));
  const none = new GeminiProvider(config(), { fetchImpl: stub(() => ({ json: { candidates: [{ finishReason: 'STOP', content: { parts: [] } }] } })).fetchImpl, limiter: freeLimiter() });
  await assert.rejects(render(none, 'hello'), (e: unknown) => e instanceof TtsProviderError && e.code === 'tts_bad_audio');
});

test('render: HTTP errors map to stable codes naming Gemini', async () => {
  for (const [status, code] of [[404, 'voice_not_found'], [403, 'forbidden'], [500, 'provider_error'], [400, 'bad_request']] as const) {
    const p = new GeminiProvider(config(), { fetchImpl: stub(() => ({ status, json: { error: { message: 'nope' } } })).fetchImpl, limiter: freeLimiter() });
    await assert.rejects(render(p, 'hello'), (e: unknown) => e instanceof TtsProviderError && e.code === code && /Gemini/.test(e.message), `${status}`);
  }
});

test('429: speak fails at once naming the wait; Telegram/generate retry once when it fits', async () => {
  let n = 0;
  const quota = { status: 429, json: { error: { message: 'Quota exceeded. Please retry in 0.05s.' } } };
  const s = stub(() => (n++ === 0 ? quota : audioReply()));
  const speak = new GeminiProvider(config(), { fetchImpl: s.fetchImpl, limiter: freeLimiter() });
  await assert.rejects(render(speak, 'hi', { retryOn429: false }), (e: unknown) => e instanceof TtsProviderError && e.code === 'rate_limited' && e.status === 429);
  n = 0;
  const gen = new GeminiProvider(config(), { fetchImpl: s.fetchImpl, limiter: freeLimiter() });
  const out = await render(gen, 'hi', { retryOn429: true });
  assert.equal(out.kind, 'pcm');
  n = 0;
  const tight = new GeminiProvider(config(), { fetchImpl: stub(() => ({ status: 429, json: { error: { message: 'retry in 30s' } } })).fetchImpl, limiter: freeLimiter() });
  await assert.rejects(render(tight, 'hi', { retryOn429: true, deadlineAt: Date.now() + 5000 }), /rate limit reached \(429\); retry in 30 s/);
});

test('the limiter gates requests per model before they are sent', async () => {
  const s = stub(() => audioReply());
  const p = new GeminiProvider(config(), { fetchImpl: s.fetchImpl, limiter: new RequestLimiter({ limit: 1, label: 'Gemini TTS' }) });
  await render(p, 'one');
  await assert.rejects(render(p, 'two', { deadlineAt: Date.now() + 1000 }), /Gemini TTS limit \(1 requests\/min\) reached; next slot in \d+ s/);
  assert.equal(s.calls.length, 1, 'the rate-limited request never reached the API');
});

// --- voices ---------------------------------------------------------------------

const catalogue = [
  { id: 'kore', type: 'prebuilt', display_name: 'Kore', language_code: 'en-US', gender: 'female', accent: 'General American', description: 'Firm and clear.' },
  { id: 'sulafat', type: 'prebuilt', display_name: 'Sulafat', language_code: 'en-US', gender: 'female', accent: 'General American', description: 'Warm voice.' },
  { id: 'en-gb-advisor-10', type: 'prebuilt', display_name: 'Authoritative Advisor 10', language_code: 'en-GB', gender: 'male', accent: 'Bristol English', persona: 'Advisor', description: 'Warm, measured British voice.' },
  { id: 'en-au-advisor-1', type: 'prebuilt', display_name: 'Authoritative Advisor 1', language_code: 'en-AU', gender: 'male', accent: 'Sydney English', description: 'Calm.' },
  { id: 'ko-kr-advisor-1', type: 'prebuilt', display_name: 'Authoritative Advisor 1', language_code: 'ko-KR', gender: 'male', accent: 'Seoul Korean', description: 'Korean advisor.' },
];
const custom = [{ id: 'voice_abc123', type: 'prompted', display_name: 'Astronomer', language_code: 'en-AU', gender: 'female', expire_time: '2027-10-01T00:00:00Z' }];

function voicesApi(opts: { down?: boolean } = {}) {
  return stub((url) => {
    if (opts.down) return { status: 503, json: {} };
    const u = new URL(url);
    if (u.pathname.endsWith('/voices/voice_abc123')) return { json: custom[0] };
    if (u.pathname.includes('/voices/voice_')) return { status: 404, json: { error: { message: 'not found' } } };
    const type = u.searchParams.get('type');
    if (type === 'prompted') return { json: { voices: custom } };
    if (type === 'replicated') return { json: { voices: [] } };
    const page = u.searchParams.get('page_token');
    return page ? { json: { voices: catalogue.slice(3) } } : { json: { voices: catalogue.slice(0, 3), nextPageToken: 'p2' } };
  });
}

test('catalogue: pages of 200 following tokens, cached across searches', async () => {
  const s = voicesApi();
  const p = new GeminiProvider(config(), { fetchImpl: s.fetchImpl, limiter: freeLimiter() });
  await p.searchVoices({ text: 'warm' });
  await p.searchVoices({ text: 'calm' });
  const prebuiltCalls = s.calls.filter((c) => new URL(c.url).searchParams.get('type') === 'prebuilt');
  assert.equal(prebuiltCalls.length, 2, 'two pages fetched once, then cached');
  assert.ok(prebuiltCalls.every((c) => new URL(c.url).searchParams.get('page_size') === '200'));
});

test('search: local matching over accent/persona/language name, filters, ranking (custom, studio, preferred language)', async () => {
  const p = new GeminiProvider(config(), { fetchImpl: voicesApi().fetchImpl, limiter: freeLimiter() });
  assert.deepEqual((await p.searchVoices({ text: 'british warm' })).map((v) => v.voice_id), ['en-gb-advisor-10']);
  assert.deepEqual((await p.searchVoices({ accent: 'sydney' })).map((v) => v.voice_id), ['en-au-advisor-1']);
  assert.deepEqual((await p.searchVoices({ language: 'en-GB' })).map((v) => v.voice_id), ['en-gb-advisor-10']);
  assert.deepEqual((await p.searchVoices({ gender: 'female', language: 'en' })).map((v) => v.voice_id), ['voice_abc123', 'kore', 'sulafat']);
  assert.deepEqual((await p.searchVoices({ custom: true })).map((v) => [v.voice_id, v.category, v.expiresAt]), [['voice_abc123', 'custom', '2027-10-01T00:00:00Z']]);
  const all = await p.searchVoices({});
  assert.deepEqual(all.map((v) => v.category), ['custom', 'studio', 'studio', 'library', 'library', 'library']);
  assert.equal(all.at(-1)!.voice_id, 'ko-kr-advisor-1', 'non-preferred language last');
  const kore = all.find((v) => v.voice_id === 'kore')!;
  assert.deepEqual([kore.name, kore.description, kore.labels.accent], ['Kore', 'Firm', 'General American']);
});

test('search when the voices API is down: studio voices offline (lenient); strict throws', async () => {
  const p = new GeminiProvider(config(), { fetchImpl: voicesApi({ down: true }).fetchImpl, limiter: freeLimiter() });
  const offline = await p.searchVoices({ text: 'warm' });
  assert.deepEqual(offline.map((v) => v.voice_id), ['sulafat']);
  await assert.rejects(p.searchVoices({ text: 'warm' }, { strict: true }), VoicesUnavailableError);
  assert.equal(STUDIO_VOICES.length, 30);
});

test('getVoice: studio offline (any case), custom via GET (404 → null), library from the catalogue', async () => {
  const s = voicesApi();
  const p = new GeminiProvider(config(), { fetchImpl: s.fetchImpl, limiter: freeLimiter() });
  assert.equal((await p.getVoice('KORE'))?.voice_id, 'kore');
  assert.equal(s.calls.length, 0, 'studio lookups need no network');
  assert.equal((await p.getVoice('voice_abc123'))?.expiresAt, '2027-10-01T00:00:00Z');
  assert.equal(await p.getVoice('voice_gone'), null);
  assert.equal((await p.getVoice('en-gb-advisor-10'))?.name, 'Authoritative Advisor 10');
  assert.equal(await p.getVoice('no-such-id'), null);
  const down = new GeminiProvider(config(), { fetchImpl: voicesApi({ down: true }).fetchImpl, limiter: freeLimiter() });
  await assert.rejects(down.getVoice('voice_abc123'), VoicesUnavailableError);
});

test('resolveVoiceValue: id, studio name, custom name; library names are ambiguous; unknown lists candidates', async () => {
  const p = new GeminiProvider(config(), { fetchImpl: voicesApi().fetchImpl, limiter: freeLimiter() });
  assert.deepEqual(await p.resolveVoiceValue('Sulafat'), { provider: 'gemini', id: 'sulafat', name: 'Sulafat', kind: 'prebuilt' });
  assert.deepEqual(await p.resolveVoiceValue('en-gb-advisor-10'), { provider: 'gemini', id: 'en-gb-advisor-10', name: 'Authoritative Advisor 10', kind: 'library' });
  assert.deepEqual(await p.resolveVoiceValue('astronomer'), { provider: 'gemini', id: 'voice_abc123', name: 'Astronomer', kind: 'custom', expiresAt: '2027-10-01T00:00:00Z' });
  await assert.rejects(p.resolveVoiceValue('Authoritative Advisor 1'), (e: unknown) =>
    e instanceof VoiceLookupError && e.code === 'voice_ambiguous' && e.candidates.length === 2 && /set one by id/.test(e.message));
  await assert.rejects(p.resolveVoiceValue('warm'), (e: unknown) => e instanceof VoiceLookupError && e.code === 'voice_not_found' && e.candidates.length > 0);
});

test('env default and built-in voice', () => {
  assert.deepEqual(new GeminiProvider(config({ geminiTtsVoice: 'Sulafat' })).envDefaultVoice(), { provider: 'gemini', id: 'sulafat', name: 'Sulafat', kind: 'prebuilt' });
  assert.deepEqual(new GeminiProvider(config({ geminiTtsVoice: 'en-gb-advisor-10' })).envDefaultVoice(), { provider: 'gemini', id: 'en-gb-advisor-10', name: 'en-gb-advisor-10' });
  assert.equal(new GeminiProvider(config()).envDefaultVoice(), null);
  // Built-in default is library voice Zuri (owner choice, #0376), not Kore.
  assert.deepEqual(new GeminiProvider(config()).builtinDefaultVoice(), { provider: 'gemini', id: 'en-us-zuri', name: 'Zuri', kind: 'library' });
  for (const v of ['Zuri', 'zuri', 'EN-US-ZURI']) {
    assert.deepEqual(new GeminiProvider(config({ geminiTtsVoice: v })).envDefaultVoice(), { provider: 'gemini', id: 'en-us-zuri', name: 'Zuri', kind: 'library' }, v);
  }
});

test('the built-in default (Zuri) is known offline: lookup, name and search need no catalogue', async () => {
  const s = voicesApi({ down: true });
  const p = new GeminiProvider(config(), { fetchImpl: s.fetchImpl, limiter: freeLimiter() });
  const info = await p.getVoice('en-us-zuri');
  assert.deepEqual([info?.voice_id, info?.name, info?.category, info?.labels.accent, info?.labels.gender], ['en-us-zuri', 'Zuri', 'library', 'East Coast', 'female']);
  assert.equal((await p.getVoice('EN-US-Zuri'))?.voice_id, 'en-us-zuri');
  assert.deepEqual(await p.resolveVoiceValue('Zuri'), { provider: 'gemini', id: 'en-us-zuri', name: 'Zuri', kind: 'library' });
  assert.equal(s.calls.length, 0, 'lookups of the built-in default need no network');
  assert.deepEqual((await p.searchVoices({ text: 'zuri' })).map((v) => v.voice_id), ['en-us-zuri'], 'offline search still finds it');
});

test('429 retry follows the live policy of a shared render, not the starter\'s flag (fix loop)', async () => {
  let n = 0;
  const s = stub(() => (n++ === 0 ? { status: 429, json: { error: { message: 'Please retry in 0.05s.' } } } : audioReply()));
  const p = new GeminiProvider(config(), { fetchImpl: s.fetchImpl, limiter: freeLimiter() });
  let retry = true;
  const out = await render(p, 'hi', { retryOn429: false, policy: { deadlineAt: () => Date.now() + 60_000, retryOn429: () => retry } });
  assert.equal(out.kind, 'pcm', 'a live generate waiter allows the retry even though speak started the render');
  n = 0; retry = false;
  await assert.rejects(render(p, 'hi', { retryOn429: true, policy: { deadlineAt: () => Date.now() + 60_000, retryOn429: () => retry } }), /rate limit reached/);
});

// --- designed voices (phase 4) -------------------------------------------------

test('designVoice: prompted request with store:true and the configured model; voice at the top level; sample decoded to PCM', async () => {
  const s = stub(() => ({ json: {
    id: 'voice_new1', type: 'prompted', display_name: 'Isla', model: 'gemini-3.8-flash-tts', expire_time: '2027-10-03T00:00:00Z',
    prompted: { input: 'calm Scottish narrator' }, sample_audio: { mime_type: 'audio/wav', data: geminiWav().toString('base64') }, usage: { audio_tokens: 1800 },
  } }));
  const p = new GeminiProvider(config(), { fetchImpl: s.fetchImpl, limiter: freeLimiter() });
  const v = await p.designVoice({ description: 'calm Scottish narrator', name: 'Isla', gender: 'female', language: 'en-GB' });
  assert.equal(s.calls.length, 1);
  assert.match(s.calls[0].url, /\/v1beta\/voices$/);
  assert.equal(s.calls[0].init.method, 'POST');
  assert.deepEqual(s.calls[0].body, {
    store: true,
    voice: { model: 'gemini-3.8-flash-tts', type: 'prompted', display_name: 'Isla', gender: 'female', language_code: 'en-GB', prompted: { input: 'calm Scottish narrator' } },
  });
  assert.equal(v.id, 'voice_new1');
  assert.equal(v.expiresAt, '2027-10-03T00:00:00Z');
  assert.equal(v.sample?.kind, 'pcm');
  assert.equal(v.sample?.data.length, PCM.length, 'the sample is exactly the data chunk (no C2PA bytes)');

  const bare = stub(() => ({ json: { voice: { id: 'voice_new2' } } }));
  const p2 = new GeminiProvider(config(), { fetchImpl: bare.fetchImpl, limiter: freeLimiter() });
  const v2 = await p2.designVoice({ description: 'd', name: 'N' });
  assert.deepEqual(Object.keys(bare.calls[0].body.voice).sort(), ['display_name', 'model', 'prompted', 'type'], 'no gender/language unless given');
  assert.equal(v2.id, 'voice_new2', 'a nested voice object is accepted too');
  assert.equal(v2.name, 'N');
  assert.equal(v2.sample, null);
});

test('designVoice errors: 400 passes Google\'s reason through; 429 is rate_limited', async () => {
  const quota = stub(() => ({ status: 400, json: { error: { message: 'Voice limit of 200 reached for this project.' } } }));
  await assert.rejects(new GeminiProvider(config(), { fetchImpl: quota.fetchImpl }).designVoice({ description: 'd', name: 'n' }),
    (e: unknown) => e instanceof TtsProviderError && e.code === 'bad_request' && /Voice limit of 200/.test(e.message));
  const busy = stub(() => ({ status: 429, json: { error: { message: 'slow down' } } }));
  await assert.rejects(new GeminiProvider(config(), { fetchImpl: busy.fetchImpl }).designVoice({ description: 'd', name: 'n' }),
    (e: unknown) => e instanceof TtsProviderError && e.code === 'rate_limited');
});

test('deleteVoice: true when deleted, false when already gone (404); remoteRecipe reads prompted.input, null once gone', async () => {
  const s = stub((url, init) => {
    if (init.method === 'DELETE') return url.endsWith('voice_gone') ? { status: 404, json: {} } : { json: {} };
    if (url.endsWith('voice_live')) return { json: { id: 'voice_live', display_name: 'Astronomer', gender: 'female', language_code: 'en-AU', expire_time: '2027-01-01T00:00:00Z', prompted: { input: 'a stargazer' } } };
    return { status: 404, json: {} };
  });
  const p = new GeminiProvider(config(), { fetchImpl: s.fetchImpl, limiter: freeLimiter() });
  assert.equal(await p.deleteVoice('voice_live'), true);
  assert.equal(await p.deleteVoice('voice_gone'), false);
  assert.deepEqual(await p.remoteRecipe('voice_live'), { name: 'Astronomer', description: 'a stargazer', gender: 'female', language: 'en-AU', expiresAt: '2027-01-01T00:00:00Z' });
  assert.equal(await p.remoteRecipe('voice_gone'), null);
  assert.equal(await p.remoteRecipe('kore'), null, 'only designed voices have recipes');
});

test('render of a deleted designed voice is VoiceUnusableError(missing); a library 404 stays voice_not_found', async () => {
  const s = stub(() => ({ status: 404, json: { error: { message: 'Voice not found' } } }));
  const p = new GeminiProvider(config(), { fetchImpl: s.fetchImpl, limiter: freeLimiter() });
  await assert.rejects(render(p, 'hello there', { voiceId: 'voice_gone' }), (e: unknown) => e instanceof VoiceUnusableError && e.why === 'missing' && e.code === 'voice_not_found');
  await assert.rejects(render(p, 'hello there', { voiceId: 'en-gb-advisor-10' }), (e: unknown) => e instanceof TtsProviderError && !(e instanceof VoiceUnusableError) && e.code === 'voice_not_found');
});

// --- cloned voices (#0376) --------------------------------------------------------

/**
 * Google's answer to the 2026-10-05 live probe (silent placeholder takes):
 * a failed consent check arrives as HTTP 500 INTERNAL, the real reason
 * buried in a debug detail string. Kept verbatim (minus the long payload).
 */
const CONSENT_FAILED_500 = {
  error: {
    code: 500,
    message: 'Error translating server response to JSON',
    status: 'INTERNAL',
    details: [{
      '@type': 'type.googleapis.com/google.rpc.DebugInfo',
      detail: "INTERNAL: Invalid type URL, unknown type: google.rpc.context.HttpHeaderContext\nOriginal error: INVALID_ARGUMENT: Consent flow failed. Please follow instructions at https://ai.google.dev/gemini-api/docs/speech-generation for troubleshooting.\nThe recorded phrase didn't match the text on screen. Please read the prompt exactly as written. [type.googleapis.com/util.MessageSetPayload='[google.rpc.error_details_ext] { details { ... \\\"code\\\":\\\"FINISH_REASON_INPUT_VR_TAKEDOWN\\\" ... } }']",
    }],
  },
};

test('cloneVoice: replicated request with both recordings inline as WAV, store:true; same voice shape as design', async () => {
  const s = stub(() => ({ json: { id: 'voice_c1', type: 'replicated', display_name: 'Greg', model: 'models/gemini-3.8-flash-tts', expire_time: '2027-10-05T00:00:00Z' } }));
  const p = new GeminiProvider(config(), { fetchImpl: s.fetchImpl, limiter: freeLimiter() });
  const sample = Buffer.from('RIFF-sample');
  const consent = Buffer.from('RIFF-consent');
  const v = await p.cloneVoice({ name: 'Greg', sample, consent });
  assert.match(s.calls[0].url, /\/v1beta\/voices$/);
  assert.deepEqual(s.calls[0].body, {
    store: true,
    voice: {
      model: 'gemini-3.8-flash-tts', type: 'replicated', display_name: 'Greg',
      replicated: {
        source_audio: { mime_type: 'audio/wav', data: sample.toString('base64') },
        consent_audio: { mime_type: 'audio/wav', data: consent.toString('base64') },
      },
    },
  });
  assert.deepEqual(v, { id: 'voice_c1', name: 'Greg', expiresAt: '2027-10-05T00:00:00Z', model: 'gemini-3.8-flash-tts', sample: null });
});

test('cloneVoice errors: the live consent refusal (an HTTP 500) becomes clone_consent_failed with Google\'s reason; region and others map too', async () => {
  const refused = stub(() => ({ status: 500, json: CONSENT_FAILED_500 }));
  await assert.rejects(new GeminiProvider(config(), { fetchImpl: refused.fetchImpl }).cloneVoice({ name: 'n', sample: Buffer.alloc(1), consent: Buffer.alloc(1) }),
    (e: unknown) => e instanceof TtsProviderError && e.code === 'clone_consent_failed' && e.status === 422
      && /couldn't confirm the consent recording \(The recorded phrase didn't match the text on screen\)\. Record both again/.test(e.message));
  const region = cloneRefusal({ error: { code: 400, status: 'FAILED_PRECONDITION', message: 'User location is not supported for the API use.' } });
  assert.equal(region?.code, 'clone_unavailable_region');
  assert.equal(region?.status, 403);
  assert.equal(cloneRefusal({ error: { message: 'Voice limit of 200 reached for this project.' } }), null, 'anything else keeps the usual mapping');
  const quota = stub(() => ({ status: 400, json: { error: { message: 'Voice limit of 200 reached for this project.' } } }));
  await assert.rejects(new GeminiProvider(config(), { fetchImpl: quota.fetchImpl }).cloneVoice({ name: 'n', sample: Buffer.alloc(1), consent: Buffer.alloc(1) }),
    (e: unknown) => e instanceof TtsProviderError && e.code === 'bad_request' && /voice cloning/.test(e.message) && /Voice limit of 200/.test(e.message));
});
