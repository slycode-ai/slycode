/**
 * Speech length rules for spoken terminal replies (feature 086).
 *
 * LOCKSTEP: messaging/src/speech-limits.ts is a byte-for-byte twin of this
 * file (and speech-limits.test.ts of its test). Change both together.
 *
 * Words are counted on the raw text TTS will actually receive: whitespace
 * tokens, minus bracketed audio tags like "[pause]" (ElevenLabs v3 tags are
 * spoken as direction, not words). Characters count everything, tags
 * included, so a tag-stuffed or CJK/no-space text is still bounded.
 */
export interface SpeechCount {
    words: number;
    chars: number;
    /** Text with tag-only tokens removed and whitespace collapsed (for display). */
    effectiveText: string;
}
export interface SpeechLimits {
    maxWords: number;
    maxChars: number;
}
export declare const DEFAULT_MAX_SPEAK_WORDS = 60;
export declare const MIN_MAX_SPEAK_WORDS = 1;
export declare const MAX_MAX_SPEAK_WORDS = 200;
export declare const CHARS_PER_WORD_GUARD = 8;
export declare function countSpeech(text: string): SpeechCount;
/** True when nothing speakable remains: empty, tags only, or punctuation only. */
export declare function isEmptySpeech(text: string): boolean;
/**
 * Resolve limits from the web voice settings object (data/settings.json →
 * settings.voice). `null` input means the settings were unreadable and the
 * caller must refuse admission rather than substitute a larger default.
 * A missing or invalid maxSpeakWords falls back to the default (clamped).
 */
export declare function resolveLimits(voiceSettings: {
    maxSpeakWords?: unknown;
} | null | undefined): SpeechLimits | null;
/** Inclusive boundary: exactly at the limit passes. */
export declare function exceedsLimits(count: SpeechCount, limits: SpeechLimits): boolean;
