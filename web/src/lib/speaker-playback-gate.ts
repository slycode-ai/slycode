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
