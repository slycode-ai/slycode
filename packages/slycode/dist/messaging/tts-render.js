/**
 * Shared speech renderer for /tts/generate and /tts/render (feature 086).
 *
 * Wraps `renderTtsAudio` with:
 *   - a bounded LRU render cache keyed on voice + model + voice settings +
 *     format + text, so a repeated "done" never re-hits ElevenLabs;
 *   - coalescing of concurrent identical requests onto one in-flight
 *     promise (a burst of the same text renders once).
 *
 * Cache hits still return audio: whether a cached clip is DELIVERED is the
 * caller's (bridge's) decision, not the renderer's. Never touches disk and
 * never references a channel.
 */
import { renderTtsAudio, TTS_MODEL_ID, RenderCancelledError } from './tts.js';
export const DEFAULT_RENDER_CACHE_SIZE = 50;
export class SpeechRenderer {
    config;
    cache = new Map();
    inflight = new Map();
    render;
    cacheSize;
    constructor(config, opts = {}) {
        this.config = config;
        this.render = opts.render ?? renderTtsAudio;
        this.cacheSize = opts.cacheSize ?? DEFAULT_RENDER_CACHE_SIZE;
    }
    /** Cache key: everything that changes the audio bytes. */
    cacheKey(opts) {
        const voiceId = opts.voiceId || this.config.elevenlabsVoiceId || '';
        return JSON.stringify([
            voiceId,
            TTS_MODEL_ID,
            { stability: 0.5, similarity_boost: 0.75, speed: this.config.elevenlabsSpeed },
            opts.format,
            opts.text,
        ]);
    }
    get size() {
        return this.cache.size;
    }
    async renderSpeech(opts) {
        const key = this.cacheKey(opts);
        const voiceId = opts.voiceId ?? this.config.elevenlabsVoiceId ?? null;
        const hit = this.cache.get(key);
        if (hit) {
            // LRU touch
            this.cache.delete(key);
            this.cache.set(key, hit);
            return { buffer: hit, format: opts.format, voiceId: voiceId || null, cached: true };
        }
        if (opts.signal?.aborted)
            throw new RenderCancelledError();
        let entry = this.inflight.get(key);
        if (!entry) {
            const controller = new AbortController();
            const promise = this.render(opts.text, this.config, { format: opts.format, voiceIdOverride: opts.voiceId, signal: controller.signal })
                .then((r) => {
                this.remember(key, r.buffer);
                return r.buffer;
            })
                .finally(() => {
                this.inflight.delete(key);
            });
            entry = { promise, controller, live: 0, pinned: false };
            this.inflight.set(key, entry);
        }
        const shared = entry;
        let onAbort;
        if (opts.signal) {
            shared.live++;
            onAbort = () => {
                shared.live--;
                if (shared.live <= 0 && !shared.pinned)
                    shared.controller.abort();
            };
            opts.signal.addEventListener('abort', onAbort, { once: true });
        }
        else {
            shared.pinned = true;
        }
        try {
            const buffer = await shared.promise;
            return { buffer, format: opts.format, voiceId: voiceId || null, cached: false };
        }
        finally {
            if (opts.signal && onAbort) {
                opts.signal.removeEventListener('abort', onAbort);
                if (!opts.signal.aborted)
                    shared.live--;
            }
        }
    }
    remember(key, buffer) {
        if (this.cacheSize <= 0)
            return;
        this.cache.set(key, buffer);
        while (this.cache.size > this.cacheSize) {
            const oldest = this.cache.keys().next().value;
            if (oldest === undefined)
                break;
            this.cache.delete(oldest);
        }
    }
}
//# sourceMappingURL=tts-render.js.map