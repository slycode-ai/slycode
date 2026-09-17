/**
 * Tests for ConnectionBudget — per-browser live-connection tally and the
 * plain-HTTP starvation verdict (card #0356, option E).
 *
 *   ./bridge/node_modules/.bin/tsx web/src/lib/connection-budget.test.ts
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ConnectionBudget,
  classifyProtocol,
  BROWSER_H1_CONNECTION_LIMIT,
  DEFAULT_BUDGET_TIMEOUT_MS,
  type BudgetChannel,
  type BudgetMessage,
  type BudgetVerdict,
} from './connection-budget';

/** In-memory bus shared by fake tabs. Delivers synchronously to every subscriber (incl. sender; the class filters self). */
function makeBus() {
  const subs = new Set<(m: BudgetMessage) => void>();
  const log: BudgetMessage[] = [];
  const channel: BudgetChannel = {
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

function makeTab(bus: ReturnType<typeof makeBus>, id: string, clock: { t: number }) {
  const verdicts: BudgetVerdict[] = [];
  const budget = new ConnectionBudget({
    tabId: id,
    channel: bus.channel,
    now: () => clock.t,
    onVerdict: (v) => verdicts.push(v),
  });
  return { budget, verdicts, last: () => verdicts[verdicts.length - 1] };
}

// ---------------------------------------------------------------------------
// Protocol detection
// ---------------------------------------------------------------------------

test('classifyProtocol: https pages are multiplexed (silent) whatever the hops say', () => {
  assert.equal(classifyProtocol({ locationProtocol: 'https:', nextHopProtocols: [] }), 'multiplexed');
  assert.equal(classifyProtocol({ locationProtocol: 'https:', nextHopProtocols: ['h2'] }), 'multiplexed');
  assert.equal(classifyProtocol({ locationProtocol: 'https:', nextHopProtocols: ['h3'] }), 'multiplexed');
  assert.equal(classifyProtocol({ locationProtocol: 'https:', nextHopProtocols: ['http/1.1'] }), 'multiplexed');
});

test('classifyProtocol: http pages are plain HTTP/1.1 — with or without timing entries', () => {
  assert.equal(classifyProtocol({ locationProtocol: 'http:', nextHopProtocols: [] }), 'plain-http');
  assert.equal(classifyProtocol({ locationProtocol: 'http:', nextHopProtocols: ['http/1.1'] }), 'plain-http');
  assert.equal(classifyProtocol({ locationProtocol: 'http:', nextHopProtocols: ['http/1.1', ''] }), 'plain-http');
  // Mixed evidence: any HTTP/1.x hop means the cap applies.
  assert.equal(classifyProtocol({ locationProtocol: 'http:', nextHopProtocols: ['h2c', 'http/1.1'] }), 'plain-http');
});

test('classifyProtocol: honours h2c-only evidence and reports unknown when there is none', () => {
  assert.equal(classifyProtocol({ locationProtocol: 'http:', nextHopProtocols: ['h2c'] }), 'multiplexed');
  assert.equal(classifyProtocol({ locationProtocol: 'file:', nextHopProtocols: [] }), 'unknown');
  assert.equal(classifyProtocol({ locationProtocol: 'file:', nextHopProtocols: ['http/1.1'] }), 'plain-http');
});

// ---------------------------------------------------------------------------
// Tally and threshold
// ---------------------------------------------------------------------------

test('a lone tab under the limit is not starved', () => {
  const bus = makeBus();
  const clock = { t: 1000 };
  const a = makeTab(bus, 'a', clock);
  a.budget.start();
  a.budget.setLocal({ streams: 3, active: true, connectingForMs: 0 });
  const v = a.budget.evaluate();
  assert.equal(v.starved, false);
  assert.equal(v.total, 3);
  assert.equal(v.own, 3);
  assert.equal(v.peerTabs, 0);
  assert.equal(v.limit, BROWSER_H1_CONNECTION_LIMIT);
});

test('three tabs with a board + terminal each (plus the audio holder) total 7 and every tab is starved', () => {
  const bus = makeBus();
  const clock = { t: 1000 };
  const a = makeTab(bus, 'a', clock);
  const b = makeTab(bus, 'b', clock);
  const c = makeTab(bus, 'c', clock);
  a.budget.start(); b.budget.start(); c.budget.start();
  a.budget.setLocal({ streams: 3, active: true, connectingForMs: 0 }); // board + terminal + audio
  b.budget.setLocal({ streams: 2, active: true, connectingForMs: 0 });
  c.budget.setLocal({ streams: 2, active: false, connectingForMs: 0 });
  for (const t of [a, b, c]) {
    const v = t.budget.evaluate();
    assert.equal(v.total, 7, `${t.budget.id} total`);
    assert.equal(v.starved, true, `${t.budget.id} starved`);
    assert.equal(v.reason, 'over-budget');
    assert.equal(v.peerTabs, 2);
  }
});

test('exactly the limit counts as starved — six held streams leave no slot for the input POST', () => {
  const bus = makeBus();
  const clock = { t: 1000 };
  const a = makeTab(bus, 'a', clock);
  const b = makeTab(bus, 'b', clock);
  a.budget.start(); b.budget.start();
  a.budget.setLocal({ streams: 3, active: true, connectingForMs: 0 });
  b.budget.setLocal({ streams: 2, active: true, connectingForMs: 0 });
  assert.equal(a.budget.evaluate().starved, false, '5 is fine');
  b.budget.setLocal({ streams: 3, active: true, connectingForMs: 0 });
  assert.equal(a.budget.evaluate().total, 6);
  assert.equal(a.budget.evaluate().starved, true);
});

test('the verdict clears as soon as another tab drops its streams', () => {
  const bus = makeBus();
  const clock = { t: 1000 };
  const a = makeTab(bus, 'a', clock);
  const b = makeTab(bus, 'b', clock);
  a.budget.start(); b.budget.start();
  a.budget.setLocal({ streams: 3, active: true, connectingForMs: 0 });
  b.budget.setLocal({ streams: 4, active: true, connectingForMs: 0 });
  assert.equal(a.last().starved, true);
  b.budget.setLocal({ streams: 1, active: true, connectingForMs: 0 }); // user closed the card modal in tab b
  assert.equal(a.last().starved, false);
  assert.equal(a.last().total, 4);
});

test('a closing tab says bye and is dropped from the total immediately', () => {
  const bus = makeBus();
  const clock = { t: 1000 };
  const a = makeTab(bus, 'a', clock);
  const b = makeTab(bus, 'b', clock);
  a.budget.start(); b.budget.start();
  a.budget.setLocal({ streams: 3, active: true, connectingForMs: 0 });
  b.budget.setLocal({ streams: 4, active: true, connectingForMs: 0 });
  assert.equal(a.last().starved, true);
  b.budget.stop();
  assert.equal(a.last().starved, false);
  assert.equal(a.last().total, 3);
  assert.equal(a.last().peerTabs, 0);
});

test('a killed tab (no goodbye, no beats) is pruned only after the multi-minute silence', () => {
  const bus = makeBus();
  const clock = { t: 1000 };
  const a = makeTab(bus, 'a', clock);
  const b = makeTab(bus, 'b', clock);
  a.budget.start(); b.budget.start();
  a.budget.setLocal({ streams: 3, active: true, connectingForMs: 0 });
  b.budget.setLocal({ streams: 4, active: true, connectingForMs: 0 });
  assert.equal(a.budget.evaluate().starved, true);
  // b's process dies without a bye; a keeps beating, b does not.
  clock.t += DEFAULT_BUDGET_TIMEOUT_MS - 1000;
  a.budget.tick();
  assert.equal(a.budget.evaluate().total, 7, 'still counted just inside the timeout');
  clock.t += 2000;
  a.budget.tick();
  assert.equal(a.budget.evaluate().total, 3, 'pruned once the silence exceeds the timeout');
  assert.equal(a.budget.evaluate().starved, false);
  assert.deepEqual(a.budget.livePeerIds(), []);
});

test('a throttled background tab beating once a minute stays counted (Chrome intensive throttling)', () => {
  const bus = makeBus();
  const clock = { t: 1000 };
  const fg = makeTab(bus, 'fg', clock);
  const bg = makeTab(bus, 'bg', clock);
  fg.budget.start(); bg.budget.start();
  fg.budget.setLocal({ streams: 2, active: true, connectingForMs: 0 });
  bg.budget.setLocal({ streams: 4, active: true, connectingForMs: 0 }); // hidden, holding streams
  assert.equal(fg.budget.evaluate().total, 6);
  assert.equal(fg.budget.evaluate().starved, true);
  // Ten minutes: the foreground beats every 3 s, the hidden tab only once per minute.
  for (let step = 0; step < 200; step++) {
    clock.t += 3000;
    fg.budget.tick();
    if (step % 20 === 19) bg.budget.tick(); // every 60 s
    assert.equal(fg.budget.evaluate().total, 6, `background tab dropped at step ${step}`);
  }
  assert.equal(fg.budget.evaluate().starved, true, 'banner stays up while the pool is still exhausted');
  assert.deepEqual(fg.budget.livePeerIds(), ['bg']);
});

test('announce() on wake posts a hello that every live peer answers at once', () => {
  const bus = makeBus();
  const clock = { t: 1000 };
  const a = makeTab(bus, 'a', clock);
  const b = makeTab(bus, 'b', clock);
  const c = makeTab(bus, 'c', clock);
  a.budget.start(); b.budget.start(); c.budget.start();
  a.budget.setLocal({ streams: 2, active: true, connectingForMs: 0 });
  b.budget.setLocal({ streams: 2, active: true, connectingForMs: 0 });
  c.budget.setLocal({ streams: 3, active: true, connectingForMs: 0 });
  const beats = (id: string) => bus.log.filter((m) => m.type === 'beat' && m.tabId === id).length;
  const hellos = () => bus.log.filter((m) => m.type === 'hello' && m.tabId === 'a').length;
  const [b0, c0, h0] = [beats('b'), beats('c'), hellos()];
  a.budget.announce(); // tab a just became visible after a long throttled sleep
  assert.equal(hellos(), h0 + 1, 'a re-announced with a hello');
  assert.equal(beats('b'), b0 + 1, 'b answered immediately');
  assert.equal(beats('c'), c0 + 1, 'c answered immediately');
  assert.equal(a.budget.evaluate().total, 7);
  assert.equal(a.last().starved, true);
  // Not started → announce is a no-op.
  const d = makeTab(bus, 'd', clock);
  const before = bus.log.length;
  d.budget.announce();
  assert.equal(bus.log.length, before);
});

test('a newcomer learns the existing total from the immediate reply to its hello', () => {
  const bus = makeBus();
  const clock = { t: 1000 };
  const a = makeTab(bus, 'a', clock);
  a.budget.start();
  a.budget.setLocal({ streams: 5, active: true, connectingForMs: 0 });
  const b = makeTab(bus, 'b', clock);
  b.budget.start();
  // No tick has happened yet — b already knows about a's five streams.
  assert.equal(b.budget.evaluate().total, 5);
  assert.equal(b.budget.evaluate().peerTabs, 1);
  b.budget.setLocal({ streams: 2, active: false, connectingForMs: 0 });
  assert.equal(b.last().starved, true);
  assert.equal(b.last().total, 7);
});

// ---------------------------------------------------------------------------
// Starvation signal: stuck CONNECTING while the host is reachable
// ---------------------------------------------------------------------------

test('a stream stuck CONNECTING beyond the stall threshold is starvation when some tab is receiving data', () => {
  const bus = makeBus();
  const clock = { t: 1000 };
  const a = makeTab(bus, 'a', clock);
  const b = makeTab(bus, 'b', clock);
  a.budget.start(); b.budget.start();
  b.budget.setLocal({ streams: 2, active: true, connectingForMs: 0 }); // b is fine → host reachable
  a.budget.setLocal({ streams: 2, active: false, connectingForMs: 6000 }); // a's new stream never opens
  const v = a.budget.evaluate();
  assert.equal(v.total, 4, 'under the counted limit — the stall is the tell');
  assert.equal(v.starved, true);
  assert.equal(v.reason, 'stalled-connecting');
  // b itself is not starved: its streams are open.
  assert.equal(b.budget.evaluate().starved, false);
});

test('a stalled stream with nobody receiving data is an outage, not starvation', () => {
  const bus = makeBus();
  const clock = { t: 1000 };
  const a = makeTab(bus, 'a', clock);
  const b = makeTab(bus, 'b', clock);
  a.budget.start(); b.budget.start();
  b.budget.setLocal({ streams: 2, active: false, connectingForMs: 8000 });
  a.budget.setLocal({ streams: 2, active: false, connectingForMs: 8000 });
  assert.equal(a.budget.evaluate().starved, false);
  assert.equal(b.budget.evaluate().starved, false);
});

test('a short CONNECTING wait is normal and does not trip the verdict', () => {
  const bus = makeBus();
  const clock = { t: 1000 };
  const a = makeTab(bus, 'a', clock);
  a.budget.start();
  a.budget.setLocal({ streams: 2, active: true, connectingForMs: 1500 });
  assert.equal(a.budget.evaluate().starved, false);
});

test('onVerdict fires only on change, and the stall verdict clears when the stream opens', () => {
  const bus = makeBus();
  const clock = { t: 1000 };
  const a = makeTab(bus, 'a', clock);
  a.budget.start();
  const n0 = a.verdicts.length;
  a.budget.setLocal({ streams: 2, active: true, connectingForMs: 0 });
  a.budget.setLocal({ streams: 2, active: true, connectingForMs: 0 }); // identical → no emission
  assert.equal(a.verdicts.length, n0 + 1);
  a.budget.setLocal({ streams: 3, active: true, connectingForMs: 7000 });
  assert.equal(a.last().starved, true);
  assert.equal(a.last().reason, 'stalled-connecting');
  a.budget.setLocal({ streams: 3, active: true, connectingForMs: 0 });
  assert.equal(a.last().starved, false);
});

test('garbage peer reports are sanitised rather than trusted', () => {
  const bus = makeBus();
  const clock = { t: 1000 };
  const a = makeTab(bus, 'a', clock);
  a.budget.start();
  bus.channel.post({ type: 'beat', tabId: 'z', ts: clock.t, report: { streams: -4, active: 'yes' as unknown as boolean, connectingForMs: Number.NaN } });
  const v = a.budget.evaluate();
  assert.equal(v.total, 0);
  assert.equal(v.peerTabs, 1);
  assert.equal(v.starved, false);
});
