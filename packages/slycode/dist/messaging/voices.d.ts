/**
 * ElevenLabs voice search and listing
 *
 * Searches both personal voices (/v2/voices) and the shared
 * community library (/v1/shared-voices), deduplicating by voice_id.
 */
export interface ElevenLabsVoice {
    voice_id: string;
    name: string;
    category: string;
    description: string;
    labels: Record<string, string>;
}
export declare function searchVoices(apiKey: string, query?: string): Promise<ElevenLabsVoice[]>;
