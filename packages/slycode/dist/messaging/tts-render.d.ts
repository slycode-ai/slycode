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
import { renderTtsAudio } from './tts.js';
import type { VoiceConfig } from './types.js';
export type RenderFn = typeof renderTtsAudio;
export interface RenderSpeechOpts {
    text: string;
    format: 'ogg' | 'mp3';
    /** Explicit voice id; undefined → env default inside renderTtsAudio. */
    voiceId?: string;
    /**
     * Caller's abort signal (e.g. HTTP request closed). Coalesced requesters
     * share one render; it is aborted only when EVERY requester has aborted
     * (a requester without a signal pins it alive).
     */
    signal?: AbortSignal;
}
export interface RenderSpeechResult {
    buffer: Buffer;
    format: 'ogg' | 'mp3';
    /** The voice id actually used (explicit, else env default, else null). */
    voiceId: string | null;
    /** True when served from the render cache (no ElevenLabs call). */
    cached: boolean;
}
export declare const DEFAULT_RENDER_CACHE_SIZE = 50;
export declare class SpeechRenderer {
    private readonly config;
    private readonly cache;
    private readonly inflight;
    private readonly render;
    private readonly cacheSize;
    constructor(config: VoiceConfig, opts?: {
        render?: RenderFn;
        cacheSize?: number;
    });
    /** Cache key: everything that changes the audio bytes. */
    cacheKey(opts: RenderSpeechOpts): string;
    get size(): number;
    renderSpeech(opts: RenderSpeechOpts): Promise<RenderSpeechResult>;
    private remember;
}
