'use client';

import { createContext, useContext, useCallback, useRef, useState, useEffect, type ReactNode } from 'react';
import { useVoiceRecorder } from '@/hooks/useVoiceRecorder';
import { useVoiceShortcuts } from '@/hooks/useVoiceShortcuts';
import { useSettings } from '@/hooks/useSettings';
import { FloatingVoiceWidget } from '@/components/FloatingVoiceWidget';
import type { VoiceState, VoiceClaimant, VoiceSettings, AppSettings, TerminalHandle } from '@/lib/types';

// ---------------------------------------------------------------------------
// Context value interface
// ---------------------------------------------------------------------------

interface VoiceContextValue {
  // State (from useVoiceRecorder)
  voiceState: VoiceState;
  elapsedSeconds: number;
  error: string | null;
  hasRecording: boolean;

  // Controls (from useVoiceRecorder)
  startRecording: () => Promise<void>;
  pauseRecording: () => void;
  resumeRecording: () => void;
  clearRecording: () => void;
  submitRecording: () => Promise<void>;
  retryTranscription: () => Promise<void>;

  // Claim system
  claimVoiceControl: (claimant: VoiceClaimant) => void;
  releaseVoiceControl: (claimant: VoiceClaimant) => void;
  currentClaimantId: string | null;

  // Settings
  settings: AppSettings;
  updateSettings: (patch: { voice?: Partial<VoiceSettings> }) => Promise<AppSettings | null>;

  // Terminal registry
  registerTerminal: (id: string, handle: TerminalHandle) => void;
  unregisterTerminal: (id: string) => void;

  // Submit mode — 'paste' means don't auto-submit to terminal after transcription
  submitModeRef: React.RefObject<'auto' | 'paste'>;

  // UI state
  showSettings: boolean;
  setShowSettings: (v: boolean) => void;
  hasFieldFocus: boolean;
  setHasFieldFocus: (v: boolean) => void;
}

const VoiceContext = createContext<VoiceContextValue | null>(null);

// ---------------------------------------------------------------------------
// useVoice() hook — consumer interface
// ---------------------------------------------------------------------------

export function useVoice(): VoiceContextValue {
  const ctx = useContext(VoiceContext);
  if (!ctx) throw new Error('useVoice() must be used inside <VoiceProvider>');
  return ctx;
}

// ---------------------------------------------------------------------------
// Focus target for unclaimed (global) mode
// ---------------------------------------------------------------------------

interface GlobalFocusTarget {
  type: 'input' | 'terminal';
  element?: HTMLElement;
  terminalId?: string;
}

// ---------------------------------------------------------------------------
// VoiceProvider — the single owner of all voice state
// ---------------------------------------------------------------------------

export function VoiceProvider({ children }: { children: ReactNode }) {
  // ---- Settings (single instance) ----
  const { settings, updateSettings } = useSettings();

  // ---- Terminal handle registry ----
  const terminalHandlesRef = useRef<Map<string, TerminalHandle>>(new Map());
  const lastActiveTerminalRef = useRef<string | null>(null);

  const registerTerminal = useCallback((id: string, handle: TerminalHandle) => {
    terminalHandlesRef.current.set(id, handle);
    lastActiveTerminalRef.current = id;
  }, []);

  const unregisterTerminal = useCallback((id: string) => {
    terminalHandlesRef.current.delete(id);
    if (lastActiveTerminalRef.current === id) {
      // Fallback to first available terminal
      const keys = Array.from(terminalHandlesRef.current.keys());
      lastActiveTerminalRef.current = keys.length > 0 ? keys[0] : null;
    }
  }, []);

  // ---- Claim/release system ----
  const claimantRef = useRef<VoiceClaimant | null>(null);
  const [currentClaimantId, setCurrentClaimantId] = useState<string | null>(null);

  // ---- Global focus target (unclaimed mode) ----
  const globalFocusTargetRef = useRef<GlobalFocusTarget | null>(null);
  const globalSubmitModeRef = useRef<'auto' | 'paste'>('auto');

  // ---- UI state ----
  const [showSettings, setShowSettings] = useState(false);
  const [hasFieldFocus, setHasFieldFocus] = useState(false);

  // ---- Global text insertion (unclaimed mode) ----
  const insertTextGlobal = useCallback((text: string) => {
    const target = globalFocusTargetRef.current;
    if (!target) return;

    if (target.type === 'input' && target.element) {
      if (!document.contains(target.element)) return;
      const el = target.element as HTMLInputElement | HTMLTextAreaElement;
      const start = el.selectionStart ?? el.value.length;
      const end = el.selectionEnd ?? el.value.length;
      el.focus();
      el.setSelectionRange(start, end);
      document.execCommand('insertText', false, text);
    } else if (target.type === 'terminal' && target.terminalId) {
      const handle = terminalHandlesRef.current.get(target.terminalId);
      if (!handle) return;
      const shouldAutoSubmit = globalSubmitModeRef.current === 'auto' && settings.voice.autoSubmitTerminal;
      handle.sendInput(text);
      if (shouldAutoSubmit) {
        setTimeout(() => handle.sendInput('\r'), 300);
      }
    }
    globalSubmitModeRef.current = 'auto';
  }, [settings.voice.autoSubmitTerminal]);

  // ---- Transcription complete handler (routes to claimant or global) ----
  const handleTranscriptionComplete = useCallback((text: string) => {
    if (claimantRef.current) {
      claimantRef.current.onTranscriptionComplete(text);
    } else {
      insertTextGlobal(text);
    }
  }, [insertTextGlobal]);

  // ---- Voice recorder (single state machine) ----
  const voiceRecorder = useVoiceRecorder({
    maxRecordingSeconds: settings.voice.maxRecordingSeconds,
    onTranscriptionComplete: handleTranscriptionComplete,
  });

  // ---- Claim/release implementation ----
  const claimVoiceControl = useCallback((claimant: VoiceClaimant) => {
    if (claimantRef.current && claimantRef.current.id !== claimant.id) {
      // Force-release previous claimant
      claimantRef.current.onRelease?.();
      if (voiceRecorder.state !== 'idle' && voiceRecorder.state !== 'disabled') {
        voiceRecorder.clearRecording();
      }
    }
    claimantRef.current = claimant;
    setCurrentClaimantId(claimant.id);
  }, [voiceRecorder]);

  const releaseVoiceControl = useCallback((claimant: VoiceClaimant) => {
    if (claimantRef.current?.id !== claimant.id) return; // not the owner
    if (voiceRecorder.state !== 'idle' && voiceRecorder.state !== 'error' && voiceRecorder.state !== 'disabled') {
      voiceRecorder.clearRecording();
    }
    claimantRef.current = null;
    setCurrentClaimantId(null);
  }, [voiceRecorder]);

  // ---- Global focus tracking (only active when unclaimed) ----
  useEffect(() => {
    const handleFocusIn = (e: FocusEvent) => {
      const target = e.target as HTMLElement;
      // Check voice-target inputs
      if (target.closest('[data-voice-target]') && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) {
        setHasFieldFocus(true);
        return;
      }
      // Check terminal containers
      if (target.closest('[data-terminal-id]')) {
        const terminalEl = target.closest('[data-terminal-id]') as HTMLElement;
        const terminalId = terminalEl.dataset.terminalId;
        if (terminalId && terminalHandlesRef.current.has(terminalId)) {
          lastActiveTerminalRef.current = terminalId;
          setHasFieldFocus(true);
        }
      }
    };

    const handleFocusOut = () => {
      // Small delay to allow focus to settle
      setTimeout(() => {
        const active = document.activeElement as HTMLElement;
        if (!active) { setHasFieldFocus(false); return; }
        const isVoiceTarget = active.closest('[data-voice-target]') && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA');
        const isTerminal = active.closest('[data-terminal-id]');
        if (!isVoiceTarget && !isTerminal) {
          setHasFieldFocus(false);
        }
      }, 100);
    };

    document.addEventListener('focusin', handleFocusIn);
    document.addEventListener('focusout', handleFocusOut);
    return () => {
      document.removeEventListener('focusin', handleFocusIn);
      document.removeEventListener('focusout', handleFocusOut);
    };
  }, []);

  // ---- Shortcut callbacks ----
  const handleStartRecording = useCallback(() => {
    if (claimantRef.current) {
      // Claimed mode — delegate to claimant
      claimantRef.current.onRecordStart?.();
      voiceRecorder.startRecording();
    } else {
      // Unclaimed (global) mode — capture focus target ourselves
      const active = document.activeElement as HTMLElement;
      if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA') && active.closest('[data-voice-target]')) {
        globalFocusTargetRef.current = { type: 'input', element: active };
      } else if (active?.closest('[data-terminal-id]')) {
        const terminalEl = active.closest('[data-terminal-id]') as HTMLElement;
        const terminalId = terminalEl.dataset.terminalId || lastActiveTerminalRef.current;
        if (terminalId && terminalHandlesRef.current.has(terminalId)) {
          globalFocusTargetRef.current = { type: 'terminal', terminalId };
        } else {
          return; // No valid target
        }
      } else if (lastActiveTerminalRef.current && terminalHandlesRef.current.has(lastActiveTerminalRef.current)) {
        // Fallback: use last active terminal if nothing specific is focused
        // but only if we have field focus (the control bar is enabled)
        globalFocusTargetRef.current = { type: 'terminal', terminalId: lastActiveTerminalRef.current };
      } else {
        return; // No valid target
      }
      voiceRecorder.startRecording();
    }
  }, [voiceRecorder]);

  const handleSubmitPasteOnly = useCallback(() => {
    globalSubmitModeRef.current = 'paste';
    voiceRecorder.submitRecording();
  }, [voiceRecorder]);

  const handlePauseResume = useCallback(() => {
    if (voiceRecorder.state === 'recording') {
      voiceRecorder.pauseRecording();
    } else if (voiceRecorder.state === 'paused') {
      voiceRecorder.resumeRecording();
    }
  }, [voiceRecorder]);

  // ---- Single global shortcut listener ----
  useVoiceShortcuts({
    voiceState: voiceRecorder.state,
    shortcuts: settings.voice.shortcuts,
    callbacks: {
      onStartRecording: handleStartRecording,
      onPauseResume: handlePauseResume,
      onSubmit: voiceRecorder.submitRecording,
      onSubmitPasteOnly: handleSubmitPasteOnly,
      onClear: voiceRecorder.clearRecording,
    },
    enabled: true,
    hasFieldFocus: claimantRef.current ? true : hasFieldFocus, // Claimed mode always enabled
    suspended: showSettings,
  });

  // ---- Context value ----
  const contextValue: VoiceContextValue = {
    voiceState: voiceRecorder.state,
    elapsedSeconds: voiceRecorder.elapsedSeconds,
    error: voiceRecorder.error,
    hasRecording: voiceRecorder.hasRecording,
    startRecording: voiceRecorder.startRecording,
    pauseRecording: voiceRecorder.pauseRecording,
    resumeRecording: voiceRecorder.resumeRecording,
    clearRecording: voiceRecorder.clearRecording,
    submitRecording: voiceRecorder.submitRecording,
    retryTranscription: voiceRecorder.retryTranscription,
    claimVoiceControl,
    releaseVoiceControl,
    currentClaimantId,
    settings,
    updateSettings,
    registerTerminal,
    unregisterTerminal,
    submitModeRef: globalSubmitModeRef,
    showSettings,
    setShowSettings,
    hasFieldFocus,
    setHasFieldFocus,
  };

  return (
    <VoiceContext.Provider value={contextValue}>
      {children}
      <FloatingVoiceWidget />
    </VoiceContext.Provider>
  );
}
