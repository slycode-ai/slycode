'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import type { VoiceSettings } from '@/lib/types';

interface VoiceSettingsPopoverProps {
  settings: VoiceSettings;
  onSave: (settings: Partial<VoiceSettings>) => void;
  onClose: () => void;
}

function ShortcutInput({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const [capturing, setCapturing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (!capturing) return;
    e.preventDefault();
    e.stopPropagation();

    const parts: string[] = [];
    if (e.ctrlKey) parts.push('Ctrl');
    if (e.shiftKey) parts.push('Shift');
    if (e.altKey) parts.push('Alt');
    if (e.metaKey) parts.push('Cmd');

    const key = e.key;
    if (!['Control', 'Shift', 'Alt', 'Meta'].includes(key)) {
      const displayKey = key === ' ' ? 'Space' : key === 'Escape' ? 'Escape' : key === 'Enter' ? 'Enter' : key.length === 1 ? key : key;
      parts.push(displayKey);
      onChange(parts.join('+'));
      setCapturing(false);
    }
  }, [capturing, onChange]);

  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-xs text-void-600 dark:text-void-400">{label}</span>
      <input
        ref={inputRef}
        type="text"
        value={capturing ? 'Press keys...' : value}
        readOnly
        onFocus={() => setCapturing(true)}
        onBlur={() => setCapturing(false)}
        onKeyDown={handleKeyDown}
        className={`w-28 rounded border px-2 py-1 text-center text-xs ${
          capturing
            ? 'border-neon-blue-400 bg-neon-blue-400/10 text-neon-blue-600 dark:text-neon-blue-400'
            : 'border-void-300 bg-void-50 text-void-700 dark:border-void-600 dark:bg-void-700 dark:text-void-300'
        } cursor-pointer outline-none`}
      />
    </div>
  );
}

export function VoiceSettingsPopover({ settings, onSave, onClose }: VoiceSettingsPopoverProps) {
  const popoverRef = useRef<HTMLDivElement>(null);
  const [shortcuts, setShortcuts] = useState({ ...settings.shortcuts });
  const [autoSubmit, setAutoSubmit] = useState(settings.autoSubmitTerminal);
  const [maxMinutes, setMaxMinutes] = useState(Math.round(settings.maxRecordingSeconds / 60));

  // Auto-save on close via cleanup
  const stateRef = useRef({ shortcuts, autoSubmit, maxMinutes });
  stateRef.current = { shortcuts, autoSubmit, maxMinutes };

  useEffect(() => {
    return () => {
      const { shortcuts: sc, autoSubmit: as_, maxMinutes: mm } = stateRef.current;
      onSave({
        shortcuts: sc,
        autoSubmitTerminal: as_,
        maxRecordingSeconds: Math.max(1, mm) * 60,
      });
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [onClose]);

  return (
    <div
      ref={popoverRef}
      className="w-80 rounded-lg border border-void-200 bg-white p-4 shadow-(--shadow-overlay) dark:border-void-600 dark:bg-void-800"
    >
      <h3 className="mb-3 text-sm font-medium text-void-800 dark:text-void-200">Voice Settings</h3>

      {/* Shortcuts */}
      <div className="mb-4 space-y-2">
        <div className="text-xs font-medium text-void-500 dark:text-void-400">Keyboard Shortcuts</div>
        <ShortcutInput
          label="Start recording"
          value={shortcuts.startRecording}
          onChange={(v) => setShortcuts((s) => ({ ...s, startRecording: v }))}
        />
        <ShortcutInput
          label="Pause / Resume"
          value={shortcuts.pauseResume}
          onChange={(v) => setShortcuts((s) => ({ ...s, pauseResume: v }))}
        />
        <ShortcutInput
          label="Submit"
          value={shortcuts.submit}
          onChange={(v) => setShortcuts((s) => ({ ...s, submit: v }))}
        />
        <ShortcutInput
          label="Paste only"
          value={shortcuts.submitPasteOnly}
          onChange={(v) => setShortcuts((s) => ({ ...s, submitPasteOnly: v }))}
        />
        <ShortcutInput
          label="Clear / Cancel"
          value={shortcuts.clear}
          onChange={(v) => setShortcuts((s) => ({ ...s, clear: v }))}
        />
      </div>

      {/* Behaviour */}
      <div className="space-y-3 border-t border-void-200 pt-3 dark:border-void-600">
        <div className="text-xs font-medium text-void-500 dark:text-void-400">Behaviour</div>

        <label className="flex items-center justify-between gap-2">
          <span className="text-xs text-void-600 dark:text-void-400">Auto-submit (terminal)</span>
          <button
            type="button"
            role="switch"
            aria-checked={autoSubmit}
            onClick={() => setAutoSubmit(!autoSubmit)}
            className={`relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${
              autoSubmit ? 'bg-green-500' : 'bg-void-300 dark:bg-void-600'
            }`}
          >
            <span
              className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow transition ${
                autoSubmit ? 'translate-x-4' : 'translate-x-0'
              }`}
            />
          </button>
        </label>

        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-void-600 dark:text-void-400">Max recording (min)</span>
          <input
            type="number"
            min={1}
            max={30}
            value={maxMinutes}
            onChange={(e) => setMaxMinutes(parseInt(e.target.value) || 5)}
            className="w-16 rounded border border-void-300 bg-void-50 px-2 py-1 text-center text-xs text-void-700 outline-none dark:border-void-600 dark:bg-void-700 dark:text-void-300"
          />
        </div>
      </div>
    </div>
  );
}
