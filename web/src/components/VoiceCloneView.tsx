'use client';

/**
 * "Clone my voice" inside the voice search panel (#0376, Gemini only).
 *
 * Three steps, in order: a 10–30 s sample (recorded, or a file), the consent
 * statement read aloud (recorded live, never uploaded), and a name. Both
 * takes become 24 kHz mono WAV in the browser and go to Google in one paid
 * call; they are never kept anywhere (owner ruling). Then the same result
 * flow as design: play, "Use for <project>" (the normal stamped set),
 * "Discard" (deletes it at Google) or keep it.
 *
 * Main actions render into the panel's pinned action bar so they stay in
 * view on a phone with the keyboard up.
 */

import { useCallback, useContext, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CONSENT_STATEMENTS, CLONE_CONSENT_SECONDS, CLONE_SAMPLE_SECONDS, consentFor } from '@/lib/consent-statements';
import { hasFinePointer } from '@/lib/visible-viewport';
import { useTakeRecorder, type TakeRecorder } from '@/hooks/useTakeRecorder';
import {
  CLONE_COST_NOTE,
  CLONE_EXPECTED_SECONDS,
  VOICES_DOWN_MESSAGE,
  cloneBody,
  cloneFormProblem,
  clonedAsPickerVoice,
  formatExpiry,
  interpretChangeResponse,
  interpretCloneResponse,
  interpretPreviewFailure,
  previewBody,
  roundSeconds,
  type PickerVoice,
  type ProjectVoiceRow,
  type Stamp,
} from '@/lib/voice-picker-view';
import { VoiceActionBarContext } from './VoiceSheet';

type ChangeResult = ReturnType<typeof interpretChangeResponse>;

type Phase =
  | { kind: 'form'; error: string | null }
  | { kind: 'cloning'; startedAt: number }
  | { kind: 'ready'; voice: { id: string; name: string; expiresAt: string | null }; sampleUrl: string | null; warnings: string[]; error: string | null; busy: 'use' | 'discard' | null };

const touchTarget = 'max-sm:min-h-11 pointer-coarse:min-h-11';
const fieldClass =
  `w-full rounded border border-line-strong bg-surface-2 px-2 py-1 text-xs text-ink-2 outline-none placeholder:text-ink-3 focus-visible:border-accent disabled:opacity-60 ${touchTarget} max-sm:text-base pointer-coarse:text-base`;
const primaryButton =
  `rounded-md border border-accent/60 bg-accent/20 px-3 py-1 text-xs text-accent transition-colors hover:bg-accent/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 disabled:cursor-not-allowed disabled:opacity-50 ${touchTarget} max-sm:px-4 pointer-coarse:px-4`;
const secondaryButton =
  `inline-flex items-center gap-1.5 rounded-md border border-line-strong px-3 py-1 text-xs text-ink-2 transition-colors hover:text-ink-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 disabled:cursor-not-allowed disabled:opacity-50 ${touchTarget} max-sm:px-4 pointer-coarse:px-4`;
const quietButton =
  `rounded px-1 py-0.5 text-[11px] text-ink-3 hover:text-ink-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 disabled:opacity-50 ${touchTarget} max-sm:px-2 max-sm:text-xs pointer-coarse:px-2 pointer-coarse:text-xs`;

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

function PlayIcon({ playing }: { playing: boolean }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 12 12" className="h-3 w-3">
      {playing
        ? <rect x="2.5" y="2.5" width="7" height="7" rx="1" fill="currentColor" />
        : <path d="M3.5 2.2v7.6a.5.5 0 0 0 .76.43l6.1-3.8a.5.5 0 0 0 0-.86l-6.1-3.8a.5.5 0 0 0-.76.43z" fill="currentColor" />}
    </svg>
  );
}

/** A few bars that follow the input level while a take records. */
function LevelMeter({ level, active }: { level: number; active: boolean }) {
  const shape = [0.45, 0.7, 1, 0.8, 0.55, 0.9, 0.65, 0.4];
  return (
    <div aria-hidden="true" className="flex h-5 items-end gap-[3px]">
      {shape.map((s, i) => (
        <span
          key={i}
          className={`w-1 rounded-full transition-[height] duration-75 motion-reduce:transition-none ${active ? 'bg-accent' : 'bg-line-strong'}`}
          style={{ height: `${Math.max(12, Math.min(100, (active ? level * s * 100 : 0) + 12))}%` }}
        />
      ))}
    </div>
  );
}

const ADVICE_TEXT = { quiet: 'Too quiet: move closer to the mic.', loud: 'Too loud: move back a little.', ok: '' } as const;

/** Record / stop / play / again for one take. */
function TakeControls({ rec, label, maxSeconds, disabled, playing, onPlay }: {
  rec: TakeRecorder;
  label: string;
  maxSeconds: number;
  disabled: boolean;
  playing: boolean;
  onPlay: () => void;
}) {
  const recording = rec.state === 'recording' || rec.state === 'starting';
  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-2">
        {recording ? (
          <button type="button" onClick={rec.stop} className={`${secondaryButton} border-danger/60 text-danger-text`} aria-label={`Stop recording the ${label}`}>
            <span aria-hidden="true" className="h-2 w-2 rounded-sm bg-danger" />
            Stop
          </button>
        ) : (
          <button type="button" disabled={disabled || rec.state === 'processing'} onClick={() => void rec.start()} className={secondaryButton} aria-label={rec.take ? `Record the ${label} again` : `Record the ${label}`}>
            <span aria-hidden="true" className="h-2 w-2 rounded-full bg-danger" />
            {rec.take ? 'Record again' : 'Record'}
          </button>
        )}
        {rec.take && !recording && (
          <button type="button" disabled={disabled} onClick={onPlay} aria-pressed={playing} className={secondaryButton} aria-label={playing ? `Stop playing the ${label}` : `Play the ${label}`}>
            <PlayIcon playing={playing} />
            {playing ? 'Stop' : 'Play'}
          </button>
        )}
        {recording && <LevelMeter level={rec.level} active={rec.state === 'recording'} />}
        <span className="ml-auto text-[11px] tabular-nums text-ink-3" aria-live="off">
          {rec.state === 'recording' ? `${Math.floor(rec.seconds)} s of ${maxSeconds}`
            : rec.state === 'processing' ? 'Preparing…'
            : rec.take ? `${roundSeconds(rec.take.seconds)} s` : ''}
        </span>
      </div>
      {rec.state === 'recording' && rec.advice && rec.advice !== 'ok' && <p className="text-[11px] text-warn-text">{ADVICE_TEXT[rec.advice]}</p>}
      {rec.error && <p role="alert" className="text-xs text-danger-text">{rec.error}</p>}
    </div>
  );
}

function StepHeading({ n, title, done, id }: { n: number; title: string; done: boolean; id: string }) {
  return (
    <div className="flex items-center gap-2">
      <span
        aria-hidden="true"
        className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-medium ${done ? 'bg-accent/20 text-accent' : 'border border-line-strong text-ink-3'}`}
      >
        {done ? '✓' : n}
      </span>
      <h5 id={id} className="text-xs font-medium text-ink-1">{title}</h5>
    </div>
  );
}

export function VoiceCloneView({ target, stamp, initialLocale, onBack, onUse, onDiscarded, onStale, onCreated, onBusyChange }: {
  target: ProjectVoiceRow;
  /** The stamp of the list this panel shows (Gemini). */
  stamp: Stamp;
  initialLocale: string;
  onBack: () => void;
  /** The picker's normal set; resolves with what messaging said. */
  onUse: (voice: PickerVoice) => Promise<ChangeResult | null>;
  onDiscarded: (message: string) => void;
  onStale: (message: string) => void;
  onCreated: () => void;
  onBusyChange?: (busy: boolean) => void;
}) {
  const actionBar = useContext(VoiceActionBarContext);
  const sample = useTakeRecorder(CLONE_SAMPLE_SECONDS.max);
  const consent = useTakeRecorder(CLONE_CONSENT_SECONDS.max);
  const [locale, setLocale] = useState(initialLocale);
  const [name, setName] = useState('');
  const [phase, setPhase] = useState<Phase>({ kind: 'form', error: null });
  const [elapsed, setElapsed] = useState(0);
  const [playing, setPlaying] = useState<'sample' | 'consent' | 'result' | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const inFlightRef = useRef(false);
  const aliveRef = useRef(true);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const urlsRef = useRef<string[]>([]);
  const readyHeadingRef = useRef<HTMLParagraphElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const formId = useId();
  const ids = { s1: useId(), s2: useId(), s3: useId(), name: useId(), locale: useId(), cost: useId(), statement: useId() };
  const statement = consentFor(locale);

  useEffect(() => {
    aliveRef.current = true;
    const urls = urlsRef.current;
    return () => {
      aliveRef.current = false;
      audioRef.current?.pause();
      for (const u of urls) URL.revokeObjectURL(u);
    };
  }, []);

  const holdPanel = phase.kind === 'cloning' || (phase.kind === 'ready' && phase.busy !== null)
    || sample.state === 'recording' || consent.state === 'recording';
  useEffect(() => { onBusyChange?.(holdPanel); }, [holdPanel, onBusyChange]);
  useEffect(() => () => onBusyChange?.(false), [onBusyChange]);

  useEffect(() => {
    if (phase.kind !== 'cloning') return;
    const tick = () => setElapsed(Math.round((Date.now() - phase.startedAt) / 1000));
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [phase]);

  useEffect(() => {
    if (phase.kind === 'ready') readyHeadingRef.current?.focus();
  }, [phase.kind]);

  const stopPlaying = useCallback(() => {
    audioRef.current?.pause();
    audioRef.current = null;
    setPlaying(null);
  }, []);

  const playUrl = useCallback(async (url: string, which: 'sample' | 'consent' | 'result') => {
    audioRef.current?.pause();
    const audio = new Audio(url);
    audioRef.current = audio;
    audio.onended = () => { if (aliveRef.current && audioRef.current === audio) setPlaying(null); };
    try {
      await audio.play();
      if (aliveRef.current && audioRef.current === audio) setPlaying(which);
    } catch {
      if (aliveRef.current) setPlaying(null);
    }
  }, []);

  const toggleTake = useCallback((which: 'sample' | 'consent') => {
    if (playing === which) { stopPlaying(); return; }
    const take = (which === 'sample' ? sample : consent).take;
    if (!take) return;
    const url = base64ToBlobUrl(take.wavBase64, 'audio/wav');
    if (!url) return;
    urlsRef.current.push(url);
    void playUrl(url, which);
  }, [consent, playUrl, playing, sample, stopPlaying]);

  // A take being re-recorded stops any playback.
  useEffect(() => {
    if (sample.state === 'recording' || consent.state === 'recording') stopPlaying();
  }, [consent.state, sample.state, stopPlaying]);

  const create = useCallback(async () => {
    if (inFlightRef.current) return; // a double tap never starts a second paid call
    const form = { name, locale, sample: sample.take, consent: consent.take };
    const problem = cloneFormProblem(form);
    if (problem) {
      setPhase({ kind: 'form', error: problem });
      return;
    }
    stopPlaying();
    inFlightRef.current = true;
    setPhase({ kind: 'cloning', startedAt: Date.now() });
    let result: ReturnType<typeof interpretCloneResponse>;
    try {
      const res = await fetch('/api/messaging/voices/clone', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cloneBody(form, stamp)),
      });
      result = interpretCloneResponse(res.status, await res.json().catch(() => null));
    } catch {
      result = { kind: 'error', message: VOICES_DOWN_MESSAGE };
    }
    inFlightRef.current = false;
    if (!aliveRef.current) return;
    if (result.kind === 'stale') { onStale(result.message); return; }
    if (result.kind === 'error') {
      // Both takes stay, so a retry is one tap (or one re-record).
      setPhase({ kind: 'form', error: result.message });
      return;
    }
    const sampleUrl = result.sample ? base64ToBlobUrl(result.sample.data, result.sample.contentType) : null;
    if (sampleUrl) urlsRef.current.push(sampleUrl);
    setPhase({ kind: 'ready', voice: result.voice, sampleUrl, warnings: result.warnings, error: null, busy: null });
    onCreated();
    if (sampleUrl) void playUrl(sampleUrl, 'result');
  }, [consent.take, locale, name, onCreated, onStale, playUrl, sample.take, stamp, stopPlaying]);

  /** Google may send no sample for a clone: render a short preview instead (about 0.1¢). */
  const previewResult = useCallback(async () => {
    if (phase.kind !== 'ready') return;
    if (playing === 'result') { stopPlaying(); return; }
    if (phase.sampleUrl) { void playUrl(phase.sampleUrl, 'result'); return; }
    setPreviewLoading(true);
    try {
      const res = await fetch('/api/messaging/voices/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(previewBody(clonedAsPickerVoice(phase.voice, stamp))),
      });
      if (!res.ok || !(res.headers.get('content-type') ?? '').startsWith('audio/')) {
        const failure = interpretPreviewFailure(res.status, await res.json().catch(() => null));
        if (!aliveRef.current) return;
        if (failure.kind === 'stale') onStale(failure.message);
        else setPhase({ ...phase, error: failure.message });
        return;
      }
      const url = URL.createObjectURL(await res.blob());
      urlsRef.current.push(url);
      if (!aliveRef.current) return;
      setPhase({ ...phase, sampleUrl: url });
      void playUrl(url, 'result');
    } catch {
      if (aliveRef.current) setPhase({ ...phase, error: VOICES_DOWN_MESSAGE });
    } finally {
      if (aliveRef.current) setPreviewLoading(false);
    }
  }, [onStale, phase, playUrl, playing, stamp, stopPlaying]);

  const use = useCallback(async () => {
    if (phase.kind !== 'ready' || phase.busy) return;
    stopPlaying();
    setPhase({ ...phase, busy: 'use', error: null });
    const result = await onUse(clonedAsPickerVoice(phase.voice, stamp));
    if (!aliveRef.current) return;
    if (result?.kind === 'error') setPhase({ ...phase, busy: null, error: result.message });
  }, [onUse, phase, stamp, stopPlaying]);

  const discard = useCallback(async () => {
    if (phase.kind !== 'ready' || phase.busy) return;
    stopPlaying();
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
  }, [onDiscarded, phase, stopPlaying]);

  const placeActions = (actions: React.ReactNode) => (actionBar
    ? createPortal(actions, actionBar)
    : <div className="flex flex-wrap items-center gap-2">{actions}</div>);

  if (phase.kind === 'ready') {
    const { voice, warnings, error, busy } = phase;
    return (
      <div className="space-y-3 px-4 py-3">
        <div>
          <p ref={readyHeadingRef} tabIndex={-1} className="text-sm text-ink-1 outline-none">{voice.name} is ready.</p>
          <p className="text-[11px] text-ink-3">
            {voice.expiresAt ? `Google keeps it until ${formatExpiry(voice.expiresAt)}. ` : ''}Your recordings weren&apos;t kept, so to renew it you&apos;ll record again.
          </p>
        </div>
        <button type="button" aria-pressed={playing === 'result'} disabled={previewLoading} onClick={() => void previewResult()} className={secondaryButton}>
          <PlayIcon playing={playing === 'result'} />
          {previewLoading ? 'Preparing…' : playing === 'result' ? 'Stop' : 'Hear it'}
        </button>
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

  const cloning = phase.kind === 'cloning';
  const recordingAny = sample.state === 'recording' || consent.state === 'recording' || sample.state === 'starting' || consent.state === 'starting';
  const fill = cloning ? Math.min(95, Math.round((elapsed / CLONE_EXPECTED_SECONDS) * 100)) : 0;
  return (
    <form id={formId} className="space-y-4 px-4 py-3" aria-busy={cloning} onSubmit={(e) => { e.preventDefault(); void create(); }}>
      <p className="text-[11px] text-ink-3">
        Record both in the same quiet room, on the same mic. Only you can clone your voice: Google checks that the same person reads the consent.
      </p>

      {/* 1. Sample */}
      <section aria-labelledby={ids.s1} className="space-y-1.5">
        <StepHeading n={1} id={ids.s1} title="Your voice sample" done={!!sample.take} />
        <p className="pl-7 text-[11px] text-ink-3">
          Read anything aloud, naturally, for {CLONE_SAMPLE_SECONDS.min}–{CLONE_SAMPLE_SECONDS.max} seconds. It stops by itself at {CLONE_SAMPLE_SECONDS.max}.
        </p>
        <div className="pl-7">
          <TakeControls rec={sample} label="voice sample" maxSeconds={CLONE_SAMPLE_SECONDS.max} disabled={cloning || consent.state === 'recording'} playing={playing === 'sample'} onPlay={() => toggleTake('sample')} />
          {!recordingAny && (
            <>
              <button type="button" disabled={cloning} onClick={() => fileRef.current?.click()} className={`${quietButton} -ml-1 mt-1`}>
                Or use a recording you already have
              </button>
              <input
                ref={fileRef}
                type="file"
                accept="audio/*"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = '';
                  if (file) void sample.takeFile(file);
                }}
              />
            </>
          )}
        </div>
      </section>

      {/* 2. Consent: the one step where reading must be exact, so it gets the space. */}
      <section aria-labelledby={ids.s2} className="space-y-1.5">
        <StepHeading n={2} id={ids.s2} title="The consent statement" done={!!consent.take} />
        <div className="space-y-2 pl-7">
          <div className="flex items-center gap-2">
            <label htmlFor={ids.locale} className="shrink-0 text-[11px] text-ink-3">Language</label>
            <select
              id={ids.locale}
              value={locale}
              disabled={cloning || consent.state === 'recording'}
              onChange={(e) => { setLocale(e.target.value); if (consent.take) consent.reset(); }}
              className={`${fieldClass} w-auto min-w-0 flex-1`}
            >
              {CONSENT_STATEMENTS.map((c) => <option key={c.locale} value={c.locale}>{c.language}</option>)}
            </select>
          </div>
          <p className="text-[11px] text-ink-3">Read this aloud, exactly as written:</p>
          <blockquote
            id={ids.statement}
            lang={locale}
            className={`rounded-md border px-3 py-2.5 text-base leading-relaxed text-ink-1 transition-colors ${
              consent.state === 'recording' ? 'border-accent/60 bg-accent/5' : 'border-line-strong bg-surface-2'
            }`}
          >
            {statement?.statement}
          </blockquote>
          <TakeControls rec={consent} label="consent statement" maxSeconds={CLONE_CONSENT_SECONDS.max} disabled={cloning || sample.state === 'recording'} playing={playing === 'consent'} onPlay={() => toggleTake('consent')} />
        </div>
      </section>

      {/* 3. Name */}
      <section aria-labelledby={ids.s3} className="space-y-1.5">
        <StepHeading n={3} id={ids.s3} title="Name it" done={!!name.trim()} />
        <div className="pl-7">
          <label htmlFor={ids.name} className="sr-only">Voice name</label>
          <input
            id={ids.name}
            type="text"
            maxLength={100}
            disabled={cloning}
            placeholder="e.g. My voice"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onFocus={(e) => { if (!hasFinePointer()) e.currentTarget.scrollIntoView({ block: 'center' }); }}
            className={fieldClass}
          />
        </div>
      </section>

      <p id={ids.cost} className="text-[11px] text-ink-3">{CLONE_COST_NOTE}</p>

      {cloning ? (
        <div aria-live="polite" className="space-y-1">
          <div className="h-1 overflow-hidden rounded-full bg-surface-3" role="progressbar" aria-label="Cloning the voice" aria-valuetext={`${elapsed} seconds so far`}>
            <div className="h-full rounded-full bg-accent/70 transition-[width] duration-1000 ease-linear motion-reduce:transition-none" style={{ width: `${fill}%` }} />
          </div>
          <p className="text-xs text-ink-3">
            Cloning {name.trim() || 'the voice'}… {elapsed} s{elapsed > CLONE_EXPECTED_SECONDS + 15 ? ' (taking longer than usual; it is still working)' : ''}
          </p>
        </div>
      ) : (
        phase.kind === 'form' && phase.error && <p role="alert" className="text-xs text-danger-text">{phase.error}</p>
      )}

      {placeActions(
        <button type="submit" form={formId} disabled={cloning || recordingAny} aria-describedby={ids.cost} className={primaryButton}>
          {cloning ? 'Cloning…' : 'Create voice'}
        </button>,
      )}
    </form>
  );
}
