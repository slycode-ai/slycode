/**
 * TTS plumbing shared by every speech path (feature 086, provider-aware since 087):
 * per-provider semaphores, caller deadlines, the legacy ElevenLabs entry point
 * and source-audio encoding. Rendering itself goes through SpeechRenderer
 * (tts-render.ts) and the provider adapters in ./tts/.
 */
import type { VoiceConfig } from './types.js';
import type { AudioFormat, SourceAudio, TtsProvider, TtsProviderId } from './tts/provider.js';
export { RenderTimeoutError, RenderCancelledError } from './tts/errors.js';
/** ElevenLabs model id (kept for callers that predate the provider interface). */
export declare const TTS_MODEL_ID = "eleven_v3";
/** `speak` (POST /tts/render) and the legacy direct entry point. */
export declare const TTS_RENDER_TIMEOUT_MS: number;
/** Telegram voice replies (POST /voice): a long reply is several Gemini chunks. */
export declare const TTS_VOICE_TIMEOUT_MS: number;
/** Web voice-picker previews (POST /voices/preview): one short sentence, someone waiting. */
export declare const TTS_PREVIEW_TIMEOUT_MS: number;
/** `generate` (POST /tts/generate): long narration. */
export declare const TTS_GENERATE_TIMEOUT_MS: number;
/** Speaking-speed range (ElevenLabs' accepted range; Gemini is time-stretched within it). */
export declare const SPEED_MIN = 0.7;
export declare const SPEED_MAX = 1.2;
/**
 * Provider-neutral speaking speed (feature 087): TTS_SPEED, else
 * ELEVENLABS_SPEED, else 1. ElevenLabs keeps receiving exactly
 * ELEVENLABS_SPEED unless TTS_SPEED is set (byte-identical requests for
 * existing installs); out-of-range values are clamped with a warning.
 */
export declare function speedFromEnv(env: Record<string, string | undefined>): {
    ttsSpeed: number;
    elevenlabsSpeed: number;
    warning: string | null;
};
/** Character cap shared by /voice, /tts/generate and /tts/render (TTS_GENERATE_MAX_TEXT, default 5000). */
export declare function maxSpeechText(): number;
/** The /voice refusal for an over-long Telegram reply (feature 087), or null when it fits. */
export declare function voiceTextLimitError(message: unknown, max?: number): string | null;
/** Max concurrent ElevenLabs requests; extra callers queue (never rejected). */
export declare const TTS_RENDER_CONCURRENCY = 2;
/** Run `fn` holding one of the provider's slots; queue wait ends when `signal` fires. */
export declare function withProviderSlot<T>(provider: Pick<TtsProvider, 'id' | 'concurrency'>, signal: AbortSignal, fn: () => Promise<T>): Promise<T>;
/** Test-only visibility into the ElevenLabs semaphore. */
export declare function ttsSemaphoreState(provider?: TtsProviderId): {
    active: number;
    waiting: number;
};
/**
 * A controller that aborts at `deadline` (RenderTimeoutError) or when the
 * caller's own signal fires (RenderCancelledError). `dispose()` clears both.
 */
export declare function deadlineController(timeoutMs: number, deadline: number, signal?: AbortSignal): {
    controller: AbortController;
    dispose: () => void;
};
/**
 * Legacy direct ElevenLabs render (pre-087 entry point, kept for callers and
 * tests): one deadline covers queue residence AND the ElevenLabs call.
 */
export declare function textToSpeech(text: string, config: VoiceConfig, voiceIdOverride?: string, opts?: {
    timeoutMs?: number;
    fetchImpl?: typeof fetch;
    signal?: AbortSignal;
}): Promise<Buffer>;
/**
 * Encode provider source audio into the format the caller asked for.
 * - MP3 source → mp3: zero transcode, the provider's bytes untouched.
 * - MP3 source → ogg: ffmpeg (Telegram voice bubble); throws on failure so the
 *   caller decides fallback policy (/voice falls back to MP3, generate → 502).
 * - PCM source (Gemini): bundled WASM encoders, phase 2.
 */
export declare function encodeSource(source: SourceAudio, format: AudioFormat): Promise<Buffer>;
export declare function convertToOgg(mp3Buffer: Buffer): Promise<Buffer>;
