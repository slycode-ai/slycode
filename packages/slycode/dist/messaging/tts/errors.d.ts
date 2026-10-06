/** Render and provider errors shared by tts.ts, tts-render.ts and the adapters (feature 087). */
/** Thrown when a render (queue wait + provider call + encode) exceeds the caller's deadline. */
export declare class RenderTimeoutError extends Error {
    constructor(ms: number);
}
/** Thrown when the caller abandoned the request (client disconnected) before or during the render. */
export declare class RenderCancelledError extends Error {
    constructor();
}
/** Provider-level failure with a stable code the routes map to HTTP errors. */
export declare class TtsProviderError extends Error {
    readonly code: string;
    readonly status: number;
    constructor(code: string, message: string, status?: number);
}
/** Thrown by strict voice searches when the provider cannot be reached or errors. */
export declare class VoicesUnavailableError extends Error {
    constructor(message: string);
}
/** A failed voice lookup, with candidates the caller can show (rows are VoiceInfo). */
export declare class VoiceLookupError extends TtsProviderError {
    readonly candidates: Array<{
        voice_id: string;
        name: string;
        category: string;
        description?: string;
        labels?: Record<string, string>;
        expiresAt?: string;
    }>;
    constructor(code: 'voice_not_found' | 'voice_ambiguous', message: string, candidates: Array<{
        voice_id: string;
        name: string;
        category: string;
        description?: string;
        labels?: Record<string, string>;
        expiresAt?: string;
    }>);
}
/**
 * A designed (custom) voice that can no longer be rendered: expired by its
 * stored date, or gone at the provider. Routes rewrite the message with the
 * fix, suggesting `--recreate` only when a local recipe exists (feature 087
 * phase 4).
 */
export declare class VoiceUnusableError extends TtsProviderError {
    readonly why: 'expired' | 'missing';
    readonly voice: {
        id: string;
        name: string;
        expiresAt?: string;
    };
    constructor(why: 'expired' | 'missing', voice: {
        id: string;
        name: string;
        expiresAt?: string;
    }, message: string);
}
