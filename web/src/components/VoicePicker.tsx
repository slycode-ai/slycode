'use client';

/**
 * Project voices picker in Voice Settings (feature 087 phase 3).
 *
 * Two views in the same small space: the project list (each project's voice
 * for the active provider, where it comes from, Change / Reset) and, after
 * Change, a search for that project (Gemini gets gender and accent chips,
 * every row can be previewed). Results keep the provider and revision they
 * were found under; set, reset and preview send them back, and a
 * 409 stale_provider refreshes everything with a short notice.
 *
 * Previews play here, in the browser, never through the speaker stream.
 */

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { VOICE_SETTINGS_LAYER_ATTR } from '@/lib/voice-settings-layer';
import { VOICE_SHEET_QUERY, hasFinePointer } from '@/lib/visible-viewport';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { VoiceDesignView } from './VoiceDesignView';
import { VoiceCloneView } from './VoiceCloneView';
import { VoiceActionBarContext, VoiceSheet } from './VoiceSheet';
import {
  ACCENT_CHIPS,
  GENDER_CHIPS,
  VOICES_DOWN_MESSAGE,
  changeVoiceUrl,
  emptyResultsText,
  initialConsentLocale,
  installDefaultRow,
  isInstallDefaultRow,
  installDefaultSource,
  rowVoiceText,
  othersToggleLabel,
  splitProjects,
  interpretChangeResponse,
  interpretPreviewFailure,
  interpretProjectsResponse,
  interpretSearchResponse,
  previewBody,
  searchPlaceholder,
  searchQuery,
  setBody,
  sourceText,
  voiceDetail,
  type PickerVoice,
  type ProjectVoiceRow,
  type ProjectsResult,
  type SearchFilters,
  type SearchResult,
  type Stamp,
} from '@/lib/voice-picker-view';
import { providerLabel } from '@/lib/tts-provider-view';

const SEARCH_DEBOUNCE_MS = 300;
const NO_FILTERS: SearchFilters = { text: '', gender: null, language: null };

type Note = { kind: 'info' | 'error'; message: string };
type Preview = { key: string; state: 'loading' | 'playing' };

/** Phones and touch screens: 44 px targets and readable text (#0376). Desktop sizes are unchanged. */
const touchTarget = 'max-sm:min-h-11 max-sm:px-2 max-sm:text-xs pointer-coarse:min-h-11 pointer-coarse:px-2 pointer-coarse:text-xs';
const linkButton =
  `rounded px-1 py-0.5 text-[11px] text-accent hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 disabled:cursor-progress disabled:opacity-50 ${touchTarget}`;
const quietButton =
  `rounded px-1 py-0.5 text-[11px] text-ink-3 hover:text-ink-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 disabled:cursor-progress disabled:opacity-50 ${touchTarget}`;

function chipClass(pressed: boolean): string {
  return `shrink-0 rounded-full border px-2 py-0.5 text-[11px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 max-sm:min-h-11 max-sm:px-3 max-sm:text-xs pointer-coarse:min-h-11 pointer-coarse:px-3 pointer-coarse:text-xs ${
    pressed
      ? 'border-accent/60 bg-accent/20 text-accent'
      : 'border-line-strong text-ink-3 hover:text-ink-2'
  }`;
}

/** Browse | Design segments at the top of the voice panel. */
function segmentClass(pressed: boolean): string {
  return `flex-1 rounded px-3 py-1 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 disabled:cursor-not-allowed disabled:opacity-50 max-sm:min-h-11 pointer-coarse:min-h-11 ${
    pressed ? 'bg-accent/20 text-accent' : 'text-ink-3 enabled:hover:text-ink-2'
  }`;
}

function PreviewIcon({ state }: { state: Preview['state'] | null }) {
  if (state === 'loading') {
    return <span aria-hidden="true" className="block h-3 w-3 rounded-full border-2 border-current border-t-transparent motion-safe:animate-spin" />;
  }
  if (state === 'playing') {
    return (
      <svg aria-hidden="true" viewBox="0 0 12 12" className="h-3 w-3"><rect x="2.5" y="2.5" width="7" height="7" rx="1" fill="currentColor" /></svg>
    );
  }
  return (
    <svg aria-hidden="true" viewBox="0 0 12 12" className="h-3 w-3"><path d="M3.5 2.2v7.6a.5.5 0 0 0 .76.43l6.1-3.8a.5.5 0 0 0 0-.86l-6.1-3.8a.5.5 0 0 0-.76.43z" fill="currentColor" /></svg>
  );
}

export function VoicePicker({ revision, onStale, projectId }: {
  /** The project in view (card modal, project page); the picker opens on it alone. */
  projectId?: string | null;
  /** The install's switch revision as the provider control last saw it; a change reloads the picker. */
  revision: number | null;
  /** A stale pick was refused: the provider control should re-read the provider too. */
  onStale?: () => void;
}) {
  /** The search panel browses voices, or (Gemini) designs or clones one. */
  const [mode, setMode] = useState<'browse' | 'design' | 'clone'>('browse');
  /** Other projects stay behind a toggle, collapsed on every open (owner ruling, #0369). */
  const [showOthers, setShowOthers] = useState(false);
  const [projects, setProjects] = useState<ProjectsResult | null>(null);
  const [target, setTarget] = useState<ProjectVoiceRow | null>(null);
  const [filters, setFilters] = useState<SearchFilters>(NO_FILTERS);
  const [results, setResults] = useState<SearchResult | null>(null);
  const [searching, setSearching] = useState(false);
  const [busyProject, setBusyProject] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [rowError, setRowError] = useState<{ key: string; message: string } | null>(null);
  const [note, setNote] = useState<Note | null>(null);
  const [searchNonce, setSearchNonce] = useState(0);
  /** A paid design call is running: the panel can't be left until it answers. */
  const [designBusy, setDesignBusy] = useState(false);

  const aliveRef = useRef(true);
  const searchAbortRef = useRef<AbortController | null>(null);
  const previewAbortRef = useRef<AbortController | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const clipUrlsRef = useRef(new Map<string, string>());
  const changeButtonsRef = useRef(new Map<string, HTMLButtonElement>());
  const searchInputRef = useRef<HTMLInputElement>(null);
  const returnFocusRef = useRef<string | null>(null);
  /** Which provider the chips were shown for; chips only reach the query on Gemini. */
  const chipProviderRef = useRef<Stamp['provider'] | null>(null);

  const noteId = useId();
  const othersId = useId();
  const searchLabelId = useId();

  const stopPreview = useCallback(() => {
    previewAbortRef.current?.abort();
    previewAbortRef.current = null;
    const audio = audioRef.current;
    if (audio) {
      audio.onended = null;
      audio.onerror = null;
      audio.pause();
    }
    audioRef.current = null;
    setPreview(null);
  }, []);

  useEffect(() => {
    aliveRef.current = true;
    const clips = clipUrlsRef.current;
    return () => {
      aliveRef.current = false;
      searchAbortRef.current?.abort();
      previewAbortRef.current?.abort();
      audioRef.current?.pause();
      for (const url of clips.values()) URL.revokeObjectURL(url);
      clips.clear();
    };
  }, []);

  const loadProjects = useCallback(async () => {
    let result: ProjectsResult;
    try {
      const res = await fetch('/api/messaging/voices/projects', { cache: 'no-store' });
      result = interpretProjectsResponse(res.status, await res.json().catch(() => null));
    } catch {
      result = { kind: 'error', message: VOICES_DOWN_MESSAGE };
    }
    if (!aliveRef.current) return;
    setProjects(result);
    // Keep the project being picked for in step with the fresh list.
    if (result.kind === 'ok') {
      setTarget((t) => (t ? result.rows.find((r) => r.projectId === t.projectId) ?? null : t));
    }
  }, []);

  /** Any 409 stale_provider: say so once, then re-read the list and re-run the search. */
  const refreshAfterStale = useCallback((message: string) => {
    stopPreview();
    setNote({ kind: 'info', message });
    void loadProjects();
    setSearchNonce((n) => n + 1);
    onStale?.();
  }, [loadProjects, onStale, stopPreview]);

  // The search effect calls the latest refresh without re-running on its identity.
  const refreshAfterStaleRef = useRef(refreshAfterStale);
  useEffect(() => { refreshAfterStaleRef.current = refreshAfterStale; }, [refreshAfterStale]);

  // Load when opened, and again whenever the provider switch revision moves.
  useEffect(() => {
    void loadProjects();
  }, [revision, loadProjects]);

  // Re-run the search on a provider switch made elsewhere in the popover.
  const lastRevisionRef = useRef(revision);
  useEffect(() => {
    if (lastRevisionRef.current === revision) return;
    lastRevisionRef.current = revision;
    stopPreview();
    setSearchNonce((n) => n + 1);
  }, [revision, stopPreview]);

  // Search: text debounced, chips immediate; the previous request is abandoned.
  const pickingFor = target?.projectId ?? null;
  useEffect(() => {
    if (!pickingFor) return;
    const ac = new AbortController();
    searchAbortRef.current?.abort();
    searchAbortRef.current = ac;
    const delay = filters.text.trim() ? SEARCH_DEBOUNCE_MS : 0;
    const timer = setTimeout(async () => {
      setSearching(true);
      let result: SearchResult;
      try {
        // Never pins a provider: messaging searches the active one and stamps the
        // answer with it, so a pick can only ever be written to that provider.
        const res = await fetch(`/api/messaging/voices?${searchQuery(chipProviderRef.current, filters)}`, { cache: 'no-store', signal: ac.signal });
        result = interpretSearchResponse(res.status, await res.json().catch(() => null));
      } catch {
        if (ac.signal.aborted) return;
        result = { kind: 'error', message: VOICES_DOWN_MESSAGE };
      }
      if (!aliveRef.current || ac.signal.aborted) return;
      if (result.kind === 'stale') {
        // Re-searches via the nonce; keep the previous rows until then.
        setSearching(false);
        refreshAfterStaleRef.current(result.message);
        return;
      }
      setResults(result);
      setSearching(false);
    }, delay);
    return () => {
      clearTimeout(timer);
      ac.abort();
    };
  }, [pickingFor, filters, searchNonce]);

  const startPicking = useCallback((row: ProjectVoiceRow) => {
    setNote(null);
    setRowError(null);
    setResults(null);
    setFilters(NO_FILTERS);
    setMode('browse');
    returnFocusRef.current = row.projectId;
    setTarget(row);
  }, []);

  const stopPicking = useCallback(() => {
    stopPreview();
    searchAbortRef.current?.abort();
    setSearching(false);
    setRowError(null);
    setMode('browse');
    setTarget(null);
  }, [stopPreview]);

  // Focus follows the view: search box on Change, the project's Change button on the way back.
  // Keyed on the project id, not the row object, so a list reload never moves focus.
  // Touch screens skip the search box: focusing it throws the keyboard over the panel (#0376).
  useEffect(() => {
    if (pickingFor) {
      if (hasFinePointer()) searchInputRef.current?.focus();
    } else if (returnFocusRef.current) {
      changeButtonsRef.current.get(returnFocusRef.current)?.focus();
      returnFocusRef.current = null;
    }
  }, [pickingFor]);

  const chooseVoice = useCallback(async (voice: PickerVoice): Promise<ReturnType<typeof interpretChangeResponse> | null> => {
    if (!target || busyProject) return null;
    setBusyProject(target.projectId);
    setRowError(null);
    let result: ReturnType<typeof interpretChangeResponse>;
    try {
      // A project's own voice, or (#0376) the install default.
      const res = await fetch(changeVoiceUrl(target), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(setBody(voice)),
      });
      result = interpretChangeResponse(res.status, await res.json().catch(() => null));
    } catch {
      result = { kind: 'error', message: VOICES_DOWN_MESSAGE };
    }
    if (!aliveRef.current) return null;
    setBusyProject(null);
    if (result.kind === 'stale') {
      setMode('browse');
      refreshAfterStale(result.message);
    } else if (result.kind === 'error') {
      setRowError({ key: clipKey(voice), message: result.message });
    } else {
      setNote({ kind: 'info', message: `${isInstallDefaultRow(target) ? 'The install default' : target.name} now uses ${result.voice?.name ?? voice.name} on ${providerLabel(voice.stamp.provider)}.` });
      void loadProjects();
      stopPicking();
    }
    return result;
  }, [busyProject, loadProjects, refreshAfterStale, stopPicking, target]);

  const resetVoice = useCallback(async (row: ProjectVoiceRow, stamp: Stamp) => {
    if (busyProject) return;
    setBusyProject(row.projectId);
    setNote(null);
    let result: ReturnType<typeof interpretChangeResponse>;
    try {
      const qs = `provider=${stamp.provider}&revision=${stamp.revision}`;
      const res = await fetch(`/api/messaging/voices/projects/${encodeURIComponent(row.projectId)}?${qs}`, { method: 'DELETE' });
      result = interpretChangeResponse(res.status, await res.json().catch(() => null));
    } catch {
      result = { kind: 'error', message: VOICES_DOWN_MESSAGE };
    }
    if (!aliveRef.current) return;
    setBusyProject(null);
    if (result.kind === 'stale') {
      refreshAfterStale(result.message);
    } else if (result.kind === 'error') {
      setNote({ kind: 'error', message: result.message });
    } else {
      setNote({ kind: 'info', message: `${row.name} is back on the ${sourceText(result.source)}${result.voice ? ` (${result.voice.name})` : ''}.` });
      void loadProjects();
    }
  }, [busyProject, loadProjects, refreshAfterStale]);

  const togglePreview = useCallback(async (voice: PickerVoice) => {
    const key = clipKey(voice);
    if (preview?.key === key) {
      stopPreview();
      return;
    }
    stopPreview();
    setRowError(null);
    setPreview({ key, state: 'loading' });
    let src = voice.previewUrl ?? clipUrlsRef.current.get(key) ?? null;
    if (!src) {
      const ac = new AbortController();
      previewAbortRef.current = ac;
      try {
        const res = await fetch('/api/messaging/voices/preview', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(previewBody(voice)),
          signal: ac.signal,
        });
        if (!res.ok || !(res.headers.get('content-type') ?? '').startsWith('audio/')) {
          const failure = interpretPreviewFailure(res.status, await res.json().catch(() => null));
          if (!aliveRef.current || ac.signal.aborted) return;
          if (failure.kind === 'stale') {
            refreshAfterStale(failure.message);
          } else {
            setPreview(null);
            setRowError({ key, message: failure.message });
          }
          return;
        }
        const blob = await res.blob();
        if (!aliveRef.current || ac.signal.aborted) return;
        src = URL.createObjectURL(blob);
        clipUrlsRef.current.set(key, src);
      } catch {
        if (!aliveRef.current || ac.signal.aborted) return;
        setPreview(null);
        setRowError({ key, message: VOICES_DOWN_MESSAGE });
        return;
      } finally {
        if (previewAbortRef.current === ac) previewAbortRef.current = null;
      }
    }
    const audio = new Audio(src);
    audioRef.current = audio;
    audio.onended = () => { if (audioRef.current === audio) { audioRef.current = null; setPreview(null); } };
    audio.onerror = () => {
      if (audioRef.current !== audio) return;
      audioRef.current = null;
      setPreview(null);
      setRowError({ key, message: 'This preview could not be played.' });
    };
    try {
      await audio.play();
      if (aliveRef.current && audioRef.current === audio) setPreview({ key, state: 'playing' });
    } catch {
      if (!aliveRef.current || audioRef.current !== audio) return;
      audioRef.current = null;
      setPreview(null);
      setRowError({ key, message: 'The browser blocked playback. Click play again.' });
    }
  }, [preview, refreshAfterStale, stopPreview]);

  const projectStamp = projects?.kind === 'ok' ? projects.stamp : null;
  const activeProvider = results?.kind === 'ok' ? results.stamp.provider : projectStamp?.provider ?? null;
  useEffect(() => { chipProviderRef.current = activeProvider; }, [activeProvider]);
  const rows = projects?.kind === 'ok' ? projects.rows : [];
  const installDefault = projects?.kind === 'ok' ? projects.installDefault : null;
  const { current, others } = splitProjects(rows, projectId);
  // A project picked from the expanded list keeps the list open on the way back.
  const showOthersNow = showOthers || (!!target && target.projectId !== current?.projectId);

  const renderRow = (row: ProjectVoiceRow, isCurrent: boolean) => {
    const busy = busyProject === row.projectId;
    return (
      <li key={row.projectId} className="flex items-center gap-2 py-1.5" aria-busy={busy || undefined} aria-current={isCurrent ? 'true' : undefined}>
        <div className="min-w-0 flex-1 leading-tight">
          <div className="truncate text-xs text-ink-2">
            {row.name}
            {isCurrent && <span className="text-ink-3"> (this project)</span>}
          </div>
          <div className="truncate text-[11px] text-ink-3" title={row.voice ? `${row.voice.name} (${row.voice.id})` : undefined}>
            {rowVoiceText(row)}
          </div>
        </div>
        {row.source === 'project' && projectStamp && (
          <button
            type="button"
            disabled={busyProject !== null}
            aria-label={`Reset ${row.name} to the install default voice`}
            title="Use the install default voice again"
            onClick={() => void resetVoice(row, projectStamp)}
            className={quietButton}
          >
            Reset
          </button>
        )}
        <button
          type="button"
          ref={(el) => {
            if (el) changeButtonsRef.current.set(row.projectId, el);
            else changeButtonsRef.current.delete(row.projectId);
          }}
          disabled={busyProject !== null}
          aria-label={`Change the voice for ${row.name}`}
          onClick={() => startPicking(row)}
          className={linkButton}
        >
          Change
        </button>
      </li>
    );
  };

  return (
    <div>
      <div className="text-xs text-ink-2">Project voice</div>

      <div className="mt-1">
          {!projects ? (
            <p className="text-xs text-ink-3">Loading project voices…</p>
          ) : projects.kind === 'error' ? (
            <p className="text-xs text-ink-3">{projects.message}</p>
          ) : (
            <div>
              {current && (
                <ul aria-label="This project's voice" className="divide-y divide-line">
                  {renderRow(current, true)}
                </ul>
              )}
              {/* The install default governs the projects without their own voice,
                  so it heads the expanded list (#0376), not the main view. */}
              {others.length > 0 || installDefault ? (
                <>
                  <button
                    type="button"
                    aria-expanded={showOthersNow}
                    aria-controls={othersId}
                    onClick={() => setShowOthers(!showOthersNow)}
                    className={`${quietButton} -ml-1 mt-0.5`}
                  >
                    {others.length > 0
                      ? othersToggleLabel(others.length, !!current, showOthersNow)
                      : showOthersNow ? 'Hide install default' : 'Show install default'}
                  </button>
                  {showOthersNow && (
                    <ul id={othersId} aria-label={current ? 'Install default and other projects' : 'Install default and projects'} className="mt-0.5 max-h-44 divide-y divide-line overflow-y-auto border-t border-line pr-1">
                      {installDefault && (() => {
                        const row = installDefaultRow(installDefault);
                        return (
                          <li key={row.projectId} className="flex items-center gap-2 py-1.5" aria-busy={busyProject === row.projectId || undefined}>
                            <div className="min-w-0 flex-1 leading-tight" title="Used by every project that has no voice of its own">
                              <div className="truncate text-xs text-ink-2">Install default</div>
                              <div className="truncate text-[11px] text-ink-3">
                                {installDefault.voice ? installDefault.voice.name : 'No voice'}, {installDefaultSource(installDefault.source)}
                              </div>
                            </div>
                            <button
                              type="button"
                              ref={(el) => {
                                if (el) changeButtonsRef.current.set(row.projectId, el);
                                else changeButtonsRef.current.delete(row.projectId);
                              }}
                              disabled={busyProject !== null}
                              aria-label="Change the install default voice"
                              onClick={() => startPicking(row)}
                              className={linkButton}
                            >
                              Change
                            </button>
                          </li>
                        );
                      })()}
                      {others.map((row) => renderRow(row, false))}
                    </ul>
                  )}
                </>
              ) : rows.length === 0 ? (
                <p className="text-xs text-ink-3">No projects are registered yet. Add one to give it a voice.</p>
              ) : null}
            </div>
          )}

          <div id={noteId} aria-live="polite" className="mt-1.5 empty:hidden">
            {note && !target && (
              <p className={`text-xs ${note.kind === 'error' ? 'text-danger-text' : 'text-ink-3'}`}>{note.message}</p>
            )}
          </div>
      </div>

      {/* Search and browse open in their own viewport-sized panel, never inline. */}
      {target && (
        <VoiceSearchPanel labelId={searchLabelId} onClose={() => { if (!designBusy) stopPicking(); }}>
          <SearchView
            designSlot={mode === 'clone' && results?.kind === 'ok' && results.stamp.provider === 'gemini' ? (
              <VoiceCloneView
                target={target}
                stamp={results.stamp}
                initialLocale={initialConsentLocale(filters.language ?? (typeof navigator !== 'undefined' ? navigator.language : null))}
                onBusyChange={setDesignBusy}
                onBack={() => setMode('browse')}
                onUse={chooseVoice}
                onDiscarded={(message) => {
                  setMode('browse');
                  setNote({ kind: 'info', message });
                  setSearchNonce((n) => n + 1);
                }}
                onStale={(message) => {
                  setMode('browse');
                  refreshAfterStale(message);
                }}
                onCreated={() => setSearchNonce((n) => n + 1)}
              />
            ) : mode === 'design' && results?.kind === 'ok' && results.stamp.provider === 'gemini' ? (
              <VoiceDesignView
                target={target}
                stamp={results.stamp}
                onBusyChange={setDesignBusy}
                onBack={() => setMode('browse')}
                onUse={chooseVoice}
                onDiscarded={(message) => {
                  setMode('browse');
                  setNote({ kind: 'info', message });
                  setSearchNonce((n) => n + 1);
                }}
                onStale={(message) => {
                  setMode('browse');
                  refreshAfterStale(message);
                }}
                onCreated={() => setSearchNonce((n) => n + 1)}
              />
            ) : null}
            mode={mode}
            onDesign={() => {
              stopPreview();
              setNote(null);
              setMode('design');
            }}
            onClone={() => {
              stopPreview();
              setNote(null);
              setMode('clone');
            }}
            onBrowse={() => setMode('browse')}
            locked={designBusy}
            target={target}
            provider={activeProvider}
            filters={filters}
            setFilters={setFilters}
            results={results}
            searching={searching}
            busy={busyProject === target.projectId}
            preview={preview}
            rowError={rowError}
            note={note}
            inputRef={searchInputRef}
            labelId={searchLabelId}
            onBack={stopPicking}
            onUse={(v) => void chooseVoice(v)}
            onPreview={(v) => void togglePreview(v)}
          />
        </VoiceSearchPanel>
      )}
    </div>
  );
}

/**
 * The voice search sheet: portalled to <body>, centred, sized to the
 * viewport, with its own scroll. It carries the settings-layer marker so a
 * click inside it never closes the Voice Settings popover underneath.
 * Escape here closes the sheet only where CardModal doesn't own Escape (the
 * floating widget); in a card, Back is the way out.
 */
function VoiceSearchPanel({ labelId, onClose, children }: { labelId: string; onClose: () => void; children: React.ReactNode }) {
  // Phones: a full-screen sheet sized to what can be seen (#0376).
  const sheetLayout = useMediaQuery(VOICE_SHEET_QUERY);
  // The pinned action bar under the scrolling body. Its node is state, so the
  // views that portal their actions into it re-render once it exists.
  const [actionBar, setActionBar] = useState<HTMLDivElement | null>(null);
  const content = (
    <VoiceActionBarContext.Provider value={actionBar}>
      {children}
      <div
        ref={setActionBar}
        className="flex shrink-0 flex-wrap items-center gap-2 border-t border-line bg-surface-1 px-4 py-2.5 pb-[max(0.625rem,env(safe-area-inset-bottom))] empty:hidden"
      />
    </VoiceActionBarContext.Provider>
  );
  if (sheetLayout) {
    return <VoiceSheet variant="full" labelledBy={labelId} onClose={onClose}>{content}</VoiceSheet>;
  }
  if (typeof document === 'undefined') return null;
  return createPortal(
    <div {...{ [VOICE_SETTINGS_LAYER_ATTR]: '' }} className="fixed inset-0 z-[10000] flex items-center justify-center p-4">
      <div aria-hidden="true" className="absolute inset-0 bg-black/40 dark:bg-black/60" onMouseDown={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelId}
        onKeyDown={(e) => {
          if (e.key === 'Escape') { e.stopPropagation(); onClose(); }
        }}
        className="relative flex max-h-[min(40rem,calc(100dvh-2rem))] w-full max-w-md flex-col overflow-hidden rounded-lg border border-line bg-surface-1 shadow-(--shadow-overlay)"
      >
        {content}
      </div>
    </div>,
    document.body,
  );
}

function clipKey(v: PickerVoice): string {
  return `${v.stamp.provider}:${v.id}`;
}

function SearchView({
  target, provider, filters, setFilters, results, searching, busy, preview, rowError, note, inputRef, labelId, onBack, onUse, onPreview, designSlot, mode, onDesign, onClone, onBrowse, locked,
}: {
  /** When set, the panel body is the voice designer or cloner instead of the list. */
  designSlot: React.ReactNode;
  mode: 'browse' | 'design' | 'clone';
  onDesign: () => void;
  onClone: () => void;
  onBrowse: () => void;
  /** A paid call is running in the designer: stay put until it answers. */
  locked: boolean;
  target: ProjectVoiceRow;
  provider: Stamp['provider'] | null;
  filters: SearchFilters;
  setFilters: React.Dispatch<React.SetStateAction<SearchFilters>>;
  results: SearchResult | null;
  searching: boolean;
  busy: boolean;
  preview: Preview | null;
  rowError: { key: string; message: string } | null;
  note: Note | null;
  inputRef: React.RefObject<HTMLInputElement | null>;
  labelId: string;
  onBack: () => void;
  onUse: (v: PickerVoice) => void;
  onPreview: (v: PickerVoice) => void;
}) {
  const voices = results?.kind === 'ok' ? results.voices : [];
  const currentId = target.voice?.id ?? null;
  return (
    <>
    <div className="shrink-0 space-y-2 border-b border-line px-4 pt-3 pb-3">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0 leading-tight">
          <h4 id={labelId} className="truncate text-sm font-medium text-ink-1">Voice for {target.name}</h4>
          <p className="truncate text-[11px] text-ink-3">
            {provider ? `${providerLabel(provider)} voices` : 'Voices'}{target.voice ? `, now ${target.voice.name}` : ''}
          </p>
        </div>
        <button type="button" onClick={onBack} disabled={locked} className={`${quietButton} shrink-0`}>Back to settings</button>
      </div>

      {/* Browse the list, or (Gemini) design or clone a voice. Off Gemini, say why. */}
      <div>
        <div role="group" aria-label="Find or make a voice" className="flex rounded-md border border-line-strong p-0.5">
          <button type="button" aria-pressed={!designSlot} disabled={locked} onClick={onBrowse} className={segmentClass(!designSlot)}>
            Browse
          </button>
          <button
            type="button"
            aria-pressed={!!designSlot && mode === 'design'}
            aria-label="Design a voice from a description"
            disabled={locked || provider !== 'gemini' || results?.kind !== 'ok'}
            onClick={designSlot && mode === 'design' ? undefined : onDesign}
            className={segmentClass(!!designSlot && mode === 'design')}
          >
            Design
          </button>
          <button
            type="button"
            aria-pressed={!!designSlot && mode === 'clone'}
            aria-label="Clone your own voice from a recording"
            disabled={locked || provider !== 'gemini' || results?.kind !== 'ok'}
            onClick={designSlot && mode === 'clone' ? undefined : onClone}
            className={segmentClass(!!designSlot && mode === 'clone')}
          >
            Clone
          </button>
        </div>
        {provider && provider !== 'gemini' && (
          <p className="pt-1 text-[11px] text-ink-3">Designing and cloning voices need the Gemini provider. Switch it in Voice Settings, under Provider.</p>
        )}
      </div>

      {!designSlot && (
      <>
      <input
        ref={inputRef}
        type="search"
        aria-labelledby={labelId}
        placeholder={searchPlaceholder(provider)}
        value={filters.text}
        onChange={(e) => {
          const text = e.target.value;
          setFilters((f) => ({ ...f, text }));
        }}
        /* 16 px text on touch screens: smaller makes iOS zoom the page on focus. */
        className="w-full rounded border border-line-strong bg-surface-2 px-2 py-1 text-xs text-ink-2 outline-none placeholder:text-ink-3 focus-visible:border-accent max-sm:min-h-11 max-sm:text-base pointer-coarse:min-h-11 pointer-coarse:text-base"
      />

      {provider === 'gemini' && (
        <div className="space-y-1">
          {/* Phones: one scrolling row per group instead of a tall wrap. */}
          <div role="group" aria-label="Gender" className="flex flex-wrap gap-1 max-sm:-mx-4 max-sm:flex-nowrap max-sm:overflow-x-auto max-sm:px-4">
            {GENDER_CHIPS.map((c) => {
              const pressed = filters.gender === c.id;
              return (
                <button key={c.id} type="button" aria-pressed={pressed} className={chipClass(pressed)}
                  onClick={() => setFilters((f) => ({ ...f, gender: pressed ? null : c.id }))}>
                  {c.label}
                </button>
              );
            })}
          </div>
          <div role="group" aria-label="Accent" className="flex flex-wrap gap-1 max-sm:-mx-4 max-sm:flex-nowrap max-sm:overflow-x-auto max-sm:px-4">
            {ACCENT_CHIPS.map((c) => {
              const pressed = filters.language === c.language;
              return (
                <button key={c.language} type="button" aria-pressed={pressed} className={chipClass(pressed)}
                  onClick={() => setFilters((f) => ({ ...f, language: pressed ? null : c.language }))}>
                  {c.label}
                </button>
              );
            })}
          </div>
        </div>
      )}

      </>
      )}
    </div>

    {designSlot ? (
      <div className="min-h-0 flex-1 overflow-y-auto">{designSlot}</div>
    ) : (
    <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
      {results?.kind === 'error' ? (
        <p className="text-xs text-ink-3">{results.message}</p>
      ) : !results ? (
        <p className="text-xs text-ink-3">Searching…</p>
      ) : voices.length === 0 ? (
        <p className="text-xs text-ink-3" aria-live="polite">{searching ? 'Searching…' : emptyResultsText(filters)}</p>
      ) : (
        <>
          <ul
            aria-label={`Voices for ${target.name}`}
            aria-busy={searching || busy}
            className={`space-y-0.5 transition-opacity ${searching ? 'opacity-60' : ''}`}
          >
            {voices.map((v) => {
              const key = clipKey(v);
              const state = preview?.key === key ? preview.state : null;
              const isCurrent = v.id === currentId;
              const detail = voiceDetail(v);
              return (
                <li key={key} className={`rounded px-1 py-1 ${state === 'playing' ? 'bg-accent/10' : 'hover:bg-surface-2'}`}>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      aria-label={state ? `Stop preview of ${v.name}` : `Preview ${v.name}`}
                      aria-pressed={state !== null}
                      title={v.previewUrl ? 'Play the sample' : 'Play a short sample'}
                      onClick={() => onPreview(v)}
                      className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 max-sm:h-11 max-sm:w-11 pointer-coarse:h-11 pointer-coarse:w-11 ${
                        state
                          ? 'border-accent/60 text-accent'
                          : 'border-line-strong text-ink-3 hover:text-ink-2'
                      }`}
                    >
                      <PreviewIcon state={state} />
                    </button>
                    <div className="min-w-0 flex-1 leading-tight">
                      <div className="truncate text-xs text-ink-2">{v.name}</div>
                      {detail && <div className="truncate text-[11px] text-ink-3" title={detail}>{detail}</div>}
                    </div>
                    {isCurrent ? (
                      <span className="shrink-0 px-1 text-[11px] text-ink-3">Current</span>
                    ) : (
                      <button
                        type="button"
                        disabled={busy}
                        aria-label={`Use ${v.name} for ${target.name}`}
                        onClick={() => onUse(v)}
                        className={linkButton}
                      >
                        Use
                      </button>
                    )}
                  </div>
                  {rowError?.key === key && (
                    <p role="alert" className="mt-0.5 pl-8 text-[11px] text-danger-text">{rowError.message}</p>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
    )}

    <div aria-live="polite" className="shrink-0 border-t border-line px-4 py-2 empty:hidden">
      {note && (
        <p className={`text-xs ${note.kind === 'error' ? 'text-danger-text' : 'text-ink-3'}`}>{note.message}</p>
      )}
      {!designSlot && results?.kind === 'ok' && results.truncated && (
        <p className="text-[11px] text-ink-3">Showing the first 50 matches. Add a word or a filter to narrow them.</p>
      )}
    </div>
    </>
  );
}
