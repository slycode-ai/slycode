/**
 * Tests for AudioHolder — one player per browser election (feature 086).
 *
 *   ./bridge/node_modules/.bin/tsx web/src/lib/audio-holder.test.ts
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AudioHolder, type HolderChannel, type HolderMessage, type RelayState } from './audio-holder';

/** In-memory bus shared by fake tabs. Delivers synchronously to every other subscriber. */
function makeBus() {
  const subs = new Set<(m: HolderMessage) => void>();
  const log: HolderMessage[] = [];
  const channel: HolderChannel = {
    post(msg) {
      log.push(msg);
      for (const s of [...subs]) s(msg);
    },
    subscribe(l) {
      subs.add(l);
      return () => { subs.delete(l); };
    },
  };
  return { channel, log };
}

function makeTab(bus: ReturnType<typeof makeBus>, id: string, clock: { t: number }, visible = () => true) {
  const events: string[] = [];
  const commands: string[] = [];
  const states: RelayState[] = [];
  const holder = new AudioHolder({
    tabId: id,
    channel: bus.channel,
    now: () => clock.t,
    isVisible: visible,
    onBecomeHolder: () => events.push('become'),
    onLoseHolder: () => events.push('lose'),
    onCommand: (c) => commands.push(c),
    onState: (s) => states.push(s),
  });
  return { holder, events, commands, states };
}

test('single tab becomes holder on start', () => {
  const bus = makeBus();
  const clock = { t: 1000 };
  const a = makeTab(bus, 'a', clock);
  a.holder.start();
  assert.equal(a.holder.isHolder, true);
  assert.deepEqual(a.events, ['become']);
});

test('lowest tabId wins among live visible tabs; loser hands over seen ids', () => {
  const bus = makeBus();
  const clock = { t: 1000 };
  const b = makeTab(bus, 'b', clock);
  b.holder.start();
  assert.equal(b.holder.isHolder, true);
  b.holder.markSeen('clip-1');

  const a = makeTab(bus, 'a', clock);
  a.holder.start();
  assert.equal(a.holder.isHolder, true, 'a (lower id) takes over');
  assert.equal(b.holder.isHolder, false);
  assert.deepEqual(b.events, ['become', 'lose']);
  assert.equal(a.holder.hasSeen('clip-1'), true, 'seen ids relayed on handover');
});

test('dead peer (no heartbeat for 10 s) triggers re-election', () => {
  const bus = makeBus();
  const clock = { t: 1000 };
  const a = makeTab(bus, 'a', clock);
  const b = makeTab(bus, 'b', clock);
  a.holder.start();
  b.holder.start();
  assert.equal(a.holder.isHolder, true);
  // a silently disappears (no release); b keeps ticking
  clock.t += 11000;
  b.holder.tick();
  assert.equal(b.holder.isHolder, true, 'b takes over after a times out');
});

test('visible tab preferred over hidden tab when nothing is playing', () => {
  const bus = makeBus();
  const clock = { t: 1000 };
  let aVisible = true;
  const a = makeTab(bus, 'a', clock, () => aVisible);
  const b = makeTab(bus, 'b', clock, () => true);
  a.holder.start();
  b.holder.start();
  assert.equal(a.holder.isHolder, true);
  aVisible = false;
  a.holder.visibilityChanged();
  assert.equal(b.holder.isHolder, true, 'visible b pre-empts hidden idle a');
  assert.equal(a.holder.isHolder, false);
});

test('hidden holder mid-clip is NOT pre-empted by a visible tab', () => {
  const bus = makeBus();
  const clock = { t: 1000 };
  let aVisible = true;
  const a = makeTab(bus, 'a', clock, () => aVisible);
  const b = makeTab(bus, 'b', clock, () => true);
  a.holder.start();
  b.holder.start();
  a.holder.setPlaying(true);
  aVisible = false;
  a.holder.visibilityChanged();
  assert.equal(a.holder.isHolder, true, 'a keeps holding while playing');
  assert.equal(b.holder.isHolder, false);
});

test('claimNow (Play in this tab) beats visibility and id order', () => {
  const bus = makeBus();
  const clock = { t: 1000 };
  const a = makeTab(bus, 'a', clock);
  const b = makeTab(bus, 'b', clock);
  a.holder.start();
  b.holder.start();
  a.holder.setPlaying(true);
  clock.t += 5;
  b.holder.claimNow();
  assert.equal(b.holder.isHolder, true);
  assert.equal(a.holder.isHolder, false);
});

test('commands from a non-holder reach the holder; state relays the other way', () => {
  const bus = makeBus();
  const clock = { t: 1000 };
  const a = makeTab(bus, 'a', clock);
  const b = makeTab(bus, 'b', clock);
  a.holder.start();
  b.holder.start();
  b.holder.sendCommand('dismiss');
  assert.deepEqual(a.commands, ['dismiss']);
  assert.deepEqual(b.commands, [], 'non-holder does not act locally');
  a.holder.sendCommand('pause');
  assert.deepEqual(a.commands, ['dismiss', 'pause'], 'holder acts locally');

  const state: RelayState = { enabled: true, revision: 3, playing: true, blocked: false, caption: null, queueLength: 1 };
  a.holder.publishState(state);
  assert.deepEqual(b.states, [state]);
  b.holder.publishState(state);
  assert.equal(a.states.length, 0, 'non-holder publish is ignored');
});

test('stop releases and the survivor takes over', () => {
  const bus = makeBus();
  const clock = { t: 1000 };
  const a = makeTab(bus, 'a', clock);
  const b = makeTab(bus, 'b', clock);
  a.holder.start();
  b.holder.start();
  a.holder.markSeen('x');
  a.holder.stop();
  assert.equal(b.holder.isHolder, true);
  assert.equal(b.holder.hasSeen('x'), true);
  assert.deepEqual(a.events, ['become', 'lose']);
});

test('seen set is bounded', () => {
  const bus = makeBus();
  const clock = { t: 1000 };
  const holder = new AudioHolder({ tabId: 'a', channel: bus.channel, now: () => clock.t, seenCap: 3 });
  holder.start();
  for (const id of ['1', '2', '3', '4']) holder.markSeen(id);
  assert.equal(holder.hasSeen('1'), false);
  assert.equal(holder.hasSeen('4'), true);
});

test('losing holder hands its queue payload to the winner', () => {
  const bus = makeBus();
  const clock = { t: 1000 };
  const received: unknown[] = [];
  const b = new AudioHolder({ tabId: 'b', channel: bus.channel, now: () => clock.t, getHandoverPayload: () => ['clip-9'] });
  b.start();
  const a = new AudioHolder({ tabId: 'a', channel: bus.channel, now: () => clock.t, onHandoverPayload: (p) => received.push(p) });
  a.start();
  assert.equal(a.isHolder, true);
  assert.deepEqual(received, [['clip-9']]);
});

// ---- fix-loop additions (feature 086 review findings 5 and 6) ----

function makeTabR(bus: ReturnType<typeof makeBus>, id: string, clock: { t: number }) {
  const recording: boolean[] = [];
  const syncs: string[] = [];
  const holder = new AudioHolder({
    tabId: id,
    channel: bus.channel,
    now: () => clock.t,
    onRecordingChange: (a) => recording.push(a),
    onSyncRequest: () => syncs.push('sync'),
  });
  return { holder, recording, syncs };
}

test('recording ownership: a dictating follower pauses the holder and survives handover', () => {
  const bus = makeBus();
  const clock = { t: 1000 };
  const a = makeTabR(bus, 'a', clock);
  const b = makeTabR(bus, 'b', clock);
  a.holder.start();
  b.holder.start();
  assert.equal(a.holder.isHolder, true);
  // b (not holder) starts dictating
  b.holder.setRecording(true);
  assert.equal(a.holder.isAnyRecording(), true, 'holder sees the follower recording');
  assert.deepEqual(a.recording, [true]);
  // handover: a leaves, b becomes holder — the recording flag must still hold
  a.holder.stop();
  assert.equal(b.holder.isHolder, true);
  assert.equal(b.holder.isAnyRecording(), true, 'new holder still knows recording is in progress');
  // a new tab joins mid-recording and becomes holder (lower id) — learns it from heartbeats
  const z = makeTabR(bus, '0', clock);
  z.holder.start();
  assert.equal(z.holder.isHolder, true);
  assert.equal(z.holder.isAnyRecording(), true, 'late-joining holder learns recording from the claim/heartbeat exchange');
  b.holder.setRecording(false);
  assert.equal(z.holder.isAnyRecording(), false);
  assert.deepEqual(z.recording, [true, false]);
});

test('recording ownership: a recording tab that dies releases the pause via liveness', () => {
  const bus = makeBus();
  const clock = { t: 1000 };
  const a = makeTabR(bus, 'a', clock);
  const b = makeTabR(bus, 'b', clock);
  a.holder.start();
  b.holder.start();
  b.holder.setRecording(true);
  assert.equal(a.holder.isAnyRecording(), true);
  // b vanishes without a release; a keeps ticking past the liveness timeout
  clock.t += 11000;
  a.holder.tick();
  assert.equal(a.holder.isAnyRecording(), false, 'dead recording peer no longer blocks playback');
  assert.deepEqual(a.recording, [true, false]);
});

test('sync-on-join: the holder is asked to republish when a new tab claims', () => {
  const bus = makeBus();
  const clock = { t: 1000 };
  const a = makeTabR(bus, 'a', clock);
  a.holder.start();
  assert.deepEqual(a.syncs, []);
  const b = makeTabR(bus, 'b', clock);
  b.holder.start();
  assert.deepEqual(a.syncs, ['sync'], 'holder republishes for the newcomer');
  assert.deepEqual(b.syncs, [], 'follower is never asked to sync');
});

test('relayed state can carry availability so followers converge on ON and on TTS status', () => {
  const bus = makeBus();
  const clock = { t: 1000 };
  const a = makeTab(bus, 'a', clock);
  const b = makeTab(bus, 'b', clock);
  a.holder.start();
  b.holder.start();
  a.holder.publishState({ enabled: true, revision: 4, playing: false, blocked: false, caption: null, queueLength: 0, availability: { messagingRunning: true, tts: true } });
  assert.equal(b.states.length, 1);
  assert.equal(b.states[0].enabled, true);
  assert.deepEqual(b.states[0].availability, { messagingRunning: true, tts: true });
});
