/**
 * PCM handling and encoding for providers that return raw audio (Gemini),
 * feature 087. No system binary: MP3 via wasm-media-encoders (LAME in WASM),
 * Ogg/Opus via @audio/encode-opus (libopus in WASM), WAV written here.
 *
 * Metadata policy (owner ruling 2026-10-01): NOTHING but the audio samples
 * leaves this module. parseWav takes exactly the `data` chunk payload — Gemini
 * appends a C2PA manifest chunk after the audio, and any other chunk (LIST,
 * C2PA, …) is skipped — and every output (mp3/ogg/wav) is encoded fresh from
 * those samples. A provider WAV is never forwarded.
 *
 * Encoder lifecycle: only the compiled modules are cached; every clip gets a
 * fresh encoder instance. LAME's encode()/finalize() return views into WASM
 * memory that the next call overwrites, so each one is copied immediately.
 */
import fs from 'fs';
import { createRequire } from 'module';
import { TtsProviderError } from './errors.js';
const badAudio = (message) => new TtsProviderError('tts_bad_audio', message, 502);
/**
 * Parse a RIFF/WAVE buffer and return ONLY the PCM samples of its `data`
 * chunk (exactly the declared size). Chunks before or after `data` are
 * skipped by their declared sizes (word-aligned: odd sizes carry a pad byte).
 */
export function parseWav(buf) {
    if (buf.length < 12 || buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') {
        throw badAudio('provider audio is not a RIFF/WAVE file');
    }
    let fmt = null;
    let data = null;
    let off = 12;
    while (off + 8 <= buf.length) {
        const id = buf.toString('ascii', off, off + 4);
        const size = buf.readUInt32LE(off + 4);
        const start = off + 8;
        const end = start + size;
        if (id === 'fmt ') {
            if (size < 16 || end > buf.length)
                throw badAudio(`WAV fmt chunk is truncated (${size} bytes declared)`);
            fmt = { format: buf.readUInt16LE(start), channels: buf.readUInt16LE(start + 2), rate: buf.readUInt32LE(start + 4), bits: buf.readUInt16LE(start + 14) };
        }
        else if (id === 'data') {
            if (end > buf.length) {
                throw badAudio(`WAV data chunk is truncated: ${size} bytes declared, ${buf.length - start} present`);
            }
            // Exactly the declared payload, copied, whole samples only.
            data = Buffer.from(buf.subarray(start, start + (size - (size % 2))));
        }
        else if (end > buf.length && !data) {
            throw badAudio(`WAV chunk '${id}' is truncated before the audio`);
        }
        if (data && fmt)
            break;
        off = end + (size & 1);
    }
    if (!fmt)
        throw badAudio('WAV has no fmt chunk');
    if (!data)
        throw badAudio('WAV has no data chunk');
    // 1 = PCM; 0xFFFE = WAVE_FORMAT_EXTENSIBLE (accepted when it is 16-bit mono)
    if ((fmt.format !== 1 && fmt.format !== 0xfffe) || fmt.channels !== 1 || fmt.bits !== 16) {
        throw badAudio(`unsupported WAV format (format ${fmt.format}, ${fmt.channels} channel(s), ${fmt.bits}-bit); expected 16-bit mono PCM`);
    }
    if (!fmt.rate)
        throw badAudio('WAV sample rate is 0');
    return { data, sampleRate: fmt.rate };
}
/** Headerless audio/l16 (Gemini documents it as s16le), rate from the MIME (default 24 kHz). */
export function parseL16(buf, mime) {
    const rate = Number(/rate=(\d+)/i.exec(mime)?.[1] ?? 24000);
    const channels = Number(/channels=(\d+)/i.exec(mime)?.[1] ?? 1);
    if (channels !== 1)
        throw badAudio(`unsupported L16 audio: ${channels} channels`);
    return { data: Buffer.from(buf.subarray(0, buf.length - (buf.length % 2))), sampleRate: rate };
}
export function pcmSeconds(pcm) {
    return pcm.data.length / 2 / pcm.sampleRate;
}
/** Join chunks with silence between them (gapAfterMs of each chunk except the last). */
export function concatPcm(parts) {
    if (parts.length === 0)
        throw badAudio('nothing to join');
    const rate = parts[0].pcm.sampleRate;
    const buffers = [];
    parts.forEach((p, i) => {
        if (p.pcm.sampleRate !== rate)
            throw badAudio(`chunk sample rates differ (${p.pcm.sampleRate} vs ${rate})`);
        buffers.push(p.pcm.data);
        if (i < parts.length - 1 && p.gapAfterMs > 0)
            buffers.push(Buffer.alloc(Math.round((rate * p.gapAfterMs) / 1000) * 2));
    });
    return { data: Buffer.concat(buffers), sampleRate: rate };
}
/** Reject empty or implausibly short audio for text that has speakable characters. */
export function validatePcm(pcm, opts) {
    if (pcm.data.length === 0)
        throw badAudio('provider returned empty audio');
    if (opts.speakable && pcmSeconds(pcm) < 0.2)
        throw badAudio(`provider returned ${pcmSeconds(pcm).toFixed(2)} s of audio for speakable text`);
}
/** A fresh 44-byte PCM WAV around the samples — never a provider's header or chunks. */
export function writeWav(pcm) {
    const h = Buffer.alloc(44);
    h.write('RIFF', 0, 'ascii');
    h.writeUInt32LE(36 + pcm.data.length, 4);
    h.write('WAVE', 8, 'ascii');
    h.write('fmt ', 12, 'ascii');
    h.writeUInt32LE(16, 16);
    h.writeUInt16LE(1, 20);
    h.writeUInt16LE(1, 22);
    h.writeUInt32LE(pcm.sampleRate, 24);
    h.writeUInt32LE(pcm.sampleRate * 2, 28);
    h.writeUInt16LE(2, 32);
    h.writeUInt16LE(16, 34);
    h.write('data', 36, 'ascii');
    h.writeUInt32LE(pcm.data.length, 40);
    return Buffer.concat([h, pcm.data]);
}
function toFloat32(pcm) {
    const n = pcm.data.length >> 1;
    const i16 = new Int16Array(n);
    new Uint8Array(i16.buffer).set(pcm.data.subarray(0, n * 2));
    const f = new Float32Array(n);
    for (let i = 0; i < n; i++)
        f[i] = i16[i] / 32768;
    return f;
}
let loading = null;
let status = { state: 'unknown' };
/** Load (once) and cache the encoder modules. Rejects with encoder_unavailable. */
export function loadEncoders() {
    if (!loading) {
        loading = (async () => {
            let mp3;
            let opus;
            try {
                mp3 = await import('wasm-media-encoders');
            }
            catch (err) {
                throw new TtsProviderError('encoder_unavailable', `wasm-media-encoders failed to load: ${err.message}`, 500);
            }
            try {
                opus = (await import('@audio/encode-opus')).default;
            }
            catch (err) {
                throw new TtsProviderError('encoder_unavailable', `@audio/encode-opus failed to load: ${err.message}`, 500);
            }
            // Compile LAME once; each clip instantiates its own encoder from it.
            let mp3Module = null;
            try {
                const wasmPath = createRequire(import.meta.url).resolve('wasm-media-encoders/wasm/mp3');
                mp3Module = await WebAssembly.compile(fs.readFileSync(wasmPath));
            }
            catch {
                mp3Module = null; // fall back to the package's embedded copy (compiles per clip)
            }
            return { mp3, mp3Module, opus };
        })();
        loading.then(() => { status = { state: 'ready' }; }, (err) => { status = { state: 'failed', error: err.message }; loading = null; });
    }
    return loading;
}
/** For health: has an encoder load been attempted, and did it work? */
export function encoderStatus() {
    return { ...status };
}
const MP3_BLOCK = 4608;
async function encodeMp3(pcm, enc) {
    const encoder = enc.mp3Module
        ? await enc.mp3.createEncoder('audio/mpeg', enc.mp3Module)
        : await enc.mp3.createMp3Encoder();
    encoder.configure({ sampleRate: pcm.sampleRate, channels: 1, bitrate: 64 });
    const samples = toFloat32(pcm);
    const out = [];
    for (let i = 0; i < samples.length; i += MP3_BLOCK) {
        out.push(Buffer.from(encoder.encode([samples.subarray(i, i + MP3_BLOCK)]))); // copy: the view is reused
    }
    out.push(Buffer.from(encoder.finalize()));
    return Buffer.concat(out);
}
/** 2× linear upsample (24 → 48 kHz). Opus runs at 48 kHz; doing this here is ~50× faster than the library's resampler. */
function upsample2x(x) {
    const y = new Float32Array(x.length * 2);
    for (let i = 0; i < x.length; i++) {
        const a = x[i];
        const b = i + 1 < x.length ? x[i + 1] : a;
        y[2 * i] = a;
        y[2 * i + 1] = (a + b) / 2;
    }
    return y;
}
async function encodeOgg(pcm, enc) {
    const samples = toFloat32(pcm);
    const at48k = pcm.sampleRate === 24000;
    const encoder = await enc.opus({ sampleRate: at48k ? 48000 : pcm.sampleRate, channels: 1, bitrate: 48, application: 'voip', complexity: 5 });
    try {
        // encode() takes an ARRAY of channels; a bare Float32Array silently encodes nothing.
        const body = Buffer.from(encoder.encode([at48k ? upsample2x(samples) : samples]));
        const tail = Buffer.from(encoder.flush());
        return Buffer.concat([body, tail]);
    }
    finally {
        encoder.free();
    }
}
/** Encode PCM to a delivery format. Fresh encoder per clip; failures surface as TtsProviderError. */
export async function encodePcm(pcm, format) {
    if (format === 'wav')
        return writeWav(pcm);
    const enc = await loadEncoders();
    try {
        return format === 'mp3' ? await encodeMp3(pcm, enc) : await encodeOgg(pcm, enc);
    }
    catch (err) {
        if (err instanceof TtsProviderError)
            throw err;
        throw new TtsProviderError('encode_failed', `${format} encoding failed: ${err.message}`, 500);
    }
}
//# sourceMappingURL=audio-encode.js.map