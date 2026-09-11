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
/** Thrown by searchVoicesStrict when ElevenLabs cannot be reached or errors. */
export declare class VoicesUnavailableError extends Error {
    constructor(message: string);
}
/**
 * Like searchVoices but an upstream failure (network, non-2xx) THROWS
 * VoicesUnavailableError instead of degrading to an empty list, so callers
 * that need to distinguish "no such voice" from "could not ask" (the project
 * voice setter, feature 086) never report an outage as "not found".
 */
export declare function searchVoicesStrict(apiKey: string, query?: string): Promise<ElevenLabsVoice[]>;
export declare function searchVoices(apiKey: string, query?: string): Promise<ElevenLabsVoice[]>;
