/**
 *   cd web && ../bridge/node_modules/.bin/tsx --test src/lib/wav-encode.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { blockLevel, bytesToBase64, downmixToMono, encodeWav16, levelAdvice, wavSeconds } from './wav-encode';

test('the WAV header is 24 kHz mono 16-bit PCM with the right sizes', () => {
  const wav = encodeWav16(new Float32Array(24000), 24000);
  const v = new DataView(wav.buffer);
  const text = (at: number) => String.fromCharCode(...wav.subarray(at, at + 4));
  assert.deepEqual([text(0), text(8), text(12), text(36)], ['RIFF', 'WAVE', 'fmt ', 'data']);
  assert.equal(v.getUint32(4, true), 36 + 48000);
  assert.equal(v.getUint16(20, true), 1, 'PCM');
  assert.equal(v.getUint16(22, true), 1, 'mono');
  assert.equal(v.getUint32(24, true), 24000);
  assert.equal(v.getUint32(28, true), 48000, 'byte rate');
  assert.equal(v.getUint16(34, true), 16, 'bits');
  assert.equal(v.getUint32(40, true), 48000);
  assert.equal(wav.length, 44 + 48000);
  assert.equal(wavSeconds(wav), 1);
});

test('samples are clamped and scaled to 16-bit', () => {
  const wav = encodeWav16(new Float32Array([1, -1, 2, -2, 0.5, 0]), 24000);
  const v = new DataView(wav.buffer);
  assert.deepEqual([0, 1, 2, 3, 4, 5].map((i) => v.getInt16(44 + i * 2, true)), [32767, -32768, 32767, -32768, 16384, 0]);
});

test('stereo is averaged to mono; mono passes through', () => {
  const l = new Float32Array([1, 0, -1]);
  const r = new Float32Array([0, 0, 1]);
  assert.deepEqual(Array.from(downmixToMono([l, r])), [0.5, 0, 0]);
  assert.equal(downmixToMono([l]), l);
  assert.equal(downmixToMono([]).length, 0);
});

test('base64 of a large take matches Buffer and does not blow the stack', () => {
  const bytes = new Uint8Array(1_500_000).map((_, i) => i % 251);
  assert.equal(bytesToBase64(bytes), Buffer.from(bytes).toString('base64'));
});

test('meter: RMS and peak, and the advice it gives', () => {
  assert.deepEqual(blockLevel(new Float32Array(0)), { rms: 0, peak: 0 });
  const half = blockLevel(new Float32Array([0.5, -0.5, 0.5, -0.5]));
  assert.equal(half.rms, 0.5);
  assert.equal(half.peak, 0.5);
  assert.equal(levelAdvice({ rms: 0.001, peak: 0.01 }), 'quiet');
  assert.equal(levelAdvice({ rms: 0.2, peak: 0.6 }), 'ok');
  assert.equal(levelAdvice({ rms: 0.3, peak: 1 }), 'loud');
});
