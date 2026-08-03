/**
 * Tests for the unseen-card predicate and seen-state persistence (feature 082).
 *
 * The predicate is the load-bearing part: it decides whether a card shows the
 * attention marker, and it has three ways to go wrong — flagging mid-run
 * sessions, flagging output the user already read, and flagging everything on
 * first run (the baseline guard).
 *
 * Self-contained script (no test runner configured in web/). Run via:
 *
 *   ./bridge/node_modules/.bin/tsx web/src/lib/board-view-state.test.ts
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';

import { UNSEEN_IDLE_MS, computeUnseen, type BoardViewState } from './board-view-state';
import {
  boardViewStatePath,
  markCardSeen,
  readBoardViewState,
} from './board-view-state-store';

const NOW = new Date('2026-07-27T12:00:00.000Z');
const nowMs = NOW.getTime();

/** ISO timestamp N ms before NOW. */
function ago(ms: number): string {
  return new Date(nowMs - ms).toISOString();
}

function stateWith(cardSeen: Record<string, string>, baselineMsAgo = 60 * 60 * 1000): BoardViewState {
  return { schema_version: 1, card_seen: cardSeen, baseline_at: ago(baselineMsAgo) };
}

async function tmpProject(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'board-view-state-'));
  await fs.mkdir(path.join(dir, 'documentation'), { recursive: true });
  return dir;
}

// ---------------------------------------------------------------- predicate

test('computeUnseen — no lastOutputAt means nothing to have missed', () => {
  const unseen = computeUnseen([{ cardId: 'card-1', lastOutputAt: null }], stateWith({}), NOW);
  assert.equal(unseen.size, 0);
});

test('computeUnseen — output newer than the watermark but still mid-run is NOT unseen', () => {
  // 1s of silence: the agent is probably between tool calls, not finished.
  const unseen = computeUnseen(
    [{ cardId: 'card-1', lastOutputAt: ago(1000) }],
    stateWith({ 'card-1': ago(10 * 60 * 1000) }),
    NOW,
  );
  assert.equal(unseen.has('card-1'), false);
});

test('computeUnseen — settled output newer than the watermark IS unseen', () => {
  const unseen = computeUnseen(
    [{ cardId: 'card-1', lastOutputAt: ago(UNSEEN_IDLE_MS + 1000) }],
    stateWith({ 'card-1': ago(10 * 60 * 1000) }),
    NOW,
  );
  assert.equal(unseen.has('card-1'), true);
});

test('computeUnseen — exactly at the threshold counts as settled', () => {
  const unseen = computeUnseen(
    [{ cardId: 'card-1', lastOutputAt: ago(UNSEEN_IDLE_MS) }],
    stateWith({ 'card-1': ago(10 * 60 * 1000) }),
    NOW,
  );
  assert.equal(unseen.has('card-1'), true);
});

test('computeUnseen — output older than the watermark was already read', () => {
  const unseen = computeUnseen(
    [{ cardId: 'card-1', lastOutputAt: ago(10 * 60 * 1000) }],
    stateWith({ 'card-1': ago(60 * 1000) }),
    NOW,
  );
  assert.equal(unseen.has('card-1'), false);
});

test('computeUnseen — no watermark falls back to the baseline (first-run guard)', () => {
  // Output predates the baseline: this is history from before the feature
  // existed, so it must NOT produce a wall of markers on first load.
  const unseen = computeUnseen(
    [{ cardId: 'card-1', lastOutputAt: ago(2 * 60 * 60 * 1000) }],
    stateWith({}, 60 * 60 * 1000),
    NOW,
  );
  assert.equal(unseen.has('card-1'), false);
});

test('computeUnseen — no watermark, output after the baseline IS unseen', () => {
  const unseen = computeUnseen(
    [{ cardId: 'card-1', lastOutputAt: ago(30 * 60 * 1000) }],
    stateWith({}, 60 * 60 * 1000),
    NOW,
  );
  assert.equal(unseen.has('card-1'), true);
});

test('computeUnseen — a card with several sessions is unseen if ANY qualifies', () => {
  const unseen = computeUnseen(
    [
      { cardId: 'card-1', lastOutputAt: ago(1000) },                      // mid-run
      { cardId: 'card-1', lastOutputAt: ago(UNSEEN_IDLE_MS + 5000) },     // settled + new
    ],
    stateWith({ 'card-1': ago(10 * 60 * 1000) }),
    NOW,
  );
  assert.equal(unseen.has('card-1'), true);
});

test('computeUnseen — future lastOutputAt (clock skew) is treated as not settled', () => {
  const unseen = computeUnseen(
    [{ cardId: 'card-1', lastOutputAt: new Date(nowMs + 60_000).toISOString() }],
    stateWith({}),
    NOW,
  );
  assert.equal(unseen.has('card-1'), false);
});

test('computeUnseen — unparseable timestamps are skipped, not thrown on', () => {
  const unseen = computeUnseen(
    [{ cardId: 'card-1', lastOutputAt: 'not-a-date' }],
    stateWith({}),
    NOW,
  );
  assert.equal(unseen.size, 0);
});

// --------------------------------------------------- blip filtering

test('computeUnseen — a stray blip long after the real work does NOT flag', () => {
  // Observed live on 2026-07-29: sessions whose lastActive was hours or days old
  // but which emitted a byte minutes ago. Those were the false alarms.
  const unseen = computeUnseen(
    [{
      cardId: 'card-1',
      lastOutputAt: ago(60_000),                 // blipped a minute ago
      lastActiveAt: ago(6 * 60 * 60 * 1000),     // real work was 6h ago
    }],
    stateWith({ 'card-1': ago(3 * 60 * 60 * 1000) }), // looked 3h ago, after the work
    NOW,
  );
  assert.equal(unseen.has('card-1'), false);
});

test('computeUnseen — sustained work newer than the watermark DOES flag', () => {
  const unseen = computeUnseen(
    [{ cardId: 'card-1', lastOutputAt: ago(30_000), lastActiveAt: ago(45_000) }],
    stateWith({ 'card-1': ago(10 * 60 * 1000) }),
    NOW,
  );
  assert.equal(unseen.has('card-1'), true);
});

test('computeUnseen — real work, but a fresh blip keeps it unsettled', () => {
  // Work finished, then something emitted a byte 2s ago: still streaming as far
  // as we can tell, so hold off rather than flag mid-stream.
  const unseen = computeUnseen(
    [{ cardId: 'card-1', lastOutputAt: ago(2_000), lastActiveAt: ago(60_000) }],
    stateWith({ 'card-1': ago(10 * 60 * 1000) }),
    NOW,
  );
  assert.equal(unseen.has('card-1'), false);
});

test('computeUnseen — omitting lastActiveAt falls back to lastOutputAt', () => {
  const unseen = computeUnseen(
    [{ cardId: 'card-1', lastOutputAt: ago(UNSEEN_IDLE_MS + 1000) }],
    stateWith({ 'card-1': ago(10 * 60 * 1000) }),
    NOW,
  );
  assert.equal(unseen.has('card-1'), true);
});

// ------------------------------------------------- Done-lane suppression

test('computeUnseen — Done card that moved since you last looked is suppressed', () => {
  // The agent moved it to Done (updatedAt) AFTER you last opened it, then kept
  // printing its summary. Finishing the card is the acknowledgement.
  const unseen = computeUnseen(
    [{ cardId: 'card-1', lastOutputAt: ago(30_000) }],
    stateWith({ 'card-1': ago(20 * 60 * 1000) }),
    NOW,
    [{ id: 'card-1', stage: 'done', updatedAt: ago(10 * 60 * 1000) }],
  );
  assert.equal(unseen.has('card-1'), false);
});

test('computeUnseen — Done card re-run AFTER you opened it still flags', () => {
  // Opening the card to start the new run pushed the watermark past the move,
  // so the suppression no longer applies.
  const unseen = computeUnseen(
    [{ cardId: 'card-1', lastOutputAt: ago(30_000) }],
    stateWith({ 'card-1': ago(5 * 60 * 1000) }),
    NOW,
    [{ id: 'card-1', stage: 'done', updatedAt: ago(10 * 60 * 1000) }],
  );
  assert.equal(unseen.has('card-1'), true);
});

test('computeUnseen — suppression applies ONLY to the Done lane', () => {
  const cards = [{ id: 'card-1', stage: 'testing', updatedAt: ago(10 * 60 * 1000) }];
  const unseen = computeUnseen(
    [{ cardId: 'card-1', lastOutputAt: ago(30_000) }],
    stateWith({ 'card-1': ago(20 * 60 * 1000) }),
    NOW,
    cards,
  );
  assert.equal(unseen.has('card-1'), true);
});

test('computeUnseen — omitting cards keeps the original behaviour', () => {
  const unseen = computeUnseen(
    [{ cardId: 'card-1', lastOutputAt: ago(30_000) }],
    stateWith({ 'card-1': ago(20 * 60 * 1000) }),
    NOW,
  );
  assert.equal(unseen.has('card-1'), true);
});

test('computeUnseen — unknown card id falls through to the normal rule', () => {
  const unseen = computeUnseen(
    [{ cardId: 'card-ghost', lastOutputAt: ago(30_000) }],
    stateWith({}),
    NOW,
    [{ id: 'card-1', stage: 'done', updatedAt: ago(10 * 60 * 1000) }],
  );
  assert.equal(unseen.has('card-ghost'), true);
});

// -------------------------------------------------------------- persistence

test('readBoardViewState — missing file yields a seeded state, does not throw', async () => {
  const dir = await tmpProject();
  const state = await readBoardViewState(dir, NOW);
  assert.equal(state.schema_version, 1);
  assert.deepEqual(state.card_seen, {});
  assert.equal(state.baseline_at, NOW.toISOString());
  // Reading must not create the file — a read-only board leaves no trace.
  await assert.rejects(() => fs.access(boardViewStatePath(dir)));
});

test('readBoardViewState — corrupt file is treated as absent', async () => {
  const dir = await tmpProject();
  await fs.writeFile(boardViewStatePath(dir), '{ this is not json', 'utf-8');
  const state = await readBoardViewState(dir, NOW);
  assert.deepEqual(state.card_seen, {});
  assert.equal(state.baseline_at, NOW.toISOString());
});

test('markCardSeen — creates the file and stamps the watermark', async () => {
  const dir = await tmpProject();
  await markCardSeen(dir, 'card-1', NOW);
  const onDisk = JSON.parse(await fs.readFile(boardViewStatePath(dir), 'utf-8')) as BoardViewState;
  assert.equal(onDisk.card_seen['card-1'], NOW.toISOString());
  assert.equal(onDisk.baseline_at, NOW.toISOString());
});

test('markCardSeen — baseline is stamped once, not moved on later writes', async () => {
  const dir = await tmpProject();
  await markCardSeen(dir, 'card-1', NOW);

  const later = new Date(nowMs + 60 * 60 * 1000);
  await markCardSeen(dir, 'card-2', later);

  const onDisk = JSON.parse(await fs.readFile(boardViewStatePath(dir), 'utf-8')) as BoardViewState;
  assert.equal(onDisk.baseline_at, NOW.toISOString(), 'baseline must not drift');
  assert.equal(onDisk.card_seen['card-1'], NOW.toISOString());
  assert.equal(onDisk.card_seen['card-2'], later.toISOString());
});

test('markCardSeen then computeUnseen — opening a card clears its marker', async () => {
  const dir = await tmpProject();
  const sessions = [{ cardId: 'card-1', lastOutputAt: ago(UNSEEN_IDLE_MS + 1000) }];

  const before = await readBoardViewState(dir, new Date(nowMs - 60 * 60 * 1000));
  assert.equal(computeUnseen(sessions, before, NOW).has('card-1'), true);

  await markCardSeen(dir, 'card-1', NOW);
  const after = await readBoardViewState(dir, NOW);
  assert.equal(computeUnseen(sessions, after, NOW).has('card-1'), false);
});
