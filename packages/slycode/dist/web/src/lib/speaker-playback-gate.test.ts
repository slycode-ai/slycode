import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PlaybackGate, unlockAutoplay } from './speaker-playback-gate';

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
