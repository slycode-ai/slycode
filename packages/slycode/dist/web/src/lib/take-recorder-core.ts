/**
 * The lifecycle of one voice-cloning recording ("take", #0376), with the
 * browser APIs injected so it can be tested without a browser. The React
 * hook (`hooks/useTakeRecorder.ts`) is a thin wrapper around it.
 *
 * Rules (review fixes, 2026-10-05):
 *  - Any failure while setting up (recorder can't be made or started) stops
 *    the mic tracks, closes the meter, and lands in 'error' with a message.
 *    Never stuck at 'starting', never a live mic left behind.
 *  - Stop while 'starting' (the permission prompt is up) cancels that start:
 *    a later grant sees a newer generation and stops its own tracks at once.
 *  - Every async step checks the generation, so a late grant, stop or
 *    decode never lands on a newer take, a reset or an unmounted view.
 */
import { blockLevel, levelAdvice } from './wav-encode';
import type { CloneTake } from './voice-picker-view';

export type TakeState = 'idle' | 'starting' | 'recording' | 'processing' | 'done' | 'error';

export interface TakeSnapshot {
  state: TakeState;
  /** Seconds recorded so far (live), or the take's length when done. */
  seconds: number;
  /** 0–1, smoothed, for the meter. */
  level: number;
  advice: 'quiet' | 'ok' | 'loud' | null;
  take: CloneTake | null;
  error: string | null;
}

export const INITIAL_TAKE: TakeSnapshot = { state: 'idle', seconds: 0, level: 0, advice: null, take: null, error: null };

/** The parts of a MediaStream this uses. */
export interface StreamLike { getTracks(): Array<{ stop(): void }> }

/** The parts of a MediaRecorder this uses. */
export interface RecorderLike {
  state: string;
  mimeType: string;
  ondataavailable: ((e: { data: Blob }) => void) | null;
  onstop: (() => void) | null;
  start(timeslice?: number): void;
  stop(): void;
}

export interface MeterLike {
  /** Current block of samples, or null when unavailable. */
  read(): Float32Array | null;
  close(): void;
}

export interface TakeEnv {
  /** Why the mic can't be used at all (insecure page, no MediaRecorder), or null. */
  micUnavailable(): string | null;
  getUserMedia(): Promise<StreamLike>;
  pickMimeType(): string;
  createRecorder(stream: StreamLike, mimeType: string): RecorderLike;
  /** A level meter on the stream; null (or a throw) just means no meter. */
  createMeter(stream: StreamLike): MeterLike | null;
  /** Recording or file → 24 kHz mono WAV take. */
  convert(blob: Blob): Promise<CloneTake>;
  now(): number;
  setInterval(fn: () => void, ms: number): unknown;
  clearInterval(handle: unknown): void;
}

export function micErrorMessage(err: unknown): string {
  const name = (err as Error)?.name;
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return "SlyCode can't use the microphone. Allow it in the browser's site settings (on a phone: the site's settings in the browser, or the browser's microphone permission in the phone's settings), or upload a recording instead.";
  }
  if (name === 'NotFoundError') return 'No microphone was found. Connect one, or upload a recording instead.';
  return `The microphone didn't start: ${(err as Error)?.message || name || 'unknown error'}.`;
}

export class TakeRecorderCore {
  private snap: TakeSnapshot = INITIAL_TAKE;
  private generation = 0;
  private starting = false;
  private alive = true;
  private stream: StreamLike | null = null;
  private recorder: RecorderLike | null = null;
  private meter: MeterLike | null = null;
  private timer: unknown = null;
  private chunks: Blob[] = [];
  private startedAt = 0;

  constructor(
    private readonly maxSeconds: number,
    private readonly env: TakeEnv,
    private readonly onChange: (s: TakeSnapshot) => void,
  ) {}

  get snapshot(): TakeSnapshot { return this.snap; }

  private set(patch: Partial<TakeSnapshot>): void {
    this.snap = { ...this.snap, ...patch };
    if (this.alive) this.onChange(this.snap);
  }

  /** Stop the mic tracks, the meter and the tick. Safe to call twice. */
  private release(): void {
    if (this.timer !== null) this.env.clearInterval(this.timer);
    this.timer = null;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    try { this.meter?.close(); } catch { /* already closed */ }
    this.meter = null;
  }

  /** (Re)connect to a mounted view; React StrictMode unmounts and remounts once. */
  attach = (): void => { this.alive = true; };

  /** The view is gone: cancel everything and release the mic. */
  dispose = (): void => {
    this.alive = false;
    this.generation++;
    this.starting = false;
    this.stopRecorderSilently();
    this.release();
  };

  private stopRecorderSilently(): void {
    const rec = this.recorder;
    this.recorder = null;
    this.chunks = [];
    if (rec && rec.state !== 'inactive') {
      rec.onstop = null;
      try { rec.stop(); } catch { /* already stopped */ }
    }
  }

  start = async (): Promise<void> => {
    const st = this.snap.state;
    if (st === 'starting' || st === 'recording' || st === 'processing') return;
    const unavailable = this.env.micUnavailable();
    if (unavailable) {
      this.set({ state: 'error', error: unavailable });
      return;
    }
    const generation = ++this.generation;
    this.starting = true;
    this.set({ state: 'starting', error: null, take: null, seconds: 0, level: 0, advice: null });

    let stream: StreamLike;
    try {
      stream = await this.env.getUserMedia();
    } catch (err) {
      if (!this.alive || generation !== this.generation) return;
      this.starting = false;
      this.set({ state: 'error', error: micErrorMessage(err) });
      return;
    }
    if (!this.alive || generation !== this.generation) {
      // Stopped, reset or unmounted while the prompt was up: give the mic straight back.
      stream.getTracks().forEach((t) => t.stop());
      return;
    }
    this.stream = stream;

    try {
      this.meter = this.env.createMeter(stream);
    } catch {
      this.meter = null; // no meter is fine; the take still records
    }

    const mimeType = this.env.pickMimeType();
    let rec: RecorderLike;
    try {
      rec = this.env.createRecorder(stream, mimeType);
      this.chunks = [];
      rec.ondataavailable = (e) => { if (e.data.size > 0) this.chunks.push(e.data); };
      rec.onstop = () => {
        const blob = new Blob(this.chunks, { type: rec.mimeType || mimeType || 'audio/webm' });
        this.chunks = [];
        this.recorder = null;
        this.release();
        if (!this.alive || generation !== this.generation) return;
        this.set({ level: 0 });
        void this.finish(blob, generation);
      };
      rec.start(500);
    } catch (err) {
      // Setup failed: never leave the mic live or the take stuck at 'starting'.
      this.starting = false;
      this.recorder = null;
      this.chunks = [];
      this.release();
      if (!this.alive || generation !== this.generation) return;
      const why = (err as Error)?.message || (err as Error)?.name || 'unknown error';
      this.set({ state: 'error', level: 0, seconds: 0, error: `Recording couldn't start: ${why}. Try again, or upload a recording instead.` });
      return;
    }
    this.recorder = rec;
    this.starting = false;
    this.startedAt = this.env.now();
    this.set({ state: 'recording' });
    this.timer = this.env.setInterval(() => this.tick(), 66);
  };

  private tick(): void {
    const elapsed = (this.env.now() - this.startedAt) / 1000;
    const block = this.meter?.read() ?? null;
    if (block) {
      const l = blockLevel(block);
      this.set({ seconds: elapsed, level: this.snap.level * 0.6 + Math.min(1, l.rms * 4) * 0.4, advice: levelAdvice(l) });
    } else {
      this.set({ seconds: elapsed });
    }
    if (elapsed >= this.maxSeconds) this.stop();
  }

  stop = (): void => {
    const rec = this.recorder;
    if (rec && rec.state !== 'inactive') {
      rec.stop();
      return;
    }
    // Stop while the permission prompt (or setup) is pending: cancel that start.
    if (this.starting) {
      this.starting = false;
      this.generation++;
      this.release();
      this.set({ state: 'idle', level: 0, seconds: 0, advice: null });
    }
  };

  reset = (): void => {
    this.generation++;
    this.starting = false;
    this.stopRecorderSilently();
    this.release();
    this.set({ ...INITIAL_TAKE });
  };

  /** Use a file instead of recording (the sample step only). */
  takeFile = async (file: Blob): Promise<void> => {
    this.reset();
    await this.finish(file, this.generation);
  };

  private async finish(blob: Blob, generation: number): Promise<void> {
    this.set({ state: 'processing' });
    try {
      const take = await this.env.convert(blob);
      if (!this.alive || generation !== this.generation) return;
      this.set({ state: 'done', take, seconds: take.seconds });
    } catch {
      if (!this.alive || generation !== this.generation) return;
      this.set({ state: 'error', error: "This recording couldn't be read as audio. Try again, or use a WAV, MP3 or M4A file." });
    }
  }
}
