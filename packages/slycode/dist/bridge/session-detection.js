/**
 * Session-id detection decision helpers (feature 080).
 *
 * Pure functions only — no fs, no timers, no session-manager imports — so the
 * re-arm gating and relink candidate filtering can be table-tested directly
 * (same pattern as reaper.ts evaluateCandidate / submit-verify.ts classifier).
 */
/** Cooldown between detection re-arms so bursty input doesn't churn directory scans. */
export const GUID_REARM_COOLDOWN_MS = 5000;
/** Files older than session createdAt minus this slack cannot belong to the session. */
export const RELINK_LIFETIME_SLACK_MS = 60_000;
/**
 * Should an input-delivery/attach event (re-)arm the session-id watch?
 * Replaces the old once-only `guidRetryAttempted` debounce.
 */
export function shouldArmDetection(input) {
    if (input.hasId || input.cancelled || input.inFlight)
        return false;
    const cooldown = input.cooldownMs ?? GUID_REARM_COOLDOWN_MS;
    if (input.lastArmedAt !== null && input.now - input.lastArmedAt < cooldown)
        return false;
    return true;
}
/**
 * Filter relink candidates, preserving input order (callers pass newest-first):
 * - drop ids claimed by OTHER sessions (own previous id stays eligible)
 * - drop files that predate the session's creation (minus slack) — they cannot
 *   hold this session's conversation. Unknown timestamps are kept.
 */
export function filterRelinkCandidates(candidates, opts) {
    const slack = opts.slackMs ?? RELINK_LIFETIME_SLACK_MS;
    return candidates.filter(c => {
        if (opts.claimed.has(c.sessionId) && c.sessionId !== opts.ownPrevious)
            return false;
        if (opts.createdAtMs !== null &&
            c.timestampMs !== null &&
            c.timestampMs < opts.createdAtMs - slack) {
            return false;
        }
        return true;
    });
}
//# sourceMappingURL=session-detection.js.map