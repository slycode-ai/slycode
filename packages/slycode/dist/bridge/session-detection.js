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
 * Choose the candidate an EXPLICIT user relink should bind (feature 080 rev 2).
 *
 * User directive: "if I say relink, I want it to relink" — an explicit relink
 * must succeed whenever any session file exists. Claims held by other session
 * records do NOT veto the choice; the caller transfers the claim instead.
 * Candidates arrive newest-first. Preference order:
 *   1. newest candidate within the session's lifetime (timestamp >= createdAt
 *      minus slack, unknown timestamps count as within) — avoids grabbing an
 *      ancient conversation when a plausible one exists
 *   2. otherwise newest overall (never fail while files exist)
 */
export function chooseRelinkCandidate(candidates, opts) {
    if (candidates.length === 0)
        return null;
    const slack = opts.slackMs ?? RELINK_LIFETIME_SLACK_MS;
    if (opts.createdAtMs !== null) {
        const within = candidates.find(c => c.timestampMs === null || c.timestampMs >= opts.createdAtMs - slack);
        if (within)
            return within;
    }
    return candidates[0];
}
//# sourceMappingURL=session-detection.js.map