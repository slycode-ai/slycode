import { ElevenLabsProvider } from './elevenlabs.js';
import { GeminiProvider } from './gemini.js';
import { TtsProviderError } from './errors.js';
export const TTS_PROVIDER_IDS = ['elevenlabs', 'gemini'];
export const PROVIDER_LABELS = { elevenlabs: 'ElevenLabs', gemini: 'Gemini' };
export const PROVIDER_KEY_ENV = { elevenlabs: 'ELEVENLABS_API_KEY', gemini: 'GEMINI_API_KEY' };
export const PROVIDER_VOICE_ENV = { elevenlabs: 'ELEVENLABS_VOICE_ID', gemini: 'GEMINI_TTS_VOICE' };
export function isTtsProviderId(v) {
    return typeof v === 'string' && TTS_PROVIDER_IDS.includes(v);
}
export { VoiceLookupError } from './errors.js';
export { TtsProviderError, VoicesUnavailableError } from './errors.js';
/** Build the providers available in this build: ElevenLabs and Gemini (feature 087). */
export function createTtsProviders(config, opts = {}) {
    return { elevenlabs: new ElevenLabsProvider(config, opts.fetchImpl), gemini: new GeminiProvider(config, { fetchImpl: opts.fetchImpl }) };
}
/** Parse TTS_PROVIDER; anything unrecognised is ignored (null). */
export function parseProviderEnv(raw) {
    const v = (raw ?? '').trim().toLowerCase();
    return isTtsProviderId(v) ? v : null;
}
/**
 * Install-wide provider: explicit switch stored in messaging-state.json, else
 * TTS_PROVIDER from .env, else auto (ElevenLabs if its key is set, else Gemini
 * if its key is set, else ElevenLabs). Existing installs have neither of the
 * first two and an ElevenLabs key, so they stay on ElevenLabs.
 */
export function resolveActiveProvider(stored, config, registry) {
    let id;
    let source;
    const fromEnv = parseProviderEnv(config.ttsProviderEnv);
    if (stored) {
        id = stored;
        source = 'state';
    }
    else if (fromEnv) {
        id = fromEnv;
        source = 'env';
    }
    else {
        source = 'auto';
        id = config.elevenlabsApiKey ? 'elevenlabs' : config.geminiApiKey ? 'gemini' : 'elevenlabs';
    }
    return { id, source, provider: registry[id] ?? null };
}
/**
 * Voice resolution for one provider: explicit → project slot → install default
 * → env default → built-in. Only an EMPTY step falls through; an unusable
 * stored voice is never skipped silently (it fails loudly at render time).
 */
export function resolveVoice(provider, steps) {
    if (steps.explicit) {
        return { voice: { provider: provider.id, id: steps.explicit, name: steps.explicit }, source: 'explicit' };
    }
    const slot = steps.slot;
    if (slot?.voice && slot.source) {
        return { voice: { ...slot.voice, provider: provider.id }, source: slot.source };
    }
    const env = provider.envDefaultVoice();
    if (env)
        return { voice: env, source: 'env' };
    const builtin = provider.builtinDefaultVoice();
    if (builtin)
        return { voice: builtin, source: 'builtin' };
    throw new TtsProviderError('no_voice', `TTS provider (${provider.label}): no voice to speak with. Set ${PROVIDER_VOICE_ENV[provider.id]} in .env or run \`sly-messaging voice set <voice> --provider ${provider.id}\`.`);
}
//# sourceMappingURL=provider.js.map