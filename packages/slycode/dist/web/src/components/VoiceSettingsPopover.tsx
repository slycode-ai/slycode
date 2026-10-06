'use client';

import { useState, useRef, useEffect, useCallback, useId } from 'react';
import type { SpeechBubbleMode, VoiceSettings } from '@/lib/types';
import { DEFAULT_MAX_SPEAK_WORDS, MAX_SPEAK_WORDS_MAX, MAX_SPEAK_WORDS_MIN } from '@/lib/types';
import type { SpeakerController } from '@/hooks/useSpeakerController';
import type { SpeechHealth, SpeechProviderId } from '@/lib/speech-health';
import {
  MESSAGING_DOWN_MESSAGE,
  interpretLoadResponse,
  interpretSwitchResponse,
  providerLabel,
  providerOptions,
  providerSourceHint,
  unverifiedSummary,
  voiceLabel,
  type ProviderOption,
  type VoiceCheck,
  type VoiceRefusal,
} from '@/lib/tts-provider-view';
import { VoicePicker } from './VoicePicker';
import { spokenRepliesRow } from '@/lib/spoken-replies-row';
import { VOICE_SETTINGS_LAYER_ATTR } from '@/lib/voice-settings-layer';

interface VoiceSettingsPopoverProps {
  settings: VoiceSettings;
  onSave: (settings: Partial<VoiceSettings>) => void;
  onClose: () => void;
  /** Spoken replies (feature 086): availability for the status line. */
  speaker?: SpeakerController;
  /** Last settings save failure — shown inline so spoken-reply limits never fail silently. */
  saveError?: string | null;
  /** The project in view, if any: the voice picker opens on it alone (feature 087). */
  projectId?: string | null;
  /** popover: anchored beside the gear (desktop); sheet: inside a bottom VoiceSheet (phones, #0376). */
  variant?: 'popover' | 'sheet';
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
      <span className="text-xs text-ink-2">{label}</span>
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
            ? 'border-accent bg-accent/10 text-accent'
            : 'border-line-strong bg-surface-2 text-ink-2'
        } cursor-pointer outline-none`}
      />
    </div>
  );
}

type ProviderNote =
  | { kind: 'info'; message: string }
  | { kind: 'error'; message: string }
  | { kind: 'switched'; provider: SpeechProviderId; unverified: VoiceCheck[] }
  | { kind: 'refused'; message: string; refusals: VoiceRefusal[] };

async function fetchProviderHealth(): Promise<ReturnType<typeof interpretLoadResponse>> {
  try {
    const res = await fetch('/api/messaging/tts', { cache: 'no-store' });
    const body: unknown = await res.json().catch(() => null);
    return interpretLoadResponse(res.status, body);
  } catch {
    return { health: null, error: MESSAGING_DOWN_MESSAGE };
  }
}

/**
 * Install-wide voice provider switch (feature 087). Reads the provider when the
 * popover opens; picking the other provider asks messaging to switch, which
 * may refuse (409) when projects use voices the new provider can't play.
 */
function VoiceProviderControl({ speaker, refreshKey, onRevision }: {
  speaker?: SpeakerController;
  /** Bumped when the voice picker learns the provider changed (stale pick): re-read it. */
  refreshKey?: number;
  /** The switch revision whenever it is (re)read, so the picker can follow a switch. */
  onRevision?: (revision: number) => void;
}) {
  const [health, setHealth] = useState<SpeechHealth | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pending, setPending] = useState<SpeechProviderId | null>(null);
  const [note, setNote] = useState<ProviderNote | null>(null);
  const aliveRef = useRef(true);
  // Synchronous guard: a fast double-click must not send two switches.
  const pendingRef = useRef(false);
  const labelId = useId();
  const noteId = useId();

  const load = useCallback(() => {
    void fetchProviderHealth().then((result) => {
      if (!aliveRef.current) return;
      setHealth(result.health);
      setLoadError(result.error);
    });
  }, []);

  useEffect(() => {
    aliveRef.current = true;
    load();
    return () => { aliveRef.current = false; };
  }, [load]);

  const firstRefreshRef = useRef(true);
  useEffect(() => {
    if (firstRefreshRef.current) { firstRefreshRef.current = false; return; }
    load();
  }, [refreshKey, load]);

  useEffect(() => {
    if (health) onRevision?.(health.revision);
  }, [health, onRevision]);

  const choose = useCallback(async (option: ProviderOption) => {
    if (option.active || pendingRef.current) return;
    if (option.disabled) {
      // aria-disabled keeps the option focusable so keyboard and touch users can learn why.
      setNote({ kind: 'info', message: `${option.label}: ${option.reason ?? 'not available right now.'}` });
      return;
    }
    pendingRef.current = true;
    setPending(option.id);
    setNote(null);
    let result: ReturnType<typeof interpretSwitchResponse>;
    try {
      const res = await fetch('/api/messaging/tts', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: option.id }),
      });
      const body: unknown = await res.json().catch(() => null);
      result = interpretSwitchResponse(res.status, body);
    } catch {
      result = { kind: 'error', message: MESSAGING_DOWN_MESSAGE };
    }
    pendingRef.current = false;
    if (!aliveRef.current) return;
    setPending(null);
    if (result.kind === 'switched') {
      setHealth(result.health);
      setLoadError(null);
      setNote({ kind: 'switched', provider: result.health.provider, unverified: result.unverified });
      void speaker?.refresh();
    } else {
      setNote(result);
      // Not a clean refusal: messaging may be down or may have switched after all — re-read the truth.
      if (result.kind === 'error') {
        load();
        void speaker?.refresh();
      }
    }
  }, [load, speaker]);

  const options = providerOptions(health, loadError);
  const source = health ? providerSourceHint(health.providerSource) : null;
  // The spoken-replies line above already says when messaging is off; don't say it twice.
  const showLoadError = !health && !!loadError && !note && speaker?.availability.messagingRunning !== false;
  const hasNote = pending !== null || note !== null || showLoadError;

  return (
    <div>
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0 leading-tight">
          <span id={labelId} className="block text-xs text-ink-2">Voice provider</span>
          {source && (
            <span title={source.title} className="block text-[11px] text-ink-3">{source.text}</span>
          )}
        </div>
        <div
          role="group"
          aria-labelledby={labelId}
          aria-describedby={hasNote ? noteId : undefined}
          aria-busy={pending !== null}
          className="inline-flex shrink-0 rounded-md border border-line-strong p-0.5"
        >
          {options.map((o) => {
            const isPending = pending === o.id;
            const look = o.active
              ? 'cursor-default bg-accent/20 text-accent'
              : isPending
                ? 'cursor-progress bg-accent/10 motion-safe:animate-pulse text-accent'
                : o.disabled
                  ? 'cursor-not-allowed text-ink-3 opacity-50'
                  : pending
                    ? 'cursor-progress text-ink-3'
                    : 'text-ink-3 hover:text-ink-2';
            return (
              <button
                key={o.id}
                type="button"
                aria-pressed={o.active}
                aria-disabled={o.disabled || (pending !== null && !o.active) ? true : undefined}
                title={isPending ? `Switching to ${o.label}…` : o.title}
                onClick={() => void choose(o)}
                className={`rounded px-2 py-0.5 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 max-sm:min-h-10 pointer-coarse:min-h-10 ${look}`}
              >
                {o.label}
              </button>
            );
          })}
        </div>
      </div>

      <div id={noteId} aria-live="polite" className="mt-1.5 empty:hidden">
        {pending ? (
          <p className="text-xs text-ink-3">
            Checking project voices, then switching to {providerLabel(pending)}…
          </p>
        ) : note?.kind === 'info' ? (
          <p className="text-xs text-ink-3">{note.message}</p>
        ) : note?.kind === 'error' ? (
          <p className="text-xs text-danger-text">{note.message}</p>
        ) : note?.kind === 'switched' ? (
          <SwitchedNote provider={note.provider} unverified={note.unverified} />
        ) : note?.kind === 'refused' ? (
          <RefusedNote message={note.message} refusals={note.refusals} />
        ) : showLoadError ? (
          <p className="text-xs text-ink-3">{loadError}</p>
        ) : null}
      </div>
    </div>
  );
}

function SwitchedNote({ provider, unverified }: { provider: SpeechProviderId; unverified: VoiceCheck[] }) {
  const label = providerLabel(provider);
  if (unverified.length === 0) {
    return <p className="text-xs text-ink-3">Switched. Spoken replies now use {label} for every project.</p>;
  }
  const { items, sharedReason } = unverifiedSummary(unverified);
  return (
    <div className="max-h-24 overflow-y-auto border-l-2 border-amber-400 pl-2 text-xs text-ink-2">
      <p>
        Switched to {label}. Couldn&apos;t check:{' '}
        {items.map((item, i) => (
          <span key={`${unverified[i].projectId}-${i}`} title={sharedReason ? undefined : unverified[i].reason || undefined}>
            {item}{i < items.length - 1 ? ', ' : '.'}
          </span>
        ))}
      </p>
      {sharedReason && <p className="mt-0.5 text-ink-3">{sharedReason}</p>}
    </div>
  );
}

function RefusedNote({ message, refusals }: { message: string; refusals: VoiceRefusal[] }) {
  return (
    <div className="border-l-2 border-amber-400 pl-2 text-xs">
      <p className="text-ink-2">{message}</p>
      {refusals.length > 0 && (
        <ul
          tabIndex={0}
          aria-label="Projects blocking the switch"
          className="mt-1.5 max-h-36 space-y-1.5 overflow-y-auto rounded pr-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
        >
          {refusals.map((r, i) => (
            <li key={`${r.projectId}-${i}`}>
              <div>
                <span className="font-medium text-ink-2">{r.projectName}</span>{' '}
                <span className="text-ink-3">({voiceLabel(r.voice)})</span>
              </div>
              {r.reason && <div className="text-ink-2">{r.reason}</div>}
              {r.fix && <div className="text-ink-3">Fix: {r.fix}</div>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

type SettingsTab = 'input' | 'voice';
const SETTINGS_TABS: ReadonlyArray<{ id: SettingsTab; label: string; title: string }> = [
  { id: 'input', label: 'Input', title: 'Dictation: shortcuts, auto-submit, recording length' },
  { id: 'voice', label: 'Voice', title: 'Spoken replies: provider, project voice, limits' },
];
/** The tab last chosen in this page, so reopening the gear lands where you were. */
let lastTab: SettingsTab = 'input';

export function VoiceSettingsPopover({ settings, onSave, onClose, speaker, saveError, projectId, variant = 'popover' }: VoiceSettingsPopoverProps) {
  const sheet = variant === 'sheet';
  const popoverRef = useRef<HTMLDivElement>(null);
  const [shortcuts, setShortcuts] = useState({ ...settings.shortcuts });
  const [autoSubmit, setAutoSubmit] = useState(settings.autoSubmitTerminal);
  const [maxMinutes, setMaxMinutes] = useState(Math.round(settings.maxRecordingSeconds / 60));
  const [maxSpeakWords, setMaxSpeakWords] = useState(settings.maxSpeakWords ?? DEFAULT_MAX_SPEAK_WORDS);
  const [bubbleMode, setBubbleMode] = useState<SpeechBubbleMode>(settings.speechBubbleMode ?? 'auto-hide');
  const [tab, setTab] = useState<SettingsTab>(lastTab);
  const tabIdBase = useId();
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const speakerStatusId = useId();
  const maxWordsId = useId();
  const maxWordsHintId = useId();
  // Provider control ↔ voice picker (feature 087 phase 3): a switch reloads the
  // picker; a stale pick in the picker re-reads the provider.
  const [ttsRevision, setTtsRevision] = useState<number | null>(null);
  const [providerRefresh, setProviderRefresh] = useState(0);
  const bumpProviderRefresh = useCallback(() => setProviderRefresh((n) => n + 1), []);

  // Auto-save on close via cleanup
  const stateRef = useRef({ shortcuts, autoSubmit, maxMinutes, maxSpeakWords, bubbleMode });
  stateRef.current = { shortcuts, autoSubmit, maxMinutes, maxSpeakWords, bubbleMode };

  useEffect(() => {
    return () => {
      const { shortcuts: sc, autoSubmit: as_, maxMinutes: mm, maxSpeakWords: msw, bubbleMode: bm } = stateRef.current;
      const words = Number.isFinite(msw) ? Math.min(MAX_SPEAK_WORDS_MAX, Math.max(MAX_SPEAK_WORDS_MIN, Math.round(msw))) : DEFAULT_MAX_SPEAK_WORDS;
      onSave({
        shortcuts: sc,
        autoSubmitTerminal: as_,
        maxRecordingSeconds: Math.max(1, mm) * 60,
        maxSpeakWords: words,
        speechBubbleMode: bm,
      });
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Element | null;
      if (target instanceof Element && target.closest(`[${VOICE_SETTINGS_LAYER_ATTR}]`)) return;
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [onClose]);

  const selectTab = (next: SettingsTab) => {
    lastTab = next;
    setTab(next);
  };
  // Arrow keys move between tabs (WAI-ARIA tabs pattern, automatic activation).
  const onTabKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight' && e.key !== 'Home' && e.key !== 'End') return;
    e.preventDefault();
    const i = SETTINGS_TABS.findIndex((t) => t.id === tab);
    const next = e.key === 'Home' ? 0 : e.key === 'End' ? SETTINGS_TABS.length - 1
      : (i + (e.key === 'ArrowRight' ? 1 : -1) + SETTINGS_TABS.length) % SETTINGS_TABS.length;
    selectTab(SETTINGS_TABS[next].id);
    tabRefs.current[next]?.focus();
  };

  return (
    <div
      ref={popoverRef}
      // Height is capped by the host (CardModal / floating widget) to the room
      // beside the anchor via --voice-popover-max-h; only the body scrolls.
      className={sheet
        ? 'flex max-h-[var(--voice-popover-max-h,85dvh)] w-full max-w-lg flex-col rounded-t-xl border border-b-0 border-line bg-surface-1 pb-[env(safe-area-inset-bottom)] shadow-(--shadow-overlay)'
        : 'flex max-h-[var(--voice-popover-max-h,calc(100dvh-5rem))] w-80 flex-col rounded-lg border border-line bg-surface-1 shadow-(--shadow-overlay)'}
    >
      {sheet && <div aria-hidden="true" className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-line-strong" />}
      <div className="flex shrink-0 items-center justify-between gap-2 px-4 pt-3 pb-2">
        <h3 className="text-sm font-medium text-ink-1">Voice Settings</h3>
        <div role="tablist" aria-label="Voice Settings sections" onKeyDown={onTabKeyDown} className={`inline-flex rounded-md border border-line-strong p-0.5${sheet ? ' ml-auto' : ''}`}>
          {SETTINGS_TABS.map((t, i) => (
            <button
              key={t.id}
              ref={(el) => { tabRefs.current[i] = el; }}
              id={`${tabIdBase}-tab-${t.id}`}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              aria-controls={`${tabIdBase}-panel-${t.id}`}
              tabIndex={tab === t.id ? 0 : -1}
              title={t.title}
              onClick={() => selectTab(t.id)}
              className={`rounded px-2 py-0.5 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 max-sm:min-h-10 max-sm:px-3 pointer-coarse:min-h-10 pointer-coarse:px-3 ${
                tab === t.id
                  ? 'bg-accent/20 text-accent'
                  : 'text-ink-3 hover:text-ink-2'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
        {sheet && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close voice settings"
            className="-mr-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-ink-3 transition-colors hover:bg-surface-3 hover:text-ink-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
          >
            <svg aria-hidden="true" className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto border-t border-line px-4 pt-3 pb-4">
      {/* Both panels stay mounted (hidden), so switching tabs keeps unsaved
          input, the provider read and the picker's state. */}
      <div role="tabpanel" id={`${tabIdBase}-panel-input`} aria-labelledby={`${tabIdBase}-tab-input`} hidden={tab !== 'input'}>
      {/* Shortcuts */}
      <div className="mb-4 space-y-2">
        <div className="text-xs font-medium text-ink-3">Keyboard Shortcuts</div>
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
      <div className="space-y-3 border-t border-line pt-3">
        <div className="text-xs font-medium text-ink-3">Behaviour</div>

        <label className="flex items-center justify-between gap-2">
          <span className="text-xs text-ink-2">Auto-submit (terminal)</span>
          <button
            type="button"
            role="switch"
            aria-checked={autoSubmit}
            onClick={() => setAutoSubmit(!autoSubmit)}
            className={`relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${
              autoSubmit ? 'bg-green-500' : 'bg-surface-3'
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
          <span className="text-xs text-ink-2">Max recording (min)</span>
          <input
            type="number"
            min={1}
            max={30}
            value={maxMinutes}
            onChange={(e) => setMaxMinutes(parseInt(e.target.value) || 5)}
            className="w-16 rounded border border-line-strong bg-surface-2 px-2 py-1 text-center text-xs text-ink-2 outline-none max-sm:text-base pointer-coarse:text-base"
          />
        </div>
      </div>

      </div>

      <div role="tabpanel" id={`${tabIdBase}-panel-voice`} aria-labelledby={`${tabIdBase}-tab-voice`} hidden={tab !== 'voice'}>
      {/* Spoken replies (feature 086) */}
      <div className="space-y-3">
        <div className="text-xs font-medium text-ink-3">Spoken replies</div>

        {speaker && (() => {
          // One source of truth: the switch calls the same setEnabled as the
          // speaker button by the mic, so both stay in sync (and across tabs).
          const row = spokenRepliesRow({
            enabled: speaker.enabled,
            available: speaker.available,
            messagingRunning: speaker.availability.messagingRunning,
            ttsReason: speaker.availability.ttsReason,
          });
          return (
            <div className="flex items-start gap-2 text-xs">
              <span
                aria-hidden="true"
                className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${
                  row.dot === 'pending' ? 'bg-void-400' : row.dot === 'ok' ? 'bg-green-500' : 'bg-amber-400'
                }`}
              />
              <span id={speakerStatusId} className="min-w-0 flex-1 text-ink-2">{row.text}</span>
              {row.toggle && (
                <button
                  type="button"
                  role="switch"
                  aria-checked={row.toggle.checked}
                  aria-label="Spoken replies"
                  aria-describedby={speakerStatusId}
                  disabled={row.toggle.disabled}
                  title={row.toggle.disabled ? 'Spoken replies are unavailable right now' : row.toggle.checked ? 'Turn spoken replies off' : 'Allow spoken replies'}
                  onClick={() => void speaker.setEnabled(!row.toggle!.checked)}
                  className={`relative inline-flex h-5 w-9 shrink-0 rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neon-blue-400/60 ${
                    row.toggle.checked ? 'bg-green-500' : 'bg-surface-3'
                  } ${row.toggle.disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}`}
                >
                  <span
                    className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow transition ${
                      row.toggle.checked ? 'translate-x-4' : 'translate-x-0'
                    }`}
                  />
                </button>
              )}
            </div>
          );
        })()}

        <VoiceProviderControl speaker={speaker} refreshKey={providerRefresh} onRevision={setTtsRevision} />

        <VoicePicker revision={ttsRevision} onStale={bumpProviderRefresh} projectId={projectId} />

        {/* Two different limits (owner ruling, #0369): this one is the browser's
            spoken replies (`speak`) only; Telegram voice replies have their own
            fixed character cap, shown read-only below. */}
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0 leading-tight">
            <label htmlFor={maxWordsId} className="block text-xs text-ink-2">Browser reply length (words)</label>
            <span id={maxWordsHintId} className="block text-[11px] text-ink-3">Spoken replies from terminals, in this browser</span>
          </div>
          <input
            id={maxWordsId}
            aria-describedby={maxWordsHintId}
            type="number"
            min={MAX_SPEAK_WORDS_MIN}
            max={MAX_SPEAK_WORDS_MAX}
            value={maxSpeakWords}
            onChange={(e) => setMaxSpeakWords(parseInt(e.target.value) || DEFAULT_MAX_SPEAK_WORDS)}
            className="w-16 shrink-0 rounded border border-line-strong bg-surface-2 px-2 py-1 text-center text-xs text-ink-2 outline-none max-sm:text-base pointer-coarse:text-base"
          />
        </div>

        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0 leading-tight">
            <span className="block text-xs text-ink-2">Telegram voice replies</span>
            <span className="block text-[11px] text-ink-3">Fixed limit, not adjustable</span>
          </div>
          <span className="shrink-0 text-xs text-ink-3">5,000 characters</span>
        </div>

        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-ink-2">Caption</span>
          <div role="radiogroup" aria-label="Caption behaviour" className="inline-flex rounded-md border border-line-strong p-0.5">
            {(['auto-hide', 'keep'] as const).map((m) => (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={bubbleMode === m}
                onClick={() => setBubbleMode(m)}
                className={`rounded px-2 py-0.5 text-xs transition-colors ${
                  bubbleMode === m
                    ? 'bg-accent/20 text-accent'
                    : 'text-ink-3 hover:text-ink-2'
                }`}
              >
                {m === 'auto-hide' ? 'Auto-hide' : 'Keep until dismissed'}
              </button>
            ))}
          </div>
        </div>
      </div>
      </div>
      </div>

      {/* A save failure shows whichever tab is open. */}
      {saveError && (
        <p role="alert" className="shrink-0 border-t border-line px-4 py-2 text-xs text-danger-text">{saveError}</p>
      )}
    </div>
  );
}
