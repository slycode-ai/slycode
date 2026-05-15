import type { VoiceConfig } from './types.js';
export declare function textToSpeech(text: string, config: VoiceConfig, voiceIdOverride?: string): Promise<Buffer>;
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
}): Promise<{
    buffer: Buffer;
    format: 'ogg' | 'mp3';
    sourceMp3: Buffer;
}>;
export declare function convertToOgg(mp3Buffer: Buffer): Promise<Buffer>;
