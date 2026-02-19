import type { VoiceConfig } from './types.js';
export declare function textToSpeech(text: string, config: VoiceConfig, voiceIdOverride?: string): Promise<Buffer>;
export declare function convertToOgg(mp3Buffer: Buffer): Promise<Buffer>;
