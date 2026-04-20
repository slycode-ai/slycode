import { useEffect, useRef } from 'react';
import type { VoiceState, VoiceShortcuts } from '@/lib/types';

interface VoiceShortcutCallbacks {
  onStartRecording: () => void;
  onPauseResume: () => void;
  onSubmit: () => void;
  onSubmitPasteOnly: () => void;
  onClear: () => void;
}

interface UseVoiceShortcutsOptions {
  voiceState: VoiceState;
  shortcuts: VoiceShortcuts;
  callbacks: VoiceShortcutCallbacks;
  enabled: boolean;
  hasFieldFocus: boolean;
  /** When true, all shortcut handling is paused (e.g. settings popover capturing keys) */
  suspended?: boolean;
}

function parseShortcut(shortcut: string): { ctrlKey: boolean; shiftKey: boolean; altKey: boolean; metaKey: boolean; key: string } {
  const parts = shortcut.split('+').map((p) => p.trim().toLowerCase());
  const key = parts[parts.length - 1];
  return {
    ctrlKey: parts.includes('ctrl'),
    shiftKey: parts.includes('shift'),
    altKey: parts.includes('alt'),
    metaKey: parts.includes('meta') || parts.includes('cmd'),
    key: key === 'space' ? ' ' : key === 'escape' ? 'Escape' : key === 'enter' ? 'Enter' : key,
  };
}

function matchesShortcut(e: KeyboardEvent, shortcut: string): boolean {
  const parsed = parseShortcut(shortcut);
  const eventKey = e.key.toLowerCase();
  const parsedKey = parsed.key.toLowerCase();

  if (eventKey !== parsedKey && e.key !== parsed.key) return false;
  if (parsed.ctrlKey !== e.ctrlKey) return false;
  if (parsed.shiftKey !== e.shiftKey) return false;
  if (parsed.altKey !== e.altKey) return false;
  if (parsed.metaKey !== e.metaKey) return false;
  return true;
}

export function useVoiceShortcuts({ voiceState, shortcuts, callbacks, enabled, hasFieldFocus, suspended }: UseVoiceShortcutsOptions): void {
  const callbacksRef = useRef(callbacks);
  const voiceStateRef = useRef(voiceState);
  const shortcutsRef = useRef(shortcuts);
  const hasFieldFocusRef = useRef(hasFieldFocus);
  const suspendedRef = useRef(suspended);

  useEffect(() => {
    callbacksRef.current = callbacks;
    voiceStateRef.current = voiceState;
    shortcutsRef.current = shortcuts;
    hasFieldFocusRef.current = hasFieldFocus;
    suspendedRef.current = suspended;
  });

  useEffect(() => {
    if (!enabled) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (suspendedRef.current) return;
      const currentState = voiceStateRef.current;
      const sc = shortcutsRef.current;
      const cb = callbacksRef.current;

      // In idle state: only start recording shortcut is active, and only if a field is focused
      if (currentState === 'idle' && hasFieldFocusRef.current) {
        if (matchesShortcut(e, sc.startRecording)) {
          e.preventDefault();
          e.stopPropagation();
          cb.onStartRecording();
          return;
        }
      }

      // In recording/paused state: voice shortcuts override normal keys
      if (currentState === 'recording' || currentState === 'paused') {
        if (matchesShortcut(e, sc.pauseResume)) {
          e.preventDefault();
          e.stopPropagation();
          cb.onPauseResume();
          return;
        }
        if (matchesShortcut(e, sc.submitPasteOnly)) {
          e.preventDefault();
          e.stopPropagation();
          cb.onSubmitPasteOnly();
          return;
        }
        if (matchesShortcut(e, sc.submit)) {
          e.preventDefault();
          e.stopPropagation();
          cb.onSubmit();
          return;
        }
        if (matchesShortcut(e, sc.clear)) {
          e.preventDefault();
          e.stopPropagation();
          cb.onClear();
          return;
        }
      }
    };

    // Use capture phase so we intercept before form elements
    document.addEventListener('keydown', handleKeyDown, true);
    return () => document.removeEventListener('keydown', handleKeyDown, true);
  }, [enabled]);
}
