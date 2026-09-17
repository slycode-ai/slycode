/**
 * ConnectionBudget — per-browser tally of live long-lived HTTP connections
 * (card #0356, option E).
 *
 * Browsers cap a plain-HTTP origin at 6 concurrent HTTP/1.1 connections.
 * Every SlyCode tab holds several SSE streams (board, terminal, audio), all
 * to the same origin, so three or four tabs exhaust the pool and every NEW
 * request — the terminal input POST included — queues forever while the
 * already-open streams keep delivering output. That half-working state is
 * indistinguishable from "it's thinking", so this module makes it loud.
 *
 * Each tab reports its own live stream count (plus whether it is receiving
 * data and how long its slowest stream has been stuck CONNECTING) to sibling
 * tabs over an injected channel (BroadcastChannel in the browser, a fake in
 * tests), and every tab sums the reports it has heard from live peers.
 *
 * A tab is STARVED when either:
 *  - the browser-wide total reaches the limit (6 held = zero free slots, so
 *    the input POST cannot go out — hence `>=`, not `>`), or
 *  - one of its own streams has sat in CONNECTING for several seconds while
 *    this browser is demonstrably reachable (some tab is receiving data).
 *    That is the direct starvation signal; a dead bridge trips the ordinary
 *    "disconnected" path instead and is excluded by the reachability check.
 *
 * The verdict clears as soon as the count drops or the stalled stream opens.
 * Nothing here touches streams or input — it only observes and reports.
 *
 * Presence is NOT a fast heartbeat race. Chrome throttles a hidden tab's
 * timers to once a minute after five minutes in the background, and hidden
 * tabs are exactly the ones holding streams — a 10 s expiry silently dropped
 * them from the tally and hid the banner while the pool stayed exhausted.
 * So a peer is removed on an explicit goodbye (pagehide / beforeunload) or
 * after a generous multi-minute silence that only a killed tab produces; a
 * tab re-announces (hello, which solicits immediate replies) whenever it
 * becomes visible or focused so the foreground tally is always fresh.
 */

export const BROWSER_H1_CONNECTION_LIMIT = 6;
export const STALLED_CONNECTING_MS = 5000;
export const BUDGET_CHANNEL_NAME = 'slycode-connection-budget';
export const DEFAULT_BUDGET_HEARTBEAT_MS = 3000;
/**
 * Silence after which a peer is presumed dead. Must sit well above Chrome's
 * intensive-throttling interval (timers once per minute in tabs hidden for
 * 5+ min) so a live background tab is never dropped; 5 minutes tolerates four
 * missed throttled beats. A tab that dies without a goodbye (process kill,
 * crash) lingers in the tally for at most this long.
 */
export const DEFAULT_BUDGET_TIMEOUT_MS = 5 * 60 * 1000;

export type ProtocolClass = 'plain-http' | 'multiplexed' | 'unknown';

/**
 * Decide whether this page is subject to the HTTP/1.1 per-host cap.
 *
 * Browsers never speak HTTP/2 over cleartext, so an `http:` page is HTTP/1.1
 * regardless of what timing entries say. An `https:` page is treated as
 * multiplexed (h2/h3) — the brief asks for silence there, and when TLS does
 * fall back to HTTP/1.1 the reverse proxy in front is the thing to fix.
 * `nextHopProtocol` values are used as confirmation when present.
 */
export function classifyProtocol(input: {
  locationProtocol: string;
  nextHopProtocols: readonly string[];
}): ProtocolClass {
  const hops = input.nextHopProtocols.map((p) => p.toLowerCase()).filter(Boolean);
  const multiplexed = hops.some((p) => p === 'h2' || p === 'h2c' || p === 'h3' || p.startsWith('h3-') || p.startsWith('hq'));
  const legacy = hops.some((p) => p === 'http/1.1' || p === 'http/1.0' || p === 'http/1');
  if (input.locationProtocol === 'https:') return 'multiplexed';
  if (input.locationProtocol === 'http:') {
    if (multiplexed && !legacy) return 'multiplexed'; // h2c — not something browsers do, but honour the evidence
    return 'plain-http';
  }
  if (legacy) return 'plain-http';
  if (multiplexed) return 'multiplexed';
  return 'unknown';
}

/** What one tab reports about itself. */
export interface TabReport {
  /** Live long-lived connections (EventSource CONNECTING or OPEN). */
  streams: number;
  /** Some stream in this tab received data or a heartbeat recently — the host is reachable. */
  active: boolean;
  /** Age of the longest-waiting CONNECTING stream, 0 when none is waiting. */
  connectingForMs: number;
}

export type BudgetMessage =
  | { type: 'hello'; tabId: string; ts: number; report: TabReport }
  | { type: 'beat'; tabId: string; ts: number; report: TabReport }
  | { type: 'bye'; tabId: string };

export interface BudgetChannel {
  post(msg: BudgetMessage): void;
  subscribe(listener: (msg: BudgetMessage) => void): () => void;
}

export type StarvationReason = 'over-budget' | 'stalled-connecting';

export interface BudgetVerdict {
  starved: boolean;
  reason: StarvationReason | null;
  /** Live long-lived connections across every tab of this browser (incl. this one). */
  total: number;
  /** This tab's own live long-lived connections. */
  own: number;
  /** Number of OTHER live tabs heard from. */
  peerTabs: number;
  limit: number;
}

export interface ConnectionBudgetOptions {
  tabId: string;
  channel: BudgetChannel;
  now?: () => number;
  limit?: number;
  stalledMs?: number;
  heartbeatMs?: number;
  timeoutMs?: number;
  /** Fires whenever the verdict changes (starved flag, reason, or total). */
  onVerdict?: (verdict: BudgetVerdict) => void;
}

interface PeerRecord {
  ts: number;
  report: TabReport;
}

const EMPTY_REPORT: TabReport = { streams: 0, active: false, connectingForMs: 0 };

export class ConnectionBudget {
  private readonly tabId: string;
  private readonly channel: BudgetChannel;
  private readonly now: () => number;
  private readonly limit: number;
  private readonly stalledMs: number;
  private readonly timeoutMs: number;
  private readonly opts: ConnectionBudgetOptions;
  private readonly peers = new Map<string, PeerRecord>();
  private local: TabReport = EMPTY_REPORT;
  private unsubscribe: (() => void) | null = null;
  private started = false;
  private last: BudgetVerdict | null = null;

  readonly heartbeatMs: number;

  constructor(opts: ConnectionBudgetOptions) {
    this.opts = opts;
    this.tabId = opts.tabId;
    this.channel = opts.channel;
    this.now = opts.now ?? (() => Date.now());
    this.limit = opts.limit ?? BROWSER_H1_CONNECTION_LIMIT;
    this.stalledMs = opts.stalledMs ?? STALLED_CONNECTING_MS;
    this.heartbeatMs = opts.heartbeatMs ?? DEFAULT_BUDGET_HEARTBEAT_MS;
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_BUDGET_TIMEOUT_MS;
  }

  get id(): string { return this.tabId; }

  /** Join the tally. Idempotent. Announces so siblings answer straight away. */
  start(): void {
    if (this.started) return;
    this.started = true;
    this.unsubscribe = this.channel.subscribe((msg) => this.handle(msg));
    this.channel.post({ type: 'hello', tabId: this.tabId, ts: this.now(), report: this.local });
    this.emit();
  }

  /** Leave the tally; siblings drop this tab's streams from their totals immediately. */
  stop(): void {
    if (!this.started) return;
    this.started = false;
    this.channel.post({ type: 'bye', tabId: this.tabId });
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  /** Called by the owner's timer every heartbeatMs. Re-announces and prunes dead peers. */
  tick(): void {
    if (!this.started) return;
    this.channel.post({ type: 'beat', tabId: this.tabId, ts: this.now(), report: this.local });
    this.emit();
  }

  /**
   * Re-announce with a hello so every live peer answers at once. Call when
   * the tab becomes visible or focused: its timers may have been throttled
   * for minutes, so its picture of the siblings is refreshed immediately
   * rather than waiting for their (possibly throttled) beats.
   */
  announce(): void {
    if (!this.started) return;
    this.channel.post({ type: 'hello', tabId: this.tabId, ts: this.now(), report: this.local });
    this.emit();
  }

  /** This tab's stream picture changed. Broadcast right away so siblings re-evaluate without waiting a beat. */
  setLocal(report: TabReport): void {
    const changed =
      report.streams !== this.local.streams ||
      report.active !== this.local.active ||
      (report.connectingForMs >= this.stalledMs) !== (this.local.connectingForMs >= this.stalledMs);
    this.local = { ...report };
    if (this.started && changed) {
      this.channel.post({ type: 'beat', tabId: this.tabId, ts: this.now(), report: this.local });
    }
    this.emit();
  }

  /** Current verdict (also pushed through onVerdict when it changes). */
  evaluate(): BudgetVerdict {
    this.prune();
    let total = this.local.streams;
    let anyActive = this.local.active;
    for (const peer of this.peers.values()) {
      total += peer.report.streams;
      anyActive = anyActive || peer.report.active;
    }
    let reason: StarvationReason | null = null;
    if (total >= this.limit) reason = 'over-budget';
    else if (this.local.connectingForMs >= this.stalledMs && anyActive) reason = 'stalled-connecting';
    return {
      starved: reason !== null,
      reason,
      total,
      own: this.local.streams,
      peerTabs: this.peers.size,
      limit: this.limit,
    };
  }

  /** Live peer ids (diagnostics/tests). */
  livePeerIds(): string[] {
    this.prune();
    return [...this.peers.keys()].sort();
  }

  // -- internals ----------------------------------------------------------

  private prune(): void {
    const cutoff = this.now() - this.timeoutMs;
    for (const [id, peer] of this.peers) {
      if (peer.ts < cutoff) this.peers.delete(id);
    }
  }

  private emit(): void {
    const v = this.evaluate();
    const prev = this.last;
    this.last = v;
    if (
      !prev ||
      prev.starved !== v.starved ||
      prev.reason !== v.reason ||
      prev.total !== v.total ||
      prev.peerTabs !== v.peerTabs
    ) {
      this.opts.onVerdict?.(v);
    }
  }

  private handle(msg: BudgetMessage): void {
    if (!this.started) return;
    if (msg.tabId === this.tabId) return;
    switch (msg.type) {
      case 'hello': {
        this.peers.set(msg.tabId, { ts: this.now(), report: sanitiseReport(msg.report) });
        // Answer the newcomer immediately so its first verdict already counts us.
        this.channel.post({ type: 'beat', tabId: this.tabId, ts: this.now(), report: this.local });
        this.emit();
        break;
      }
      case 'beat': {
        this.peers.set(msg.tabId, { ts: this.now(), report: sanitiseReport(msg.report) });
        this.emit();
        break;
      }
      case 'bye': {
        this.peers.delete(msg.tabId);
        this.emit();
        break;
      }
    }
  }
}

function sanitiseReport(r: Partial<TabReport> | undefined): TabReport {
  const streams = typeof r?.streams === 'number' && Number.isFinite(r.streams) ? Math.max(0, Math.floor(r.streams)) : 0;
  const connectingForMs = typeof r?.connectingForMs === 'number' && Number.isFinite(r.connectingForMs) ? Math.max(0, r.connectingForMs) : 0;
  return { streams, active: r?.active === true, connectingForMs };
}

/** BroadcastChannel-backed channel for the browser; no-op when unsupported. */
export function createBroadcastBudgetChannel(name = BUDGET_CHANNEL_NAME): BudgetChannel {
  let bc: BroadcastChannel | null = null;
  const listeners = new Set<(msg: BudgetMessage) => void>();
  if (typeof window !== 'undefined' && typeof BroadcastChannel !== 'undefined') {
    try {
      bc = new BroadcastChannel(name);
      bc.onmessage = (ev: MessageEvent<BudgetMessage>) => {
        for (const l of [...listeners]) l(ev.data);
      };
    } catch {
      bc = null;
    }
  }
  return {
    post(msg) {
      try { bc?.postMessage(msg); } catch { /* channel closed */ }
    },
    subscribe(l) {
      listeners.add(l);
      return () => { listeners.delete(l); };
    },
  };
}

export function newBudgetTabId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
