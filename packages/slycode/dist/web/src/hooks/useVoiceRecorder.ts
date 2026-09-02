import { useState, useRef, useCallback, useEffect } from 'react';
import type { VoiceState } from '@/lib/types';

interface UseVoiceRecorderOptions {
  maxRecordingSeconds: number;
  /**
   * Deliver a transcript to its target. Return an error message (string) when
   * it could NOT be delivered — the recorder then enters the error state and
   * keeps both the audio and the transcript so Retry can re-deliver without
   * re-transcribing. Return nothing (or throw) otherwise; a throw is treated
   * as a delivery failure with the thrown message.
   */
  onTranscriptionComplete?: (text: string) => string | void;
}

interface UseVoiceRecorderReturn {
  state: VoiceState;
  elapsedSeconds: number;
  error: string | null;
  transcribedText: string | null;
  hasRecording: boolean;
  startRecording: () => Promise<void>;
  pauseRecording: () => void;
  resumeRecording: () => void;
  clearRecording: () => void;
  submitRecording: () => Promise<void>;
  retryTranscription: () => Promise<void>;
}

export function useVoiceRecorder({ maxRecordingSeconds, onTranscriptionComplete }: UseVoiceRecorderOptions): UseVoiceRecorderReturn {
  const [state, setState] = useState<VoiceState>('idle');
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [transcribedText, setTranscribedText] = useState<string | null>(null);
  // Mirrors "audio or transcript retained" as state so the UI (Retry button,
  // popup title) re-renders when retention changes — refs alone don't.
  const [hasRecording, setHasRecording] = useState(false);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const audioBlobRef = useRef<Blob | null>(null);
  // Transcript that came back but could not be delivered — Retry re-delivers
  // it instead of paying for a second transcription.
  const pendingTranscriptRef = useRef<string | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const batchStartRef = useRef(0);
  const autoPausedRef = useRef(false);
  const onTranscriptionCompleteRef = useRef(onTranscriptionComplete);
  // Recording generation: bumped by every start and clear. Any async
  // completion (transcription response, retry) captures the generation it
  // started under and is ignored if it no longer matches — so a modal closed
  // or voice reclaimed mid-transcription, or a fresh recording started after
  // a clear, can never receive a stale transcript.
  const generationRef = useRef(0);
  // Single-flight locks — `state` in the closures lags a tap by one render,
  // so a rapid double-tap could otherwise start two recorders or two POSTs.
  const startingRef = useRef(false);
  const submittingRef = useRef(false);

  useEffect(() => {
    onTranscriptionCompleteRef.current = onTranscriptionComplete;
  }, [onTranscriptionComplete]);

  const startTimer = useCallback(() => {
    if (timerRef.current) return;
    timerRef.current = setInterval(() => {
      setElapsedSeconds((prev) => prev + 1);
    }, 1000);
  }, []);

  const stopTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  // Auto-pause at max recording length (per batch)
  useEffect(() => {
    if (state === 'recording' && (elapsedSeconds - batchStartRef.current) >= maxRecordingSeconds) {
      if (mediaRecorderRef.current?.state === 'recording') {
        mediaRecorderRef.current.pause();
      }
      autoPausedRef.current = true;
      stopTimer();
      setState('paused');
    }
  }, [state, elapsedSeconds, maxRecordingSeconds, stopTimer]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopTimer();
      if (mediaRecorderRef.current?.state !== 'inactive') {
        try { mediaRecorderRef.current?.stop(); } catch { /* ignore */ }
      }
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, [stopTimer]);

  const stopMediaRecorder = useCallback(() => {
    return new Promise<Blob>((resolve) => {
      const recorder = mediaRecorderRef.current;
      if (!recorder || recorder.state === 'inactive') {
        const blob = new Blob(chunksRef.current, { type: chunksRef.current[0]?.type || 'audio/webm' });
        resolve(blob);
        return;
      }
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: chunksRef.current[0]?.type || 'audio/webm' });
        resolve(blob);
      };
      recorder.stop();
    });
  }, []);

  const transcribeAudio = useCallback(async (blob: Blob): Promise<string> => {
    if (blob.size === 0) {
      throw new Error('No audio was captured (empty recording). Check the microphone and try again.');
    }
    const formData = new FormData();
    formData.append('audio', blob, 'recording.webm');
    const res = await fetch('/api/transcribe', { method: 'POST', body: formData });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Transcription failed');
    const text = typeof data.text === 'string' ? data.text.trim() : '';
    if (!text) {
      throw new Error('Transcription came back empty — nothing intelligible was heard.');
    }
    return text;
  }, []);

  const releaseStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  /**
   * Hand a transcript to the delivery callback. On success everything retained
   * for Retry is dropped; on failure the audio + transcript are kept and the
   * error state shows the callback's message.
   */
  const deliverTranscript = useCallback((text: string) => {
    let failure: string | undefined;
    try {
      failure = onTranscriptionCompleteRef.current?.(text) || undefined;
    } catch (err) {
      failure = (err as Error).message || 'Transcript could not be delivered';
    }
    setTranscribedText(text);
    setElapsedSeconds(0);
    if (failure) {
      pendingTranscriptRef.current = text;
      setHasRecording(true);
      setError(failure);
      setState('error');
      return;
    }
    audioBlobRef.current = null;
    pendingTranscriptRef.current = null;
    chunksRef.current = [];
    setHasRecording(false);
    setState('idle');
  }, []);

  const startRecording = useCallback(async () => {
    if (state !== 'idle' && state !== 'disabled') return;
    if (startingRef.current) return;
    startingRef.current = true;
    const generation = ++generationRef.current;

    try {
      setError(null);
      setTranscribedText(null);
      chunksRef.current = [];
      audioBlobRef.current = null;
      pendingTranscriptRef.current = null;
      setHasRecording(false);
      setElapsedSeconds(0);
      batchStartRef.current = 0;

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (generation !== generationRef.current) {
        // Cleared (modal closed / voice reclaimed) while the permission
        // prompt was up — don't start a recorder nobody owns.
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      streamRef.current = stream;

      const mimeType = MediaRecorder.isTypeSupported('audio/ogg;codecs=opus')
        ? 'audio/ogg;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
          ? 'audio/webm;codecs=opus'
          : MediaRecorder.isTypeSupported('audio/mp4')
            ? 'audio/mp4'
            : '';

      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.start(1000); // Collect data every second
      setState('recording');
      startTimer();
    } catch (err) {
      const msg = (err as Error).message;
      if (msg.includes('Permission') || msg.includes('NotAllowed')) {
        setError('Microphone permission denied. Please allow microphone access.');
      } else {
        setError(msg || 'Failed to start recording');
      }
      setState('error');
      releaseStream();
    } finally {
      startingRef.current = false;
    }
  }, [state, startTimer, releaseStream]);

  const pauseRecording = useCallback(() => {
    if (state !== 'recording') return;
    if (mediaRecorderRef.current?.state === 'recording') {
      mediaRecorderRef.current.pause();
    }
    stopTimer();
    setState('paused');
  }, [state, stopTimer]);

  const resumeRecording = useCallback(() => {
    if (state !== 'paused') return;
    if (mediaRecorderRef.current?.state === 'paused') {
      mediaRecorderRef.current.resume();
    }
    // Only reset batch start when resuming from auto-pause (gives another full interval)
    // Manual pause/resume should not extend the current batch window
    if (autoPausedRef.current) {
      batchStartRef.current = elapsedSeconds;
      autoPausedRef.current = false;
    }
    startTimer();
    setState('recording');
  }, [state, elapsedSeconds, startTimer]);

  const clearRecording = useCallback(() => {
    generationRef.current++; // orphan any in-flight transcription/retry
    stopTimer();
    if (mediaRecorderRef.current?.state !== 'inactive') {
      try { mediaRecorderRef.current?.stop(); } catch { /* ignore */ }
    }
    chunksRef.current = [];
    audioBlobRef.current = null;
    pendingTranscriptRef.current = null;
    setHasRecording(false);
    setElapsedSeconds(0);
    setError(null);
    setTranscribedText(null);
    releaseStream();
    setState('idle');
  }, [stopTimer, releaseStream]);

  const submitRecording = useCallback(async () => {
    if (state !== 'recording' && state !== 'paused') return;
    if (submittingRef.current) return;
    submittingRef.current = true;
    const generation = generationRef.current;

    stopTimer();
    setState('transcribing');

    try {
      const blob = await stopMediaRecorder();
      releaseStream();
      if (generation !== generationRef.current) return; // cleared while stopping
      audioBlobRef.current = blob;
      setHasRecording(blob.size > 0);

      const text = await transcribeAudio(blob);
      if (generation !== generationRef.current) return; // cleared while transcribing
      deliverTranscript(text);
    } catch (err) {
      if (generation !== generationRef.current) return;
      setError((err as Error).message || 'Transcription failed');
      setState('error');
    } finally {
      submittingRef.current = false;
    }
  }, [state, stopTimer, stopMediaRecorder, transcribeAudio, releaseStream, deliverTranscript]);

  const retryTranscription = useCallback(async () => {
    if (state !== 'error') return;
    if (submittingRef.current) return;
    const generation = generationRef.current;

    // A transcript that only failed delivery is re-delivered as-is.
    const pending = pendingTranscriptRef.current;
    if (pending) {
      setError(null);
      deliverTranscript(pending);
      return;
    }

    if (!audioBlobRef.current) return;
    submittingRef.current = true;
    setState('transcribing');
    setError(null);

    try {
      const text = await transcribeAudio(audioBlobRef.current);
      if (generation !== generationRef.current) return;
      deliverTranscript(text);
    } catch (err) {
      if (generation !== generationRef.current) return;
      setError((err as Error).message || 'Transcription failed');
      setState('error');
    } finally {
      submittingRef.current = false;
    }
  }, [state, transcribeAudio, deliverTranscript]);

  return {
    state,
    elapsedSeconds,
    error,
    transcribedText,
    hasRecording,
    startRecording,
    pauseRecording,
    resumeRecording,
    clearRecording,
    submitRecording,
    retryTranscription,
  };
}
