import { useState, useRef, useCallback, useEffect } from 'react';
import type { VoiceState } from '@/lib/types';

interface UseVoiceRecorderOptions {
  maxRecordingSeconds: number;
  onTranscriptionComplete?: (text: string) => void;
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

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const audioBlobRef = useRef<Blob | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const batchStartRef = useRef(0);
  const autoPausedRef = useRef(false);
  const onTranscriptionCompleteRef = useRef(onTranscriptionComplete);

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
    const formData = new FormData();
    formData.append('audio', blob, 'recording.webm');
    const res = await fetch('/api/transcribe', { method: 'POST', body: formData });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Transcription failed');
    return data.text;
  }, []);

  const releaseStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  const startRecording = useCallback(async () => {
    if (state !== 'idle' && state !== 'disabled') return;

    try {
      setError(null);
      setTranscribedText(null);
      chunksRef.current = [];
      audioBlobRef.current = null;
      setElapsedSeconds(0);
      batchStartRef.current = 0;

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
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
    stopTimer();
    if (mediaRecorderRef.current?.state !== 'inactive') {
      try { mediaRecorderRef.current?.stop(); } catch { /* ignore */ }
    }
    chunksRef.current = [];
    audioBlobRef.current = null;
    setElapsedSeconds(0);
    setError(null);
    setTranscribedText(null);
    releaseStream();
    setState('idle');
  }, [stopTimer, releaseStream]);

  const submitRecording = useCallback(async () => {
    if (state !== 'recording' && state !== 'paused') return;

    stopTimer();
    setState('transcribing');

    try {
      const blob = await stopMediaRecorder();
      audioBlobRef.current = blob;
      releaseStream();

      const text = await transcribeAudio(blob);
      setTranscribedText(text);
      setElapsedSeconds(0);
      chunksRef.current = [];
      setState('idle');
      onTranscriptionCompleteRef.current?.(text);
    } catch (err) {
      setError((err as Error).message || 'Transcription failed');
      setState('error');
    }
  }, [state, stopTimer, stopMediaRecorder, transcribeAudio, releaseStream]);

  const retryTranscription = useCallback(async () => {
    if (state !== 'error' || !audioBlobRef.current) return;

    setState('transcribing');
    setError(null);

    try {
      const text = await transcribeAudio(audioBlobRef.current);
      setTranscribedText(text);
      audioBlobRef.current = null;
      chunksRef.current = [];
      setElapsedSeconds(0);
      setState('idle');
      onTranscriptionCompleteRef.current?.(text);
    } catch (err) {
      setError((err as Error).message || 'Transcription failed');
      setState('error');
    }
  }, [state, transcribeAudio]);

  return {
    state,
    elapsedSeconds,
    error,
    transcribedText,
    hasRecording: audioBlobRef.current !== null || chunksRef.current.length > 0,
    startRecording,
    pauseRecording,
    resumeRecording,
    clearRecording,
    submitRecording,
    retryTranscription,
  };
}
