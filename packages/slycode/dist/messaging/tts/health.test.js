import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSpeechHealth } from './health.js';
import { createTtsProviders, resolveActiveProvider, resolveVoice, parseProviderEnv } from './provider.js';
import { TtsProviderError } from './errors.js';
const here = path.dirname(fileURLToPath(import.meta.url));
function cfg(over = {}) {
    return {
        sttBackend: 'openai', openaiApiKey: '', whisperCliPath: '', whisperModelPath: '', awsTranscribeRegion: '',
        awsTranscribeLanguage: 'en-AU', awsTranscribeS3Bucket: '', elevenlabsApiKey: 'xi', elevenlabsVoiceId: '',
        elevenlabsSpeed: 1, geminiApiKey: '', geminiTtsModel: 'gemini-3.8-flash-tts', geminiTtsVoice: '', ttsProviderEnv: '', ttsSpeed: 1, geminiTtsLanguage: 'en', ...over,
    };
}
function health(config, opts = {}) {
    const registry = createTtsProviders(config);
    return buildSpeechHealth({
        active: resolveActiveProvider(opts.stored ?? null, config, registry),
        registry, config, revision: 4,
        storedDefault: (p) => opts.defaults?.[p] ?? null,
        projectsWithoutVoice: () => opts.missing ?? [],
    });
}
test('provider resolution: state switch → TTS_PROVIDER → auto (existing installs stay on ElevenLabs)', () => {
    const reg = createTtsProviders(cfg());
    assert.deepEqual(pick(resolveActiveProvider(null, cfg(), reg)), ['elevenlabs', 'auto', true]);
    assert.deepEqual(pick(resolveActiveProvider(null, cfg({ ttsProviderEnv: 'Gemini' }), reg)), ['gemini', 'env', true]);
    assert.deepEqual(pick(resolveActiveProvider('elevenlabs', cfg({ ttsProviderEnv: 'gemini' }), reg)), ['elevenlabs', 'state', true]);
    assert.deepEqual(pick(resolveActiveProvider(null, cfg({ elevenlabsApiKey: '', geminiApiKey: 'g' }), reg)), ['gemini', 'auto', true]);
    assert.deepEqual(pick(resolveActiveProvider(null, cfg({ elevenlabsApiKey: '' }), reg)), ['elevenlabs', 'auto', true]);
    assert.equal(parseProviderEnv('nonsense'), null);
    function pick(a) { return [a.id, a.source, a.provider !== null]; }
});
test('voice resolution: explicit → slot → env → built-in; only EMPTY steps fall through', () => {
    const el = createTtsProviders(cfg({ elevenlabsVoiceId: 'ENV' })).elevenlabs;
    assert.deepEqual(resolveVoice(el, { explicit: 'X', slot: { voice: { id: 'P', name: 'P' }, source: 'project' } }), { voice: { provider: 'elevenlabs', id: 'X', name: 'X' }, source: 'explicit' });
    assert.deepEqual(resolveVoice(el, { slot: { voice: { id: 'P', name: 'Pee' }, source: 'project' } }), { voice: { provider: 'elevenlabs', id: 'P', name: 'Pee' }, source: 'project' });
    assert.deepEqual(resolveVoice(el, { slot: { voice: { id: 'D', name: 'Dee' }, source: 'inherited' } }).source, 'inherited');
    assert.deepEqual(resolveVoice(el, { slot: { voice: null, source: null } }), { voice: { provider: 'elevenlabs', id: 'ENV', name: 'env default' }, source: 'env' });
    const bare = createTtsProviders(cfg()).elevenlabs;
    assert.throws(() => resolveVoice(bare, { slot: { voice: null, source: null } }), (e) => e instanceof TtsProviderError && e.code === 'no_voice' && /ELEVENLABS_VOICE_ID/.test(e.message));
});
test('ready with a key even without an install default; voice gaps are warnings naming the projects', () => {
    const h = health(cfg(), { missing: ['Alpha', 'Beta'] });
    assert.equal(h.ready, true);
    assert.equal(h.reason, null);
    assert.equal(h.provider, 'elevenlabs');
    assert.equal(h.providerSource, 'auto');
    assert.equal(h.revision, 4);
    assert.equal(h.warnings.length, 1);
    assert.match(h.warnings[0], /2 projects have no ElevenLabs voice.*Alpha, Beta/);
    assert.deepEqual(health(cfg(), { missing: [] }).warnings, []);
    assert.deepEqual(health(cfg({ elevenlabsVoiceId: 'E' }), { missing: ['Alpha'] }).warnings, [], 'an env default covers every project');
});
test('per-provider status: configured = key present, available = in this build, default voice + source', () => {
    const h = health(cfg({ elevenlabsVoiceId: 'E', geminiApiKey: 'g' }), { defaults: { elevenlabs: { id: 'S', name: 'Stored' } } });
    assert.deepEqual(h.providers.elevenlabs, { configured: true, available: true, defaultVoice: { id: 'S', name: 'Stored' }, defaultVoiceSource: 'state' });
    assert.deepEqual(h.providers.gemini, { configured: true, available: true, defaultVoice: { id: 'en-us-zuri', name: 'Zuri' }, defaultVoiceSource: 'builtin' });
});
test('not ready: missing key names the key; an unavailable provider says so', () => {
    const noKey = health(cfg({ elevenlabsApiKey: '' }));
    assert.equal(noKey.ready, false);
    assert.equal(noKey.reason?.code, 'no_key');
    assert.match(noKey.reason.message, /ELEVENLABS_API_KEY is not set/);
    const gemNoKey = health(cfg({ ttsProviderEnv: 'gemini' }));
    assert.equal(gemNoKey.provider, 'gemini');
    assert.equal(gemNoKey.reason?.code, 'no_key');
    assert.match(gemNoKey.reason.message, /GEMINI_API_KEY is not set/);
    assert.equal(health(cfg({ ttsProviderEnv: 'gemini', geminiApiKey: 'g' })).ready, true);
    // A provider missing from the build (e.g. an older registry) still reports provider_unavailable.
    const config = cfg({ ttsProviderEnv: 'gemini', geminiApiKey: 'g' });
    const registry = { elevenlabs: createTtsProviders(config).elevenlabs };
    const h = buildSpeechHealth({ active: resolveActiveProvider(null, config, registry), registry, config, revision: 0, storedDefault: () => null, projectsWithoutVoice: () => [] });
    assert.equal(h.reason?.code, 'provider_unavailable');
});
test('a Gemini install whose encoders failed to load is not ready, with the reason', () => {
    const config = cfg({ ttsProviderEnv: 'gemini', geminiApiKey: 'g' });
    const registry = createTtsProviders(config);
    const h = buildSpeechHealth({ active: resolveActiveProvider(null, config, registry), registry, config, revision: 0, storedDefault: () => null, projectsWithoutVoice: () => [], encoder: { state: 'failed', error: 'module not found' } });
    assert.equal(h.ready, false);
    assert.equal(h.reason?.code, 'encoder_unavailable');
    assert.match(h.reason.message, /module not found/);
    const el = buildSpeechHealth({ active: resolveActiveProvider(null, cfg(), createTtsProviders(cfg())), registry: createTtsProviders(cfg()), config: cfg(), revision: 0, storedDefault: () => null, projectsWithoutVoice: () => [], encoder: { state: 'failed' } });
    assert.equal(el.ready, true, 'ElevenLabs does not need the WASM encoders');
});
test('LOCKSTEP: the DTO block is byte-identical in messaging, bridge and web', () => {
    const block = (file) => {
        const src = fs.readFileSync(file, 'utf8');
        const start = src.indexOf('// --- DTO (LOCKSTEP');
        const end = src.indexOf('// --- end DTO ---');
        assert.ok(start >= 0 && end > start, `markers missing in ${file}`);
        return src.slice(start, end);
    };
    const mine = block(path.join(here, 'health.ts'));
    assert.equal(block(path.resolve(here, '../../../bridge/src/speech-health.ts')), mine);
    assert.equal(block(path.resolve(here, '../../../web/src/lib/speech-health.ts')), mine);
});
//# sourceMappingURL=health.test.js.map