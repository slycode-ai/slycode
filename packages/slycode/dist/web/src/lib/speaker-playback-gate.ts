/**
 * Pure decision helpers for the spoken-reply player (feature 086, fix loop).
 *
 * PlaybackGate — answers "may this clip start now?" for the holder tab.
 * After a handover (or any new stream) the new holder must NOT play relayed
 * or queued clips until the bridge has sent a FRESH permission snapshot with
 * enabled=true and a revision that matches the clip. Until then clips wait;
 * clips older than the snapshot are dropped (they were revoked).
 *
 * unlockAutoplay — earns the autoplay allowance inside a user gesture using
 * a THROWAWAY media element and/or an AudioContext. It never receives the
 * playback element, so it can never pause a clip that Play-reply started.
 */

export interface PermissionSnapshot {
  enabled: boolean;
  revision: number;
}

export interface GateClip {
  revision: number;
}

export type GateDecision = 'play' | 'wait' | 'drop';

export class PlaybackGate {
  private snapshot: PermissionSnapshot | null = null;
  private fresh = false;
  private recording = false;

  /** A new stream/holdership started: nothing may play until a fresh snapshot lands. */
  invalidate(): void {
    this.fresh = false;
  }

  /** Bridge-sourced state (stream event or bridge HTTP response) — never relayed state. */
  applySnapshot(s: PermissionSnapshot): void {
    this.snapshot = { enabled: s.enabled, revision: s.revision };
    this.fresh = true;
  }

  setRecording(active: boolean): void {
    this.recording = active;
  }

  get isFresh(): boolean { return this.fresh; }
  get isRecording(): boolean { return this.recording; }
  get current(): PermissionSnapshot | null { return this.snapshot ? { ...this.snapshot } : null; }

  /**
   * 'drop'  — the clip's revision is older than the known revision (revoked).
   * 'wait'  — no fresh snapshot yet, permission off, the clip is NEWER than
   *           our snapshot (we are stale), or dictation is recording.
   * 'play'  — fresh snapshot, enabled, revisions match, nobody recording.
   */
  decide(clip: GateClip): GateDecision {
    const s = this.snapshot;
    if (s && clip.revision < s.revision) return 'drop';
    if (!this.fresh || !s) return 'wait';
    if (!s.enabled) return 'wait';
    if (clip.revision > s.revision) return 'wait';
    if (this.recording) return 'wait';
    return 'play';
  }
}

// ---------------------------------------------------------------------------

export interface ThrowawayAudio {
  muted: boolean;
  src: string;
  play(): Promise<void>;
}

export interface AudioContextLike {
  state: string;
  resume(): Promise<void>;
  createBuffer(channels: number, length: number, sampleRate: number): unknown;
  createBufferSource(): { buffer: unknown; connect(dest: unknown): void; start(when?: number): void };
  destination: unknown;
}

export interface UnlockDeps {
  /** Creates a NEW, throwaway media element. Must never return the playback element. */
  makeAudio?: () => ThrowawayAudio;
  audioContext?: AudioContextLike | null;
}

/** Shortest valid silent WAV (44-byte header, 0 samples). */
export const SILENT_WAV_DATA_URI =
  'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQAAAAA=';

export function unlockAutoplay(deps: UnlockDeps): { touchedContext: boolean; touchedAudio: boolean } {
  let touchedContext = false;
  let touchedAudio = false;
  try {
    const ctx = deps.audioContext;
    if (ctx) {
      if (ctx.state === 'suspended') void ctx.resume();
      const buffer = ctx.createBuffer(1, 1, 22050);
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      src.connect(ctx.destination);
      src.start(0);
      touchedContext = true;
    }
  } catch { /* best effort */ }
  try {
    if (deps.makeAudio) {
      const el = deps.makeAudio();
      el.muted = true;
      el.src = SILENT_WAV_DATA_URI;
      void el.play().catch(() => { /* blocked; the Play button remains */ });
      touchedAudio = true;
    }
  } catch { /* best effort */ }
  return { touchedContext, touchedAudio };
}

// ---------------------------------------------------------------------------
// Manual "Play reply" (feature 086 reopen, 2026-09-13)
// ---------------------------------------------------------------------------

/**
 * Human-readable reason for a failed play() or a media error. NotAllowedError
 * is the autoplay policy (the Play button is the remedy); everything else is
 * a real failure the bubble must show instead of silently doing nothing.
 */
export function describePlayError(err: unknown): { autoplayBlocked: boolean; text: string } {
  const name = (err as { name?: string } | null)?.name ?? '';
  const message = (err as { message?: string } | null)?.message ?? '';
  if (name === 'NotAllowedError') return { autoplayBlocked: true, text: 'Browser blocked audio. Click Play reply.' };
  if (name === 'NotSupportedError') return { autoplayBlocked: false, text: 'This browser cannot play the audio format.' };
  if (name === 'AbortError') return { autoplayBlocked: false, text: 'Playback was interrupted. Click Play reply again.' };
  if (name === 'MediaError' || /^media error/i.test(message)) return { autoplayBlocked: false, text: message || 'Audio failed to load.' };
  return { autoplayBlocked: false, text: `Playback failed${name ? ` (${name})` : ''}${message ? `: ${message}` : ''}.` };
}

/** Text for an <audio> element's `error` event (MediaError codes). */
export function describeMediaError(code: number | undefined, message?: string): string {
  switch (code) {
    case 1: return 'Audio load was aborted.';
    case 2: return 'Network error while loading the audio.';
    case 3: return 'Audio could not be decoded.';
    case 4: return 'Audio source not supported by this browser.';
    default: return message ? `Audio failed to load: ${message}` : 'Audio failed to load.';
  }
}

/** Delay before an interrupted auto clip is tried again. */
export const AUTO_RETRY_DELAY_MS = 300;

/** A clip may start on its own only this long after it first arrived (matches the bridge's clip TTL). */
export const AUTO_PLAY_WINDOW_MS = 90_000;

/**
 * May this clip start WITHOUT a click? Never once any tab has heard it
 * (seen), never after its expiry, never once it is older than the window
 * since it FIRST arrived. Every automatic start goes through this: queue,
 * dictation-end resume, interruption retry, handover (#0377).
 */
export function isAutoPlayable(input: { receivedAt: number; expiresAt: number | null; seen: boolean; now: number }): boolean {
  if (input.seen) return false;
  if (input.expiresAt !== null && input.expiresAt < input.now) return false;
  return input.now - input.receivedAt <= AUTO_PLAY_WINDOW_MS;
}

/** A handed-over clip keeps its ORIGINAL arrival time, so a handover can never make an old clip fresh again. */
export function handoverReceivedAt(clip: { receivedAt?: unknown }, now: number): number {
  return typeof clip.receivedAt === 'number' && Number.isFinite(clip.receivedAt) ? clip.receivedAt : now;
}

export type PlayRejectionPlan =
  /** Our own stop/replace caused it (dismiss, revoke, handover, newer clip): whoever stopped it owns what happens next. */
  | 'ignore'
  /** Something outside the player paused/reloaded a fresh auto clip we still hold: try once more. */
  | 'retry'
  /** Keep the clip loaded and SHOW why: the user is waiting on it (pressed Play, or it was the live clip in a visible tab). */
  | 'hold'
  /** Keep the clip loaded, no warning: Play reply stays available (autoplay block, background interruption). */
  | 'park'
  /** The clip is no longer fresh: silently retire it to Replay, never warn about it. */
  | 'demote'
  /** Real auto-path failure (unsupported, decode): surface it and move on to the next clip. */
  | 'skip';

/**
 * What to do when play() rejects (#0377). An interruption (AbortError) is NOT a
 * broken clip: the old path marked it seen and dropped it, so the bubble said
 * "interrupted", its Play reply found nothing, and only the card's Replay
 * (bridge clip store) could play it. The warning is only for a user who is
 * actually waiting on that clip; background/resume interruptions stay silent.
 */
export function planPlayRejection(input: {
  errName: string;
  manual: boolean;
  /** This attempt was replaced by a later start or stopped by our own code. */
  superseded: boolean;
  isHolder: boolean;
  /** This clip has already been retried once after an interruption. */
  retried: boolean;
  /** Still within the auto-play window (see isAutoPlayable). */
  fresh: boolean;
  /** This tab is visible (the clip is the live one the user would be hearing). */
  visible: boolean;
}): PlayRejectionPlan {
  if (input.superseded) return 'ignore';
  if (input.manual) return 'hold';
  if (!input.fresh) return 'demote';
  if (input.errName === 'NotAllowedError') return 'park';
  if (input.errName === 'AbortError') {
    if (!input.isHolder) return 'ignore';
    if (!input.retried) return 'retry';
    return input.visible ? 'hold' : 'park';
  }
  return 'skip';
}

export interface ManualPlayInput {
  isHolder: boolean;
  /** The clip currently loaded in the player (blocked or paused), if any. */
  current: { clipId: string } | null;
  /** Queued clip ids, head first. */
  queue: Array<{ clipId: string }>;
  /** The clip the user is looking at in the bubble, if known. */
  captionClipId: string | null;
  /** The clip that finished most recently (kept for Replay), if any. */
  lastPlayed?: { clipId: string } | null;
}

export type ManualPlayPlan =
  | { action: 'play-current' }
  | { action: 'play-queued'; index: number }
  | { action: 'replay-last' }
  | { action: 'claim-and-wait' }
  | { action: 'nothing'; reason: string };

/**
 * A deliberate click on "Play reply" must play THAT clip regardless of the
 * autoplay gate (fresh snapshot / revision match / recording). The gate only
 * exists to stop stale or revoked AUTO-play; a user click is consent.
 */
export function planManualPlay(input: ManualPlayInput): ManualPlayPlan {
  if (!input.isHolder) return { action: 'claim-and-wait' };
  if (input.current && (!input.captionClipId || input.current.clipId === input.captionClipId)) return { action: 'play-current' };
  const wanted = input.captionClipId
    ? input.queue.findIndex((c) => c.clipId === input.captionClipId)
    : (input.queue.length > 0 ? 0 : -1);
  if (wanted >= 0) return { action: 'play-queued', index: wanted };
  if (input.current) return { action: 'play-current' };
  if (input.queue.length > 0) return { action: 'play-queued', index: 0 };
  // Replay: the bubble still shows a clip that already finished.
  if (input.lastPlayed && (!input.captionClipId || input.lastPlayed.clipId === input.captionClipId)) return { action: 'replay-last' };
  return { action: 'nothing', reason: 'Nothing left to play. That reply expired or was already played.' };
}

// ---------------------------------------------------------------------------
// Playback progress (bubble hairline)
// ---------------------------------------------------------------------------

export interface PlaybackProgress {
  /** 0..1 of the clip, or null when the duration is unknown. */
  fraction: number | null;
  /** True while no finite duration is known (metadata not loaded / streaming, and nothing decoded yet). */
  indeterminate: boolean;
  /** True once the clip is over: 'ended' fired, or the clock reached the DECODED length. */
  complete: boolean;
}

export const PROGRESS_IDLE: PlaybackProgress = { fraction: null, indeterminate: false, complete: false };

/** Tolerance (s) when comparing the element clock against the decoded length. */
export const PROGRESS_END_EPSILON_S = 0.06;

/**
 * Progress from the <audio> element's own clock. Inline base64 MP3 reports
 * NaN (before loadedmetadata) or occasionally Infinity for duration; both mean
 * "unknown" → indeterminate until a finite duration arrives. 'ended' always
 * completes the bar at 100% regardless of what the clock said last.
 */
export function computeProgress(input: {
  currentTime: number;
  /** The <audio> element's duration — for a header-less MP3 this is an ESTIMATE and can be wrong. */
  duration: number;
  ended: boolean;
  /** Authoritative length from AudioContext.decodeAudioData, when available. Always wins. */
  decodedDuration?: number | null;
}): PlaybackProgress {
  if (input.ended) return { fraction: 1, indeterminate: false, complete: true };
  const t = Number.isFinite(input.currentTime) ? Math.max(0, input.currentTime) : 0;
  const decoded = input.decodedDuration;
  if (typeof decoded === 'number' && Number.isFinite(decoded) && decoded > 0) {
    if (t >= decoded - PROGRESS_END_EPSILON_S) return { fraction: 1, indeterminate: false, complete: true };
    return { fraction: Math.min(1, t / decoded), indeterminate: false, complete: false };
  }
  const d = input.duration;
  if (!Number.isFinite(d) || d <= 0) return { fraction: null, indeterminate: true, complete: false };
  return { fraction: Math.min(1, t / d), indeterminate: false, complete: false };
}

/** Decode base64 audio bytes into an ArrayBuffer for AudioContext.decodeAudioData. */
export function base64ToArrayBuffer(b64: string): ArrayBuffer {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

/**
 * Inline style for the bubble's fill element. Derived from `fraction` ONLY:
 * a transform (scaleX from the left edge) rather than a percentage width, so
 * no stylesheet rule, animation, transition or parent sizing can disagree
 * with the number the audio clock produced. Indeterminate → no inline style
 * (the CSS sweep takes over).
 */
export function progressFillStyle(p: PlaybackProgress): { transform: string; transformOrigin: 'left' } | undefined {
  if (p.indeterminate || p.fraction === null) return undefined;
  const f = Math.min(1, Math.max(0, p.fraction));
  return { transform: `scaleX(${Math.round(f * 1000) / 1000})`, transformOrigin: 'left' };
}

/**
 * Key the footer Replay control watches to refetch the bridge's kept clips.
 * Changes on every delivered clip (clipSeq), on permission changes, and when
 * the bubble's clip changes — so the control appears live, never only on mount.
 */
export function clipListRefreshKey(s: { clipSeq: number; revision: number; enabled: boolean | null; replayableClipId: string | null; captionClipId: string | null }): string {
  return `${s.clipSeq}|${s.revision}|${s.enabled === null ? 'u' : s.enabled ? '1' : '0'}|${s.replayableClipId ?? ''}|${s.captionClipId ?? ''}`;
}

/** Hairline lifecycle after a clip ends: hold briefly at 100%, fade, then unmount. */
export const TRACK_HOLD_MS = 600;
export const TRACK_FADE_MS = 450;
export type TrackPhase = 'live' | 'fading' | 'hidden';

/**
 * 'live'   — a clip is playing, or it just completed (still within the hold).
 * 'fading' — completed; the bar is at 100% and fading out.
 * 'hidden' — nothing playing and the fade is over (or nothing ever played).
 * A Replay resets `complete` (fraction back to 0) and the bar reappears.
 */
export function trackPhase(input: { playing: boolean; complete: boolean; msSinceComplete: number | null }): TrackPhase {
  if (input.playing) return 'live';
  if (!input.complete) return 'hidden';
  const t = input.msSinceComplete ?? 0;
  if (t < TRACK_HOLD_MS) return 'live';
  if (t < TRACK_HOLD_MS + TRACK_FADE_MS) return 'fading';
  return 'hidden';
}
