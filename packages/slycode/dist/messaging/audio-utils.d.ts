export declare function stripAudioTags(text: string): string;
export declare function slugifyForFilename(text: string, maxLen?: number): string;
export declare function pickFirstNWords(text: string, n: number): string;
export declare function timestamp(): string;
export declare function todayDateString(): string;
export declare function buildGeneratedFilename(opts: {
    text: string;
    voiceId: string | null;
    format: 'ogg' | 'mp3';
}): string;
