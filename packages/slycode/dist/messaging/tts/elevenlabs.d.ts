/**
 * ElevenLabs TTS adapter (feature 087; behaviour moved verbatim from
 * messaging/src/tts.ts and voices.ts).
 *
 * BYTE-IDENTITY: the request URL, headers and body are pinned by
 * tts/elevenlabs.golden.test.ts against captures from the pre-refactor code.
 */
import type { VoiceConfig } from '../types.js';
import type { ProviderRenderRequest, SourceAudio, TtsProvider, VoiceInfo, VoiceQuery, VoiceRef } from './provider.js';
export declare const ELEVENLABS_MODEL_ID = "eleven_v3";
/** Max concurrent ElevenLabs requests (the plan's hard cap is 3); extra callers queue. */
export declare const ELEVENLABS_CONCURRENCY = 2;
export declare class ElevenLabsProvider implements TtsProvider {
    private readonly config;
    private readonly fetchImpl?;
    readonly id: "elevenlabs";
    readonly label = "ElevenLabs";
    readonly model = "eleven_v3";
    /** Single request per render: every SlyCode cap (speak, /voice, generate) is within ElevenLabs' limit. */
    readonly maxRenderChars: number;
    readonly concurrency = 2;
    /** Speed goes in the request body (voice_settings.speed). */
    readonly nativeSpeed = true;
    constructor(config: VoiceConfig, fetchImpl?: typeof fetch | undefined);
    isConfigured(): boolean;
    envDefaultVoice(): VoiceRef | null;
    builtinDefaultVoice(): VoiceRef | null;
    cacheKeyParts(): unknown[];
    render(req: ProviderRenderRequest): Promise<SourceAudio>;
    searchVoices(query: VoiceQuery, opts?: {
        strict?: boolean;
    }): Promise<VoiceInfo[]>;
    /**
     * What a user typed → a voice. Unchanged from feature 086: a 20-character
     * id is taken as an id (ElevenLabs ids are not re-verified); anything else
     * must match exactly ONE voice name (case-insensitive) in a strict search.
     */
    resolveVoiceValue(value: string): Promise<VoiceRef>;
}
/** ElevenLabs voice ids are 20 alphanumeric characters. */
export declare const ELEVENLABS_ID_PATTERN: RegExp;
export interface ElevenLabsVoice {
    voice_id: string;
    name: string;
    category: string;
    description: string;
    labels: Record<string, string>;
    /** ElevenLabs' sample clip (https), when the API gives one. */
    preview_url?: string;
}
/**
 * Like searchElevenLabsVoices but an upstream failure (network, non-2xx)
 * THROWS VoicesUnavailableError instead of degrading to an empty list, so
 * callers that need to distinguish "no such voice" from "could not ask" (the
 * project voice setter, feature 086) never report an outage as "not found".
 */
export declare function searchElevenLabsVoicesStrict(apiKey: string, query?: string): Promise<ElevenLabsVoice[]>;
/** Lenient search (Telegram picker): an upstream failure degrades to an empty list. */
export declare function searchElevenLabsVoices(apiKey: string, query?: string): Promise<ElevenLabsVoice[]>;
