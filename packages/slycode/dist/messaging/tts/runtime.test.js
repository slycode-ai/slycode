import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { TtsProviderError } from './errors.js';
import { voiceTextLimitError } from '../tts.js';
let home;
const originalHome = process.env.SLYCODE_HOME;
function cfg(over = {}) {
    return {
        sttBackend: 'openai', openaiApiKey: '', whisperCliPath: '', whisperModelPath: '', awsTranscribeRegion: '',
        awsTranscribeLanguage: 'en-AU', awsTranscribeS3Bucket: '', elevenlabsApiKey: 'xi', elevenlabsVoiceId: '',
        elevenlabsSpeed: 1, geminiApiKey: '', geminiTtsModel: 'gemini-3.8-flash-tts', geminiTtsVoice: '', ttsProviderEnv: '', ttsSpeed: 1, geminiTtsLanguage: 'en', ...over,
    };
}
async function runtime(config) {
    const stateMod = await import(`../state.js?t=${Date.now()}-${Math.random()}`);
    const { TtsRuntime } = await import('./runtime.js');
    const state = new stateMod.StateManager();
    return { state, tts: new TtsRuntime(config, state) };
}
beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'tts-runtime-test-'));
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
test('an existing ElevenLabs install resolves to ElevenLabs and reads its project voice', async () => {
    const { state, tts } = await runtime(cfg({ elevenlabsVoiceId: 'ENVVOICE' }));
    state.setProjectVoice('alpha', { id: 'ALPHA', name: 'Alpha Voice' });
    const provider = tts.requireActive();
    assert.equal(provider.id, 'elevenlabs');
    assert.deepEqual(tts.voiceForContext(provider, { session: 'alpha:claude:card:card-1' }), { voice: { provider: 'elevenlabs', id: 'ALPHA', name: 'Alpha Voice' }, source: 'project' });
    assert.deepEqual(tts.voiceForContext(provider, { session: 'beta:claude:global' }), { voice: { provider: 'elevenlabs', id: 'ENVVOICE', name: 'env default' }, source: 'env' });
    assert.equal(tts.voiceForContext(provider, { projectId: 'alpha' }, 'EXPLICIT').source, 'explicit');
});
test('health integrates state: no install default and a voiceless project → ready with a warning naming it', async () => {
    const { state, tts } = await runtime(cfg());
    state.setProjectVoice('alpha', { id: 'ALPHA', name: 'Alpha Voice' });
    const h = tts.health();
    assert.equal(h.ready, true);
    assert.equal(h.warnings.length, 1);
    assert.match(h.warnings[0], /1 project has no ElevenLabs voice.*\(Beta\)/);
    assert.throws(() => tts.voiceForContext(tts.requireActive(), { projectId: 'beta' }), (e) => e instanceof TtsProviderError && e.code === 'no_voice');
});
test('requireActive carries the health reason; providerFor refuses unknown and unavailable providers', async () => {
    const { tts } = await runtime(cfg({ elevenlabsApiKey: '' }));
    assert.throws(() => tts.requireActive(), (e) => e instanceof TtsProviderError && e.code === 'tts_unconfigured' && /ELEVENLABS_API_KEY/.test(e.message));
    assert.throws(() => tts.providerFor('nope'), (e) => e instanceof TtsProviderError && e.code === 'bad_request');
    assert.equal(tts.providerFor('gemini').id, 'gemini', 'Gemini is in the build (phase 2)');
    assert.equal(tts.providerFor(undefined).id, 'elevenlabs');
});
test('an unrecognised TTS_PROVIDER is reported for the startup log and otherwise ignored', async () => {
    const { tts } = await runtime(cfg({ ttsProviderEnv: 'elevenlab' }));
    assert.equal(tts.invalidProviderEnv(), 'elevenlab');
    assert.equal(tts.active().id, 'elevenlabs');
    assert.equal(tts.active().source, 'auto');
});
test('/voice cap: over-long Telegram replies get a clear refusal (feature 087)', () => {
    assert.equal(voiceTextLimitError('x'.repeat(5000), 5000), null);
    assert.match(voiceTextLimitError('x'.repeat(5001), 5000), /^Telegram voice reply too long: 5001 characters \(fixed limit 5000; the browser word limit in Voice Settings does not apply here\)/);
    assert.equal(voiceTextLimitError(undefined, 10), null);
});
//# sourceMappingURL=runtime.test.js.map