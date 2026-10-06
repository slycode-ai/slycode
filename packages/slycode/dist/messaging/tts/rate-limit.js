/**
 * Sliding-window request limiter per model (feature 087).
 *
 * Phase 0 measured 10 requests/minute per model on a Gemini TTS key; requests
 * past that get 429 (not billed). The limiter queues requests inside each
 * caller's deadline and fails at once — naming the wait — when the next slot
 * would arrive too late. A 429 that still happens (another process sharing the
 * key) blocks the model until Google's "retry in N s" hint has passed.
 */
import { TtsProviderError } from './errors.js';
function defaultSleep(ms, signal) {
    return new Promise((resolve, reject) => {
        if (signal?.aborted)
            return reject(signal.reason instanceof Error ? signal.reason : new Error('aborted'));
        const t = setTimeout(() => { signal?.removeEventListener('abort', onAbort); resolve(); }, ms);
        const onAbort = () => { clearTimeout(t); reject(signal.reason instanceof Error ? signal.reason : new Error('aborted')); };
        signal?.addEventListener('abort', onAbort, { once: true });
    });
}
export class RequestLimiter {
    opts;
    stamps = new Map();
    blockedUntil = new Map();
    windowMs;
    now;
    sleep;
    constructor(opts) {
        this.opts = opts;
        this.windowMs = opts.windowMs ?? 60_000;
        this.now = opts.now ?? Date.now;
        this.sleep = opts.sleep ?? defaultSleep;
    }
    /** Milliseconds until `key` has a free slot (0 = now). */
    waitMs(key) {
        const now = this.now();
        const recent = (this.stamps.get(key) ?? []).filter((t) => now - t < this.windowMs);
        this.stamps.set(key, recent);
        const block = Math.max(0, (this.blockedUntil.get(key) ?? 0) - now);
        const windowWait = recent.length < this.opts.limit ? 0 : recent[0] + this.windowMs - now;
        return Math.max(block, windowWait);
    }
    /**
     * Take a slot for `key`, waiting while the wait fits before the deadline.
     * Throws TtsProviderError('rate_limited') naming the wait when it does not.
     */
    async acquire(key, deadline, signal) {
        for (;;) {
            // A function deadline is re-read on every pass (a shared render's
            // deadline moves with its live waiters).
            const deadlineAt = typeof deadline === 'function' ? deadline() : deadline;
            const wait = this.waitMs(key);
            if (wait === 0) {
                this.stamps.get(key).push(this.now());
                return;
            }
            if (this.now() + wait > deadlineAt) {
                throw new TtsProviderError('rate_limited', `${this.opts.label} limit (${this.opts.limit} requests/min) reached; next slot in ${Math.ceil(wait / 1000)} s.`, 429);
            }
            await this.sleep(wait, signal);
        }
    }
    /** Record a provider 429 with its retry hint: no requests for `key` until it has passed. */
    noteRejected(key, retryAfterMs) {
        const until = this.now() + Math.max(0, retryAfterMs);
        this.blockedUntil.set(key, Math.max(until, this.blockedUntil.get(key) ?? 0));
    }
}
/** Parse Google's retry hint ("Please retry in 51.37s." or RetryInfo "51s") to ms; default 60 s. */
export function parseRetryAfterMs(body) {
    const err = body?.error;
    const fromDetails = err?.details?.find((d) => typeof d?.retryDelay === 'string')?.retryDelay;
    const m = /([\d.]+)\s*s/.exec(fromDetails ?? '') ?? /retry in ([\d.]+)\s*s/i.exec(err?.message ?? '');
    return m ? Math.ceil(parseFloat(m[1]) * 1000) : 60_000;
}
//# sourceMappingURL=rate-limit.js.map