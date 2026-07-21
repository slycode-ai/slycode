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

export interface RelinkChoiceOptions {
  /** The relinking session's createdAt (epoch ms); null disables the lifetime preference. */
  createdAtMs: number | null;
  slackMs?: number;
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
export function chooseRelinkCandidate(
  candidates: RelinkCandidate[],
  opts: RelinkChoiceOptions
): RelinkCandidate | null {
  if (candidates.length === 0) return null;
  const slack = opts.slackMs ?? RELINK_LIFETIME_SLACK_MS;
  if (opts.createdAtMs !== null) {
    const within = candidates.find(
      c => c.timestampMs === null || c.timestampMs >= (opts.createdAtMs as number) - slack
    );
    if (within) return within;
  }
  return candidates[0];
}
