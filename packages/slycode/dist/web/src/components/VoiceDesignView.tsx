'use client';

/**
 * "Design a voice" inside the voice search panel (feature 087, Gemini only).
 *
 * Form → one paid design call (recipe saved by messaging before it answers)
 * → the sample plays here → "Use for <project>" (the normal stamped set) or
 * "Discard" (deletes it at Google; messaging keeps the recipe). A synchronous
 * guard stops a double click from starting a second paid call, and the list's
 * revision goes with the request so a stale panel is refused before any call.
 *
 * The main actions render into the panel's pinned action bar (#0376), so on a
 * phone they stay in view with the keyboard up.
 */

import { useCallback, useContext, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { hasFinePointer } from '@/lib/visible-viewport';
import { VoiceActionBarContext } from './VoiceSheet';
import {
  ACCENT_CHIPS,
  DESIGN_COST_NOTE,
  DESIGN_EXPECTED_SECONDS,
  DESIGN_GENDERS,
  DESIGN_HINT,
  VOICES_DOWN_MESSAGE,
  designBody,
  designFormProblem,
  designedAsPickerVoice,
  formatExpiry,
  interpretChangeResponse,
  interpretDesignResponse,
  type DesignForm,
  type PickerVoice,
  type ProjectVoiceRow,
  type Stamp,
} from '@/lib/voice-picker-view';

type ChangeResult = ReturnType<typeof interpretChangeResponse>;

type Phase =
  | { kind: 'form'; error: string | null }
  | { kind: 'designing'; startedAt: number }
  | { kind: 'ready'; voice: { id: string; name: string; expiresAt: string | null }; sampleUrl: string | null; warnings: string[]; error: string | null; busy: 'use' | 'discard' | null };

/** Phones and touch screens: 44 px targets; 16 px field text so iOS doesn't zoom on focus (#0376). */
const touchTarget = 'max-sm:min-h-11 pointer-coarse:min-h-11';
const fieldClass =
  `w-full rounded border border-line-strong bg-surface-2 px-2 py-1 text-xs text-ink-2 outline-none placeholder:text-ink-3 focus-visible:border-accent disabled:opacity-60 ${touchTarget} max-sm:text-base pointer-coarse:text-base`;
const primaryButton =
  `rounded-md border border-accent/60 bg-accent/20 px-3 py-1 text-xs text-accent transition-colors hover:bg-accent/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 disabled:cursor-progress disabled:opacity-60 ${touchTarget} max-sm:px-4 pointer-coarse:px-4`;
const secondaryButton =
  `rounded-md border border-line-strong px-3 py-1 text-xs text-ink-2 transition-colors hover:text-ink-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 disabled:cursor-progress disabled:opacity-60 ${touchTarget} max-sm:px-4 pointer-coarse:px-4`;
const quietButton =
  `rounded px-1 py-0.5 text-[11px] text-ink-3 hover:text-ink-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 disabled:opacity-60 ${touchTarget} max-sm:px-2 max-sm:text-xs pointer-coarse:px-2 pointer-coarse:text-xs`;

function base64ToBlobUrl(data: string, type: string): string | null {
  try {
    const bin = atob(data);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return URL.createObjectURL(new Blob([bytes], { type }));
  } catch {
    return null;
  }
}

export function VoiceDesignView({ target, stamp, onBack, onUse, onDiscarded, onStale, onCreated, onBusyChange }: {
  target: ProjectVoiceRow;
  /** The stamp of the list this panel shows (Gemini). */
  stamp: Stamp;
  onBack: () => void;
  /** The picker's normal set; resolves with what messaging said. */
  onUse: (voice: PickerVoice) => Promise<ChangeResult | null>;
  onDiscarded: (message: string) => void;
  onStale: (message: string) => void;
  /** A voice now exists: refresh the list behind this view. */
  onCreated: () => void;
  /** True while a paid call or a set/discard is running, so the panel holds still. */
  onBusyChange?: (busy: boolean) => void;
}) {
  const actionBar = useContext(VoiceActionBarContext);
  const formId = useId();
  const [form, setForm] = useState<DesignForm>({ description: '', name: '', gender: null, language: null });
  const [phase, setPhase] = useState<Phase>({ kind: 'form', error: null });
  const [elapsed, setElapsed] = useState(0);
  const [playing, setPlaying] = useState(false);
  const inFlightRef = useRef(false);
  const aliveRef = useRef(true);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const sampleUrlRef = useRef<string | null>(null);
  const descriptionRef = useRef<HTMLTextAreaElement>(null);
  const readyHeadingRef = useRef<HTMLParagraphElement>(null);
  const ids = { description: useId(), hint: useId(), name: useId(), gender: useId(), language: useId(), cost: useId() };

  useEffect(() => {
    aliveRef.current = true;
    // Touch screens: no automatic focus, or the keyboard covers the form (#0376).
    if (hasFinePointer()) descriptionRef.current?.focus();
    return () => {
      aliveRef.current = false;
      audioRef.current?.pause();
      if (sampleUrlRef.current) URL.revokeObjectURL(sampleUrlRef.current);
    };
  }, []);

  // Tell the panel when it must not be left (a paid call, or a set/discard, is running).
  const holdPanel = phase.kind === 'designing' || (phase.kind === 'ready' && phase.busy !== null);
  useEffect(() => {
    onBusyChange?.(holdPanel);
  }, [holdPanel, onBusyChange]);
  useEffect(() => () => onBusyChange?.(false), [onBusyChange]);

  // Elapsed seconds while Google designs the voice (usually ~20 s).
  useEffect(() => {
    if (phase.kind !== 'designing') return;
    const tick = () => setElapsed(Math.round((Date.now() - phase.startedAt) / 1000));
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [phase]);

  const stopSample = useCallback(() => {
    audioRef.current?.pause();
    if (audioRef.current) audioRef.current.currentTime = 0;
    setPlaying(false);
  }, []);

  const playSample = useCallback(async (url: string) => {
    let audio = audioRef.current;
    if (!audio || audio.src !== url) {
      audio?.pause();
      audio = new Audio(url);
      audio.onended = () => { if (aliveRef.current) setPlaying(false); };
      audioRef.current = audio;
    }
    try {
      await audio.play();
      if (aliveRef.current) setPlaying(true);
    } catch {
      // Autoplay may be blocked after the long wait; the play button still works.
      if (aliveRef.current) setPlaying(false);
    }
  }, []);

  const design = useCallback(async () => {
    if (inFlightRef.current) return; // a double click never starts a second paid call
    const problem = designFormProblem(form);
    if (problem) {
      setPhase({ kind: 'form', error: problem });
      return;
    }
    inFlightRef.current = true;
    setPhase({ kind: 'designing', startedAt: Date.now() });
    let result: ReturnType<typeof interpretDesignResponse>;
    try {
      const res = await fetch('/api/messaging/voices/design', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(designBody(form, stamp)),
      });
      result = interpretDesignResponse(res.status, await res.json().catch(() => null));
    } catch {
      result = { kind: 'error', message: VOICES_DOWN_MESSAGE };
    }
    inFlightRef.current = false;
    if (!aliveRef.current) return;
    if (result.kind === 'stale') {
      onStale(result.message);
      return;
    }
    if (result.kind === 'error') {
      setPhase({ kind: 'form', error: result.message });
      return;
    }
    const sampleUrl = result.sample ? base64ToBlobUrl(result.sample.data, result.sample.contentType) : null;
    sampleUrlRef.current = sampleUrl;
    setPhase({ kind: 'ready', voice: result.voice, sampleUrl, warnings: result.warnings, error: null, busy: null });
    onCreated();
    if (sampleUrl) void playSample(sampleUrl);
  }, [form, onCreated, onStale, playSample, stamp]);

  // Move focus to the result so keyboard and screen-reader users land on it.
  useEffect(() => {
    if (phase.kind === 'ready') readyHeadingRef.current?.focus();
  }, [phase.kind]);

  const use = useCallback(async () => {
    if (phase.kind !== 'ready' || phase.busy) return;
    stopSample();
    setPhase({ ...phase, busy: 'use', error: null });
    const result = await onUse(designedAsPickerVoice(phase.voice, form, stamp));
    if (!aliveRef.current) return;
    // Success closes the panel and stale refreshes it (the picker does both);
    // only an error stays here to be shown.
    if (result?.kind === 'error') setPhase({ ...phase, busy: null, error: result.message });
  }, [form, onUse, phase, stamp, stopSample]);

  const discard = useCallback(async () => {
    if (phase.kind !== 'ready' || phase.busy) return;
    stopSample();
    setPhase({ ...phase, busy: 'discard', error: null });
    let message: string | null = null;
    try {
      const res = await fetch(`/api/messaging/voices/design/${encodeURIComponent(phase.voice.id)}`, { method: 'DELETE' });
      const body: unknown = await res.json().catch(() => null);
      if (!res.ok || (typeof body === 'object' && body !== null && (body as { ok?: unknown }).ok === false)) {
        message = (typeof body === 'object' && body !== null && typeof (body as { message?: unknown }).message === 'string')
          ? (body as { message: string }).message
          : `The messaging service answered HTTP ${res.status}.`;
      }
    } catch {
      message = VOICES_DOWN_MESSAGE;
    }
    if (!aliveRef.current) return;
    if (message) {
      setPhase({ ...phase, busy: null, error: `${phase.voice.name} was not deleted: ${message}` });
      return;
    }
    onDiscarded(`${phase.voice.name} was discarded.`);
  }, [onDiscarded, phase, stopSample]);

  /** Into the panel's pinned action bar when there is one; inline otherwise. */
  const placeActions = (actions: React.ReactNode) => (actionBar
    ? createPortal(actions, actionBar)
    : <div className="flex flex-wrap items-center gap-2">{actions}</div>);

  if (phase.kind === 'ready') {
    const { voice, sampleUrl, warnings, error, busy } = phase;
    return (
      <div className="space-y-3 px-4 py-3">
        <div>
          <p ref={readyHeadingRef} tabIndex={-1} className="text-sm text-ink-1 outline-none">
            {voice.name} is ready.
          </p>
          <p className="text-[11px] text-ink-3">
            {voice.expiresAt ? `Google keeps it until ${formatExpiry(voice.expiresAt)}. ` : ''}Its recipe is saved, so it can be remade later.
          </p>
        </div>

        {sampleUrl ? (
          <button
            type="button"
            aria-pressed={playing}
            onClick={() => (playing ? stopSample() : void playSample(sampleUrl))}
            className={`${secondaryButton} inline-flex items-center gap-2`}
          >
            <svg aria-hidden="true" viewBox="0 0 12 12" className="h-3 w-3">
              {playing
                ? <rect x="2.5" y="2.5" width="7" height="7" rx="1" fill="currentColor" />
                : <path d="M3.5 2.2v7.6a.5.5 0 0 0 .76.43l6.1-3.8a.5.5 0 0 0 0-.86l-6.1-3.8a.5.5 0 0 0-.76.43z" fill="currentColor" />}
            </svg>
            {playing ? 'Stop sample' : 'Play sample'}
          </button>
        ) : (
          <p className="text-xs text-ink-3">No sample came back; preview it from the list instead.</p>
        )}

        <blockquote className="border-l-2 border-line pl-2 text-[11px] text-ink-3">
          {form.description.trim()}
        </blockquote>

        {warnings.map((w) => <p key={w} className="text-[11px] text-warn-text">{w}</p>)}
        {error && <p role="alert" className="text-xs text-danger-text">{error}</p>}

        {placeActions(
          <>
            <button type="button" disabled={busy !== null} onClick={() => void use()} className={primaryButton}>
              {busy === 'use' ? 'Setting…' : `Use for ${target.name}`}
            </button>
            <button type="button" disabled={busy !== null} onClick={() => void discard()} className={secondaryButton}>
              {busy === 'discard' ? 'Discarding…' : 'Discard'}
            </button>
            <button type="button" disabled={busy !== null} onClick={onBack} className={`ml-auto ${quietButton}`}>
              Keep it, back to voices
            </button>
          </>,
        )}
      </div>
    );
  }

  const designing = phase.kind === 'designing';
  const fill = designing ? Math.min(95, Math.round((elapsed / DESIGN_EXPECTED_SECONDS) * 100)) : 0;
  return (
    <form
      id={formId}
      className="space-y-3 px-4 py-3"
      aria-busy={designing}
      onSubmit={(e) => { e.preventDefault(); void design(); }}
    >
      <div className="space-y-1">
        <label htmlFor={ids.description} className="block text-xs text-ink-2">Describe the voice</label>
        <textarea
          id={ids.description}
          ref={descriptionRef}
          rows={3}
          maxLength={2000}
          disabled={designing}
          aria-describedby={ids.hint}
          value={form.description}
          onChange={(e) => { const description = e.target.value; setForm((f) => ({ ...f, description })); }}
          className={`${fieldClass} resize-y`}
        />
        <p id={ids.hint} className="text-[11px] text-ink-3">{DESIGN_HINT}</p>
      </div>

      <div className="space-y-1">
        <label htmlFor={ids.name} className="block text-xs text-ink-2">Name</label>
        <input
          id={ids.name}
          type="text"
          maxLength={100}
          disabled={designing}
          value={form.name}
          onChange={(e) => { const name = e.target.value; setForm((f) => ({ ...f, name })); }}
          className={fieldClass}
        />
      </div>

      <div className="flex gap-2">
        <div className="min-w-0 flex-1 space-y-1">
          <label htmlFor={ids.gender} className="block text-xs text-ink-2">Gender <span className="text-ink-3">(optional)</span></label>
          <select
            id={ids.gender}
            disabled={designing}
            value={form.gender ?? ''}
            onChange={(e) => { const gender = e.target.value || null; setForm((f) => ({ ...f, gender })); }}
            className={fieldClass}
          >
            <option value="">Any</option>
            {DESIGN_GENDERS.map((g) => <option key={g.id} value={g.id}>{g.label}</option>)}
          </select>
        </div>
        <div className="min-w-0 flex-1 space-y-1">
          <label htmlFor={ids.language} className="block text-xs text-ink-2">Accent <span className="text-ink-3">(optional)</span></label>
          <select
            id={ids.language}
            disabled={designing}
            value={form.language ?? ''}
            onChange={(e) => { const language = e.target.value || null; setForm((f) => ({ ...f, language })); }}
            className={fieldClass}
          >
            <option value="">Any</option>
            {ACCENT_CHIPS.map((c) => <option key={c.language} value={c.language}>{c.label}</option>)}
          </select>
        </div>
      </div>

      <p id={ids.cost} className="text-[11px] text-ink-3">{DESIGN_COST_NOTE}</p>

      {designing ? (
        <div aria-live="polite" className="space-y-1">
          <div className="h-1 overflow-hidden rounded-full bg-surface-3" role="progressbar" aria-label="Designing the voice" aria-valuetext={`${elapsed} seconds so far`}>
            <div className="h-full rounded-full bg-accent/70 transition-[width] duration-1000 ease-linear motion-reduce:transition-none" style={{ width: `${fill}%` }} />
          </div>
          <p className="text-xs text-ink-3">
            Designing {form.name.trim() || 'the voice'}… {elapsed} s{elapsed > DESIGN_EXPECTED_SECONDS + 10 ? ' (taking longer than usual; it is still working)' : ''}
          </p>
        </div>
      ) : (
        phase.kind === 'form' && phase.error && <p role="alert" className="text-xs text-danger-text">{phase.error}</p>
      )}

      {/* Submit lives in the pinned bar (outside the form), tied back by form=. */}
      {placeActions(
        <button type="submit" form={formId} disabled={designing} aria-describedby={ids.cost} className={primaryButton}>
          {designing ? 'Designing…' : 'Design voice'}
        </button>,
      )}
    </form>
  );
}
