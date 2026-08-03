/**
 * Board view state persistence (feature 082) — SERVER ONLY.
 *
 * The filesystem half of board-view-state.ts. Kept separate because the board
 * imports the pure predicate client-side, and an `fs` import would break the
 * client bundle.
 *
 * Writes follow the atlas view-state pattern: read -> mutate -> atomic
 * tmp+rename. Concurrent writes are last-wins, which is fine for a per-user
 * view preference.
 */

import { promises as fs } from 'fs';
import path from 'path';

import { BOARD_VIEW_STATE_FILE, type BoardViewState } from './board-view-state';

export function boardViewStatePath(projectRoot: string): string {
  return path.join(projectRoot, 'documentation', BOARD_VIEW_STATE_FILE);
}

function seededState(nowIso: string): BoardViewState {
  return { schema_version: 1, card_seen: {}, baseline_at: nowIso };
}

/**
 * Read the state file. A missing OR corrupt file yields a freshly seeded state
 * (baseline = now) rather than throwing — this is a view preference, and losing
 * it should never break the board.
 *
 * Note: a seeded return is NOT persisted here. baseline_at is only written on
 * the first markCardSeen, so a read-only board never creates the file.
 */
export async function readBoardViewState(
  projectRoot: string,
  now: Date = new Date(),
): Promise<BoardViewState> {
  try {
    const raw = await fs.readFile(boardViewStatePath(projectRoot), 'utf-8');
    const parsed = JSON.parse(raw) as Partial<BoardViewState>;
    if (!parsed || typeof parsed !== 'object') return seededState(now.toISOString());
    return {
      schema_version: typeof parsed.schema_version === 'number' ? parsed.schema_version : 1,
      card_seen:
        parsed.card_seen && typeof parsed.card_seen === 'object' ? parsed.card_seen : {},
      baseline_at:
        typeof parsed.baseline_at === 'string' ? parsed.baseline_at : now.toISOString(),
    };
  } catch {
    return seededState(now.toISOString());
  }
}

/** Stamp a card as seen. Atomic write, copying the atlas view-state pattern. */
export async function markCardSeen(
  projectRoot: string,
  cardId: string,
  now: Date = new Date(),
): Promise<BoardViewState> {
  const nowIso = now.toISOString();
  const state = await readBoardViewState(projectRoot, now);
  state.card_seen[cardId] = nowIso;

  const file = boardViewStatePath(projectRoot);
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = file + `.tmp-${process.pid}`;
  await fs.writeFile(tmp, JSON.stringify(state, null, 2) + '\n', 'utf-8');
  await fs.rename(tmp, file);
  return state;
}
