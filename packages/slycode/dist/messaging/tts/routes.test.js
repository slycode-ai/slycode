/**
 * Route-level tests for the TTS HTTP surface (tts/routes.ts, feature 087).
 * Real Express + a real StateManager in a temp SLYCODE_HOME; fake providers,
 * a stub channel and a stub encoder, so nothing reaches a real API.
 */
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
let home;
const originalHome = process.env.SLYCODE_HOME;
export function cfg(over = {}) {
    return {
        sttBackend: 'openai', openaiApiKey: '', whisperCliPath: '', whisperModelPath: '', awsTranscribeRegion: '',
        awsTranscribeLanguage: 'en-AU', awsTranscribeS3Bucket: '', elevenlabsApiKey: 'xi', elevenlabsVoiceId: 'ENVVOICE',
        elevenlabsSpeed: 1, geminiApiKey: '', geminiTtsModel: 'gemini-3.8-flash-tts', geminiTtsVoice: '', ttsProviderEnv: '',
        ttsSpeed: 1, geminiTtsLanguage: 'en', ...over,
    };
}
export function fakeProvider(id, over = {}) {
    const renders = [];
    const voices = [
        { provider: id, voice_id: `${id}-v1`, name: 'Alpha Voice', category: 'premade', description: 'warm', labels: {} },
        { provider: id, voice_id: `${id}-v2`, name: 'Beta Voice', category: 'premade', description: 'bright', labels: {} },
    ];
    return {
        id, label: id === 'elevenlabs' ? 'ElevenLabs' : 'Gemini', model: `${id}-model`, maxRenderChars: Number.POSITIVE_INFINITY, concurrency: 2,
        nativeSpeed: id === 'elevenlabs', resolveVoiceValue: async (v) => ({ provider: id, id: v, name: v }),
        isConfigured: () => true,
        envDefaultVoice: () => (id === 'elevenlabs' ? { provider: id, id: 'ENVVOICE', name: 'env default' } : null),
        builtinDefaultVoice: () => (id === 'gemini' ? { provider: id, id: 'kore', name: 'Kore' } : null),
        cacheKeyParts: () => [`${id}-model`],
        searchVoices: async (q) => voices.filter((v) => !q.text || v.name.toLowerCase().includes(q.text.toLowerCase())),
        render: async (req) => { renders.push(req); return { kind: 'mp3', data: Buffer.from(`${req.voiceId}|${req.chunk.text}`) }; },
        renders,
        ...over,
    };
}
/** Build an app with the TTS router mounted, against the current temp SLYCODE_HOME. */
export async function harness(opts = {}) {
    const stateMod = await import(`../state.js?t=${Date.now()}-${Math.random()}`);
    const { TtsRuntime } = await import('./runtime.js');
    const { SpeechRenderer } = await import('../tts-render.js');
    const { createTtsRouter, serviceJsonParser } = await import('./routes.js');
    const state = new stateMod.StateManager();
    const registry = { elevenlabs: fakeProvider('elevenlabs'), ...opts.providers };
    const encode = opts.encode ?? (async (src, fmt) => Buffer.concat([Buffer.from(`${fmt}:`), src.data]));
    const tts = new TtsRuntime(opts.config ?? cfg(), state, { registry, renderer: new SpeechRenderer({ encode: encode }) });
    const sent = [];
    const archived = [];
    const channel = opts.channel === false ? null : {
        isReady: () => true,
        sendChatAction: async () => { },
        sendVoice: async (audio, format) => { sent.push({ audio, format }); return { messageId: 1 }; },
    };
    const app = express();
    app.use(serviceJsonParser());
    app.use(createTtsRouter({
        tts, state,
        channel: () => channel,
        noChannelError: 'no channel',
        sessionName: () => 'global',
        contextSlug: () => 'slug',
        archive: (_b, ext) => { archived.push(ext); },
        afterVoiceSent: async () => { },
        workspaceRoot: () => home,
        encodeSample: async (src, fmt) => Buffer.concat([Buffer.from(`${fmt}:`), src.data]),
    }));
    const server = app.listen(0);
    await new Promise((r) => server.once('listening', r));
    const { port } = server.address();
    return { base: `http://127.0.0.1:${port}`, sent, archived, state, tts, close: () => new Promise((r) => server.close(() => r())) };
}
export async function call(h, method, url, body) {
    const res = await fetch(`${h.base}${url}`, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: res.status, json: await res.json().catch(() => null) };
}
beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'tts-routes-test-'));
    process.env.SLYCODE_HOME = home;
    fs.mkdirSync(path.join(home, 'projects'), { recursive: true });
    fs.writeFileSync(path.join(home, 'projects', 'registry.json'), JSON.stringify({ projects: [
            { id: 'alpha', name: 'Alpha', path: '/tmp/alpha' },
            { id: 'beta', name: 'Beta', path: '/tmp/beta' },
        ] }));
    fs.writeFileSync(path.join(home, 'messaging-state.json'), JSON.stringify({ targetType: 'global', targetPrefs: {} }));
});
afterEach(() => {
    if (originalHome === undefined)
        delete process.env.SLYCODE_HOME;
    else
        process.env.SLYCODE_HOME = originalHome;
    fs.rmSync(home, { recursive: true, force: true });
});
export const decodeB64 = (s) => Buffer.from(s, 'base64').toString();
test('GET /tts/provider reports the active provider and the DTO', async () => {
    const h = await harness();
    try {
        const r = await call(h, 'GET', '/tts/provider');
        assert.equal(r.status, 200);
        assert.equal(r.json.ok, true);
        assert.equal(r.json.provider, 'elevenlabs');
        assert.equal(r.json.providerSource, 'auto');
        assert.equal(r.json.ready, true);
    }
    finally {
        await h.close();
    }
});
test('POST /tts/render renders with the project voice for the session and returns mp3', async () => {
    const h = await harness();
    try {
        h.state.setProjectVoice('alpha', { id: 'ALPHA', name: 'Alpha' });
        const r = await call(h, 'POST', '/tts/render', { text: 'hello', session: 'alpha:claude:card:card-1' });
        assert.equal(r.status, 200);
        assert.equal(r.json.provider, 'elevenlabs');
        assert.equal(r.json.voiceId, 'ALPHA');
        assert.equal(decodeB64(r.json.dataBase64), 'mp3:ALPHA|hello');
        const again = await call(h, 'POST', '/tts/render', { text: 'hello', session: 'alpha:claude:card:card-1' });
        assert.equal(again.json.cached, true);
    }
    finally {
        await h.close();
    }
});
test('POST /tts/render with no key → 400 tts_unconfigured naming the key', async () => {
    const h = await harness({ config: cfg({ elevenlabsApiKey: '' }) });
    try {
        const r = await call(h, 'POST', '/tts/render', { text: 'hello' });
        assert.equal(r.status, 400);
        assert.equal(r.json.error, 'tts_unconfigured');
        assert.match(r.json.message, /ELEVENLABS_API_KEY/);
    }
    finally {
        await h.close();
    }
});
test('POST /voice: no channel, too long, OGG, and the MP3 fallback label', async () => {
    const none = await harness({ channel: false });
    try {
        assert.deepEqual((await call(none, 'POST', '/voice', { message: 'hi' })).json, { error: 'no channel' });
    }
    finally {
        await none.close();
    }
    const h = await harness();
    try {
        const long = await call(h, 'POST', '/voice', { message: 'x'.repeat(5001) });
        assert.equal(long.status, 400);
        assert.match(long.json.error, /too long: 5001 characters/);
        const ok = await call(h, 'POST', '/voice', { message: 'hello there' });
        assert.equal(ok.status, 200);
        assert.equal(h.sent.at(-1)?.format, 'ogg');
        assert.equal(h.sent.at(-1)?.audio.toString(), 'ogg:ENVVOICE|hello there');
        assert.deepEqual(h.archived, ['.ogg']);
    }
    finally {
        await h.close();
    }
    const failing = await harness({ encode: async (src, fmt) => { if (fmt === 'ogg')
            throw new Error('no ffmpeg'); return src.data; } });
    try {
        await call(failing, 'POST', '/voice', { message: 'fallback please' });
        assert.equal(failing.sent.at(-1)?.format, 'mp3', 'OGG failure falls back to MP3, labelled as MP3');
        assert.deepEqual(failing.archived, ['.mp3']);
    }
    finally {
        await failing.close();
    }
});
test('POST /tts/generate writes the file and reports provider and voice', async () => {
    const h = await harness();
    try {
        const out = path.join(home, 'gen');
        const r = await call(h, 'POST', '/tts/generate', { text: 'narration', format: 'mp3', outDir: out, voiceId: 'EXPLICIT' });
        assert.equal(r.status, 200);
        assert.equal(r.json.provider, 'elevenlabs');
        assert.equal(r.json.voiceId, 'EXPLICIT');
        assert.equal(fs.readFileSync(r.json.absolutePath).toString(), 'mp3:EXPLICIT|narration');
    }
    finally {
        await h.close();
    }
});
test('GET /voices/search tags results with the provider and the switch revision', async () => {
    const h = await harness();
    try {
        const r = await call(h, 'GET', '/voices/search?q=alpha');
        assert.equal(r.status, 200);
        assert.equal(r.json.provider, 'elevenlabs');
        assert.equal(r.json.revision, 0);
        assert.deepEqual(r.json.voices.map((v) => [v.provider, v.voice_id]), [['elevenlabs', 'elevenlabs-v1']]);
    }
    finally {
        await h.close();
    }
});
test('structural invariant: only POST /voice touches the channel', () => {
    const src = fs.readFileSync(new URL('./routes.ts', import.meta.url), 'utf8');
    const blocks = src.split(/\n  router\.(?=get|post|put|delete)/).slice(1);
    assert.ok(blocks.length >= 6);
    for (const b of blocks) {
        const route = b.slice(0, b.indexOf(','));
        const touches = /deps\.channel\(/.test(b);
        assert.equal(touches, route.includes("'/voice'"), `${route} channel access`);
    }
});
// --- Phase 2: Gemini end to end, provider switch, stale picks, filters -------
import { encodeSource } from '../tts.js';
import { parseWav } from './audio-encode.js';
import { VoicesUnavailableError } from './errors.js';
/** A Gemini stand-in that returns PCM sized like real speech (~0.45 s per word). */
function pcmGemini(over = {}) {
    const p = fakeProvider('gemini', { maxRenderChars: 600, nativeSpeed: false, concurrency: 3, ...over });
    p.render = async (req) => {
        p.renders.push(req);
        const words = req.chunk.text.split(/\s+/).filter(Boolean).length;
        const n = Math.round(24000 * 0.45 * words);
        return { kind: 'pcm', data: Buffer.alloc(n * 2, 3), sampleRate: 24000, channels: 1 };
    };
    p.getVoice = over.getVoice ?? (async (id) => (['kore', 'sulafat'].includes(id) ? { provider: 'gemini', voice_id: id, name: id, category: 'studio', description: '', labels: {} } : null));
    return p;
}
const sentence = (i) => `Sentence number ${i} carries a handful of ordinary words for length.`;
test('stubbed 3-chunk Gemini job end to end: /tts/generate → three provider calls → one fresh WAV with gaps', async () => {
    const gemini = pcmGemini();
    const h = await harness({ config: cfg({ geminiApiKey: 'g', ttsProviderEnv: 'gemini' }), providers: { gemini }, encode: encodeSource });
    try {
        const text = Array.from({ length: 24 }, (_, i) => sentence(i)).join(' ').slice(0, 1600);
        const r = await call(h, 'POST', '/tts/generate', { text, format: 'wav', outDir: path.join(home, 'gen') });
        assert.equal(r.status, 200, JSON.stringify(r.json));
        assert.equal(r.json.provider, 'gemini');
        assert.equal(r.json.voiceId, 'kore', 'built-in default when nothing is set');
        assert.equal(gemini.renders.length, 3, 'three chunks, three provider calls');
        assert.ok(gemini.renders.every((q) => q.retryOn429 === true), 'generate may retry a 429 once');
        const wav = fs.readFileSync(r.json.absolutePath);
        const pcm = parseWav(wav);
        const chunkSamples = gemini.renders.reduce((n, q) => n + Math.round(24000 * 0.45 * q.chunk.text.split(/\s+/).filter(Boolean).length), 0);
        const gaps = pcm.data.length / 2 - chunkSamples;
        assert.ok(gaps === Math.round(24000 * 0.12) * 2 || gaps === Math.round(24000 * 0.12) + Math.round(24000 * 0.25), `two join gaps, got ${gaps} samples`);
        assert.equal(wav.length, 44 + pcm.data.length, 'fresh 44-byte header, no other chunks');
    }
    finally {
        await h.close();
    }
});
test('speak on Gemini: a 1,600-char reply is 3 parallel chunks, never retried on 429, encoded to MP3', async () => {
    const gemini = pcmGemini();
    const h = await harness({ config: cfg({ geminiApiKey: 'g', ttsProviderEnv: 'gemini', ttsSpeed: 1.2 }), providers: { gemini }, encode: encodeSource });
    try {
        const text = Array.from({ length: 24 }, (_, i) => sentence(i)).join(' ').slice(0, 1600);
        const r = await call(h, 'POST', '/tts/render', { text });
        assert.equal(r.status, 200, JSON.stringify(r.json));
        assert.equal(gemini.renders.length, 3);
        assert.ok(gemini.renders.every((q) => q.retryOn429 === false), 'speak never retries');
        assert.equal(Buffer.from(r.json.dataBase64, 'base64').subarray(0, 1)[0], 0xff, 'mp3 frame sync');
    }
    finally {
        await h.close();
    }
});
test('PUT /tts/provider: key missing → 400; unusable voices → 409 naming the project; success bumps the revision', async () => {
    const noKey = await harness({ providers: { gemini: pcmGemini({ isConfigured: () => false }) } });
    try {
        const r = await call(noKey, 'PUT', '/tts/provider', { provider: 'gemini' });
        assert.equal(r.status, 400);
        assert.equal(r.json.error, 'provider_unconfigured');
        assert.match(r.json.message, /GEMINI_API_KEY/);
    }
    finally {
        await noKey.close();
    }
    const h = await harness({ config: cfg({ geminiApiKey: 'g' }), providers: { gemini: pcmGemini() } });
    try {
        assert.equal((await call(h, 'PUT', '/tts/provider', { provider: 'azure' })).status, 400);
        h.state.setProjectVoice('alpha', { id: 'voice_old', name: 'Old Design', expiresAt: '2020-01-01T00:00:00Z', kind: 'custom', provider: 'gemini' });
        h.state.setProjectVoice('beta', { id: 'voice_deleted', name: 'Gone', provider: 'gemini' });
        const refused = await call(h, 'PUT', '/tts/provider', { provider: 'gemini' });
        assert.equal(refused.status, 409);
        assert.equal(refused.json.error, 'unusable_voices');
        assert.deepEqual(refused.json.refusals.map((x) => [x.projectName, /expired|no longer exists/.exec(x.reason)?.[0]]), [['Alpha', 'expired'], ['Beta', 'no longer exists']]);
        assert.equal((await call(h, 'GET', '/tts/provider')).json.provider, 'elevenlabs', 'nothing changed');
        h.state.setProjectVoice('alpha', { id: 'sulafat', name: 'Sulafat', provider: 'gemini' });
        h.state.clearProjectVoice('beta', 'gemini');
        const ok = await call(h, 'PUT', '/tts/provider', { provider: 'gemini' });
        assert.equal(ok.status, 200, JSON.stringify(ok.json));
        assert.equal(ok.json.provider, 'gemini');
        assert.equal(ok.json.providerSource, 'state');
        assert.equal(ok.json.revision, 1);
        // Switching back rewrites nothing: alpha's ElevenLabs slot (none) and Gemini slot survive.
        const back = await call(h, 'PUT', '/tts/provider', { provider: 'elevenlabs' });
        assert.equal(back.status, 200);
        assert.equal(h.state.getProjectVoice('alpha', 'gemini').stored?.id, 'sulafat');
    }
    finally {
        await h.close();
    }
});
test('PUT /tts/provider: an invalid env default in use is refused; an unreachable voice API is reported, not refused', async () => {
    const badEnv = await harness({ config: cfg({ geminiApiKey: 'g' }), providers: { gemini: pcmGemini({ envDefaultVoice: () => ({ provider: 'gemini', id: 'bogus-voice', name: 'bogus-voice' }) }) } });
    try {
        const r = await call(badEnv, 'PUT', '/tts/provider', { provider: 'gemini' });
        assert.equal(r.status, 409);
        assert.match(r.json.refusals[0].reason, /GEMINI_TTS_VOICE=bogus-voice is not a Gemini voice/);
    }
    finally {
        await badEnv.close();
    }
    const down = await harness({ config: cfg({ geminiApiKey: 'g' }), providers: { gemini: pcmGemini({ getVoice: async (id) => { if (id === 'kore')
                    return { provider: 'gemini', voice_id: 'kore', name: 'Kore', category: 'studio', description: '', labels: {} }; throw new VoicesUnavailableError('down'); } }) } });
    try {
        down.state.setProjectVoice('alpha', { id: 'en-gb-advisor-10', name: 'Advisor', provider: 'gemini' });
        const r = await call(down, 'PUT', '/tts/provider', { provider: 'gemini' });
        assert.equal(r.status, 200);
        assert.deepEqual(r.json.unverified.map((u) => u.projectName), ['Alpha']);
    }
    finally {
        await down.close();
    }
    const noElDefault = await harness({
        config: cfg({ geminiApiKey: 'g', ttsProviderEnv: 'gemini' }),
        providers: { elevenlabs: fakeProvider('elevenlabs', { envDefaultVoice: () => null }), gemini: pcmGemini() },
    });
    try {
        const r = await call(noElDefault, 'PUT', '/tts/provider', { provider: 'elevenlabs' });
        assert.equal(r.status, 409);
        assert.equal(r.json.refusals.length, 2, 'both projects would have no ElevenLabs voice');
        assert.match(r.json.refusals[0].fix, /ELEVENLABS_VOICE_ID/);
    }
    finally {
        await noElDefault.close();
    }
});
test('PUT /projects/:id/voice: server-side id/name resolution per provider; stale picks get 409', async () => {
    const gemini = pcmGemini({ resolveVoiceValue: async (v) => ({ provider: 'gemini', id: v.toLowerCase(), name: v, kind: 'prebuilt' }) });
    const h = await harness({ config: cfg({ geminiApiKey: 'g' }), providers: { gemini } });
    try {
        const set = await call(h, 'PUT', '/projects/alpha/voice', { voice: 'Sulafat', provider: 'gemini' });
        assert.equal(set.status, 200, JSON.stringify(set.json));
        assert.equal(set.json.provider, 'gemini');
        assert.deepEqual(set.json.stored, { id: 'sulafat', name: 'Sulafat', kind: 'prebuilt' });
        assert.equal(h.state.getProjectVoice('alpha', 'elevenlabs').stored, null, 'the ElevenLabs slot is untouched');
        const missing = await call(h, 'PUT', '/projects/alpha/voice', { voiceId: 'voice_nope', provider: 'gemini' });
        assert.equal(missing.status, 404, 'an explicit Gemini id is checked');
        await call(h, 'PUT', '/tts/provider', { provider: 'gemini' }); // revision 0 → 1
        const stale = await call(h, 'PUT', '/projects/alpha/voice', { voice: 'Kore', provider: 'gemini', revision: 0 });
        assert.equal(stale.status, 409);
        assert.equal(stale.json.error, 'stale_provider');
        assert.equal(h.state.getProjectVoice('alpha', 'gemini').stored?.id, 'sulafat', 'nothing written');
    }
    finally {
        await h.close();
    }
});
test('PUT /projects/:id/voice: a provider switch during the awaited lookup is refused before the write', async () => {
    let h;
    const gemini = pcmGemini({
        resolveVoiceValue: async (v) => {
            h.state.setTtsProvider('elevenlabs'); // the switch lands while the lookup is in flight
            return { provider: 'gemini', id: v.toLowerCase(), name: v, kind: 'prebuilt' };
        },
    });
    h = await harness({ config: cfg({ geminiApiKey: 'g' }), providers: { gemini } });
    try {
        await call(h, 'PUT', '/tts/provider', { provider: 'gemini' });
        const r = await call(h, 'PUT', '/projects/alpha/voice', { voice: 'Sulafat' });
        assert.equal(r.status, 409, JSON.stringify(r.json));
        assert.equal(r.json.error, 'stale_provider');
        assert.equal(h.state.getProjectVoice('alpha', 'gemini').stored, null, 'nothing written to the Gemini slot');
        assert.equal(h.state.getProjectVoice('alpha', 'elevenlabs').stored, null, 'nor the ElevenLabs slot');
    }
    finally {
        await h.close();
    }
});
test('GET /tts/project-voices lists every project with its voice and source for the requested provider', async () => {
    const gemini = pcmGemini();
    const h = await harness({ config: cfg({ geminiApiKey: 'g' }), providers: { gemini } });
    try {
        h.state.setProjectVoice('alpha', { id: 'sulafat', name: 'Sulafat', provider: 'gemini' });
        const r = await call(h, 'GET', '/tts/project-voices?provider=gemini');
        assert.equal(r.status, 200, JSON.stringify(r.json));
        assert.equal(r.json.provider, 'gemini');
        assert.equal(typeof r.json.revision, 'number');
        const byId = Object.fromEntries(r.json.projects.map((p) => [p.projectId, p]));
        assert.deepEqual(Object.keys(byId).sort(), ['alpha', 'beta']);
        assert.equal(byId.alpha.name, 'Alpha');
        assert.equal(byId.alpha.source, 'project');
        assert.equal(byId.alpha.effective.name, 'Sulafat');
        assert.equal(byId.beta.source, 'builtin', 'no stored voice falls through to the built-in default');
        assert.equal(byId.beta.effective.id, 'kore');
        assert.deepEqual(r.json.installDefault, { voice: { id: 'kore', name: 'Kore' }, source: 'builtin' }, 'Gemini: no stored or env default → built-in');
        assert.equal('slots' in byId.alpha, false, 'compact rows');
        const el = await call(h, 'GET', '/tts/project-voices');
        assert.equal(el.json.provider, 'elevenlabs', 'defaults to the active provider');
        assert.equal(el.json.projects.find((p) => p.projectId === 'beta').source, 'env');
        assert.deepEqual(el.json.installDefault, { voice: { id: 'ENVVOICE', name: 'env default' }, source: 'env' });
    }
    finally {
        await h.close();
    }
});
test('POST /voices/preview renders the fixed sentence in that voice and returns mp3; ids checked; stale picks 409', async () => {
    const gemini = pcmGemini();
    const h = await harness({ config: cfg({ geminiApiKey: 'g' }), providers: { gemini } });
    const post = (body) => fetch(`${h.base}/voices/preview`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    try {
        const { VOICE_PREVIEW_TEXT } = await import('./routes.js');
        const ok = await post({ voiceId: 'kore', provider: 'gemini', revision: 0 });
        assert.equal(ok.status, 200);
        assert.equal(ok.headers.get('content-type'), 'audio/mpeg');
        assert.equal(ok.headers.get('x-voice-provider'), 'gemini');
        assert.ok((await ok.arrayBuffer()).byteLength > 0);
        assert.equal(gemini.renders.length, 1);
        assert.equal(gemini.renders[0].voiceId, 'kore');
        assert.equal(gemini.renders[0].chunk.text, VOICE_PREVIEW_TEXT);
        const again = await post({ voiceId: 'kore', provider: 'gemini', revision: 0 });
        assert.equal(again.status, 200);
        await again.arrayBuffer();
        assert.equal(gemini.renders.length, 1, 'a repeat preview is served from the chunk cache');
        const unknown = await post({ voiceId: 'nope', provider: 'gemini' });
        assert.equal(unknown.status, 404);
        assert.equal(gemini.renders.length, 1, 'an unknown Gemini id never reaches the provider');
        const missing = await post({ provider: 'gemini' });
        assert.equal(missing.status, 400);
        await call(h, 'PUT', '/tts/provider', { provider: 'gemini' }); // revision 0 → 1
        const stale = await post({ voiceId: 'sulafat', provider: 'gemini', revision: 0 });
        assert.equal(stale.status, 409);
        assert.equal((await stale.json()).error, 'stale_provider');
        assert.equal(gemini.renders.length, 1, 'a stale preview is not rendered');
        h.state.setProjectVoice('alpha', { id: 'sulafat', name: 'Sulafat', provider: 'gemini' });
        const staleReset = await call(h, 'DELETE', '/projects/alpha/voice?provider=gemini&revision=0');
        assert.equal(staleReset.status, 409, 'a reset from an old list is refused');
        assert.equal(h.state.getProjectVoice('alpha', 'gemini').stored?.id, 'sulafat');
        const reset = await call(h, 'DELETE', '/projects/alpha/voice?provider=gemini&revision=1');
        assert.equal(reset.status, 200);
        assert.equal(h.state.getProjectVoice('alpha', 'gemini').stored, null);
    }
    finally {
        await h.close();
    }
});
test('GET /voices/search forwards provider and filters', async () => {
    const seen = [];
    const gemini = pcmGemini({ searchVoices: async (q) => { seen.push(q); return []; } });
    const h = await harness({ config: cfg({ geminiApiKey: 'g' }), providers: { gemini } });
    try {
        const r = await call(h, 'GET', '/voices/search?provider=gemini&q=warm&gender=female&accent=sydney&language=en-AU&custom=1');
        assert.equal(r.status, 200);
        assert.equal(r.json.provider, 'gemini');
        assert.deepEqual(seen[0], { text: 'warm', gender: 'female', accent: 'sydney', language: 'en-AU', custom: true });
    }
    finally {
        await h.close();
    }
});
// --- Designed voices (feature 087 phase 4) --------------------------------------
const IN_A_YEAR = new Date(Date.now() + 365 * 86_400_000).toISOString();
function designGemini(over = {}) {
    const designs = [];
    const deleted = [];
    let n = 0;
    const gemini = pcmGemini({
        designVoice: async (req) => {
            designs.push(req);
            n++;
            return { id: `voice_new${n}`, name: req.name, expiresAt: IN_A_YEAR, model: 'gemini-3.8-flash-tts', sample: { kind: 'pcm', data: Buffer.alloc(4800, 2), sampleRate: 24000, channels: 1 } };
        },
        deleteVoice: async (id) => { deleted.push(id); return !id.endsWith('gone'); },
        remoteRecipe: async () => null,
        ...over,
    });
    return { gemini, designs, deleted };
}
const readStateFile = () => JSON.parse(fs.readFileSync(path.join(home, 'messaging-state.json'), 'utf-8'));
const recipe = (over = {}) => ({
    provider: 'gemini', name: 'Astronomer', description: 'a dry-witted stargazer', gender: 'female', language: 'en-AU',
    model: 'gemini-3.8-flash-tts', createdAt: '2025-10-01T00:00:00Z', expiresAt: '2026-10-01T00:00:00Z', ...over,
});
test('voice design: the recipe is persisted to disk with the voice, the sample saved, --set writes the project slot', async () => {
    const { gemini, designs } = designGemini();
    const h = await harness({ config: cfg({ geminiApiKey: 'g' }), providers: { gemini } });
    try {
        const r = await call(h, 'POST', '/voices/design', { description: 'a calm Scottish narrator', name: 'Isla', gender: 'female', language: 'en-GB', set: true, projectId: 'Alpha' });
        assert.equal(r.status, 200, JSON.stringify(r.json));
        assert.equal(r.json.voice.id, 'voice_new1');
        assert.equal(r.json.recipeSaved, true);
        assert.deepEqual(designs[0], { description: 'a calm Scottish narrator', name: 'Isla', gender: 'female', language: 'en-GB' });
        const saved = readStateFile().customVoices.voice_new1;
        assert.deepEqual({ ...saved, createdAt: 'x' }, { provider: 'gemini', type: 'prompted', name: 'Isla', description: 'a calm Scottish narrator', gender: 'female', language: 'en-GB', model: 'gemini-3.8-flash-tts', createdAt: 'x', expiresAt: IN_A_YEAR });
        assert.ok(r.json.samplePath.startsWith(path.join(home, 'data', 'generated-audio', 'voice-design')));
        assert.ok(r.json.samplePath.endsWith('isla.ogg'));
        assert.ok(fs.readFileSync(r.json.samplePath).subarray(0, 4).equals(Buffer.from('ogg:')));
        assert.deepEqual(h.state.getProjectVoice('alpha', 'gemini').stored, { id: 'voice_new1', name: 'Isla', kind: 'custom', expiresAt: IN_A_YEAR });
        assert.equal(h.state.getProjectVoice('alpha', 'elevenlabs').stored, null, 'only the Gemini slot');
        assert.equal(r.json.activeProvider, 'elevenlabs', 'design works whatever provider is active');
        const again = await call(h, 'POST', '/voices/design', { description: 'another', name: 'Isla' });
        assert.ok(again.json.samplePath.endsWith('isla-new2.ogg'), 'a second sample with the same name never overwrites the first');
    }
    finally {
        await h.close();
    }
});
test('voice design: a failed recipe save reports failure and deletes the new voice again', async () => {
    const { gemini, deleted } = designGemini();
    const h = await harness({ config: cfg({ geminiApiKey: 'g' }), providers: { gemini } });
    try {
        h.state.saveVoiceRecipe = () => { throw new Error('disk full'); };
        const r = await call(h, 'POST', '/voices/design', { description: 'd', name: 'Isla', set: true, projectId: 'alpha' });
        assert.equal(r.status, 500);
        assert.equal(r.json.error, 'persist_failed');
        assert.match(r.json.message, /disk full.*deleted again/);
        assert.deepEqual(deleted, ['voice_new1']);
        assert.equal(h.state.getProjectVoice('alpha', 'gemini').stored, null, 'nothing set');
        assert.equal(fs.existsSync(path.join(home, 'data', 'generated-audio', 'voice-design')), false, 'no sample written');
    }
    finally {
        await h.close();
    }
});
test('voice design: checks that cost nothing come first (project, inputs, key)', async () => {
    const { gemini, designs } = designGemini();
    const h = await harness({ config: cfg({ geminiApiKey: 'g' }), providers: { gemini } });
    try {
        assert.equal((await call(h, 'POST', '/voices/design', { description: 'd', name: 'N', set: true, projectId: 'nope' })).status, 404);
        assert.equal((await call(h, 'POST', '/voices/design', { description: 'd', name: 'N', set: true })).status, 404, '--set with no project or session');
        assert.equal((await call(h, 'POST', '/voices/design', { name: 'N' })).status, 400);
        assert.equal((await call(h, 'POST', '/voices/design', { description: 'd' })).status, 400);
        assert.equal((await call(h, 'POST', '/voices/design', { description: 'd', name: 'N', gender: 'robot' })).status, 400);
        assert.equal(designs.length, 0, 'no paid call for any of these');
    }
    finally {
        await h.close();
    }
    const nokey = await harness({ config: cfg({ geminiApiKey: '' }), providers: { gemini: designGemini({ isConfigured: () => false }).gemini } });
    try {
        const r = await call(nokey, 'POST', '/voices/design', { description: 'd', name: 'N' });
        assert.equal(r.status, 400);
        assert.match(r.json.message, /GEMINI_API_KEY/);
    }
    finally {
        await nokey.close();
    }
});
test('--recreate works from the local recipe after the voice was deleted remotely (stubbed 404); projects are not re-pointed', async () => {
    const remoteAsked = [];
    const { gemini, designs } = designGemini({ remoteRecipe: async (id) => { remoteAsked.push(id); return null; } });
    const h = await harness({ config: cfg({ geminiApiKey: 'g' }), providers: { gemini } });
    try {
        h.state.saveVoiceRecipe('voice_old', recipe({ deleted: true }));
        h.state.setProjectVoice('alpha', { id: 'voice_old', name: 'Astronomer', kind: 'custom', expiresAt: '2026-10-01T00:00:00Z', provider: 'gemini' });
        const r = await call(h, 'POST', '/voices/design', { recreate: 'voice_old' });
        assert.equal(r.status, 200, JSON.stringify(r.json));
        assert.deepEqual(designs[0], { description: 'a dry-witted stargazer', name: 'Astronomer', gender: 'female', language: 'en-AU' });
        assert.equal(remoteAsked.length, 0, 'the local recipe is used without asking Google');
        assert.equal(r.json.recreatedFrom, 'voice_old');
        assert.equal(r.json.recipeSource, 'local');
        assert.equal(h.state.getVoiceRecipe('voice_new1')?.recreatedFrom, 'voice_old');
        assert.equal(h.state.getVoiceRecipe('voice_old')?.replacedBy, 'voice_new1');
        assert.equal(h.state.getProjectVoice('alpha', 'gemini').stored?.id, 'voice_old', 'never re-pointed without --set');
    }
    finally {
        await h.close();
    }
});
test('--recreate without a local recipe: Google\'s recipe while the voice exists; else the new-description message', async () => {
    const { gemini, designs } = designGemini({
        remoteRecipe: async (id) => (id === 'voice_studio' ? { name: 'From AI Studio', description: 'a cheerful host', gender: 'male', language: 'en-US' } : null),
    });
    const h = await harness({ config: cfg({ geminiApiKey: 'g' }), providers: { gemini } });
    try {
        const remote = await call(h, 'POST', '/voices/design', { recreate: 'voice_studio', name: 'Host' });
        assert.equal(remote.status, 200, JSON.stringify(remote.json));
        assert.equal(remote.json.recipeSource, 'remote');
        assert.deepEqual(designs[0], { description: 'a cheerful host', name: 'Host', gender: 'male', language: 'en-US' });
        assert.equal(h.state.getVoiceRecipe('voice_new1')?.description, 'a cheerful host', 'now saved locally');
        const none = await call(h, 'POST', '/voices/design', { recreate: 'voice_unknown' });
        assert.equal(none.status, 404);
        assert.equal(none.json.error, 'no_recipe');
        assert.equal(none.json.message, 'No recipe for voice_unknown; run voice design "<description>" --name <name> to make a new voice.');
        assert.equal(designs.length, 1, 'no design call without a recipe');
    }
    finally {
        await h.close();
    }
});
test('voice delete: removes at Google, keeps the recipe marked deleted, names the projects still using it', async () => {
    const { gemini, deleted } = designGemini();
    const h = await harness({ config: cfg({ geminiApiKey: 'g' }), providers: { gemini } });
    try {
        h.state.saveVoiceRecipe('voice_old', recipe());
        h.state.setProjectVoice('beta', { id: 'voice_old', name: 'Astronomer', kind: 'custom', provider: 'gemini' });
        const r = await call(h, 'DELETE', '/voices/voice_old');
        assert.equal(r.status, 200, JSON.stringify(r.json));
        assert.deepEqual(deleted, ['voice_old']);
        assert.equal(r.json.recipeKept, true);
        assert.deepEqual(r.json.usedBy, ['Beta']);
        assert.match(r.json.fix, /--recreate voice_old/);
        const kept = readStateFile().customVoices.voice_old;
        assert.equal(kept.deleted, true);
        assert.equal(kept.description, 'a dry-witted stargazer');
        const gone = await call(h, 'DELETE', '/voices/voice_gone');
        assert.equal(gone.json.alreadyGone, true);
        assert.equal(gone.json.recipeKept, false);
        assert.equal((await call(h, 'DELETE', '/voices/kore')).status, 400, 'library and studio voices cannot be deleted');
    }
    finally {
        await h.close();
    }
});
test('render errors for an unusable designed voice suggest --recreate only when a recipe exists; no paid call when expired', async () => {
    const { gemini } = designGemini();
    const h = await harness({ config: cfg({ geminiApiKey: 'g', ttsProviderEnv: 'gemini' }), providers: { gemini } });
    try {
        h.state.saveVoiceRecipe('voice_old', recipe());
        h.state.setProjectVoice('alpha', { id: 'voice_old', name: 'Astronomer', kind: 'custom', expiresAt: '2026-01-01T00:00:00Z', provider: 'gemini' });
        h.state.setProjectVoice('beta', { id: 'voice_norecipe', name: 'Stray', kind: 'custom', expiresAt: '2026-01-01T00:00:00Z', provider: 'gemini' });
        const withRecipe = await call(h, 'POST', '/tts/generate', { text: 'hello there', projectId: 'alpha' });
        assert.equal(withRecipe.status, 410);
        assert.equal(withRecipe.json.error, 'voice_expired');
        assert.match(withRecipe.json.message, /custom voice 'Astronomer' \(voice_old\) expired on 2026-01-01\. To fix it, recreate .*--recreate voice_old/);
        const without = await call(h, 'POST', '/tts/generate', { text: 'hello there', projectId: 'beta' });
        assert.equal(without.status, 410);
        assert.doesNotMatch(without.json.message, /--recreate/);
        assert.match(without.json.message, /design a new one/);
        assert.equal(gemini.renders.length, 0, 'an expired voice never reaches the provider');
    }
    finally {
        await h.close();
    }
    // Deleted at Google (render 404): the route names the voice from its recipe.
    const { VoiceUnusableError } = await import('./errors.js');
    const gone = designGemini().gemini;
    gone.render = async (req) => { throw new VoiceUnusableError('missing', { id: req.voiceId, name: req.voiceId }, 'x'); };
    const h2 = await harness({ config: cfg({ geminiApiKey: 'g', ttsProviderEnv: 'gemini' }), providers: { gemini: gone } });
    try {
        h2.state.saveVoiceRecipe('voice_old', recipe());
        const r = await call(h2, 'POST', '/tts/generate', { text: 'hello there', voiceId: 'voice_old' });
        assert.equal(r.status, 404);
        assert.match(r.json.message, /custom voice 'Astronomer' \(voice_old\) no longer exists\. To fix it, recreate/);
    }
    finally {
        await h2.close();
    }
});
test('expiry warnings: voice show payload, health warnings (also the Telegram /voice header), voices --custom recipes', async () => {
    const soon = new Date(Date.now() + 12 * 86_400_000).toISOString();
    const { gemini } = designGemini({
        searchVoices: async (q) => (q.custom ? [{ provider: 'gemini', voice_id: 'voice_live', name: 'Live One', category: 'custom', description: '', labels: {}, expiresAt: soon }] : []),
    });
    const h = await harness({ config: cfg({ geminiApiKey: 'g', ttsProviderEnv: 'gemini' }), providers: { gemini } });
    try {
        h.state.saveVoiceRecipe('voice_live', recipe({ name: 'Live One', expiresAt: soon }));
        h.state.saveVoiceRecipe('voice_old', recipe({ deleted: true }));
        h.state.setProjectVoice('alpha', { id: 'voice_live', name: 'Live One', kind: 'custom', expiresAt: soon, provider: 'gemini' });
        const show = await call(h, 'GET', '/projects/alpha/voice');
        assert.equal(show.json.warnings.length, 1);
        assert.match(show.json.warnings[0], /^Project 'Alpha' voice 'Live One' \(voice_live\) expires on .* \(in 12 days\).*--recreate voice_live/);
        assert.deepEqual((await call(h, 'GET', '/projects/beta/voice')).json.warnings, []);
        const health = await call(h, 'GET', '/tts/provider');
        assert.ok(health.json.warnings.some((w) => /^Project 'Alpha' voice 'Live One'.*expires/.test(w)), JSON.stringify(health.json.warnings));
        const custom = await call(h, 'GET', '/voices/search?custom=1');
        assert.equal(custom.json.voices[0].recipe, true);
        assert.deepEqual(custom.json.recipes.map((r) => [r.voice_id, r.deleted]), [['voice_old', true]], 'recipes whose voice is gone are listed for --recreate');
    }
    finally {
        await h.close();
    }
});
// --- Fix loop (phases 3+4 review) ---------------------------------------------
test('search: the stamp is taken before the await; an unpinned search across a switch is 409; a pinned one keeps the old stamp', async () => {
    let h;
    let switchDuring = false;
    const gemini = pcmGemini({
        searchVoices: async () => {
            if (switchDuring)
                h.state.setTtsProvider(h.state.getTtsProviderChoice().provider === 'gemini' ? 'elevenlabs' : 'gemini');
            return [{ provider: 'gemini', voice_id: 'kore', name: 'Kore', category: 'studio', description: '', labels: {} }];
        },
    });
    h = await harness({ config: cfg({ geminiApiKey: 'g' }), providers: { gemini } });
    try {
        await call(h, 'PUT', '/tts/provider', { provider: 'gemini' }); // revision 1
        switchDuring = true;
        const unpinned = await call(h, 'GET', '/voices/search?q=k');
        assert.equal(unpinned.status, 409, JSON.stringify(unpinned.json));
        assert.equal(unpinned.json.error, 'stale_provider');
        const pinned = await call(h, 'GET', '/voices/search?q=k&provider=gemini'); // revision 2 → 3 during the await
        assert.equal(pinned.status, 200);
        assert.equal(pinned.json.revision, 2, 'stamped with the revision captured before the await');
    }
    finally {
        await h.close();
    }
});
test('preview: a switch during the voice lookup is refused before any render', async () => {
    let h;
    const gemini = pcmGemini({
        getVoice: async (id) => { h.state.setTtsProvider('elevenlabs'); return { provider: 'gemini', voice_id: id, name: id, category: 'studio', description: '', labels: {} }; },
    });
    h = await harness({ config: cfg({ geminiApiKey: 'g' }), providers: { gemini } });
    try {
        await call(h, 'PUT', '/tts/provider', { provider: 'gemini' }); // revision 1
        const res = await fetch(`${h.base}/voices/preview`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ voiceId: 'kore', provider: 'gemini', revision: 1 }) });
        assert.equal(res.status, 409);
        assert.equal((await res.json()).error, 'stale_provider');
        assert.equal(gemini.renders.length, 0, 'no paid render');
    }
    finally {
        await h.close();
    }
});
test('preview: a caller that hangs up during the voice lookup never triggers a render', async () => {
    let releaseLookup;
    let lookupStarted;
    const started = new Promise((r) => { lookupStarted = r; });
    const gemini = pcmGemini({
        getVoice: async (id) => {
            lookupStarted();
            await new Promise((r) => { releaseLookup = r; });
            return { provider: 'gemini', voice_id: id, name: id, category: 'studio', description: '', labels: {} };
        },
    });
    const h = await harness({ config: cfg({ geminiApiKey: 'g' }), providers: { gemini } });
    try {
        const ac = new AbortController();
        const req = fetch(`${h.base}/voices/preview`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ voiceId: 'kore', provider: 'gemini' }), signal: ac.signal }).catch(() => null);
        await started;
        ac.abort();
        await req;
        await new Promise((r) => setTimeout(r, 30)); // let the server see the close
        releaseLookup();
        await new Promise((r) => setTimeout(r, 30));
        assert.equal(gemini.renders.length, 0);
    }
    finally {
        await h.close();
    }
});
test('preview keeps a designed voice\'s expiry: an expired one is refused (410) without a render', async () => {
    const gemini = pcmGemini({
        getVoice: async (id) => ({ provider: 'gemini', voice_id: id, name: 'Old', category: 'custom', description: '', labels: {}, expiresAt: '2026-01-01T00:00:00Z' }),
    });
    const h = await harness({ config: cfg({ geminiApiKey: 'g' }), providers: { gemini } });
    try {
        const res = await fetch(`${h.base}/voices/preview`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ voiceId: 'voice_old', provider: 'gemini' }) });
        assert.equal(res.status, 410);
        assert.match((await res.json()).message, /custom voice 'Old' \(voice_old\) expired on 2026-01-01/);
        assert.equal(gemini.renders.length, 0);
    }
    finally {
        await h.close();
    }
});
test('voice design from the web: a stale list is refused before any paid call; the sample can come back as MP3', async () => {
    const { gemini, designs } = designGemini();
    const h = await harness({ config: cfg({ geminiApiKey: 'g' }), providers: { gemini } });
    try {
        await call(h, 'PUT', '/tts/provider', { provider: 'gemini' }); // revision 1
        const stale = await call(h, 'POST', '/voices/design', { description: 'warm', name: 'Isla', revision: 0, returnSample: 'mp3' });
        assert.equal(stale.status, 409);
        assert.equal(stale.json.error, 'stale_provider');
        assert.equal(designs.length, 0, 'no paid call for a stale list');
        const ok = await call(h, 'POST', '/voices/design', { description: 'warm', name: 'Isla', revision: 1, returnSample: 'mp3' });
        assert.equal(ok.status, 200, JSON.stringify(ok.json));
        assert.equal(ok.json.sample.contentType, 'audio/mpeg');
        assert.ok(Buffer.from(ok.json.sample.data, 'base64').subarray(0, 4).equals(Buffer.from('mp3:')), 'encoded with the injected encoder as mp3');
        assert.equal(h.state.getVoiceRecipe(ok.json.voice.id)?.name, 'Isla', 'recipe saved as for the CLI');
        const cli = await call(h, 'POST', '/voices/design', { description: 'warm', name: 'Isla' });
        assert.equal(cli.json.sample, null, 'the CLI gets a file path, not inline audio');
    }
    finally {
        await h.close();
    }
});
// --- Voice cloning (#0376) ------------------------------------------------------
/** A 16-bit mono WAV of `seconds` (24 kHz unless given), filled with a quiet tone-ish pattern. */
function wav(seconds, opts = {}) {
    const rate = opts.rate ?? 24000;
    const channels = opts.channels ?? 1;
    const data = Buffer.alloc(Math.round(rate * seconds) * 2 * channels);
    for (let i = 0; i < data.length; i += 2)
        data.writeInt16LE((i % 200) - 100, i);
    const head = Buffer.alloc(44);
    head.write('RIFF', 0);
    head.writeUInt32LE(36 + data.length, 4);
    head.write('WAVE', 8);
    head.write('fmt ', 12);
    head.writeUInt32LE(16, 16);
    head.writeUInt16LE(1, 20);
    head.writeUInt16LE(channels, 22);
    head.writeUInt32LE(rate, 24);
    head.writeUInt32LE(rate * 2 * channels, 28);
    head.writeUInt16LE(2 * channels, 32);
    head.writeUInt16LE(16, 34);
    head.write('data', 36);
    head.writeUInt32LE(data.length, 40);
    return Buffer.concat([head, data]);
}
const b64 = (b) => b.toString('base64');
function cloneGemini(over = {}) {
    const clones = [];
    let n = 0;
    const base = designGemini({
        cloneVoice: async (req) => {
            // Copy: the route zeroes the recordings once the call returns.
            clones.push({ name: req.name, sample: Buffer.from(req.sample), consent: Buffer.from(req.consent) });
            n++;
            return { id: `voice_clone${n}`, name: req.name, expiresAt: IN_A_YEAR, model: 'gemini-3.8-flash-tts', sample: null };
        },
        ...over,
    });
    return { ...base, clones };
}
test('voice clone: every free check refuses before any paid call', async () => {
    const { gemini, clones } = cloneGemini();
    const keyless = cloneGemini({ isConfigured: () => false });
    const noKey = await harness({ config: cfg(), providers: { gemini: keyless.gemini } });
    try {
        const r = await call(noKey, 'POST', '/voices/clone', { name: 'Greg', sample: b64(wav(12)), consent: b64(wav(6)) });
        assert.equal(r.json.error, 'tts_unconfigured');
        assert.match(r.json.message, /^Voice cloning needs GEMINI_API_KEY/);
    }
    finally {
        await noKey.close();
    }
    const h = await harness({ config: cfg({ geminiApiKey: 'g' }), providers: { gemini } });
    try {
        const ok = { name: 'Greg', locale: 'en-AU', sample: b64(wav(12)), consent: b64(wav(6)) };
        const cases = [
            [{ ...ok, name: '' }, 400, 'bad_request', /name/],
            [{ ...ok, locale: 'xx-YY' }, 400, 'bad_request', /consent language/],
            [{ ...ok, sample: undefined }, 400, 'missing_recording', /voice sample is missing/],
            [{ ...ok, consent: undefined }, 400, 'missing_recording', /consent recording is missing/],
            [{ ...ok, sample: b64(Buffer.from('not a wav at all')) }, 400, 'bad_recording', /isn't a usable WAV/],
            [{ ...ok, sample: b64(wav(12, { channels: 2 })) }, 400, 'bad_recording', /mono/],
            [{ ...ok, sample: b64(wav(7)) }, 400, 'bad_recording', /7 s; Google needs 10–30 s/],
            [{ ...ok, sample: b64(wav(31)) }, 400, 'bad_recording', /31 s/],
            [{ ...ok, consent: b64(wav(2)) }, 400, 'bad_recording', /consent recording is 2 s; Google needs 3–20 s/],
            [{ ...ok, set: true, projectId: 'nope' }, 404, 'unknown_project', /Unknown project/],
            [{ ...ok, recreate: 'voice_unknown' }, 404, 'no_recipe', /No saved details/],
        ];
        for (const [body, status, error, message] of cases) {
            const r = await call(h, 'POST', '/voices/clone', body);
            assert.equal(r.status, status, `${error}: ${JSON.stringify(r.json)}`);
            assert.equal(r.json.error, error);
            assert.match(r.json.message, message);
        }
        assert.equal(clones.length, 0, 'no paid call for any of these');
    }
    finally {
        await h.close();
    }
});
test('voice clone: a 3 MB upload goes through, the recipe keeps no recordings, --set writes the slot; other routes stay at 16 KB', async () => {
    const { gemini, clones } = cloneGemini();
    const h = await harness({ config: cfg({ geminiApiKey: 'g' }), providers: { gemini } });
    try {
        const sample = wav(30);
        const consent = wav(20);
        const r = await call(h, 'POST', '/voices/clone', { name: 'Greg', locale: 'en-au', sample: b64(sample), consent: b64(consent), set: true, projectId: 'Alpha' });
        assert.equal(r.status, 200, JSON.stringify(r.json));
        assert.ok(b64(sample).length + b64(consent).length > 3_000_000, 'the body really was over 3 MB');
        assert.equal(r.json.voice.id, 'voice_clone1');
        assert.equal(r.json.type, 'replicated');
        assert.equal(r.json.recordingsKept, false);
        assert.equal(r.json.samplePath, null);
        assert.deepEqual(r.json.warnings, [], 'no sample is not a warning for a clone');
        assert.ok(clones[0].sample.equals(sample) && clones[0].consent.equals(consent), 'the recordings reach Google unchanged');
        const raw = fs.readFileSync(path.join(home, 'messaging-state.json'), 'utf-8');
        const saved = JSON.parse(raw).customVoices.voice_clone1;
        assert.deepEqual({ ...saved, createdAt: 'x' }, { provider: 'gemini', type: 'replicated', name: 'Greg', description: '', locale: 'en-AU', model: 'gemini-3.8-flash-tts', createdAt: 'x', expiresAt: IN_A_YEAR });
        assert.ok(!raw.includes(b64(sample).slice(0, 64)), 'no recording in the state file');
        assert.equal(fs.existsSync(path.join(home, 'data')), false, 'nothing written under data/');
        assert.deepEqual(h.state.getProjectVoice('alpha', 'gemini').stored, { id: 'voice_clone1', name: 'Greg', kind: 'custom', expiresAt: IN_A_YEAR });
        const big = await call(h, 'POST', '/voices/design', { description: 'x'.repeat(3_000_000), name: 'Big' });
        assert.equal(big.status, 413, 'the design route keeps the service-wide 16 KB limit');
        const huge = await fetch(`${h.base}/voices/clone`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'G', sample: 'A'.repeat(7_000_000) }) });
        assert.equal(huge.status, 413);
        assert.equal((await huge.json()).error, 'too_large', 'a JSON answer, not an HTML error page');
    }
    finally {
        await h.close();
    }
});
test('voice clone: --recreate takes the old name and locale and links the two; design --recreate refuses a clone', async () => {
    const { gemini, clones, designs } = cloneGemini();
    const h = await harness({ config: cfg({ geminiApiKey: 'g' }), providers: { gemini } });
    try {
        h.state.saveVoiceRecipe('voice_old', { ...recipe({ name: 'Greg', description: '', gender: undefined, language: undefined }), type: 'replicated', locale: 'en-GB' });
        const viaDesign = await call(h, 'POST', '/voices/design', { recreate: 'voice_old' });
        assert.equal(viaDesign.status, 409);
        assert.equal(viaDesign.json.error, 'cloned_voice');
        assert.match(viaDesign.json.message, /recordings aren't kept.*voice clone/);
        assert.equal(designs.length, 0);
        const r = await call(h, 'POST', '/voices/clone', { recreate: 'voice_old', sample: b64(wav(15)), consent: b64(wav(6)) });
        assert.equal(r.status, 200, JSON.stringify(r.json));
        assert.equal(clones[0].name, 'Greg');
        assert.equal(r.json.recreatedFrom, 'voice_old');
        const state = readStateFile().customVoices;
        assert.equal(state.voice_old.replacedBy, 'voice_clone1');
        assert.equal(state.voice_clone1.recreatedFrom, 'voice_old');
        assert.equal(state.voice_clone1.locale, 'en-GB');
        h.state.saveVoiceRecipe('voice_designed', recipe());
        const wrongKind = await call(h, 'POST', '/voices/clone', { recreate: 'voice_designed', sample: b64(wav(15)), consent: b64(wav(6)) });
        assert.equal(wrongKind.json.error, 'designed_voice');
    }
    finally {
        await h.close();
    }
});
test('voice clone: Google refusals pass through with their own codes; delete names the clone fix', async () => {
    const { TtsProviderError: Err } = await import('./errors.js');
    const { gemini } = cloneGemini({ cloneVoice: async () => { throw new Err('clone_consent_failed', "Google couldn't confirm the consent recording (The recorded phrase didn't match the text on screen). Record both again…", 422); } });
    const h = await harness({ config: cfg({ geminiApiKey: 'g' }), providers: { gemini } });
    try {
        const r = await call(h, 'POST', '/voices/clone', { name: 'Greg', sample: b64(wav(12)), consent: b64(wav(6)) });
        assert.equal(r.status, 422);
        assert.equal(r.json.error, 'clone_consent_failed');
        assert.deepEqual(Object.keys(readStateFile().customVoices ?? {}), [], 'no recipe for a refused clone');
        h.state.saveVoiceRecipe('voice_c1', { ...recipe({ name: 'Greg', description: '' }), type: 'replicated', locale: 'en-AU' });
        h.state.setProjectVoice('alpha', { id: 'voice_c1', name: 'Greg', kind: 'custom', provider: 'gemini' });
        const del = await call(h, 'DELETE', '/voices/voice_c1');
        assert.equal(del.status, 200);
        assert.equal(del.json.type, 'replicated');
        assert.match(del.json.fix, /clone it again from new recordings/);
        assert.doesNotMatch(del.json.fix, /voice design --recreate/);
    }
    finally {
        await h.close();
    }
});
// --- Install default from the web picker (#0376) ---------------------------------
test('PUT /tts/default-voice sets what projects without their own voice inherit; own voices untouched; stale and unknown refused', async () => {
    const gemini = pcmGemini();
    const h = await harness({ config: cfg({ geminiApiKey: 'g', ttsProviderEnv: 'gemini' }), providers: { gemini } });
    try {
        h.state.setProjectVoice('alpha', { id: 'kore', name: 'Kore', provider: 'gemini' });
        const ok = await call(h, 'PUT', '/tts/default-voice', { voiceId: 'sulafat', voiceName: 'sulafat', provider: 'gemini', revision: 0 });
        assert.equal(ok.status, 200, JSON.stringify(ok.json));
        assert.deepEqual(ok.json.installDefault, { voice: { id: 'sulafat', name: 'sulafat' }, source: 'state' });
        assert.deepEqual(ok.json.effective, { id: 'sulafat', name: 'sulafat' });
        const list = await call(h, 'GET', '/tts/project-voices?provider=gemini');
        const byId = Object.fromEntries(list.json.projects.map((p) => [p.projectId, p]));
        assert.deepEqual(list.json.installDefault, { voice: { id: 'sulafat', name: 'sulafat' }, source: 'state' });
        assert.equal(byId.alpha.effective.id, 'kore', "a project's own voice is untouched");
        assert.equal(byId.alpha.source, 'project');
        assert.equal(readStateFile().defaultVoices.gemini.id, 'sulafat', 'persisted');
        const unknown = await call(h, 'PUT', '/tts/default-voice', { voiceId: 'no-such-voice', provider: 'gemini', revision: 0 });
        assert.equal(unknown.status, 404);
        assert.equal(unknown.json.error, 'voice_not_found');
        const bad = await call(h, 'PUT', '/tts/default-voice', { provider: 'gemini', revision: 0 });
        assert.equal(bad.status, 400);
        await call(h, 'PUT', '/tts/provider', { provider: 'gemini' }); // revision 0 → 1
        const stale = await call(h, 'PUT', '/tts/default-voice', { voiceId: 'kore', provider: 'gemini', revision: 0 });
        assert.equal(stale.status, 409);
        assert.equal(stale.json.error, 'stale_provider');
        assert.equal(readStateFile().defaultVoices.gemini.id, 'sulafat', 'a stale pick changes nothing');
    }
    finally {
        await h.close();
    }
});
//# sourceMappingURL=routes.test.js.map