export interface SttConfig {
    backend: 'openai' | 'local' | 'aws-transcribe';
    openaiApiKey: string;
    whisperCliPath: string;
    whisperModelPath: string;
    awsTranscribeRegion: string;
    awsTranscribeLanguage: string;
}
export declare function validateSttConfig(config: SttConfig): string | null;
export declare function transcribeAudio(filePath: string, config: SttConfig): Promise<string>;
