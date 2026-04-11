'use client';

import { useRef, useEffect } from 'react';

interface VoiceErrorPopupProps {
  error: string;
  hasRecording?: boolean;
  onRetry?: () => void;
  onClear: () => void;
  onClose: () => void;
}

export function VoiceErrorPopup({ error, hasRecording, onRetry, onClear, onClose }: VoiceErrorPopupProps) {
  const popupRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (popupRef.current && !popupRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [onClose]);

  const isSecureContext = typeof window !== 'undefined' && window.isSecureContext;
  const isStartError = !hasRecording;
  const title = isStartError ? 'Recording Failed' : 'Transcription Failed';
  const hint = isStartError && !isSecureContext
    ? 'Microphone requires HTTPS or localhost. Try accessing via localhost:3003, or add this origin to chrome://flags/#unsafely-treat-insecure-origin-as-secure.'
    : isStartError
      ? 'Could not access the microphone.'
      : 'Your recording is preserved. You can retry or clear and start over.';

  return (
    <div
      ref={popupRef}
      className="w-72 rounded-lg border border-red-400/30 bg-white p-3 shadow-(--shadow-overlay) dark:border-red-400/20 dark:bg-void-800"
    >
      <div className="mb-2 flex items-start gap-2">
        <svg className="mt-0.5 h-4 w-4 flex-shrink-0 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
        </svg>
        <div>
          <div className="text-xs font-medium text-red-600 dark:text-red-400">{title}</div>
          <div className="mt-1 text-xs text-void-600 dark:text-void-300">{error}</div>
        </div>
      </div>
      <div className="mt-2 text-xs text-void-500 dark:text-void-400">
        {hint}
      </div>
      <div className="mt-3 flex justify-end gap-2">
        <button
          onClick={onClear}
          className="rounded border border-void-300 bg-void-100 px-2 py-1 text-xs text-void-600 hover:text-void-800 dark:border-void-600 dark:bg-void-700 dark:text-void-400 dark:hover:text-void-300"
        >
          {isStartError ? 'Dismiss' : 'Clear'}
        </button>
        {hasRecording && onRetry && (
          <button
            onClick={onRetry}
            className="rounded border border-neon-blue-400/40 bg-neon-blue-400/15 px-2 py-1 text-xs text-neon-blue-600 hover:bg-neon-blue-400/25 dark:text-neon-blue-400"
          >
            Retry
          </button>
        )}
      </div>
    </div>
  );
}
