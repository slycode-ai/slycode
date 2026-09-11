/**
 * AudioHolder — one player per browser for spoken replies (feature 086).
 *
 * Every tab of the web app can receive spoken-reply clips, but only ONE tab
 * per browser should hold the audio stream and play. This module is the pure
 * election state machine: it talks to sibling tabs through an injected
 * channel (BroadcastChannel in production, a fake in tests) and to the caller
 * through callbacks. It never touches the DOM, EventSource or <audio>.
 *
 * Rules (design doc "Codex round 3 additions", browser-holder lifecycle):
 *  - Every tab claims on start and heartbeats every 3 s; a peer unseen for
 *    10 s is dead and dropped, then the election re-runs.
 *  - Winner: highest explicit priority (a user pressing "Play reply" in a
 *    tab), then visible over hidden, then lowest tabId (stable, no flapping).
 *  - A visible tab does NOT pre-empt a hidden holder that is mid-clip unless
 *    it holds an explicit priority; handover mid-clip would cut the audio.
 *  - The holder relays state (playing / caption / queue) to siblings so a
 *    non-holder tab still shows the speech bubble and can send commands
 *    (play / dismiss / pause / resume) that reach the actual player.
 *  - Seen clip ids travel with the handover so a new holder never replays a
 *    clip the old one already played.
 *  - Recording ownership travels with every claim/heartbeat: a tab that is
 *    dictating announces recording:true, and WHICHEVER tab is holder honours
 *    it (pause, don't start) until it announces recording:false or dies.
 *  - Every accepted speaker-state transition is relayed by the holder, and a
 *    newly joined tab is answered with the current state (sync-on-join) so
 *    late tabs converge instead of showing a stale toggle.
 */

export type HolderCommand = 'play' | 'dismiss' | 'pause' | 'resume';

export interface RelayCaption {
  clipId: string;
  text: string;
  sourceLabel: string;
  at: number;
}

export interface RelayAvailability {
  messagingRunning: boolean | null;
  tts: boolean | null;
}

export interface RelayState {
  enabled: boolean | null;
  revision: number;
  playing: boolean;
  blocked: boolean;
  caption: RelayCaption | null;
  queueLength: number;
  /** Optional so older relays stay valid; followers keep their own when absent. */
  availability?: RelayAvailability;
}

interface PeerInfo {
  tabId: string;
  ts: number;
  visible: boolean;
  priority: number;
  playing: boolean;
  /** This tab is dictating (microphone open); the holder must not play. */
  recording: boolean;
}

export type HolderMessage =
  | ({ type: 'claim' } & PeerInfo)
  | ({ type: 'heartbeat' } & PeerInfo)
  | { type: 'release'; tabId: string }
  | { type: 'clip-seen'; tabId: string; clipId: string }
  | { type: 'seen-set'; tabId: string; clipIds: string[] }
  | { type: 'command'; tabId: string; command: HolderCommand; clipId?: string }
  | { type: 'state'; tabId: string; state: RelayState }
  | { type: 'handover'; tabId: string; payload: unknown }
  | { type: 'recording'; tabId: string; recording: boolean };

export interface HolderChannel {
  post(msg: HolderMessage): void;
  subscribe(listener: (msg: HolderMessage) => void): () => void;
}

export interface AudioHolderOptions {
  tabId: string;
  channel: HolderChannel;
  now?: () => number;
  isVisible?: () => boolean;
  heartbeatMs?: number;
  timeoutMs?: number;
  /** Max seen clip ids kept (oldest evicted). */
  seenCap?: number;
  onBecomeHolder?: () => void;
  onLoseHolder?: () => void;
  /** A sibling asked the holder to act. Only fires while this tab is holder. */
  onCommand?: (command: HolderCommand, clipId?: string) => void;
  /** The holder relayed its state. Only fires while this tab is NOT holder. */
  onState?: (state: RelayState) => void;
  /** Losing holder hands its unplayed queue to the winner (payload is caller-defined). */
  getHandoverPayload?: () => unknown;
  onHandoverPayload?: (payload: unknown) => void;
  /** Aggregate "somebody in this browser is recording" changed. Fires for holder and followers. */
  onRecordingChange?: (active: boolean) => void;
  /** A sibling tab joined and needs the current state. Only fires while this tab is holder. */
  onSyncRequest?: () => void;
}

export const HOLDER_CHANNEL_NAME = 'slycode-audio';
export const DEFAULT_HEARTBEAT_MS = 3000;
export const DEFAULT_TIMEOUT_MS = 10000;

export class AudioHolder {
  private readonly tabId: string;
  private readonly channel: HolderChannel;
  private readonly now: () => number;
  private readonly isVisible: () => boolean;
  private readonly timeoutMs: number;
  private readonly seenCap: number;
  private readonly opts: AudioHolderOptions;
  private readonly peers = new Map<string, PeerInfo>();
  private readonly seen: string[] = [];
  private readonly seenSet = new Set<string>();
  private unsubscribe: (() => void) | null = null;
  private priority = 0;
  private playing = false;
  private recording = false;
  private lastAnyRecording = false;
  private started = false;
  private holder = false;
  private pendingHandover: unknown = undefined;

  readonly heartbeatMs: number;

  constructor(opts: AudioHolderOptions) {
    this.opts = opts;
    this.tabId = opts.tabId;
    this.channel = opts.channel;
    this.now = opts.now ?? (() => Date.now());
    this.isVisible = opts.isVisible ?? (() => true);
    this.heartbeatMs = opts.heartbeatMs ?? DEFAULT_HEARTBEAT_MS;
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.seenCap = opts.seenCap ?? 200;
  }

  get isHolder(): boolean { return this.holder; }
  get id(): string { return this.tabId; }

  /** Join the election. Idempotent. */
  start(): void {
    if (this.started) return;
    this.started = true;
    this.unsubscribe = this.channel.subscribe((msg) => this.handle(msg));
    this.channel.post({ type: 'claim', ...this.self() });
    this.evaluate();
  }

  /** Leave the election; hands seen ids to whoever wins next. */
  stop(): void {
    if (!this.started) return;
    this.started = false;
    if (this.holder) {
      this.channel.post({ type: 'seen-set', tabId: this.tabId, clipIds: [...this.seen] });
      this.postHandover();
    }
    this.channel.post({ type: 'release', tabId: this.tabId });
    this.unsubscribe?.();
    this.unsubscribe = null;
    if (this.holder) {
      this.holder = false;
      this.opts.onLoseHolder?.();
    }
  }

  /** Called by the caller's timer every heartbeatMs. Also prunes dead peers. */
  tick(): void {
    if (!this.started) return;
    this.channel.post({ type: 'heartbeat', ...this.self() });
    this.afterPeersChanged();
  }

  /** Visibility changed — re-announce so the election can prefer visible tabs. */
  visibilityChanged(): void {
    if (!this.started) return;
    this.channel.post({ type: 'heartbeat', ...this.self() });
    this.evaluate();
  }

  /** Report whether this holder is mid-clip (protects it from visibility pre-emption). */
  setPlaying(playing: boolean): void {
    this.playing = playing;
  }

  /**
   * This tab started/stopped dictating. Broadcast immediately so the holder
   * (whichever tab it is, now or after a handover) pauses/resumes, and keep
   * it in every heartbeat so a late-joining holder learns it too.
   */
  setRecording(recording: boolean): void {
    if (this.recording === recording) return;
    this.recording = recording;
    if (this.started) this.channel.post({ type: 'recording', tabId: this.tabId, recording });
    this.recomputeRecording();
  }

  /** True when this tab or any LIVE peer is dictating. Dead peers are pruned first. */
  isAnyRecording(): boolean {
    this.prune();
    if (this.recording) return true;
    for (const p of this.peers.values()) if (p.recording) return true;
    return false;
  }

  /**
   * Take holdership NOW (the user pressed Play in this tab). Priority beats
   * visibility and tab order, and survives until another tab claims later.
   */
  claimNow(): void {
    this.priority = this.now();
    if (!this.started) this.start();
    this.channel.post({ type: 'claim', ...this.self() });
    this.evaluate();
  }

  hasSeen(clipId: string): boolean {
    return this.seenSet.has(clipId);
  }

  /** Remember a played clip and tell siblings, so a handover never replays it. */
  markSeen(clipId: string): void {
    if (this.remember(clipId)) {
      this.channel.post({ type: 'clip-seen', tabId: this.tabId, clipId });
    }
  }

  /** Route a user command to the actual player (local if holder, else relayed). */
  sendCommand(command: HolderCommand, clipId?: string): void {
    if (this.holder) {
      this.opts.onCommand?.(command, clipId);
      return;
    }
    this.channel.post({ type: 'command', tabId: this.tabId, command, clipId });
  }

  /** Holder → siblings: what the player is doing. */
  publishState(state: RelayState): void {
    if (!this.holder) return;
    this.channel.post({ type: 'state', tabId: this.tabId, state });
  }

  /** Live peers (for diagnostics/tests). */
  livePeerIds(): string[] {
    this.prune();
    return [...this.peers.keys()].sort();
  }

  // -- internals ----------------------------------------------------------

  private self(): PeerInfo {
    return {
      tabId: this.tabId,
      ts: this.now(),
      visible: this.isVisible(),
      priority: this.priority,
      playing: this.playing,
      recording: this.recording,
    };
  }

  private peerFrom(msg: PeerInfo): PeerInfo {
    return {
      tabId: msg.tabId,
      ts: msg.ts,
      visible: msg.visible,
      priority: msg.priority,
      playing: msg.playing,
      recording: msg.recording === true,
    };
  }

  private recomputeRecording(): void {
    const now = this.isAnyRecording();
    if (now !== this.lastAnyRecording) {
      this.lastAnyRecording = now;
      this.opts.onRecordingChange?.(now);
    }
  }

  private remember(clipId: string): boolean {
    if (this.seenSet.has(clipId)) return false;
    this.seenSet.add(clipId);
    this.seen.push(clipId);
    while (this.seen.length > this.seenCap) {
      const old = this.seen.shift();
      if (old) this.seenSet.delete(old);
    }
    return true;
  }

  private prune(): void {
    const cutoff = this.now() - this.timeoutMs;
    for (const [id, peer] of this.peers) {
      if (peer.ts < cutoff) this.peers.delete(id);
    }
  }

  /** Called by the caller's timer every heartbeatMs. Also prunes dead peers. */
  private afterPeersChanged(): void {
    this.evaluate();
    this.recomputeRecording();
  }

  private handle(msg: HolderMessage): void {
    if (!this.started) return;
    if (msg.tabId === this.tabId) return;
    switch (msg.type) {
      case 'claim': {
        this.peers.set(msg.tabId, this.peerFrom(msg));
        // Answer a newcomer immediately so it learns about us without waiting a beat.
        this.channel.post({ type: 'heartbeat', ...this.self() });
        this.afterPeersChanged();
        // Sync-on-join: the holder answers with its current state so the
        // newcomer's toggle/bubble converge without waiting for a transition.
        if (this.holder) this.opts.onSyncRequest?.();
        break;
      }
      case 'heartbeat': {
        this.peers.set(msg.tabId, this.peerFrom(msg));
        this.afterPeersChanged();
        break;
      }
      case 'release': {
        this.peers.delete(msg.tabId);
        this.afterPeersChanged();
        break;
      }
      case 'recording': {
        const peer = this.peers.get(msg.tabId);
        if (peer) peer.recording = msg.recording;
        else this.peers.set(msg.tabId, { tabId: msg.tabId, ts: this.now(), visible: false, priority: 0, playing: false, recording: msg.recording });
        this.recomputeRecording();
        break;
      }
      case 'clip-seen': {
        this.remember(msg.clipId);
        break;
      }
      case 'seen-set': {
        for (const id of msg.clipIds) this.remember(id);
        break;
      }
      case 'command': {
        if (this.holder) this.opts.onCommand?.(msg.command, msg.clipId);
        break;
      }
      case 'state': {
        if (!this.holder) this.opts.onState?.(msg.state);
        break;
      }
      case 'handover': {
        // The loser posts after its own election ran; ours may not have yet.
        if (this.holder) this.opts.onHandoverPayload?.(msg.payload);
        else this.pendingHandover = msg.payload;
        this.evaluate();
        break;
      }
    }
  }

  private winner(): string {
    this.prune();
    const candidates: PeerInfo[] = [this.self(), ...this.peers.values()];
    // 1. explicit priority (a Play click) wins outright
    const maxPriority = Math.max(...candidates.map((c) => c.priority));
    let pool = candidates.filter((c) => c.priority === maxPriority);
    // 2. visible over hidden — but never pre-empt a holder that is mid-clip
    const currentHolder = this.holder ? this.self() : candidates.find((c) => c.playing) ?? null;
    if (currentHolder && currentHolder.playing && pool.some((c) => c.tabId === currentHolder.tabId)) {
      return currentHolder.tabId;
    }
    const visible = pool.filter((c) => c.visible);
    if (visible.length > 0) pool = visible;
    // 3. lowest tabId — deterministic across tabs
    return pool.map((c) => c.tabId).sort()[0];
  }

  private evaluate(): void {
    const win = this.winner();
    if (win === this.tabId && !this.holder) {
      this.holder = true;
      this.opts.onBecomeHolder?.();
    } else if (win !== this.tabId && this.holder) {
      this.holder = false;
      this.playing = false;
      this.channel.post({ type: 'seen-set', tabId: this.tabId, clipIds: [...this.seen] });
      this.postHandover();
      this.opts.onLoseHolder?.();
    }
    if (this.holder && this.pendingHandover !== undefined) {
      const payload = this.pendingHandover;
      this.pendingHandover = undefined;
      this.opts.onHandoverPayload?.(payload);
    }
  }

  private postHandover(): void {
    const payload = this.opts.getHandoverPayload?.();
    if (payload === undefined) return;
    this.channel.post({ type: 'handover', tabId: this.tabId, payload });
  }
}

/** BroadcastChannel-backed channel for the browser; no-op when unsupported. */
export function createBroadcastHolderChannel(name = HOLDER_CHANNEL_NAME): HolderChannel {
  let bc: BroadcastChannel | null = null;
  const listeners = new Set<(msg: HolderMessage) => void>();
  if (typeof window !== 'undefined' && typeof BroadcastChannel !== 'undefined') {
    try {
      bc = new BroadcastChannel(name);
      bc.onmessage = (ev: MessageEvent<HolderMessage>) => {
        for (const l of listeners) l(ev.data);
      };
    } catch {
      bc = null;
    }
  }
  return {
    post(msg) {
      try { bc?.postMessage(msg); } catch { /* channel closed */ }
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
  };
}

export function newTabId(): string {
  return `t-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
