export declare const CLONE_FILE_RATE = 24000;
export declare class RecordingFileError extends Error {
    readonly code: 'unreadable' | 'no_ffmpeg' | 'convert_failed';
    constructor(code: 'unreadable' | 'no_ffmpeg' | 'convert_failed', message: string);
}
export declare function isWavFile(buf: Buffer): boolean;
export declare function recordingAsWav(file: string, label: string, opts?: {
    ffmpeg?: string;
}): Buffer;
