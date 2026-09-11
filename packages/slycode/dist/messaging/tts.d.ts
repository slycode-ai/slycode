import type { VoiceConfig } from './types.js';
export declare const TTS_MODEL_ID = "eleven_v3";
/** Per-request ElevenLabs timeout (feature 086). */
export declare const TTS_RENDER_TIMEOUT_MS: number;
/** Max concurrent ElevenLabs requests; extra callers queue (never rejected). */
export declare const TTS_RENDER_CONCURRENCY = 2;
/** Thrown when a render (queue wait + ElevenLabs call) exceeds its deadline. */
export declare class RenderTimeoutError extends Error {
    constructor(ms: number);
}
/** Thrown when the caller abandoned the request (client disconnected) before or during the render. */
export declare class RenderCancelledError extends Error {
    constructor();
}
/** Test-only visibility into the semaphore. */
export declare function ttsSemaphoreState(): {
    active: number;
    waiting: number;
};
export declare function textToSpeech(text: string, config: VoiceConfig, voiceIdOverride?: string, opts?: {
    timeoutMs?: number;
    fetchImpl?: typeof fetch;
    signal?: AbortSignal;
}): Promise<Buffer>;
/**
 * Render TTS audio in the requested format.
 *
 * Always calls ElevenLabs once (returns MP3) unless `sourceMp3` is supplied,
 * in which case it reuses that buffer (used by /voice's OGG-fail fallback to
 * avoid re-hitting the API).
 *
 * - format='mp3': zero transcode, returns the ElevenLabs buffer directly.
 * - format='ogg': runs convertToOgg(); throws on failure (caller decides
 *   fallback policy — /voice falls back to MP3, /tts/generate returns 502).
 *
 * Returns the source MP3 alongside the final buffer so callers can implement
 * format fallbacks without a second API call.
 */
export declare function renderTtsAudio(text: string, config: VoiceConfig, opts: {
    format: 'ogg' | 'mp3';
    voiceIdOverride?: string;
    sourceMp3?: Buffer;
    signal?: AbortSignal;
}): Promise<{
    buffer: Buffer;
    format: 'ogg' | 'mp3';
    sourceMp3: Buffer;
}>;
export declare function convertToOgg(mp3Buffer: Buffer): Promise<Buffer>;
