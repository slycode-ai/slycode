/**
 * Voice cloning recordings (#0376): whatever the browser records (Ogg/Opus,
 * WebM/Opus, MP4/AAC on Safari) or the person uploads becomes 24 kHz mono
 * 16-bit WAV here, in the browser, which is what Google asks for. The
 * server then never needs ffmpeg. The recordings live only in memory and in
 * the one request that creates the voice.
 *
 * The pure helpers (downmix, encode, level, base64) are unit-tested; the
 * Web Audio decode/resample needs a browser.
 */

export const CLONE_SAMPLE_RATE = 24000;

/** Average the channels into one. */
export function downmixToMono(channels: ReadonlyArray<Float32Array>): Float32Array {
  if (channels.length === 0) return new Float32Array(0);
  if (channels.length === 1) return channels[0];
  const out = new Float32Array(channels[0].length);
  for (const ch of channels) for (let i = 0; i < out.length; i++) out[i] += (ch[i] ?? 0) / channels.length;
  return out;
}

/** 16-bit PCM WAV with a fresh 44-byte header. Samples are clamped to ±1. */
export function encodeWav16(samples: Float32Array, sampleRate: number): Uint8Array {
  const bytes = new Uint8Array(44 + samples.length * 2);
  const view = new DataView(bytes.buffer);
  const text = (at: number, s: string) => { for (let i = 0; i < s.length; i++) bytes[at + i] = s.charCodeAt(i); };
  text(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, 'data');
  view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(44 + i * 2, s < 0 ? Math.round(s * 0x8000) : Math.round(s * 0x7fff), true);
  }
  return bytes;
}

/** Seconds of audio in a WAV made by encodeWav16. */
export function wavSeconds(wav: Uint8Array): number {
  if (wav.length < 44) return 0;
  const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
  const rate = view.getUint32(24, true);
  return rate ? view.getUint32(40, true) / 2 / rate : 0;
}

/** Base64 for the JSON body, chunked so a 1.5 MB take never overflows the call stack. */
export function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) bin += String.fromCharCode(...bytes.subarray(i, i + step));
  return btoa(bin);
}

/** How loud a block of samples is, for the meter: RMS and peak, both 0–1. */
export function blockLevel(samples: Float32Array): { rms: number; peak: number } {
  let sum = 0;
  let peak = 0;
  for (let i = 0; i < samples.length; i++) {
    const a = Math.abs(samples[i]);
    sum += a * a;
    if (a > peak) peak = a;
  }
  return { rms: samples.length ? Math.sqrt(sum / samples.length) : 0, peak };
}

/** What the meter tells the speaker. Thresholds are deliberately loose: it's a nudge, not a gate. */
export function levelAdvice(level: { rms: number; peak: number }): 'quiet' | 'ok' | 'loud' {
  if (level.peak >= 0.98) return 'loud';
  if (level.rms < 0.01) return 'quiet';
  return 'ok';
}

/**
 * Decode any recording the browser can read and resample it to 24 kHz mono
 * WAV (an OfflineAudioContext does both). Throws when it can't be decoded.
 */
export async function toWav24kMono(blob: Blob): Promise<{ wav: Uint8Array; seconds: number }> {
  const AudioCtx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioCtx) throw new Error('This browser cannot process audio.');
  const ctx = new AudioCtx();
  let decoded: AudioBuffer;
  try {
    decoded = await ctx.decodeAudioData(await blob.arrayBuffer());
  } finally {
    void ctx.close().catch(() => {});
  }
  const length = Math.max(1, Math.ceil(decoded.duration * CLONE_SAMPLE_RATE));
  const offline = new OfflineAudioContext(1, length, CLONE_SAMPLE_RATE);
  const source = offline.createBufferSource();
  source.buffer = decoded;
  source.connect(offline.destination);
  source.start();
  const rendered = await offline.startRendering();
  const mono = downmixToMono([rendered.getChannelData(0)]);
  return { wav: encodeWav16(mono, CLONE_SAMPLE_RATE), seconds: mono.length / CLONE_SAMPLE_RATE };
}
