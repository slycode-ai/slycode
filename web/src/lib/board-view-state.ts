/**
 * Board view state (feature 082) — per-project "which cards have I looked at".
 *
 * This module is the PURE half: types, the tuning constant, and the unseen
 * predicate. It must stay free of `fs`/`path` imports because the board renders
 * client-side and imports computeUnseen directly. The filesystem half lives in
 * board-view-state-store.ts (server only).
 *
 * The state is UI-owned, mirroring documentation/atlas/view-state.json: the web
 * writes it, there is NO CLI write path, and it holds view preferences rather
 * than board data.
 */

/**
 * How long a session must be quiet before its work counts as "settled" and the
 * card is flagged unseen. One of the two tuning knobs; raised 5s -> 10s on
 * 2026-07-29 at Greg's request.
 */
export const UNSEEN_IDLE_MS = 10_000;

export const BOARD_VIEW_STATE_FILE = 'board-view-state.json';

export interface BoardViewState {
  schema_version: number;
  /** cardId -> ISO timestamp of when the card was last opened. */
  card_seen: Record<string, string>;
  /**
   * ISO timestamp stamped once, on first write. Session output older than this
   * is treated as already seen — without it, the first load after deploy would
   * flag every card that has ever had a session, which reads as noise rather
   * than signal.
   */
  baseline_at: string;
}

/** Minimal shape of the per-session activity the predicate needs. */
export interface UnseenSessionInput {
  cardId: string;
  /** Last visible output of ANY size — including one-byte blips. */
  lastOutputAt: string | null;
  /**
   * Last SUSTAINED activity, per the bridge: output within 2s that spanned at
   * least 1s of a burst — the same bar as the blue "actively working" glow.
   * Blips never advance this, which is what keeps them from flagging a card.
   */
  lastActiveAt?: string | null;
}

/**
 * Minimal card shape for the Done-lane suppression rule. Optional — omit it and
 * the predicate behaves exactly as before.
 */
export interface UnseenCardInput {
  id: string;
  stage: string;
  /** ISO. Bumped by a stage move, so it stands in for "arrived in Done". */
  updatedAt: string;
}

/**
 * Which cards are unseen, given the sessions bound to them.
 *
 * A card qualifies when ANY of its sessions has:
 *   - real work — SUSTAINED activity (lastActiveAt), not a stray byte of output
 *   - newer     — that work happened after the card's seen watermark (or baseline)
 *   - settled   — output has been quiet for at least UNSEEN_IDLE_MS
 *
 * Pure so the board and the dashboard roll-up share one definition, and so it
 * is testable without touching the filesystem.
 */
export function computeUnseen(
  sessions: UnseenSessionInput[],
  state: BoardViewState,
  now: Date = new Date(),
  cards?: UnseenCardInput[],
): Set<string> {
  const nowMs = now.getTime();
  const baselineMs = Date.parse(state.baseline_at);
  const unseen = new Set<string>();
  const cardById = cards ? new Map(cards.map((c) => [c.id, c])) : null;

  for (const session of sessions) {
    if (!session.lastOutputAt) continue;
    const outputMs = Date.parse(session.lastOutputAt);
    if (Number.isNaN(outputMs)) continue;

    // What counts as "something happened" is SUSTAINED activity, not raw output.
    // A session can emit a stray byte days after it last did real work (observed
    // live: lastActive 6 days old, lastOutput 13 minutes old) — keying off output
    // flagged those cards for nothing. lastActiveAt only advances when the bridge
    // saw genuine work, so blips are filtered out at the source.
    //
    // Falls back to lastOutputAt when the caller can't supply lastActiveAt, which
    // preserves the old behaviour rather than silently flagging nothing.
    const activityRaw = session.lastActiveAt ?? session.lastOutputAt;
    const activityMs = Date.parse(activityRaw);
    if (Number.isNaN(activityMs)) continue;

    // Settle on raw output, so a card still emitting anything isn't flagged
    // mid-stream. Clock skew can put timestamps in the future — treat that as
    // "not settled yet" rather than flagging it.
    const idleMs = nowMs - outputMs;
    if (idleMs < UNSEEN_IDLE_MS) continue;

    const seenRaw = state.card_seen[session.cardId];
    const seenMs = seenRaw ? Date.parse(seenRaw) : NaN;
    const watermarkMs = Number.isNaN(seenMs) ? baselineMs : seenMs;
    if (!(Number.isNaN(watermarkMs) || activityMs > watermarkMs)) continue;

    // Done-lane rule: a card that MOVED to Done since you last looked has
    // already been acknowledged — finishing it is the acknowledgement, and you
    // aren't going to open it again to admire the result. This deliberately
    // ignores output timing, because an agent usually moves the card to Done
    // and THEN prints its closing summary; keying off the output would flag
    // exactly the case we're trying to suppress.
    //
    // Re-running a Done card still flags it: opening the card to start that run
    // pushes the watermark past updatedAt, so the suppression no longer applies.
    const card = cardById?.get(session.cardId);
    if (card && card.stage === 'done') {
      const updatedMs = Date.parse(card.updatedAt);
      if (!Number.isNaN(updatedMs) && updatedMs > watermarkMs) continue;
    }

    unseen.add(session.cardId);
  }

  return unseen;
}
