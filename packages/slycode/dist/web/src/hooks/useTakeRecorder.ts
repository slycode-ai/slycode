import { useEffect, useState } from 'react';
import { bytesToBase64, toWav24kMono } from '@/lib/wav-encode';
import { INITIAL_TAKE, TakeRecorderCore, type MeterLike, type RecorderLike, type StreamLike, type TakeEnv, type TakeSnapshot } from '@/lib/take-recorder-core';

export type { TakeState } from '@/lib/take-recorder-core';

/**
 * One recording ("take") for voice cloning (#0376). Separate from dictation:
 * a take never goes to transcription, and it isn't a VoiceContext claimant
 * (claiming would force-release the card's dictation for good). Dictation
 * shortcuts are already suspended while Voice Settings is open, which is the
 * only place cloning lives.
 *
 * The lifecycle (start/stop/cancel/reset, failure cleanup) lives in
 * lib/take-recorder-core.ts, where it is tested; this binds it to the
 * browser. The mic is raw (no echo cancellation, noise suppression or auto
 * gain) so Google's speaker check compares like with like across both
 * takes. The finished take is 24 kHz mono WAV in memory only.
 */
export interface TakeRecorder extends TakeSnapshot {
  start: () => Promise<void>;
  stop: () => void;
  reset: () => void;
  /** Use a file instead of recording (the sample step only). */
  takeFile: (file: File) => Promise<void>;
}

const MIC_CONSTRAINTS: MediaTrackConstraints = { echoCancellation: false, noiseSuppression: false, autoGainControl: false };

function pickMimeType(): string {
  if (typeof MediaRecorder === 'undefined') return '';
  for (const t of ['audio/ogg;codecs=opus', 'audio/webm;codecs=opus', 'audio/mp4']) {
    if (MediaRecorder.isTypeSupported(t)) return t;
  }
  return '';
}

/** Why the mic can't be used, in plain words, or null. */
export function micUnavailableReason(): string | null {
  if (typeof window === 'undefined') return null;
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
    return 'The microphone needs a secure (https://) address. Open SlyCode on its https address, or upload a recording instead.';
  }
  if (typeof MediaRecorder === 'undefined') return "This browser can't record audio. Upload a recording instead.";
  return null;
}

/** An analyser on the live stream. */
function browserMeter(stream: StreamLike): MeterLike | null {
  const ctx = new AudioContext();
  // iOS starts a context made after an await suspended; the meter needs it running.
  void ctx.resume().catch(() => {});
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 2048;
  ctx.createMediaStreamSource(stream as MediaStream).connect(analyser);
  const buf = new Float32Array(analyser.fftSize);
  return {
    read: () => { analyser.getFloatTimeDomainData(buf); return buf; },
    close: () => { void ctx.close().catch(() => {}); },
  };
}

const browserEnv: TakeEnv = {
  micUnavailable: micUnavailableReason,
  getUserMedia: () => navigator.mediaDevices.getUserMedia({ audio: MIC_CONSTRAINTS }),
  pickMimeType,
  createRecorder: (stream, mimeType) => new MediaRecorder(stream as MediaStream, mimeType ? { mimeType } : undefined) as unknown as RecorderLike,
  createMeter: browserMeter,
  convert: async (blob) => {
    const { wav, seconds } = await toWav24kMono(blob);
    return { wavBase64: bytesToBase64(wav), seconds };
  },
  now: () => Date.now(),
  setInterval: (fn, ms) => window.setInterval(fn, ms),
  clearInterval: (h) => window.clearInterval(h as number),
};

export function useTakeRecorder(maxSeconds: number): TakeRecorder {
  const [snap, setSnap] = useState<TakeSnapshot>(INITIAL_TAKE);
  const [core] = useState(() => new TakeRecorderCore(maxSeconds, browserEnv, setSnap));
  useEffect(() => {
    core.attach();
    return core.dispose; // unmount: cancel any start, stop the recorder, release the mic
  }, [core]);
  return { ...snap, start: core.start, stop: core.stop, reset: core.reset, takeFile: core.takeFile };
}
