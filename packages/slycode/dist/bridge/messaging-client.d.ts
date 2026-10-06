/**
 * Minimal HTTP client from the bridge to the messaging service (feature 086).
 *
 * The bridge only ever talks to the ONE URL it was configured with
 * (MESSAGING_URL, see index.ts) — never probed across dev/prod. Used for
 * the TTS readiness probe behind GET /speaker and, in the speak route, for
 * POST /tts/render.
 */
import type { SpeechHealth } from './speech-health.js';
export interface MessagingHealth {
    configured: boolean;
    /** true/false from the service; null when unreachable or not configured */
    tts: boolean | null;
    /** The speech-health DTO (feature 087); null when unreachable or from a pre-087 messaging service. */
    speech: SpeechHealth | null;
    checkedAt: number;
}
export interface RenderRequest {
    text: string;
    session?: string;
    projectId?: string;
    voiceId?: string;
    format?: 'mp3';
}
export interface RenderResult {
    ok: true;
    voiceId: string | null;
    format: string;
    bytes: number;
    dataBase64: string;
}
export declare class MessagingError extends Error {
    code: string;
    status: number;
    constructor(code: string, status: number, message: string);
}
export declare const DEFAULT_RENDER_TIMEOUT_MS = 25000;
export declare class MessagingClient {
    private readonly baseUrl;
    private healthCache;
    private healthInFlight;
    constructor(baseUrl: string | null);
    get configured(): boolean;
    /** Cached readiness probe: at most one request per 15 s. */
    health(now?: number): Promise<MessagingHealth>;
    private probe;
    /** Force the next health() call to re-probe (e.g. after a render failure). */
    invalidateHealth(): void;
    /**
     * Render speech to an MP3 buffer via messaging's POST /tts/render.
     * Throws MessagingError with the service's error code where available.
     */
    render(req: RenderRequest, timeoutMs?: number): Promise<RenderResult>;
}
export declare function configureMessagingClient(baseUrl: string | null): MessagingClient;
export declare function getMessagingClient(): MessagingClient;
