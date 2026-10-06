import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PlaybackGate, unlockAutoplay, planManualPlay, planPlayRejection, isAutoPlayable, handoverReceivedAt, AUTO_PLAY_WINDOW_MS, describePlayError, describeMediaError, computeProgress, progressFillStyle, clipListRefreshKey, trackPhase, TRACK_HOLD_MS, TRACK_FADE_MS } from './speaker-playback-gate';

test('gate waits until a fresh snapshot arrives after invalidate (handover)', () => {
  const g = new PlaybackGate();
  assert.equal(g.decide({ revision: 3 }), 'wait', 'no snapshot yet');
  g.applySnapshot({ enabled: true, revision: 3 });
  assert.equal(g.decide({ revision: 3 }), 'play');
  g.invalidate(); // new holder / new stream
  assert.equal(g.decide({ revision: 3 }), 'wait', 'relayed clips must wait for the new stream snapshot');
  g.applySnapshot({ enabled: true, revision: 3 });
  assert.equal(g.decide({ revision: 3 }), 'play');
});

test('gate drops clips older than the snapshot revision (revoked) and waits on newer ones', () => {
  const g = new PlaybackGate();
  g.applySnapshot({ enabled: true, revision: 5 });
  assert.equal(g.decide({ revision: 4 }), 'drop');
  assert.equal(g.decide({ revision: 6 }), 'wait', 'clip newer than our snapshot means we are stale');
  assert.equal(g.decide({ revision: 5 }), 'play');
});

test('gate never plays while permission is off or while dictation records', () => {
  const g = new PlaybackGate();
  g.applySnapshot({ enabled: false, revision: 2 });
  assert.equal(g.decide({ revision: 2 }), 'wait');
  g.applySnapshot({ enabled: true, revision: 2 });
  g.setRecording(true);
  assert.equal(g.decide({ revision: 2 }), 'wait');
  g.setRecording(false);
  assert.equal(g.decide({ revision: 2 }), 'play');
});

test('handover scenario: revoked clip relayed from the old holder is dropped once the fresh snapshot lands', () => {
  const g = new PlaybackGate();
  g.invalidate();
  const relayed = { revision: 7 };
  assert.equal(g.decide(relayed), 'wait');
  // The bridge bumped the revision (OFF then ON) while the handover was in flight.
  g.applySnapshot({ enabled: true, revision: 8 });
  assert.equal(g.decide(relayed), 'drop');
});

test('unlockAutoplay never touches the playback element (only a throwaway one)', () => {
  const playback = { pauseCalls: 0, playCalls: 0, pause() { this.pauseCalls++; }, play() { this.playCalls++; return Promise.resolve(); } };
  const throwaways: Array<{ muted: boolean; src: string; played: number }> = [];
  const ctxCalls: string[] = [];
  const result = unlockAutoplay({
    makeAudio: () => {
      const el = { muted: false, src: '', played: 0, play() { el.played++; return Promise.resolve(); } };
      throwaways.push(el);
      return el;
    },
    audioContext: {
      state: 'suspended',
      resume: async () => { ctxCalls.push('resume'); },
      createBuffer: () => ({}),
      createBufferSource: () => ({ buffer: null, connect: () => ctxCalls.push('connect'), start: () => ctxCalls.push('start') }),
      destination: {},
    },
  });
  assert.equal(result.touchedContext, true);
  assert.equal(result.touchedAudio, true);
  assert.equal(throwaways.length, 1);
  assert.equal(throwaways[0].muted, true);
  assert.equal(throwaways[0].played, 1);
  assert.deepEqual(ctxCalls, ['resume', 'connect', 'start']);
  // The playback element was never handed to the unlock and is untouched.
  assert.equal(playback.pauseCalls, 0);
  assert.equal(playback.playCalls, 0);
});

test('unlockAutoplay survives a throwing context and a blocked throwaway play', () => {
  const result = unlockAutoplay({
    makeAudio: () => ({ muted: false, src: '', play: () => Promise.reject(new Error('NotAllowedError')) }),
    audioContext: { state: 'running', resume: async () => {}, createBuffer: () => { throw new Error('boom'); }, createBufferSource: () => { throw new Error('boom'); }, destination: {} },
  });
  assert.equal(result.touchedContext, false);
  assert.equal(result.touchedAudio, true);
});

test('manual Play on a delivered clip plays even when the gate would block autoplay', () => {
  const g = new PlaybackGate();
  g.invalidate(); // handover: no fresh snapshot
  g.setRecording(false);
  const clip = { clipId: 'c1', revision: 7 };
  assert.equal(g.decide(clip), 'wait', 'autoplay must wait');
  const plan = planManualPlay({ isHolder: true, current: clip, queue: [], captionClipId: 'c1' });
  assert.deepEqual(plan, { action: 'play-current' }, 'a deliberate click bypasses the gate');
  g.applySnapshot({ enabled: false, revision: 7 });
  assert.equal(g.decide(clip), 'wait', 'even permission-off blocks autoplay');
  assert.deepEqual(planManualPlay({ isHolder: true, current: clip, queue: [], captionClipId: 'c1' }), { action: 'play-current' });
});

test('manual Play finds the clip the user is looking at in the queue, or claims holdership from a follower', () => {
  assert.deepEqual(
    planManualPlay({ isHolder: true, current: null, queue: [{ clipId: 'a' }, { clipId: 'b' }], captionClipId: 'b' }),
    { action: 'play-queued', index: 1 },
  );
  assert.deepEqual(
    planManualPlay({ isHolder: true, current: { clipId: 'x' }, queue: [{ clipId: 'b' }], captionClipId: 'b' }),
    { action: 'play-queued', index: 0 },
    'caption clip wins over an unrelated current clip',
  );
  assert.deepEqual(planManualPlay({ isHolder: false, current: null, queue: [], captionClipId: 'b' }), { action: 'claim-and-wait' });
  const none = planManualPlay({ isHolder: true, current: null, queue: [], captionClipId: 'gone' });
  assert.equal(none.action, 'nothing');
  assert.match((none as { reason: string }).reason, /Nothing left to play/);
});

test('play() failures are described honestly: only NotAllowedError is an autoplay block', () => {
  assert.deepEqual(describePlayError({ name: 'NotAllowedError' }), { autoplayBlocked: true, text: 'Browser blocked audio. Click Play reply.' });
  assert.equal(describePlayError({ name: 'NotSupportedError' }).autoplayBlocked, false);
  assert.match(describePlayError({ name: 'NotSupportedError' }).text, /format/);
  assert.equal(describePlayError({ name: 'AbortError' }).autoplayBlocked, false);
  assert.match(describePlayError(new Error('boom')).text, /Playback failed.*boom/);
  assert.match(describeMediaError(4), /not supported/);
  assert.match(describeMediaError(3), /decoded/);
  assert.match(describeMediaError(undefined, 'x'), /x/);
});

test('Replay: a click on a clip that already finished replays it, bypassing the gate', () => {
  const g = new PlaybackGate();
  g.invalidate();
  assert.equal(g.decide({ revision: 2 }), 'wait');
  assert.deepEqual(
    planManualPlay({ isHolder: true, current: null, queue: [], captionClipId: 'done', lastPlayed: { clipId: 'done' } }),
    { action: 'replay-last' },
  );
  // A newer queued clip the user is looking at still wins over the finished one.
  assert.deepEqual(
    planManualPlay({ isHolder: true, current: null, queue: [{ clipId: 'next' }], captionClipId: 'next', lastPlayed: { clipId: 'done' } }),
    { action: 'play-queued', index: 0 },
  );
  // A finished clip that is not the one on screen is not replayed by accident.
  assert.equal(
    planManualPlay({ isHolder: true, current: null, queue: [], captionClipId: 'other', lastPlayed: { clipId: 'done' } }).action,
    'nothing',
  );
});

test('progress follows the element clock, is indeterminate without a finite duration, and completes on ended', () => {
  assert.deepEqual(computeProgress({ currentTime: 0, duration: NaN, ended: false }), { fraction: null, indeterminate: true, complete: false }, 'before loadedmetadata');
  assert.deepEqual(computeProgress({ currentTime: 3, duration: Infinity, ended: false }), { fraction: null, indeterminate: true, complete: false }, 'streaming-style duration');
  assert.deepEqual(computeProgress({ currentTime: 1.2, duration: 4.8, ended: false }), { fraction: 0.25, indeterminate: false, complete: false });
  assert.deepEqual(computeProgress({ currentTime: 9, duration: 4.8, ended: false }), { fraction: 1, indeterminate: false, complete: false }, 'clamped');
  assert.deepEqual(computeProgress({ currentTime: NaN, duration: 4.8, ended: false }), { fraction: 0, indeterminate: false, complete: false });
  assert.deepEqual(computeProgress({ currentTime: 4.1, duration: 4.8, ended: true }), { fraction: 1, indeterminate: false, complete: true }, 'ended always finishes the bar');
  assert.equal(computeProgress({ currentTime: 5, duration: 5, ended: false }).fraction, 1);
});

test('decoded duration is authoritative when the element over-estimates a header-less MP3', () => {
  // Element thinks 12.5 s (bitrate estimate); the decoded clip is really 5 s.
  assert.deepEqual(
    computeProgress({ currentTime: 2, duration: 12.5, ended: false, decodedDuration: 5 }),
    { fraction: 0.4, indeterminate: false, complete: false },
    'fraction uses the decoded length, not the element estimate',
  );
  // Without decoding the same instant would read as 16% — the bug Greg saw.
  assert.equal(computeProgress({ currentTime: 2, duration: 12.5, ended: false }).fraction, 0.16);
  // Reaching the decoded end completes the bar even though the element has not fired ended.
  assert.deepEqual(
    computeProgress({ currentTime: 4.97, duration: 12.5, ended: false, decodedDuration: 5 }),
    { fraction: 1, indeterminate: false, complete: true },
  );
  // Element under-estimating (decoded longer) never completes early.
  assert.equal(computeProgress({ currentTime: 3, duration: 3, ended: false, decodedDuration: 6 }).complete, false);
  assert.equal(computeProgress({ currentTime: 3, duration: 3, ended: false, decodedDuration: 6 }).fraction, 0.5);
  // A decoded duration removes the indeterminate state even before metadata.
  assert.deepEqual(computeProgress({ currentTime: 0, duration: NaN, ended: false, decodedDuration: 5 }), { fraction: 0, indeterminate: false, complete: false });
  // Garbage decoded value falls back to the element.
  assert.equal(computeProgress({ currentTime: 1, duration: 4, ended: false, decodedDuration: NaN }).fraction, 0.25);
});

test('fill style is derived from fraction only (scaleX from the left), never from a stylesheet animation', () => {
  assert.deepEqual(progressFillStyle({ fraction: 0, indeterminate: false, complete: false }), { transform: 'scaleX(0)', transformOrigin: 'left' });
  assert.deepEqual(progressFillStyle({ fraction: 0.552, indeterminate: false, complete: false }), { transform: 'scaleX(0.552)', transformOrigin: 'left' });
  assert.deepEqual(progressFillStyle({ fraction: 1, indeterminate: false, complete: true }), { transform: 'scaleX(1)', transformOrigin: 'left' });
  assert.deepEqual(progressFillStyle({ fraction: 7, indeterminate: false, complete: false }), { transform: 'scaleX(1)', transformOrigin: 'left' }, 'clamped');
  assert.equal(progressFillStyle({ fraction: null, indeterminate: true, complete: false }), undefined, 'indeterminate leaves the CSS sweep in charge');
  // Greg's captured sequence maps 1:1 onto the fill.
  for (const f of [0.175, 0.361, 0.552, 0.739, 0.927, 1]) {
    assert.equal(progressFillStyle({ fraction: f, indeterminate: false, complete: f === 1 })?.transform, `scaleX(${f})`);
  }
});

test('the footer Replay refetch key changes on every delivered clip, not only on mount', () => {
  const base = { clipSeq: 0, revision: 1, enabled: true as boolean | null, replayableClipId: null as string | null, captionClipId: null as string | null };
  const k0 = clipListRefreshKey(base);
  assert.equal(clipListRefreshKey({ ...base }), k0, 'stable when nothing changed');
  assert.notEqual(clipListRefreshKey({ ...base, clipSeq: 1 }), k0, 'a delivery (stream clip event) triggers a refetch');
  assert.notEqual(clipListRefreshKey({ ...base, revision: 2 }), k0, 'a speaker-state change triggers a refetch');
  assert.notEqual(clipListRefreshKey({ ...base, replayableClipId: 'c1' }), k0, 'a finished clip triggers a refetch');
  assert.notEqual(clipListRefreshKey({ ...base, captionClipId: 'c1' }), k0, 'a relayed caption triggers a refetch in follower tabs');
});

test('after a clip ends the bar holds at 100%, fades, then hides; Replay brings it back', () => {
  const done = { fraction: 1, indeterminate: false, complete: true };
  assert.deepEqual(progressFillStyle(done), { transform: 'scaleX(1)', transformOrigin: 'left' }, 'still full during the hold');
  assert.equal(trackPhase({ playing: true, complete: false, msSinceComplete: null }), 'live');
  assert.equal(trackPhase({ playing: false, complete: true, msSinceComplete: 0 }), 'live', 'hold at 100% right after ended');
  assert.equal(trackPhase({ playing: false, complete: true, msSinceComplete: TRACK_HOLD_MS }), 'fading');
  assert.equal(trackPhase({ playing: false, complete: true, msSinceComplete: TRACK_HOLD_MS + TRACK_FADE_MS }), 'hidden', 'ended → hidden after the fade');
  assert.equal(trackPhase({ playing: false, complete: false, msSinceComplete: null }), 'hidden', 'idle: no bar');
  // Replay: the clip restarts (fraction 0, complete false) → the bar is back.
  assert.equal(trackPhase({ playing: true, complete: false, msSinceComplete: 5000 }), 'live');
  assert.deepEqual(progressFillStyle({ fraction: 0, indeterminate: false, complete: false }), { transform: 'scaleX(0)', transformOrigin: 'left' });
});

// #0377: an interrupted auto clip was marked seen and dropped, so the bubble
// showed "interrupted", its Play reply found nothing, and only the card Replay worked.
const REJ = { errName: 'AbortError', manual: false, superseded: false, isHolder: true, retried: false, fresh: true, visible: true };

test('planPlayRejection: an outside interruption of a fresh auto clip retries once, then holds it for Play reply', () => {
  assert.equal(planPlayRejection(REJ), 'retry');
  assert.equal(planPlayRejection({ ...REJ, retried: true }), 'hold', 'visible tab, live clip: the user is waiting, show why');
  assert.equal(planPlayRejection({ ...REJ, retried: true, visible: false }), 'park', 'background interruption: silent, Play reply stays');
});

test('planPlayRejection: our own stop/replace and a lost holdership never surface an error or drop the clip', () => {
  assert.equal(planPlayRejection({ ...REJ, superseded: true }), 'ignore');
  assert.equal(planPlayRejection({ ...REJ, manual: true, superseded: true }), 'ignore');
  assert.equal(planPlayRejection({ ...REJ, isHolder: false }), 'ignore', 'handover carried the clip to the new holder');
});

test('planPlayRejection: a stale clip is retired silently, never warned about (resume / late retry)', () => {
  assert.equal(planPlayRejection({ ...REJ, fresh: false }), 'demote');
  assert.equal(planPlayRejection({ ...REJ, fresh: false, retried: true }), 'demote');
  assert.equal(planPlayRejection({ ...REJ, errName: 'NotAllowedError', fresh: false }), 'demote');
  assert.equal(planPlayRejection({ ...REJ, manual: true, fresh: false }), 'hold', 'a click on an old clip still shows why it failed');
});

test('planPlayRejection: autoplay block parks silently, manual failures warn, real auto failures skip', () => {
  assert.equal(planPlayRejection({ ...REJ, errName: 'NotAllowedError' }), 'park');
  assert.equal(planPlayRejection({ ...REJ, errName: 'NotAllowedError', manual: true }), 'hold');
  assert.equal(planPlayRejection({ ...REJ, errName: 'NotSupportedError', manual: true }), 'hold');
  assert.equal(planPlayRejection({ ...REJ, errName: 'NotSupportedError' }), 'skip');
  assert.equal(planPlayRejection({ ...REJ, errName: '' }), 'skip');
});

test('isAutoPlayable: only fresh, unheard, unexpired clips start without a click', () => {
  const now = 10_000_000;
  assert.equal(isAutoPlayable({ receivedAt: now - 5_000, expiresAt: now + 60_000, seen: false, now }), true);
  assert.equal(isAutoPlayable({ receivedAt: now - 5_000, expiresAt: now + 60_000, seen: true, now }), false, 'heard in any tab never comes back on its own');
  assert.equal(isAutoPlayable({ receivedAt: now - 5_000, expiresAt: now - 1, seen: false, now }), false, 'past the bridge expiry');
  assert.equal(isAutoPlayable({ receivedAt: now - AUTO_PLAY_WINDOW_MS - 1, expiresAt: null, seen: false, now }), false, 'card-replay clip (no expiry) parked, then resumed hours later');
  assert.equal(isAutoPlayable({ receivedAt: now - AUTO_PLAY_WINDOW_MS, expiresAt: null, seen: false, now }), true);
});

test('resume after hours away: a dictation-end resume / late retry of the parked clip is refused', () => {
  // A clip parked at 12:00 (background interruption or dictation pause); the
  // owner returns at 15:40 and the dictation-end resume or a throttled retry
  // timer fires — the old clip must not start, so no "interrupted" warning either.
  const parkedAt = Date.UTC(2026, 9, 5, 1, 0, 0);
  const back = parkedAt + (3 * 60 + 40) * 60_000;
  assert.equal(isAutoPlayable({ receivedAt: parkedAt, expiresAt: parkedAt + 90_000, seen: false, now: back }), false);
  assert.equal(planPlayRejection({ ...REJ, fresh: false, visible: true, retried: true }), 'demote');
});

test('handover keeps the original arrival time, so an old clip cannot be re-armed by changing tabs', () => {
  const now = 50_000_000;
  const old = now - 3 * 60 * 60_000;
  const received = handoverReceivedAt({ receivedAt: old }, now);
  assert.equal(received, old);
  assert.equal(isAutoPlayable({ receivedAt: received, expiresAt: null, seen: false, now }), false);
  assert.equal(handoverReceivedAt({}, now), now, 'legacy payload without receivedAt');
  assert.equal(handoverReceivedAt({ receivedAt: Number.NaN }, now), now);
});
