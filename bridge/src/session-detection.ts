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

export interface ArmDecisionInput {
  hasId: boolean;          // session already has a captured provider id
  cancelled: boolean;      // guidDetectionCancelled (session stopped/exited)
  inFlight: boolean;       // a watch is currently running for this session
  lastArmedAt: number | null; // epoch ms of the last arm, null if never armed
  now: number;             // epoch ms
  cooldownMs?: number;
}

/**
 * Should an input-delivery/attach event (re-)arm the session-id watch?
 * Replaces the old once-only `guidRetryAttempted` debounce.
 */
export function shouldArmDetection(input: ArmDecisionInput): boolean {
  if (input.hasId || input.cancelled || input.inFlight) return false;
  const cooldown = input.cooldownMs ?? GUID_REARM_COOLDOWN_MS;
  if (input.lastArmedAt !== null && input.now - input.lastArmedAt < cooldown) return false;
  return true;
}

export interface RelinkCandidate {
  sessionId: string;
  /** Best-known creation/activity timestamp for the file (epoch ms); null when unknown. */
  timestampMs: number | null;
}

export interface RelinkFilterOptions {
  /** Provider ids already claimed by any session (active or persisted). */
  claimed: Set<string>;
  /** The relinking session's own current id — stays eligible despite being claimed. */
  ownPrevious: string | null;
  /** The relinking session's createdAt (epoch ms); null skips the lifetime check. */
  createdAtMs: number | null;
  slackMs?: number;
}

/**
 * Filter relink candidates, preserving input order (callers pass newest-first):
 * - drop ids claimed by OTHER sessions (own previous id stays eligible)
 * - drop files that predate the session's creation (minus slack) — they cannot
 *   hold this session's conversation. Unknown timestamps are kept.
 */
export function filterRelinkCandidates(
  candidates: RelinkCandidate[],
  opts: RelinkFilterOptions
): RelinkCandidate[] {
  const slack = opts.slackMs ?? RELINK_LIFETIME_SLACK_MS;
  return candidates.filter(c => {
    if (opts.claimed.has(c.sessionId) && c.sessionId !== opts.ownPrevious) return false;
    if (
      opts.createdAtMs !== null &&
      c.timestampMs !== null &&
      c.timestampMs < opts.createdAtMs - slack
    ) {
      return false;
    }
    return true;
  });
}
