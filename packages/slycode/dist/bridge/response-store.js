// Two-window expiry model (card #0332). Each entry has:
//  - a LOCK window: createdAt + effectiveTimeout + LOCK_GRACE_MS. Past this the
//    entry no longer call-locks its target session (a hard-killed caller that
//    never posted /timeout must not wedge the target), but it stays deliverable.
//  - a DELIVERY window: createdAt + effectiveTimeout + DELIVERY_GRACE_MS. Only
//    past this is the entry removed (envelope kept in recentlyExpired).
// effectiveTimeout is the caller's registered --wait timeout, falling back to
// DEFAULT_TIMEOUT_MS for registrations from older CLIs that send none.
export const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes (legacy lock bound)
export const LOCK_GRACE_MS = 60 * 1000; // 60 seconds
export const DELIVERY_GRACE_MS = 24 * 60 * 60 * 1000; // 24 hours
const CLEANUP_INTERVAL_MS = 60 * 1000; // 60 seconds
const RECENTLY_EXPIRED_MAX = 200;
/**
 * In-memory store for cross-card prompt responses.
 * Manages the response callback protocol: register → poll → deliver.
 * Handles call locking and late response injection tracking.
 *
 * Delivery is multi-shot within the delivery window: a second `deliver()`
 * call overwrites the previous payload (the latest delivery wins). For a
 * still-polling caller the recovery window is bounded by the 2 s polling
 * cadence; for a timed-out caller the late-injection path fires on every
 * successful delivery.
 *
 * Lock lifetime and delivery lifetime are decoupled (see the window
 * constants above): an entry stops call-locking its target shortly after
 * the caller's own wait must have ended, but remains deliverable for a
 * generous grace so long-running agent work is never lost at the door.
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
     * `timeoutMs` is the caller's --wait timeout; both expiry windows derive
     * from it (older CLIs omit it → DEFAULT_TIMEOUT_MS).
     */
    register(responseId, callingSession, targetSession, timeoutMs) {
        this.responses.set(responseId, {
            responseId,
            callingSession,
            targetSession,
            status: 'pending',
            createdAt: Date.now(),
            ...(timeoutMs !== undefined ? { timeoutMs } : {}),
        });
    }
    effectiveTimeoutMs(entry) {
        return entry.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    }
    /** Past this, the entry no longer call-locks its target session. */
    isLockStale(entry, now) {
        return now - entry.createdAt > this.effectiveTimeoutMs(entry) + LOCK_GRACE_MS;
    }
    /** Past this, the entry is removed by cleanup (envelope retained). */
    isDeliveryExpired(entry, now) {
        return now - entry.createdAt > this.effectiveTimeoutMs(entry) + DELIVERY_GRACE_MS;
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
                callingSession: found.callingSession,
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
            callingSession: entry.callingSession,
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
     * Entries past their lock window never lock — a hard-killed caller that
     * never posted /timeout must not wedge the target session.
     */
    isSessionLocked(sessionName, excludeResponseId, now = Date.now()) {
        for (const entry of this.responses.values()) {
            if (entry.responseId === excludeResponseId)
                continue; // a submission never locks itself
            if (entry.targetSession === sessionName && entry.status === 'pending' && !entry.callerTimedOut
                && !this.isLockStale(entry, now)) {
                return true;
            }
        }
        return false;
    }
    /**
     * Get the active lock info for a session (for error messages).
     */
    getActiveLock(sessionName, excludeResponseId, now = Date.now()) {
        for (const entry of this.responses.values()) {
            if (entry.responseId === excludeResponseId)
                continue;
            if (entry.targetSession === sessionName && entry.status === 'pending' && !entry.callerTimedOut
                && !this.isLockStale(entry, now)) {
                return { callingSession: entry.callingSession, lockedAt: entry.createdAt };
            }
        }
        return null;
    }
    /**
     * Remove entries past their delivery window. Before deleting, push a small
     * envelope into the recentlyExpired ring-buffer so subsequent delivery
     * attempts can still late-inject (and be told why the live entry is gone).
     * `now` is injectable for tests.
     */
    cleanup(now = Date.now()) {
        for (const [id, entry] of this.responses) {
            if (this.isDeliveryExpired(entry, now)) {
                this.pushExpired(entry, 'expired');
                this.responses.delete(id);
            }
        }
    }
}
//# sourceMappingURL=response-store.js.map