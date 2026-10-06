/** Signed 16-bit little-endian mono samples. */
export interface Pcm {
    data: Buffer;
    sampleRate: number;
}
export type PcmFormat = 'mp3' | 'ogg' | 'wav';
/**
 * Parse a RIFF/WAVE buffer and return ONLY the PCM samples of its `data`
 * chunk (exactly the declared size). Chunks before or after `data` are
 * skipped by their declared sizes (word-aligned: odd sizes carry a pad byte).
 */
export declare function parseWav(buf: Buffer): Pcm;
/** Headerless audio/l16 (Gemini documents it as s16le), rate from the MIME (default 24 kHz). */
export declare function parseL16(buf: Buffer, mime: string): Pcm;
export declare function pcmSeconds(pcm: Pcm): number;
/** Join chunks with silence between them (gapAfterMs of each chunk except the last). */
export declare function concatPcm(parts: Array<{
    pcm: Pcm;
    gapAfterMs: number;
}>): Pcm;
/** Reject empty or implausibly short audio for text that has speakable characters. */
export declare function validatePcm(pcm: Pcm, opts: {
    speakable: boolean;
}): void;
/** A fresh 44-byte PCM WAV around the samples — never a provider's header or chunks. */
export declare function writeWav(pcm: Pcm): Buffer;
type Mp3Lib = typeof import('wasm-media-encoders');
type OpusLib = typeof import('@audio/encode-opus');
interface Encoders {
    mp3: Mp3Lib;
    mp3Module: WebAssembly.Module | null;
    opus: OpusLib['default'];
}
/** Load (once) and cache the encoder modules. Rejects with encoder_unavailable. */
export declare function loadEncoders(): Promise<Encoders>;
/** For health: has an encoder load been attempted, and did it work? */
export declare function encoderStatus(): {
    state: 'unknown' | 'ready' | 'failed';
    error?: string;
};
/** Encode PCM to a delivery format. Fresh encoder per clip; failures surface as TtsProviderError. */
export declare function encodePcm(pcm: Pcm, format: PcmFormat): Promise<Buffer>;
export {};
