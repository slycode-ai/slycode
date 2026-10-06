/**
 * Portable speech markup (feature 087).
 *
 * Agents write ONE vocabulary of [square] tags. This module parses text into a
 * provider-neutral SpeechScript; each provider serialises it its own way.
 *
 *   - Pauses and sounds are point events: they happen once, where written.
 *   - Mood, pace and voice (whisper/shout) are style: they last until changed;
 *     a new mood also ends whisper/shout (a new passage).
 *   - Emphasis applies to the next word.
 *   - Unknown tags: sound effects are dropped; a short word-like tag is a mood;
 *     anything else is dropped (Gemini only — ElevenLabs gets the text as is).
 *
 * Phase 1: ElevenLabs receives the ORIGINAL text byte-for-byte
 * (toElevenLabsText). The Gemini serialiser and the shared chunker land in
 * phase 2 on top of this parse.
 */
export interface SpeechStyle {
    mood?: string;
    pace?: string;
    voice?: string;
}
export type SpeechToken = {
    kind: 'text';
    text: string;
} | {
    kind: 'event';
    event: string;
} | {
    kind: 'pause';
    length: 'short' | 'long';
} | {
    kind: 'hesitate';
} | {
    kind: 'emphasis';
};
export interface SpeechPart {
    style: SpeechStyle;
    tokens: SpeechToken[];
}
export type TagClass = 'pause' | 'sound' | 'voice' | 'mood' | 'pace' | 'emphasis' | 'reset' | 'dropped';
export interface ParsedTag {
    raw: string;
    /** Tag text without brackets, lower-cased and whitespace-collapsed. */
    name: string;
    bracket: 'square' | 'angle';
    cls: TagClass;
    /** True when the tag was not in the vocabulary (classified by the unknown-tag rules). */
    unknown: boolean;
}
export interface SpeechScript {
    /** The exact input text. */
    source: string;
    parts: SpeechPart[];
    tags: ParsedTag[];
}
/** Unknown-tag rules (design §5): sound effect → dropped; short word-like → mood; else dropped. */
export declare function classifyUnknownTag(name: string): 'mood' | 'dropped';
/** Parse text into a provider-neutral script. Never throws. */
export declare function parseSpeech(text: string): SpeechScript;
/**
 * Text sent to ElevenLabs. Phase 1: the original text, byte-for-byte
 * (ElevenLabs v3 reads [square] tags natively and handles free-form ones).
 * Phase 2 adds the one deliberate change: known <angle> tags rewritten to
 * their square equivalents.
 */
export declare function toElevenLabsText(script: SpeechScript): string;
/** The whole script as one chunk (ElevenLabs always; Gemini when short enough). */
export declare function singleChunk(script: SpeechScript): ScriptChunkLike;
export interface ScriptChunkLike {
    text: string;
    script: SpeechScript;
    inheritedStyle: SpeechStyle;
    gapAfterMs: number;
}
/** One Gemini request carries at most this many style parts; later changes merge into the last. */
export declare const MAX_STYLE_PARTS = 8;
/** Gemini chunk size (phase 0: latency ≈ 1.5 s + 20 ms/char, so 600 ≈ 13 s per request). */
export declare const DEFAULT_CHUNK_CHARS = 600;
/** Silence between joined chunks. */
export declare const GAP_PARAGRAPH_MS = 250;
export declare const GAP_SENTENCE_MS = 120;
export interface GeminiPart {
    text: string;
    /** Natural-language delivery, e.g. "excited, fast, whispering". */
    style?: string;
}
export declare function styleText(style: SpeechStyle): string;
/**
 * Gemini request parts for a script: one part per style run. A run with no
 * words (only a laugh or a pause) is merged into its neighbour; identical
 * consecutive styles are merged; after MAX_STYLE_PARTS, further style changes
 * merge into the last part. Square tags never reach Gemini (they can be read
 * aloud — phase 0 saw it happen).
 */
export declare function toGeminiParts(script: SpeechScript): GeminiPart[];
/** Canonical text of a script as Gemini will receive it (cache identity of a chunk). */
export declare function geminiCanonicalText(script: SpeechScript): string;
/**
 * Split a parsed script into provider requests of at most `maxChars` (as
 * Gemini text), cutting at the strongest boundary available — style-part end,
 * then paragraph, then sentence, then words. Each chunk keeps the style it
 * inherits, so chunks render independently (in parallel) and join cleanly.
 * One chunk when it already fits.
 */
export declare function chunkScript(script: SpeechScript, maxChars?: number): ScriptChunkLike[];
