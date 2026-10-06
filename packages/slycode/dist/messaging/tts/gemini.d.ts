/**
 * Gemini TTS adapter (feature 087, phase 2).
 *
 * Render: POST v1beta/models/{model}:generateContent with responseModalities
 * AUDIO; one request part per style run (speech_metadata.style), events as
 * <angle> tags. The unary response is WAV (fmt, data, then a C2PA manifest
 * chunk); only the data payload is used (audio-encode.parseWav).
 *
 * Voices (phase 0 findings): ~2,100 prebuilt voices; the API's own search
 * only matches name/description, accent filters need exact strings and a
 * 1000-item page drops the next-page token. So the prebuilt catalogue is
 * fetched in pages of 200, cached for 24 h and searched locally; custom
 * (designed) voices are fetched fresh. GET /voices/{id} works only for custom
 * voices. Studio voice ids are lowercase ("kore"); library display names
 * repeat, so names resolve only for studio and custom voices.
 */
import type { VoiceConfig } from '../types.js';
import { TtsProviderError } from './errors.js';
import { RequestLimiter } from './rate-limit.js';
import { type DesignedVoice, type ProviderRenderRequest, type SourceAudio, type TtsProvider, type VoiceCloneRequest, type VoiceDesignRequest, type VoiceInfo, type VoiceQuery, type VoiceRef } from './provider.js';
export declare const GEMINI_DEFAULT_MODEL = "gemini-3.8-flash-tts";
export declare const GEMINI_CONCURRENCY: number;
export declare const GEMINI_TTS_RPM: number;
/** Voice design is synchronous; phase 0 measured 26 s. */
export declare const DESIGN_TIMEOUT_MS: number;
/** The 30 studio voices with Google's one-word descriptors (offline fallback). */
export declare const STUDIO_VOICES: ReadonlyArray<{
    id: string;
    name: string;
    descriptor: string;
}>;
/** Voice as the Gemini voices API returns it (fields we use). */
interface ApiVoice {
    id: string;
    type?: string;
    display_name?: string;
    description?: string;
    language_code?: string;
    accent?: string;
    gender?: string;
    persona?: string;
    expire_time?: string;
    model?: string;
    prompted?: {
        input?: string;
    };
    sample_audio?: {
        mime_type?: string;
        mimeType?: string;
        data?: string;
    };
}
/**
 * The built-in default voice (owner choice, #0376): library voice Zuri, the
 * closest stock voice to the owner's own. It replaces studio voice Kore.
 * Known offline like the studio voices, so lookups, `voice set Zuri` and
 * switch checks need no catalogue fetch. Rendered on a plain paid key 2026-10-05.
 */
export declare const BUILTIN_VOICE: Readonly<ApiVoice>;
/**
 * Google's clone refusals that need their own message (#0376 live probe,
 * 2026-10-05): a failed consent check came back as HTTP **500** INTERNAL
 * whose debug detail carries "Consent flow failed … The recorded phrase
 * didn't match the text on screen …" (code FINISH_REASON_INPUT_VR_TAKEDOWN),
 * so this reads the whole error, not the status. A location block is
 * Google's usual "User location is not supported" FAILED_PRECONDITION.
 */
export declare function cloneRefusal(json: Record<string, any>): TtsProviderError | null;
export declare class GeminiProvider implements TtsProvider {
    private readonly config;
    readonly id: "gemini";
    readonly label = "Gemini";
    readonly model: string;
    readonly maxRenderChars = 600;
    readonly concurrency: number;
    /** No speed control in the API: SlyCode time-stretches the PCM (tts/time-stretch.ts). */
    readonly nativeSpeed = false;
    readonly limiter: RequestLimiter;
    private readonly fetchImpl?;
    private catalogue;
    private catalogueLoading;
    constructor(config: VoiceConfig, opts?: {
        fetchImpl?: typeof fetch;
        limiter?: RequestLimiter;
    });
    private get doFetch();
    private headers;
    isConfigured(): boolean;
    envDefaultVoice(): VoiceRef | null;
    builtinDefaultVoice(): VoiceRef;
    cacheKeyParts(): unknown[];
    render(req: ProviderRenderRequest): Promise<SourceAudio>;
    private httpError;
    private parseAudio;
    private listVoices;
    /** The prebuilt catalogue, cached for 24 h (background refresh after expiry). */
    private prebuilt;
    private customVoices;
    searchVoices(query: VoiceQuery, opts?: {
        strict?: boolean;
    }): Promise<VoiceInfo[]>;
    getVoice(id: string): Promise<VoiceInfo | null>;
    /**
     * POST /voices with type 'prompted' (phase 0: synchronous, ~26 s, the voice
     * object at the top level with a WAV sample). Store is required.
     */
    designVoice(req: VoiceDesignRequest): Promise<DesignedVoice>;
    /**
     * POST /voices with type 'replicated' (#0376): the sample and the consent
     * statement go inline as WAV. Same synchronous shape as design. Google
     * checks the consent speaker matches the sample; a refusal is mapped to
     * clone_consent_failed, a location block to clone_unavailable_region.
     */
    cloneVoice(req: VoiceCloneRequest): Promise<DesignedVoice>;
    /** The shared create call (design and clone). Store is required. */
    private createVoice;
    /** DELETE /voices/{id}. True when deleted now; false when Google says it was already gone. */
    deleteVoice(id: string): Promise<boolean>;
    /** The recipe Google still holds for a designed voice (`prompted.input`), or null once it is gone. */
    remoteRecipe(id: string): Promise<{
        name: string;
        description: string;
        gender?: string;
        language?: string;
        expiresAt?: string;
    } | null>;
    private decodeSample;
    private apiError;
    /** Built-in default (Zuri) by id or name → exact id (studio ids case-insensitively) → else exact studio/custom name → else not found/ambiguous. */
    resolveVoiceValue(value: string): Promise<VoiceRef>;
}
export {};
