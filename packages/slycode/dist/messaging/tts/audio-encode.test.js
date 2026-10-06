import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MPEGDecoder } from 'mpg123-decoder';
import { OggOpusDecoder } from 'ogg-opus-decoder';
import { parseWav, parseL16, writeWav, concatPcm, validatePcm, pcmSeconds, encodePcm, encoderStatus, loadEncoders } from './audio-encode.js';
import { timeStretch } from './time-stretch.js';
import { TtsProviderError } from './errors.js';
const RATE = 24000;
function tone(seconds, hz, rate = RATE) {
    const n = Math.round(rate * seconds);
    const data = Buffer.alloc(n * 2);
    for (let i = 0; i < n; i++)
        data.writeInt16LE(Math.round(12000 * Math.sin((2 * Math.PI * hz * i) / rate)), i * 2);
    return { data, sampleRate: rate };
}
function chunk(id, payload) {
    const h = Buffer.alloc(8);
    h.write(id, 0, 'ascii');
    h.writeUInt32LE(payload.length, 4);
    return Buffer.concat([h, payload, payload.length % 2 ? Buffer.alloc(1) : Buffer.alloc(0)]);
}
function fmtChunk(opts = {}) {
    const b = Buffer.alloc(16);
    b.writeUInt16LE(opts.format ?? 1, 0);
    b.writeUInt16LE(opts.channels ?? 1, 2);
    b.writeUInt32LE(opts.rate ?? RATE, 4);
    b.writeUInt32LE((opts.rate ?? RATE) * 2, 8);
    b.writeUInt16LE(2, 12);
    b.writeUInt16LE(opts.bits ?? 16, 14);
    return chunk('fmt ', b);
}
function riff(...chunks) {
    const body = Buffer.concat([Buffer.from('WAVE'), ...chunks]);
    const h = Buffer.alloc(8);
    h.write('RIFF', 0, 'ascii');
    h.writeUInt32LE(body.length, 4);
    return Buffer.concat([h, body]);
}
/** Bytes that would be loud static if mistaken for audio (as in the phase 0 incident). */
const C2PA = Buffer.alloc(6016, 0x7f);
const C2PA_MARK = Buffer.from('c2pa-manifest-marker');
C2PA_MARK.copy(C2PA, 100);
// --- WAV parsing regression fixtures (prob-1790817824663) ---------------------
test('Gemini layout: fmt, data, then a C2PA chunk → exactly the data payload, no metadata', () => {
    const audio = tone(0.5, 440);
    const pcm = parseWav(riff(fmtChunk(), chunk('data', audio.data), chunk('C2PA', C2PA)));
    assert.equal(pcm.sampleRate, RATE);
    assert.ok(pcm.data.equals(audio.data), 'samples are exactly the data chunk');
    assert.equal(pcm.data.indexOf(C2PA_MARK), -1);
});
test('metadata BEFORE data (LIST) and an odd-size chunk with a pad byte are skipped', () => {
    const audio = tone(0.2, 300);
    const list = chunk('LIST', Buffer.from('INFOISFT\x05\x00\x00\x00Lavf\x00'));
    const odd = chunk('junk', Buffer.from([1, 2, 3])); // 3 bytes + 1 pad
    const pcm = parseWav(riff(fmtChunk(), list, odd, chunk('data', audio.data), chunk('C2PA', C2PA)));
    assert.ok(pcm.data.equals(audio.data));
});
test('fmt after data still parses; WAVE_FORMAT_EXTENSIBLE 16-bit mono is accepted', () => {
    const audio = tone(0.1, 500);
    assert.ok(parseWav(riff(chunk('data', audio.data), fmtChunk())).data.equals(audio.data));
    assert.ok(parseWav(riff(fmtChunk({ format: 0xfffe }), chunk('data', audio.data))).data.equals(audio.data));
});
test('truncated sizes are rejected as bad audio, never read past the buffer', () => {
    const audio = tone(0.1, 500);
    const full = riff(fmtChunk(), chunk('data', audio.data));
    const cut = full.subarray(0, full.length - 100);
    assert.throws(() => parseWav(cut), (e) => e instanceof TtsProviderError && e.code === 'tts_bad_audio' && /truncated/.test(e.message));
    const lyingList = Buffer.concat([riff(fmtChunk()), Buffer.from('LIST'), Buffer.from([0xff, 0xff, 0, 0])]);
    assert.throws(() => parseWav(lyingList), (e) => e instanceof TtsProviderError && /truncated before the audio/.test(e.message));
    const shortFmt = riff(chunk('fmt ', Buffer.alloc(8)), chunk('data', audio.data));
    assert.throws(() => parseWav(shortFmt), /fmt chunk is truncated/);
    // A truncated chunk AFTER the audio (e.g. a cut-off C2PA tail) does not invalidate the samples.
    const tail = Buffer.concat([riff(fmtChunk(), chunk('data', audio.data)), Buffer.from('C2PA'), Buffer.from([0x00, 0x40, 0, 0]), Buffer.alloc(10)]);
    assert.ok(parseWav(tail).data.equals(audio.data));
});
test('not RIFF, no fmt, no data, or the wrong sample format → bad audio', () => {
    const audio = tone(0.1, 500);
    for (const [buf, re] of [
        [Buffer.from('nope'), /not a RIFF/],
        [riff(chunk('data', audio.data)), /no fmt/],
        [riff(fmtChunk()), /no data/],
        [riff(fmtChunk({ channels: 2 }), chunk('data', audio.data)), /expected 16-bit mono/],
        [riff(fmtChunk({ bits: 8 }), chunk('data', audio.data)), /expected 16-bit mono/],
        [riff(fmtChunk({ format: 3 }), chunk('data', audio.data)), /expected 16-bit mono/],
    ]) {
        assert.throws(() => parseWav(buf), (e) => e instanceof TtsProviderError && e.code === 'tts_bad_audio' && re.test(e.message));
    }
});
test('L16 reads the rate from the MIME and keeps whole samples', () => {
    const pcm = parseL16(Buffer.alloc(4801), 'audio/l16; rate=16000; channels=1');
    assert.equal(pcm.sampleRate, 16000);
    assert.equal(pcm.data.length, 4800);
    assert.throws(() => parseL16(Buffer.alloc(4), 'audio/l16; rate=24000; channels=2'), /2 channels/);
});
test('writeWav is a fresh 44-byte header around the samples only (no pass-through)', () => {
    const audio = tone(0.25, 440);
    const wav = writeWav(audio);
    assert.equal(wav.length, 44 + audio.data.length);
    assert.equal(wav.toString('ascii', 36, 40), 'data');
    assert.ok(parseWav(wav).data.equals(audio.data));
    const roundTrip = writeWav(parseWav(riff(fmtChunk(), chunk('data', audio.data), chunk('C2PA', C2PA))));
    assert.equal(roundTrip.indexOf(C2PA_MARK), -1);
    assert.equal(roundTrip.indexOf(Buffer.from('C2PA')), -1);
});
test('concatPcm inserts the gaps; validatePcm rejects empty and too-short audio', () => {
    const a = tone(0.5, 440);
    const joined = concatPcm([{ pcm: a, gapAfterMs: 250 }, { pcm: a, gapAfterMs: 999 }]);
    assert.equal(pcmSeconds(joined), 1.25, 'the last chunk\'s gap is not appended');
    assert.throws(() => validatePcm({ data: Buffer.alloc(0), sampleRate: RATE }, { speakable: true }), /empty audio/);
    assert.throws(() => validatePcm(tone(0.1, 440), { speakable: true }), /0\.10 s of audio/);
    validatePcm(tone(0.1, 440), { speakable: false });
    assert.throws(() => concatPcm([{ pcm: a, gapAfterMs: 0 }, { pcm: tone(0.1, 440, 16000), gapAfterMs: 0 }]), /sample rates differ/);
});
// --- Encoders (decoded back, not just magic bytes) ---------------------------
function pitch(ch, rate) {
    const a = Math.floor(ch.length * 0.25), b = Math.floor(ch.length * 0.75);
    let best = 0, lag = 0;
    for (let L = Math.floor(rate / 2000); L < Math.floor(rate / 80); L++) {
        let s = 0;
        for (let i = a; i < b - L; i++)
            s += ch[i] * ch[i + L];
        if (s > best) {
            best = s;
            lag = L;
        }
    }
    return lag ? rate / lag : 0;
}
async function decodeMp3(buf) {
    const d = new MPEGDecoder();
    await d.ready;
    const r = d.decode(new Uint8Array(buf));
    d.free();
    return { seconds: r.samplesDecoded / r.sampleRate, hz: pitch(r.channelData[0], r.sampleRate) };
}
async function decodeOgg(buf) {
    const d = new OggOpusDecoder();
    await d.ready;
    const r = await d.decodeFile(new Uint8Array(buf));
    d.free();
    return { seconds: r.samplesDecoded / r.sampleRate, hz: pitch(r.channelData[0], r.sampleRate) };
}
function near(actual, expected, tol, what) {
    assert.ok(Math.abs(actual - expected) <= tol, `${what}: ${actual} not within ${tol} of ${expected}`);
}
test('mp3 and ogg decode back to the right length and pitch, sequentially', async () => {
    for (const [secs, hz] of [[1, 440], [2, 660]]) {
        const pcm = tone(secs, hz);
        const mp3 = await decodeMp3(await encodePcm(pcm, 'mp3'));
        near(mp3.seconds, secs, 0.1, 'mp3 duration (LAME pads ~60 ms)');
        near(mp3.hz, hz, hz * 0.02, 'mp3 pitch');
        const ogg = await decodeOgg(await encodePcm(pcm, 'ogg'));
        near(ogg.seconds, secs, 0.05, 'ogg duration');
        near(ogg.hz, hz, hz * 0.02, 'ogg pitch');
    }
    assert.equal(encoderStatus().state, 'ready');
});
test('concurrent clips get independent encoders (no shared or borrowed state)', async () => {
    const a = tone(1, 440), b = tone(3, 330);
    const [ma, mb, oa, ob] = await Promise.all([encodePcm(a, 'mp3'), encodePcm(b, 'mp3'), encodePcm(a, 'ogg'), encodePcm(b, 'ogg')]);
    const [dma, dmb, doa, dob] = await Promise.all([decodeMp3(ma), decodeMp3(mb), decodeOgg(oa), decodeOgg(ob)]);
    near(dma.seconds, 1, 0.1, 'mp3 a');
    near(dma.hz, 440, 9, 'mp3 a pitch');
    near(dmb.seconds, 3, 0.1, 'mp3 b');
    near(dmb.hz, 330, 7, 'mp3 b pitch');
    near(doa.seconds, 1, 0.05, 'ogg a');
    near(doa.hz, 440, 9, 'ogg a pitch');
    near(dob.seconds, 3, 0.05, 'ogg b');
    near(dob.hz, 330, 7, 'ogg b pitch');
    assert.ok(ma.subarray(0, 3).equals(Buffer.from([0xff, 0xf3, 0x84])) || ma[0] === 0xff, 'mp3 frame sync');
    assert.equal(oa.toString('ascii', 0, 4), 'OggS');
    assert.ok(oa.includes(Buffer.from('OpusHead')));
});
test('an encode that fails does not poison the next clip', async () => {
    const enc = await loadEncoders();
    const realOpus = enc.opus;
    enc.opus = (async () => { throw new Error('boom'); });
    await assert.rejects(encodePcm(tone(0.5, 440), 'ogg'), (e) => e instanceof TtsProviderError && e.code === 'encode_failed');
    enc.opus = realOpus;
    near((await decodeOgg(await encodePcm(tone(0.5, 440), 'ogg'))).seconds, 0.5, 0.05, 'next clip');
});
test('no metadata reaches mp3/ogg: Gemini-shaped WAV in, only samples out', async () => {
    const pcm = parseWav(riff(fmtChunk(), chunk('data', tone(0.5, 440).data), chunk('C2PA', C2PA)));
    for (const fmt of ['mp3', 'ogg']) {
        const out = await encodePcm(pcm, fmt);
        assert.equal(out.indexOf(C2PA_MARK), -1, `${fmt} carries no C2PA bytes`);
    }
});
// --- Time-stretch (speaking speed) --------------------------------------------
test('time-stretch changes duration by the factor and keeps the pitch', () => {
    const pcm = tone(2, 440);
    const fast = timeStretch(pcm, 1.1);
    near(pcmSeconds(fast), 2 / 1.1, 0.05, 'faster duration');
    const slow = timeStretch(pcm, 0.8);
    near(pcmSeconds(slow), 2 / 0.8, 0.06, 'slower duration');
    const f32 = (p) => { const f = new Float32Array(p.data.length / 2); for (let i = 0; i < f.length; i++)
        f[i] = p.data.readInt16LE(i * 2) / 32768; return f; };
    near(pitch(f32(fast), RATE), 440, 9, 'pitch preserved (faster)');
    near(pitch(f32(slow), RATE), 440, 9, 'pitch preserved (slower)');
    assert.equal(timeStretch(pcm, 1), pcm, 'speed 1 is a no-op');
    assert.throws(() => timeStretch(pcm, 0), RangeError);
});
// --- Fix loop: WSOLA keeps the head and the tail ----------------------------------
test('time-stretch preserves impulses at the very start and the very end (no dropped final window)', () => {
    for (const factor of [1.1, 1.2, 0.8, 0.7]) {
        const n = RATE; // 1 s
        const data = Buffer.alloc(n * 2);
        // quiet carrier so the similarity search has signal, plus two loud clicks
        for (let i = 0; i < n; i++)
            data.writeInt16LE(Math.round(300 * Math.sin((2 * Math.PI * 200 * i) / RATE)), i * 2);
        const click = (at) => { for (let i = 0; i < 24; i++)
            data.writeInt16LE(30000, (at + i) * 2); };
        click(2);
        click(n - 40);
        const out = timeStretch({ data, sampleRate: RATE }, factor);
        const m = out.data.length / 2;
        const W0 = Math.round(RATE * 0.03);
        assert.ok(Math.abs(m - n / factor) <= W0, `${factor}: length ${m} vs ${Math.round(n / factor)} (±1 window)`);
        const peak = (from, to) => { let p = 0; for (let i = Math.max(0, from); i < Math.min(m, to); i++)
            p = Math.max(p, Math.abs(out.data.readInt16LE(i * 2))); return p; };
        const W = Math.round(RATE * 0.03);
        assert.ok(peak(0, W) > 15000, `${factor}: start click kept (peak ${peak(0, W)})`);
        assert.ok(peak(m - W, m) > 15000, `${factor}: end click kept (peak ${peak(m - W, m)})`);
    }
});
test('time-stretch keeps speech-like content right up to the last sample', () => {
    const pcm = tone(1, 440);
    const out = timeStretch(pcm, 1.1);
    const m = out.data.length / 2;
    let tailEnergy = 0;
    for (let i = m - 480; i < m; i++)
        tailEnergy += Math.abs(out.data.readInt16LE(i * 2));
    assert.ok(tailEnergy / 480 > 4000, `last 20 ms is not silent (mean |x| ${Math.round(tailEnergy / 480)})`);
});
//# sourceMappingURL=audio-encode.test.js.map