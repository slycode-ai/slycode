'use client';

import type { VoiceState } from '@/lib/types';

interface VoiceControlBarProps {
  voiceState: VoiceState;
  elapsedSeconds: number;
  disabled: boolean;
  error: string | null;
  onRecord: () => void;
  onPause: () => void;
  onResume: () => void;
  onClear: () => void;
  onSubmit: () => void;
  onRetry: () => void;
  onOpenSettings: () => void;
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function VoiceControlBar({
  voiceState,
  elapsedSeconds,
  disabled,
  error,
  onRecord,
  onPause,
  onResume,
  onClear,
  onSubmit,
  onRetry,
  onOpenSettings,
}: VoiceControlBarProps) {
  const isRecordingPhase = voiceState === 'recording' || voiceState === 'paused';

  return (
    <div className={`flex items-center gap-1.5 ${disabled ? 'opacity-40 pointer-events-none' : ''}`}>
      {/* Idle / Disabled: just mic button */}
      {(voiceState === 'idle' || voiceState === 'disabled') && (
        <button
          onClick={onRecord}
          disabled={disabled}
          className="rounded-md border border-void-400/30 bg-void-200/50 p-1.5 text-void-500 transition-all hover:border-red-400/40 hover:bg-red-400/10 hover:text-red-400 disabled:opacity-50 dark:border-void-500/25 dark:bg-void-700/50 dark:text-void-400 dark:hover:border-red-400/40 dark:hover:bg-red-400/10 dark:hover:text-red-400"
          title="Start recording (Ctrl+.)"
        >
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
          </svg>
        </button>
      )}

      {/* Recording / Paused: full controls */}
      {isRecordingPhase && (
        <>
          {/* Blinking red dot + timer */}
          <div className="flex items-center gap-1.5 px-1">
            <span
              className={`inline-block h-2 w-2 rounded-full bg-red-500 ${voiceState === 'recording' ? 'animate-pulse' : ''}`}
            />
            <span className="min-w-[2.5rem] font-mono text-xs tabular-nums text-red-600 dark:text-red-400">
              {formatTime(elapsedSeconds)}
            </span>
          </div>

          {/* Pause / Resume */}
          <button
            onClick={voiceState === 'recording' ? onPause : onResume}
            className="rounded-md border border-void-400/30 bg-void-200/50 p-1.5 text-void-600 transition-all hover:border-neon-blue-400/40 hover:bg-neon-blue-400/10 hover:text-neon-blue-400 dark:border-void-500/25 dark:bg-void-700/50 dark:text-void-400 dark:hover:border-neon-blue-400/40 dark:hover:bg-neon-blue-400/10 dark:hover:text-neon-blue-400"
            title={voiceState === 'recording' ? 'Pause (Space)' : 'Resume (Space)'}
          >
            {voiceState === 'recording' ? (
              <svg className="h-3.5 w-3.5" fill="currentColor" viewBox="0 0 24 24">
                <rect x="6" y="4" width="4" height="16" />
                <rect x="14" y="4" width="4" height="16" />
              </svg>
            ) : (
              <svg className="h-3.5 w-3.5" fill="currentColor" viewBox="0 0 24 24">
                <polygon points="5,3 19,12 5,21" />
              </svg>
            )}
          </button>

          {/* Clear */}
          <button
            onClick={onClear}
            className="rounded-md border border-void-400/30 bg-void-200/50 p-1.5 text-void-600 transition-all hover:border-red-400/40 hover:bg-red-400/10 hover:text-red-400 dark:border-void-500/25 dark:bg-void-700/50 dark:text-void-400 dark:hover:border-red-400/40 dark:hover:bg-red-400/10 dark:hover:text-red-400"
            title="Clear recording (Escape)"
          >
            <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>

          {/* Submit */}
          <button
            onClick={onSubmit}
            className="rounded-md border border-green-400/40 bg-green-400/15 px-2 py-1.5 text-xs font-medium text-green-600 transition-all hover:bg-green-400/25 hover:shadow-[0_0_8px_rgba(34,197,94,0.2)] dark:text-green-400"
            title="Submit for transcription (Enter)"
          >
            <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </button>
        </>
      )}

      {/* Transcribing: spinner */}
      {voiceState === 'transcribing' && (
        <div className="flex items-center gap-1.5 px-1">
          <svg className="h-4 w-4 animate-spin text-[#2490b5] dark:text-neon-blue-400" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          <span className="text-xs text-[#2490b5] dark:text-neon-blue-400">Transcribing...</span>
        </div>
      )}

      {/* Error: retry + clear */}
      {voiceState === 'error' && (
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-red-400" title={error || 'Transcription failed'}>Failed</span>
          <button
            onClick={onRetry}
            className="rounded-md border border-neon-blue-400/40 bg-neon-blue-400/15 px-1.5 py-1 text-xs font-medium text-neon-blue-400 transition-all hover:bg-neon-blue-400/25"
            title="Retry transcription"
          >
            Retry
          </button>
          <button
            onClick={onClear}
            className="rounded-md border border-void-400/30 bg-void-200/50 p-1.5 text-void-600 transition-all hover:border-red-400/40 hover:bg-red-400/10 hover:text-red-400 dark:border-void-500/25 dark:bg-void-700/50 dark:text-void-400 dark:hover:border-red-400/40 dark:hover:bg-red-400/10 dark:hover:text-red-400"
            title="Clear"
          >
            <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}

      {/* Settings gear - always visible */}
      <button
        onClick={onOpenSettings}
        className="rounded-md border border-void-400/30 bg-void-200/50 p-1.5 text-void-500 transition-all hover:border-void-400/50 hover:text-void-700 dark:border-void-500/25 dark:bg-void-700/50 dark:text-void-400 dark:hover:border-void-400/50 dark:hover:text-void-300"
        title="Voice settings"
      >
        <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
      </button>
    </div>
  );
}
