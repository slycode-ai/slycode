import { TtsProviderError, VoiceUnusableError } from './errors.js';
import { expiryState, unusableVoiceMessage } from './custom-voices.js';
import { chunkScript, parseSpeech, singleChunk } from './speech-markup.js';
function deepFreeze(value) {
    if (value && typeof value === 'object' && !Object.isFrozen(value)) {
        Object.freeze(value);
        for (const v of Object.values(value))
            deepFreeze(v);
    }
    return value;
}
export function admitRender(req) {
    if (req.voice.provider !== req.provider.id) {
        throw new TtsProviderError('voice_provider_mismatch', `Voice '${req.voice.name}' belongs to ${req.voice.provider}, not ${req.provider.label}; it cannot be rendered there.`);
    }
    // A designed voice past its stored expiry is refused before any paid call
    // (phase 4); the route adds the recipe-aware fix to the message.
    if (expiryState(req.voice.expiresAt, req.now ?? Date.now())?.state === 'expired') {
        const voice = { id: req.voice.id, name: req.voice.name, expiresAt: req.voice.expiresAt };
        throw new VoiceUnusableError('expired', voice, unusableVoiceMessage(req.provider.label, 'expired', voice, false));
    }
    const script = parseSpeech(req.text);
    // One shared chunker for every path (speak, Telegram, generate) when the text
    // is over the provider's per-request size; ElevenLabs never chunks.
    const chunks = req.text.length > req.provider.maxRenderChars
        ? chunkScript(script, req.provider.maxRenderChars)
        : [singleChunk(script)];
    const now = req.now ?? Date.now();
    // The provider object itself is not frozen (it is a live adapter); the
    // snapshot fixes WHICH provider, never what it is.
    const job = {
        provider: req.provider,
        providerRevision: req.providerRevision,
        model: req.provider.model,
        voice: deepFreeze({ ...req.voice }),
        script: deepFreeze(script),
        chunks: deepFreeze(chunks),
        deadlineAt: now + req.timeoutMs,
        timeoutMs: req.timeoutMs,
        purpose: req.purpose ?? 'speak',
        speed: req.speed ?? 1,
    };
    return Object.freeze(job);
}
/** Cache identity of one chunk: provider, model/settings, voice and the chunk's EFFECTIVE script (inherited style included). */
export function chunkCacheKey(job, chunk) {
    return JSON.stringify([job.provider.id, job.provider.cacheKeyParts(), job.voice.id, chunk.inheritedStyle, chunk.text]);
}
//# sourceMappingURL=render-job.js.map