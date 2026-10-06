/**
 * A cloning recording from a file, as 16-bit mono WAV (#0376 CLI).
 *
 * WAV is passed through as-is (the route checks it). Anything else is
 * decoded by ffmpeg to RAW s16le PCM, and the WAV header is written here in
 * memory: ffmpeg's own WAV muxer can't seek back on a pipe, so it leaves the
 * size fields at 0xFFFFFFFF, which parseWav rightly rejects as truncated.
 * Nothing is written to disk.
 */
import { execFileSync } from 'child_process';
import fs from 'fs';
import { writeWav } from './audio-encode.js';
export const CLONE_FILE_RATE = 24000;
export class RecordingFileError extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.code = code;
    }
}
export function isWavFile(buf) {
    return buf.length >= 12 && buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WAVE';
}
export function recordingAsWav(file, label, opts = {}) {
    let buf;
    try {
        buf = fs.readFileSync(file);
    }
    catch (err) {
        throw new RecordingFileError('unreadable', `can't read the ${label} '${file}': ${err.message}`);
    }
    if (isWavFile(buf))
        return buf;
    let pcm;
    try {
        pcm = execFileSync(opts.ffmpeg ?? 'ffmpeg', ['-v', 'error', '-i', file, '-ac', '1', '-ar', String(CLONE_FILE_RATE), '-f', 's16le', '-acodec', 'pcm_s16le', 'pipe:1'], {
            maxBuffer: 64 * 1024 * 1024, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
        });
    }
    catch (err) {
        if (err.code === 'ENOENT') {
            throw new RecordingFileError('no_ffmpeg', `the ${label} isn't a WAV file and ffmpeg isn't installed to convert it. Convert it to 16-bit mono WAV first, or record in the web (Voice Settings → Change → Clone).`);
        }
        throw new RecordingFileError('convert_failed', `the ${label} could not be converted to WAV: ${err.message.split('\n')[0]}`);
    }
    if (pcm.length < 2)
        throw new RecordingFileError('convert_failed', `the ${label} has no audio ffmpeg could read.`);
    // An odd trailing byte can't be a sample; drop it so the header and data agree.
    const even = pcm.length % 2 ? pcm.subarray(0, pcm.length - 1) : pcm;
    return writeWav({ data: even, sampleRate: CLONE_FILE_RATE });
}
//# sourceMappingURL=recording-wav.js.map