export interface LimiterOptions {
    /** Requests per window per key. */
    limit: number;
    windowMs?: number;
    /** Label for messages, e.g. "Gemini TTS". */
    label: string;
    now?: () => number;
    sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
}
export declare class RequestLimiter {
    private readonly opts;
    private readonly stamps;
    private readonly blockedUntil;
    private readonly windowMs;
    private readonly now;
    private readonly sleep;
    constructor(opts: LimiterOptions);
    /** Milliseconds until `key` has a free slot (0 = now). */
    waitMs(key: string): number;
    /**
     * Take a slot for `key`, waiting while the wait fits before the deadline.
     * Throws TtsProviderError('rate_limited') naming the wait when it does not.
     */
    acquire(key: string, deadline: number | (() => number), signal?: AbortSignal): Promise<void>;
    /** Record a provider 429 with its retry hint: no requests for `key` until it has passed. */
    noteRejected(key: string, retryAfterMs: number): void;
}
/** Parse Google's retry hint ("Please retry in 51.37s." or RetryInfo "51s") to ms; default 60 s. */
export declare function parseRetryAfterMs(body: unknown): number;
