/**
 * ElevenLabs byte-identity goldens (feature 087, phase 1).
 *
 * The expected requests below were CAPTURED from the pre-refactor code
 * (messaging/src/tts.ts at 36f93e0) and must never be edited to make a test
 * pass: they are the proof that the provider refactor sends ElevenLabs exactly
 * what it sent before. Only the `via*` adapters may change, to call the
 * current render path.
 */
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { textToSpeech } from '../tts.js';
import { SpeechRenderer } from '../tts-render.js';
import { createTtsProviders } from './provider.js';
const baseConfig = {
    sttBackend: 'openai',
    openaiApiKey: '',
    whisperCliPath: '',
    whisperModelPath: '',
    awsTranscribeRegion: '',
    awsTranscribeLanguage: 'en-AU',
    awsTranscribeS3Bucket: '',
    elevenlabsApiKey: 'xi-test-key',
    elevenlabsVoiceId: 'ENVVOICE000000000000',
    elevenlabsSpeed: 1.0,
    geminiApiKey: '',
    geminiTtsModel: 'gemini-3.8-flash-tts',
    geminiTtsVoice: '',
    ttsProviderEnv: '',
    ttsSpeed: 1,
    geminiTtsLanguage: 'en',
};
const HEADERS = { 'Content-Type': 'application/json', 'xi-api-key': 'xi-test-key', 'Accept': 'audio/mpeg' };
const MP3_BYTES = Buffer.from([0xff, 0xf3, 0x84, 1, 2, 3]);
const GOLDENS = [
    {
        name: 'plain text, env default voice',
        text: 'Tests pass, one thing left to check on the modal.',
        speed: 1.0,
        expected: {
            url: 'https://api.elevenlabs.io/v1/text-to-speech/ENVVOICE000000000000',
            body: '{"text":"Tests pass, one thing left to check on the modal.","model_id":"eleven_v3","voice_settings":{"stability":0.5,"similarity_boost":0.75,"speed":1},"output_format":"mp3_44100_128"}',
        },
    },
    {
        name: 'skill-style tags, explicit project voice',
        text: "[excited] Good news, the build passed on the first try! [laughs] [pause] [whispers] Don't tell the tests I was surprised. [calm] Anyway, one thing left: the preview button.",
        voiceId: 'FGY2WhTYpPnrIDTdsKH5',
        speed: 1.0,
        expected: {
            url: 'https://api.elevenlabs.io/v1/text-to-speech/FGY2WhTYpPnrIDTdsKH5',
            body: "{\"text\":\"[excited] Good news, the build passed on the first try! [laughs] [pause] [whispers] Don't tell the tests I was surprised. [calm] Anyway, one thing left: the preview button.\",\"model_id\":\"eleven_v3\",\"voice_settings\":{\"stability\":0.5,\"similarity_boost\":0.75,\"speed\":1},\"output_format\":\"mp3_44100_128\"}",
        },
    },
    {
        name: 'multi-word, unknown, angle and [normal] tags, newline, quotes, unicode, non-default speed',
        text: '[serious tone] Right. [continues after a beat] The migration failed. [stress on next word] Three tests broke. [short pause] <laugh> [normal] Done.\nNew line "quoted" — café ünïcode 日本語.',
        voiceId: 'OVERRIDE000000000000',
        speed: 1.15,
        expected: {
            url: 'https://api.elevenlabs.io/v1/text-to-speech/OVERRIDE000000000000',
            body: '{"text":"[serious tone] Right. [continues after a beat] The migration failed. [stress on next word] Three tests broke. [short pause] <laugh> [normal] Done.\\nNew line \\"quoted\\" — café ünïcode 日本語.","model_id":"eleven_v3","voice_settings":{"stability":0.5,"similarity_boost":0.75,"speed":1.15},"output_format":"mp3_44100_128"}',
        },
    },
];
function recorder() {
    const calls = [];
    const fetchImpl = (async (url, init) => {
        calls.push({ url, method: init?.method, headers: init?.headers, body: init?.body });
        return new Response(new Uint8Array(MP3_BYTES), { status: 200 });
    });
    return { fetchImpl, calls };
}
const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });
// --- adapters: the only part allowed to change across the refactor ---------
/** Direct ElevenLabs call (legacy entry point, kept as a thin re-export). */
async function viaTextToSpeech(g) {
    const rec = recorder();
    const out = await textToSpeech(g.text, { ...baseConfig, elevenlabsSpeed: g.speed }, g.voiceId, { fetchImpl: rec.fetchImpl });
    return { calls: rec.calls, out };
}
/** The full render pipeline (admission snapshot → provider → encode) as /tts/render and /voice use it. */
async function viaPipeline(g, format) {
    const rec = recorder();
    globalThis.fetch = rec.fetchImpl;
    const config = { ...baseConfig, elevenlabsSpeed: g.speed };
    const providers = createTtsProviders(config);
    const renderer = new SpeechRenderer();
    const voice = { provider: 'elevenlabs', id: g.voiceId ?? config.elevenlabsVoiceId, name: 'v' };
    const res = await renderer.renderSpeech({ provider: providers.elevenlabs, providerRevision: 0, voice, text: g.text, format, timeoutMs: 5000 });
    return { calls: rec.calls, out: res.buffer };
}
// ---------------------------------------------------------------------------
for (const g of GOLDENS) {
    test(`golden (direct): ${g.name}`, async () => {
        const { calls, out } = await viaTextToSpeech(g);
        assert.equal(calls.length, 1);
        assert.equal(calls[0].url, g.expected.url);
        assert.equal(calls[0].method, 'POST');
        assert.deepEqual(calls[0].headers, HEADERS);
        assert.equal(calls[0].body, g.expected.body, 'request body must be byte-identical to the pre-refactor capture');
        assert.ok(out.equals(MP3_BYTES), 'MP3 bytes are returned untouched');
    });
    test(`golden (pipeline, mp3): ${g.name}`, async () => {
        const { calls, out } = await viaPipeline(g, 'mp3');
        assert.equal(calls.length, 1);
        assert.equal(calls[0].url, g.expected.url);
        assert.equal(calls[0].method, 'POST');
        assert.deepEqual(calls[0].headers, HEADERS);
        assert.equal(calls[0].body, g.expected.body, 'request body must be byte-identical to the pre-refactor capture');
        assert.ok(out.equals(MP3_BYTES), 'MP3 output is the provider bytes, untouched (zero transcode)');
    });
}
//# sourceMappingURL=elevenlabs.golden.test.js.map