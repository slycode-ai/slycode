export interface SttConfig {
    backend: 'openai' | 'local' | 'aws-transcribe';
    openaiApiKey: string;
    whisperCliPath: string;
    whisperModelPath: string;
    awsTranscribeRegion: string;
    awsTranscribeLanguage: string;
    awsTranscribeS3Bucket: string;
}
export declare function validateSttConfig(config: SttConfig): Promise<string | null>;
export declare function transcribeAudio(filePath: string, config: SttConfig): Promise<string>;
