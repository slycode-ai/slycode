/**
 * Speech length rules for spoken terminal replies (feature 086).
 *
 * LOCKSTEP: bridge/src/speech-limits.ts is a byte-for-byte twin of this
 * file (and speech-limits.test.ts of its test). Change both together.
 *
 * Words are counted on the raw text TTS will actually receive: whitespace
 * tokens, minus bracketed audio tags like "[pause]" (ElevenLabs v3 tags are
 * spoken as direction, not words). Characters count everything, tags
 * included, so a tag-stuffed or CJK/no-space text is still bounded.
 */
export const DEFAULT_MAX_SPEAK_WORDS = 60;
export const MIN_MAX_SPEAK_WORDS = 1;
export const MAX_MAX_SPEAK_WORDS = 200;
export const CHARS_PER_WORD_GUARD = 8;
const TAG_TOKEN = /^\[[^\]]*\]$/;
export function countSpeech(text) {
    const raw = typeof text === 'string' ? text : '';
    const tokens = raw.split(/\s+/).filter(t => t.length > 0);
    const wordTokens = tokens.filter(t => !TAG_TOKEN.test(t));
    return {
        words: wordTokens.length,
        chars: raw.trim().length,
        effectiveText: wordTokens.join(' '),
    };
}
/** True when nothing speakable remains: empty, tags only, or punctuation only. */
export function isEmptySpeech(text) {
    const { effectiveText } = countSpeech(text);
    if (effectiveText.length === 0)
        return true;
    // Punctuation/symbol-only (no letter, digit or other word character in any script)
    return !/[\p{L}\p{N}]/u.test(effectiveText);
}
/**
 * Resolve limits from the web voice settings object (data/settings.json →
 * settings.voice). `null` input means the settings were unreadable and the
 * caller must refuse admission rather than substitute a larger default.
 * A missing or invalid maxSpeakWords falls back to the default (clamped).
 */
export function resolveLimits(voiceSettings) {
    if (voiceSettings === null)
        return null;
    const rawValue = voiceSettings?.maxSpeakWords;
    const n = typeof rawValue === 'number' && Number.isFinite(rawValue)
        ? Math.round(rawValue)
        : DEFAULT_MAX_SPEAK_WORDS;
    const maxWords = Math.min(MAX_MAX_SPEAK_WORDS, Math.max(MIN_MAX_SPEAK_WORDS, n));
    return { maxWords, maxChars: maxWords * CHARS_PER_WORD_GUARD };
}
/** Inclusive boundary: exactly at the limit passes. */
export function exceedsLimits(count, limits) {
    return count.words > limits.maxWords || count.chars > limits.maxChars;
}
//# sourceMappingURL=speech-limits.js.map