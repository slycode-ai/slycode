import { PROVIDER_KEY_ENV, PROVIDER_LABELS, PROVIDER_VOICE_ENV, TTS_PROVIDER_IDS, } from './provider.js';
function keyFor(config, provider) {
    return provider === 'elevenlabs' ? config.elevenlabsApiKey : config.geminiApiKey;
}
export function buildSpeechHealth(input) {
    const { active, registry, config } = input;
    const providers = {};
    for (const id of TTS_PROVIDER_IDS) {
        const adapter = registry[id];
        const stored = input.storedDefault(id);
        const env = adapter?.envDefaultVoice() ?? null;
        const builtin = adapter?.builtinDefaultVoice() ?? null;
        const defaultVoice = stored ?? (env ? { id: env.id, name: env.name } : builtin ? { id: builtin.id, name: builtin.name } : null);
        providers[id] = {
            configured: !!keyFor(config, id),
            available: !!adapter,
            defaultVoice,
            defaultVoiceSource: stored ? 'state' : env ? 'env' : builtin ? 'builtin' : null,
        };
    }
    const label = PROVIDER_LABELS[active.id];
    let reason = null;
    if (!active.provider) {
        reason = {
            code: 'provider_unavailable',
            message: `TTS provider (${label}) is not available in this version of SlyCode. Switch with \`sly-messaging tts provider elevenlabs\` or update SlyCode.`,
        };
    }
    else if (!providers[active.id].configured) {
        reason = {
            code: 'no_key',
            message: `TTS provider (${label}): ${PROVIDER_KEY_ENV[active.id]} is not set. Add it to .env and restart the messaging service.`,
        };
    }
    else if (!active.provider.nativeSpeed && input.encoder?.state === 'failed') {
        reason = {
            code: 'encoder_unavailable',
            message: `TTS provider (${label}): the audio encoders failed to load (${input.encoder.error ?? 'unknown error'}). Reinstall SlyCode (npm install) and restart the messaging service.`,
        };
    }
    const warnings = [];
    if (!reason && !providers[active.id].defaultVoice) {
        const missing = input.projectsWithoutVoice(active.id);
        if (missing.length > 0) {
            warnings.push(`No install-level ${label} default voice: ${missing.length === 1 ? '1 project has' : `${missing.length} projects have`} no ${label} voice and can't speak (${missing.join(', ')}). Set ${PROVIDER_VOICE_ENV[active.id]} in .env or run \`sly-messaging voice set <voice> --project <project>\`.`);
        }
    }
    if (input.expiryWarnings)
        warnings.push(...input.expiryWarnings(active.id));
    return {
        provider: active.id,
        providerSource: active.source,
        revision: input.revision,
        ready: reason === null,
        reason,
        providers,
        warnings,
    };
}
//# sourceMappingURL=health.js.map