import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseWav, pcmSeconds } from './audio-encode.js';
import { RecordingFileError, recordingAsWav } from './recording-wav.js';
function hasFfmpeg() {
    try {
        execFileSync('ffmpeg', ['-version'], { stdio: 'ignore', windowsHide: true });
        return true;
    }
    catch {
        return false;
    }
}
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'recording-wav-'));
test.after(() => fs.rmSync(dir, { recursive: true, force: true }));
test('an MP3 becomes a WAV parseWav accepts, with the right length (review fix: no 0xFFFFFFFF sizes)', { skip: !hasFfmpeg() && 'ffmpeg not installed' }, () => {
    const mp3 = path.join(dir, 'sample.mp3');
    execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=220:sample_rate=44100:duration=12', '-ac', '2', mp3], { windowsHide: true });
    const wav = recordingAsWav(mp3, 'voice sample');
    assert.equal(wav.readUInt32LE(4), wav.length - 8, 'RIFF size is real');
    assert.equal(wav.readUInt32LE(40), wav.length - 44, 'data size is real');
    const pcm = parseWav(wav);
    assert.equal(pcm.sampleRate, 24000);
    const secs = pcmSeconds(pcm);
    assert.ok(Math.abs(secs - 12) < 0.15, `about 12 s, got ${secs}`);
});
test('a WAV is passed through untouched; a missing file and missing ffmpeg say so plainly', () => {
    const wavFile = path.join(dir, 'take.wav');
    const raw = Buffer.concat([Buffer.from('RIFF\x24\x00\x00\x00WAVE', 'latin1'), Buffer.alloc(32)]);
    fs.writeFileSync(wavFile, raw);
    assert.ok(recordingAsWav(wavFile, 'voice sample').equals(raw));
    assert.throws(() => recordingAsWav(path.join(dir, 'nope.wav'), 'voice sample'), (e) => e instanceof RecordingFileError && e.code === 'unreadable' && /can't read the voice sample/.test(e.message));
    const notWav = path.join(dir, 'take.m4a');
    fs.writeFileSync(notWav, 'not audio');
    assert.throws(() => recordingAsWav(notWav, 'consent recording', { ffmpeg: 'definitely-not-ffmpeg-xyz' }), (e) => e instanceof RecordingFileError && e.code === 'no_ffmpeg' && /ffmpeg isn't installed/.test(e.message));
});
test('a file ffmpeg cannot decode is a clear conversion error', { skip: !hasFfmpeg() && 'ffmpeg not installed' }, () => {
    const junk = path.join(dir, 'junk.mp3');
    fs.writeFileSync(junk, 'this is not an mp3');
    assert.throws(() => recordingAsWav(junk, 'voice sample'), (e) => e instanceof RecordingFileError && e.code === 'convert_failed');
});
//# sourceMappingURL=recording-wav.test.js.map