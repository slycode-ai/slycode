const RESPONSE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const CLEANUP_INTERVAL_MS = 60 * 1000; // 60 seconds
const RECENTLY_EXPIRED_MAX = 200;
/**
 * In-memory store for cross-card prompt responses.
 * Manages the response callback protocol: register → poll → deliver.
 * Handles call locking and late response injection tracking.
 *
 * Delivery is multi-shot within TTL: a second `deliver()` call overwrites
 * the previous payload (the latest delivery wins). For a still-polling caller
 * the recovery window is bounded by the 2 s polling cadence; for a timed-out
 * caller the late-injection path fires on every successful delivery, which
 * gives the caller a full-TTL recovery window via PTY injection.
 */
export class ResponseStore {
    responses = new Map();
    cleanupTimer = null;
    recentlyExpired = [];
    start() {
        this.cleanupTimer = setInterval(() => this.cleanup(), CLEANUP_INTERVAL_MS);
    }
    stop() {
        if (this.cleanupTimer) {
            clearInterval(this.cleanupTimer);
            this.cleanupTimer = null;
        }
    }
    /**
     * Register a pending response for a --wait prompt.
     * Also acts as a call lock on the target session.
     */
    register(responseId, callingSession, targetSession) {
        this.responses.set(responseId, {
            responseId,
            callingSession,
            targetSession,
            status: 'pending',
            createdAt: Date.now(),
        });
    }
    /**
     * Poll for a response by ID.
     */
    poll(responseId) {
        return this.responses.get(responseId) || null;
    }
    /**
     * Deliver a response (called by sly-kanban respond via POST /responses/:id).
     * Returns the entry so the caller can check if late injection is needed.
     *
     * Multi-shot within TTL: a re-delivery while the entry is still in the
     * map overwrites the payload. The first delivery flips status to
     * 'received'; subsequent deliveries keep it there but update data and
     * fire the late-injection trigger again if the caller has timed out.
     */
    deliver(responseId, data) {
        const entry = this.responses.get(responseId);
        if (!entry)
            return null;
        const isFirstDelivery = entry.status === 'pending';
        entry.data = data;
        entry.status = 'received';
        // Depth-clearing fires on first delivery only — subsequent re-deliveries
        // are the same logical exchange.
        if (isFirstDelivery && this.onResponseDelivered) {
            this.onResponseDelivered(entry.targetSession);
        }
        return entry;
    }
    /**
     * Look up envelope metadata for an ID that is no longer in the live map.
     * Returns 'unknown' when the ID was never seen (typo, or bridge restarted).
     */
    getExpiryHint(responseId) {
        const found = this.recentlyExpired.find(e => e.responseId === responseId);
        if (found) {
            return {
                reason: found.reason,
                issuedAt: found.issuedAt,
                expiredAt: found.expiredAt,
            };
        }
        return { reason: 'unknown' };
    }
    pushExpired(entry, reason) {
        this.recentlyExpired.unshift({
            responseId: entry.responseId,
            reason,
            issuedAt: entry.createdAt,
            expiredAt: Date.now(),
            targetSession: entry.targetSession,
        });
        if (this.recentlyExpired.length > RECENTLY_EXPIRED_MAX) {
            this.recentlyExpired.length = RECENTLY_EXPIRED_MAX;
        }
    }
    // Callback for clearing depth tracking when a response is delivered
    onResponseDelivered = null;
    /**
     * Mark that the caller has timed out and stopped polling.
     * Late responses should be injected into the calling session's PTY.
     */
    markCallerTimedOut(responseId) {
        const entry = this.responses.get(responseId);
        if (entry) {
            entry.callerTimedOut = true;
        }
    }
    /**
     * Check if a session is locked by an active --wait call.
     */
    isSessionLocked(sessionName) {
        for (const entry of this.responses.values()) {
            if (entry.targetSession === sessionName && entry.status === 'pending' && !entry.callerTimedOut) {
                return true;
            }
        }
        return false;
    }
    /**
     * Get the active lock info for a session (for error messages).
     */
    getActiveLock(sessionName) {
        for (const entry of this.responses.values()) {
            if (entry.targetSession === sessionName && entry.status === 'pending' && !entry.callerTimedOut) {
                return { callingSession: entry.callingSession, lockedAt: entry.createdAt };
            }
        }
        return null;
    }
    /**
     * Remove expired entries (older than TTL). Before deleting, push a small
     * envelope into the recentlyExpired ring-buffer so subsequent delivery
     * attempts can be told *why* they failed.
     */
    cleanup() {
        const now = Date.now();
        for (const [id, entry] of this.responses) {
            if (now - entry.createdAt > RESPONSE_TTL_MS) {
                this.pushExpired(entry, 'expired');
                this.responses.delete(id);
            }
        }
    }
}
//# sourceMappingURL=response-store.js.map