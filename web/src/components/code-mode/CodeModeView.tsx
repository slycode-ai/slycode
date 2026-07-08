'use client';

/**
 * Code Mode — the shell (feature 076).
 *
 * Layout per approved mockup v2: left rail (Files / Symbols / Search / Git),
 * canvas with Atlas zoom scenes (map L0 → area L1 → file atlas L3 → editor),
 * right context panel (AI explanations + freshness), Atlas terminal side
 * panel, status strip. Phase 3: consumes one-shot navigation directives
 * (navigate / highlight / deck) from `sly-atlas` via nav-event polling —
 * the agent fires a directive, the UI renders it, everything after is
 * client-side.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  AtlasSnapshot, CodeModeScene, ContextSelection, NavEvent, OpenTarget, RailTab, TreeNode,
} from './types';
import { FileTree } from './FileTree';
import { SymbolsRail } from './SymbolsRail';
import { SearchRail } from './SearchRail';
import { GitRail } from './GitRail';
import { EditorPane } from './EditorPane';
import { DiffView } from './DiffView';
import { LogView } from './LogView';
import { AtlasMap, relTime } from './AtlasMap';
import { AreaView } from './AreaView';
import { FileAtlas } from './FileAtlas';
import { AtlasTerminal } from './AtlasTerminal';
import { AtlasSettingsModal } from './AtlasSettingsModal';
import { ResultDeck } from './ResultDeck';
import { computeSessionKey } from '@/lib/session-keys';
import { submitVerified } from '@/lib/submit-verified';

/** Files with at least this many symbols get the L3 file atlas before code. */
const FILE_ATLAS_MIN_SYMBOLS = 6;

/** Atlas terminal column: drag-resizable, width persisted across sessions. */
const TERM_WIDTH_DEFAULT = 630;
const TERM_WIDTH_MIN = 380;
const TERM_WIDTH_MAX = 1100;
const TERM_WIDTH_KEY = 'slycode-code-mode-term-width';

interface CodeModeViewProps {
  projectId: string;
  projectName: string;
  projectPath?: string;
}

export function CodeModeView({ projectId, projectName, projectPath }: CodeModeViewProps) {
  const [railTab, setRailTab] = useState<RailTab>('files');
  const [railCollapsed, setRailCollapsed] = useState(false);
  const [tree, setTree] = useState<TreeNode[] | null>(null);
  const [treeError, setTreeError] = useState<string | null>(null);
  const [scene, setScene] = useState<CodeModeScene>({ kind: 'map' });
  const [selection, setSelection] = useState<ContextSelection>({ kind: 'overview' });
  const [snapshot, setSnapshot] = useState<AtlasSnapshot | null>(null);
  const [openFiles, setOpenFiles] = useState<string[]>([]);
  // Terminal open-state survives leaving/re-entering Code Mode (sessionStorage).
  const termStorageKey = `slycode-code-mode-term:${projectId}`;
  const [termOpen, setTermOpenRaw] = useState(false);
  const setTermOpen = useCallback((next: boolean | ((o: boolean) => boolean)) => {
    setTermOpenRaw(prev => {
      const value = typeof next === 'function' ? next(prev) : next;
      try { sessionStorage.setItem(termStorageKey, value ? '1' : '0'); } catch { /* ignore */ }
      return value;
    });
  }, [termStorageKey]);
  const [termProvider, setTermProvider] = useState('claude');
  const [termWidth, setTermWidth] = useState<number>(() => {
    if (typeof window === 'undefined') return TERM_WIDTH_DEFAULT;
    try {
      const saved = Number(window.localStorage.getItem(TERM_WIDTH_KEY));
      if (saved >= TERM_WIDTH_MIN && saved <= TERM_WIDTH_MAX) return saved;
    } catch { /* ignore */ }
    return TERM_WIDTH_DEFAULT;
  });
  const termWidthRef = useRef(termWidth);
  // The deck survives Board↔Code round-trips (sessionStorage) — the user may
  // leave it open, check the board, and come back.
  const deckStorageKey = `slycode-code-mode-deck:${projectId}`;
  const [deckEvent, setDeckEventRaw] = useState<NavEvent | null>(null);
  const setDeckEvent = useCallback((ev: NavEvent | null) => {
    setDeckEventRaw(ev);
    try {
      if (ev) sessionStorage.setItem(deckStorageKey, JSON.stringify(ev));
      else sessionStorage.removeItem(deckStorageKey);
    } catch { /* ignore */ }
  }, [deckStorageKey]);
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(deckStorageKey);
      if (raw) setDeckEventRaw(JSON.parse(raw));
    } catch { /* ignore */ }
  }, [deckStorageKey]);
  const [mapDrawerExpanded, setMapDrawerExpanded] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [refreshBusy, setRefreshBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const stackRef = useRef<CodeModeScene[]>([]);
  const [canGoBack, setCanGoBack] = useState(false);

  const sceneRef = useRef(scene);
  useEffect(() => { sceneRef.current = scene; }, [scene]);

  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flashToast = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3000);
  }, []);

  // ---------- data: tree + atlas snapshot ----------
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/atlas/tree?projectId=${encodeURIComponent(projectId)}`)
      .then(async r => {
        if (!r.ok) throw new Error((await r.json()).error ?? `HTTP ${r.status}`);
        return r.json();
      })
      .then(d => { if (!cancelled) setTree(d.tree); })
      .catch(e => { if (!cancelled) setTreeError(String(e.message ?? e)); });
    return () => { cancelled = true; };
  }, [projectId]);

  const fetchSnapshot = useCallback(async () => {
    try {
      const res = await fetch(`/api/atlas/artifacts?projectId=${encodeURIComponent(projectId)}`);
      if (res.ok) setSnapshot(await res.json());
    } catch { /* keep last snapshot */ }
  }, [projectId]);

  // On entry: restore the terminal panel if it was open last time, or if an
  // atlas session is already live on the bridge (e.g. a scan kicked off
  // earlier) — the running agent should never be invisible.
  useEffect(() => {
    let restored = false;
    try { restored = sessionStorage.getItem(termStorageKey) === '1'; } catch { /* ignore */ }
    if (restored) { setTermOpenRaw(true); return; }
    if (!projectPath) return;
    let cancelled = false;
    fetch('/api/bridge/stats')
      .then(r => (r.ok ? r.json() : null))
      .then(stats => {
        if (cancelled || !stats?.sessions) return;
        const key = computeSessionKey(projectPath);
        const live = stats.sessions.some(
          (s: { name?: string; status?: string }) =>
            typeof s.name === 'string' &&
            s.name.endsWith(':atlas') &&
            (s.name.startsWith(`${key}:`) || s.name.startsWith(`${projectId}:`)) &&
            s.status !== 'stopped',
        );
        if (live) setTermOpenRaw(true);
      })
      .catch(() => {});
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, projectPath]);

  useEffect(() => {
    fetchSnapshot();
    const t = setInterval(fetchSnapshot, 15000);
    return () => clearInterval(t);
  }, [fetchSnapshot]);

  // ---------- navigation ----------
  const pushScene = useCallback((next: CodeModeScene) => {
    stackRef.current.push(sceneRef.current);
    if (stackRef.current.length > 50) stackRef.current.shift();
    setCanGoBack(true);
    setScene(next);
  }, []);

  const goBack = useCallback(() => {
    const prev = stackRef.current.pop();
    setCanGoBack(stackRef.current.length > 0);
    if (prev) setScene(prev);
  }, []);

  const openFile = useCallback((target: OpenTarget) => {
    setOpenFiles(files => (files.includes(target.path) ? files : [...files, target.path]));
    setSelection({ kind: 'file', path: target.path });
    pushScene({ kind: 'editor', target: { ...target } });
  }, [pushScene]);

  /** L3 skip logic: big files get their file atlas; trivial files go straight to code. */
  const openFileSmart = useCallback(async (path: string, areaId?: string) => {
    try {
      const params = new URLSearchParams({ projectId, path, limit: '10' });
      const res = await fetch(`/api/atlas/symbols?${params}`);
      const data = res.ok ? await res.json() : null;
      const count: number = data?.symbols?.length ?? 0;
      setSelection({ kind: 'file', path, areaId });
      if (count >= FILE_ATLAS_MIN_SYMBOLS) {
        pushScene({ kind: 'file', path, areaId });
        return;
      }
    } catch { /* fall through to editor */ }
    openFile({ path });
  }, [projectId, pushScene, openFile]);

  const closeFile = useCallback((path: string) => {
    const next = openFiles.filter(f => f !== path);
    setOpenFiles(next);
    setScene(s => {
      if (s.kind === 'editor' && s.target.path === path) {
        return next.length > 0 ? { kind: 'editor', target: { path: next[next.length - 1] } } : { kind: 'map' };
      }
      return s;
    });
  }, [openFiles]);

  // ---------- Phase 3: nav-event consumption (one-shot directives) ----------
  const cursorRef = useRef<string>(new Date().toISOString()); // ignore pre-mount events
  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      try {
        const params = new URLSearchParams({ projectId, after: cursorRef.current });
        const res = await fetch(`/api/atlas/nav-events?${params}`);
        if (!res.ok || cancelled) return;
        const data = await res.json();
        const events: NavEvent[] = data.events ?? [];
        if (events.length === 0) return;
        cursorRef.current = events[events.length - 1].ts;
        for (const ev of events) applyNavEvent(ev);
      } catch { /* bridge of silence — next poll */ }
    };
    const t = setInterval(poll, 2000);
    return () => { cancelled = true; clearInterval(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  const applyNavEvent = useCallback((ev: NavEvent) => {
    if (ev.type === 'navigate' && ev.file) {
      openFile({ path: ev.file, line: ev.line });
      if (ev.note) flashToast(`✦ ${ev.note}`);
      else flashToast(`✦ Atlas navigated to ${ev.file.split('/').pop()}${ev.line ? ':' + ev.line : ''}`);
    } else if (ev.type === 'highlight' && ev.file && ev.line) {
      openFile({ path: ev.file, line: ev.line, highlight: { line: ev.line, endLine: ev.endLine, note: ev.note } });
    } else if (ev.type === 'deck' && ev.deck) {
      setDeckEvent(ev);
    }
  }, [openFile, flashToast, setDeckEvent]);

  // ---------- refresh + explain ----------
  const runRefresh = useCallback(async () => {
    if (refreshBusy) return;
    setRefreshBusy(true);
    try {
      const res = await fetch('/api/atlas/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setTermOpen(true);
      flashToast('Atlas refresh started — watch the Atlas terminal');
    } catch (e) {
      flashToast(`Refresh failed: ${String((e as Error).message ?? e)}`);
    } finally {
      setRefreshBusy(false);
    }
  }, [projectId, refreshBusy, flashToast, setTermOpen]);

  const explainSelection = useCallback(async (path: string, startLine: number, endLine: number, code: string) => {
    if (!projectPath) { flashToast('Explain needs a project path'); return; }
    setTermOpen(true);
    const sessionName = `${computeSessionKey(projectPath)}:${termProvider}:atlas`;
    const prompt = [
      `Explain this selection from ${path}:${startLine}-${endLine} — what it does and where it fits:`,
      '```',
      code.length > 4000 ? code.slice(0, 4000) + '\n…(truncated)' : code,
      '```',
    ].join('\n');
    const delivery = await submitVerified(sessionName, prompt);
    if (!delivery || delivery.outcome !== 'delivered') {
      flashToast('Could not reach the Atlas session — start it in the terminal panel first');
    }
  }, [projectPath, termProvider, flashToast, setTermOpen]);

  // ---------- render ----------
  const atlasStats = snapshot?.exists && snapshot.root
    ? {
        areas: snapshot.root.areas.length,
        stale: Object.values(snapshot.freshness).filter(f => f.stale || !f.hasNode).length,
        updated: snapshot.root.updated_at,
      }
    : null;

  const goHome = useCallback(() => {
    setSelection({ kind: 'overview' });
    setMapDrawerExpanded(false);
    if (sceneRef.current.kind !== 'map') pushScene({ kind: 'map' });
  }, [pushScene]);

  const areaName = (id: string) => snapshot?.root?.areas.find(a => a.id === id)?.name ?? id;
  /** Owning atlas area for a file (prefix match) — powers deep-scene breadcrumbs. */
  const ownerOf = (path: string): string | undefined =>
    snapshot?.root?.areas.find(a =>
      a.paths.some(p => path === p || path.startsWith(p.endsWith('/') ? p : p + '/')),
    )?.id;
  const goArea = useCallback((areaId: string) => {
    setSelection({ kind: 'area', areaId });
    pushScene({ kind: 'area', areaId });
  }, [pushScene]);
  const goLog = useCallback(() => pushScene({ kind: 'log' }), [pushScene]);
  const crumbs = buildCrumbs(projectName, scene, goHome, areaName, ownerOf, goArea, goLog);

  return (
    <div className="code-mode flex min-h-0 flex-1 flex-col overflow-hidden bg-(--cm-bg) text-(--cm-text)">
      <div className="flex min-h-0 flex-1">
        {/* ---------- Left rail ---------- */}
        <aside
          className={`flex flex-col border-r border-(--cm-line) bg-(--cm-panel) transition-[width] ${
            railCollapsed ? 'w-9' : 'w-[260px]'
          }`}
        >
          {!railCollapsed && (
            <>
              <div className="flex border-b border-(--cm-line)">
                {(['files', 'symbols', 'search', 'git'] as RailTab[]).map(tab => (
                  <button
                    key={tab}
                    onClick={() => setRailTab(tab)}
                    className={`flex-1 py-2 font-mono text-[10px] uppercase tracking-[0.12em] transition-colors ${
                      railTab === tab
                        ? 'text-(--cm-text) shadow-[inset_0_-2px_0_var(--cm-atlas)]'
                        : 'text-(--cm-faint) hover:text-(--cm-muted)'
                    }`}
                  >
                    {tab}
                  </button>
                ))}
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto">
                {railTab === 'files' && (
                  <FileTree
                    tree={tree}
                    error={treeError}
                    activePath={scene.kind === 'editor' ? scene.target.path : scene.kind === 'file' ? scene.path : undefined}
                    onOpenFile={openFile}
                  />
                )}
                {railTab === 'symbols' && <SymbolsRail projectId={projectId} onOpenFile={openFile} />}
                {railTab === 'search' && <SearchRail projectId={projectId} onOpenFile={openFile} />}
                {railTab === 'git' && (
                  <GitRail
                    projectId={projectId}
                    onShowDiff={path => pushScene({ kind: 'diff', path })}
                    onShowLog={path => pushScene({ kind: 'log', path })}
                    onOpenFile={openFile}
                  />
                )}
              </div>
            </>
          )}
          <button
            onClick={() => setRailCollapsed(c => !c)}
            className="border-t border-(--cm-line) px-2 py-1.5 text-left font-mono text-[11px] text-(--cm-faint) hover:text-(--cm-text)"
            title={railCollapsed ? 'Expand rail' : 'Collapse rail'}
          >
            {railCollapsed ? '⟩' : '⟨ collapse'}
          </button>
        </aside>

        {/* ---------- Canvas ---------- */}
        <main className="cm-grid-bg relative flex min-w-0 flex-1 flex-col">
          {/* Breadcrumbs */}
          <div className="flex items-center gap-1.5 border-b border-(--cm-line) bg-(--cm-topbar) px-3 py-1.5 font-mono text-[12px] text-(--cm-muted)">
            {canGoBack && (
              <button onClick={goBack} className="mr-1 rounded px-1.5 py-0.5 text-(--cm-atlas) hover:bg-(--cm-atlas-dim)" title="Back">
                ←
              </button>
            )}
            {crumbs.map((c, i) => (
              <span key={i} className="flex min-w-0 items-center gap-1.5">
                {i > 0 && <span className="text-(--cm-faint)">›</span>}
                {c.action ? (
                  <button onClick={c.action} className="truncate rounded px-1 py-0.5 text-(--cm-atlas) hover:bg-(--cm-atlas-dim)">{c.label}</button>
                ) : (
                  <span className={`truncate ${i === crumbs.length - 1 ? 'text-(--cm-text)' : ''}`}>{c.label}</span>
                )}
              </span>
            ))}
            {/* Atlas settings modal trigger */}
            <button
              onClick={() => setShowSettings(true)}
              title="Atlas settings — nightly refresh schedule & provider"
              className="ml-auto flex shrink-0 items-center rounded-md border border-(--cm-line2) px-2 py-1 font-mono text-[11px] text-(--cm-muted) transition-all hover:border-(--cm-atlas) hover:text-(--cm-atlas)"
            >
              ⚙
            </button>
            {/* Atlas terminal toggle — primary affordance (footer has a twin) */}
            <button
              onClick={() => setTermOpen(o => !o)}
              title={termOpen ? 'Close the Atlas terminal' : 'Open the Atlas terminal — ask the codebase'}
              className={`flex shrink-0 items-center gap-1.5 rounded-md border px-2.5 py-1 font-mono text-[10.5px] uppercase tracking-[0.08em] transition-all ${
                termOpen
                  ? 'border-(--cm-atlas) bg-(--cm-atlas-dim) text-(--cm-atlas)'
                  : 'border-(--cm-line2) text-(--cm-muted) hover:border-(--cm-atlas) hover:text-(--cm-atlas)'
              }`}
            >
              ✦ Atlas&nbsp;Terminal
            </button>
          </div>

          <div className="flex min-h-0 flex-1">
          <div className="relative min-h-0 flex-1 overflow-hidden">
            {openFiles.length > 0 && (
              <div className={scene.kind === 'editor' ? 'absolute inset-0' : 'absolute inset-0 hidden'}>
                <EditorPane
                  projectId={projectId}
                  openFiles={openFiles}
                  active={scene.kind === 'editor' ? scene.target : null}
                  onSelectFile={path => pushScene({ kind: 'editor', target: { path } })}
                  onCloseFile={closeFile}
                  onExplain={explainSelection}
                />
              </div>
            )}
            {scene.kind === 'map' && (
              <AtlasMap
                snapshot={snapshot}
                selection={selection}
                onEnterArea={areaId => { setSelection({ kind: 'area', areaId }); setMapDrawerExpanded(false); pushScene({ kind: 'area', areaId }); }}
                onSelectArea={areaId => setSelection(areaId ? { kind: 'area', areaId } : { kind: 'overview' })}
                onOpenFile={path => openFile({ path })}
                onRunFirstScan={runRefresh}
                firstScanBusy={refreshBusy}
                drawerExpanded={mapDrawerExpanded}
                onToggleDrawer={() => setMapDrawerExpanded(e => !e)}
              />
            )}
            {scene.kind === 'area' && snapshot && (
              <AreaView
                projectId={projectId}
                snapshot={snapshot}
                areaId={scene.areaId}
                onOpenFileSmart={openFileSmart}
                onOpenFile={path => openFile({ path })}
                onAreaChanged={fetchSnapshot}
                onRunRefresh={runRefresh}
                refreshBusy={refreshBusy}
              />
            )}
            {scene.kind === 'file' && (
              <FileAtlas
                projectId={projectId}
                path={scene.path}
                areaId={scene.areaId}
                snapshot={snapshot}
                onOpenAt={(path, line) => openFile({ path, line })}
              />
            )}
            {scene.kind === 'diff' && <DiffView projectId={projectId} path={scene.path} onOpenFile={openFile} />}
            {scene.kind === 'commit' && (
              <DiffView projectId={projectId} commit={{ hash: scene.hash, subject: scene.subject }} onOpenFile={openFile} />
            )}
            {scene.kind === 'log' && (
              <LogView
                projectId={projectId}
                path={scene.path}
                onShowCommit={(hash, subject) => pushScene({ kind: 'commit', hash, subject })}
              />
            )}

            {/* Toast */}
            {toast && (
              <div className="absolute bottom-4 left-1/2 z-30 -translate-x-1/2 rounded-lg border border-(--cm-line2) bg-(--cm-panel3) px-4 py-2 text-[12px] text-(--cm-text) shadow-[0_8px_30px_rgba(0,0,0,0.4)]">
                {toast}
              </div>
            )}
          </div>

          {/* Result deck — docked panel, never floats over code (AI `deck` directive) */}
          {deckEvent && (
            <aside className="w-[340px] flex-none border-l border-(--cm-atlas)/40">
              <ResultDeck
                event={deckEvent}
                onOpen={(file, line) => openFile({ path: file, line })}
                onDismiss={() => setDeckEvent(null)}
              />
            </aside>
          )}
          </div>

          {/* Slim file-info footer (replaces the file context column) */}
          {(scene.kind === 'editor' || scene.kind === 'file') && selection.kind === 'file' && (() => {
            const areaId = selection.areaId ?? ownerOf(selection.path);
            const node = areaId ? snapshot?.nodes[areaId] : undefined;
            const summary =
              node?.modules?.find(m => m.path === selection.path)?.summary ??
              node?.key_files.find(k => k.path === selection.path)?.role;
            const area = areaId ? snapshot?.root?.areas.find(a => a.id === areaId) : undefined;
            return (
              <div className="flex min-w-0 items-center gap-2.5 border-t border-(--cm-line) bg-(--cm-panel) px-3 py-1 font-mono text-[10.5px]">
                {area && (
                  <button
                    onClick={() => goArea(area.id)}
                    className="flex shrink-0 items-center gap-1.5 rounded-full border border-(--cm-line2) px-2 py-px text-(--cm-muted) transition-all hover:text-(--cm-text)"
                    style={{ borderColor: area.color }}
                    title={`Back to ${area.name}`}
                  >
                    <span className="h-1.5 w-1.5 rounded-full" style={{ background: area.color }} />
                    {area.name}
                  </button>
                )}
                <span className="shrink-0 text-(--cm-faint)">{selection.path}</span>
                {summary && <span className="min-w-0 truncate text-(--cm-muted)" title={summary}>— {summary}</span>}
              </div>
            );
          })()}
        </main>

        {/* ---------- Atlas terminal — always the FAR-RIGHT panel ---------- */}
        {termOpen && projectPath && (
          <div style={{ width: termWidth }} className="relative flex-none border-l border-(--cm-line2)">
            {/* Left-edge resize handle — pointer capture keeps the drag alive
                over the xterm canvas; refit follows via Terminal's ResizeObserver. */}
            <div
              onPointerDown={e => {
                e.preventDefault();
                const el = e.currentTarget;
                el.setPointerCapture(e.pointerId);
                const startX = e.clientX;
                const startW = termWidthRef.current;
                const onMove = (ev: PointerEvent) => {
                  const w = Math.min(TERM_WIDTH_MAX, Math.max(TERM_WIDTH_MIN, startW + (startX - ev.clientX)));
                  termWidthRef.current = w;
                  setTermWidth(w);
                };
                const onUp = () => {
                  el.removeEventListener('pointermove', onMove);
                  el.removeEventListener('pointerup', onUp);
                  try { localStorage.setItem(TERM_WIDTH_KEY, String(termWidthRef.current)); } catch { /* ignore */ }
                };
                el.addEventListener('pointermove', onMove);
                el.addEventListener('pointerup', onUp);
              }}
              onDoubleClick={() => {
                termWidthRef.current = TERM_WIDTH_DEFAULT;
                setTermWidth(TERM_WIDTH_DEFAULT);
                try { localStorage.removeItem(TERM_WIDTH_KEY); } catch { /* ignore */ }
              }}
              className="absolute inset-y-0 -left-[3px] z-20 w-[7px] cursor-col-resize touch-none transition-colors hover:bg-(--cm-atlas)/35 active:bg-(--cm-atlas)/50"
              title="Drag to resize · double-click to reset"
            />
            <AtlasTerminal
              projectId={projectId}
              projectName={projectName}
              projectPath={projectPath}
              onClose={() => setTermOpen(false)}
              onProviderChange={setTermProvider}
            />
          </div>
        )}
      </div>

      {/* ---------- Atlas settings modal ---------- */}
      {showSettings && (
        <AtlasSettingsModal
          projectId={projectId}
          onClose={() => setShowSettings(false)}
          onRunRefresh={runRefresh}
          refreshBusy={refreshBusy}
        />
      )}

      {/* ---------- Status strip ---------- */}
      <footer className="flex items-center gap-5 border-t border-(--cm-line) bg-(--cm-panel) px-3 py-1 font-mono text-[10.5px] text-(--cm-faint)">
        <span>
          ATLAS{' '}
          {atlasStats ? (
            <span className="text-(--cm-atlas)">● {atlasStats.areas} areas</span>
          ) : snapshot === null ? (
            <span>… loading</span>
          ) : (
            <span>○ not built</span>
          )}
        </span>
        {atlasStats && atlasStats.stale > 0 && <span className="text-(--cm-stale)">{atlasStats.stale} stale</span>}
        {atlasStats && <span>updated {relTime(atlasStats.updated)}</span>}
        <button
          onClick={runRefresh}
          disabled={refreshBusy}
          title="Start an atlas refresh (re-analyzes stale areas, enriches thin ones)"
          className="tracking-[0.05em] text-(--cm-muted) hover:text-(--cm-atlas) disabled:opacity-50"
        >
          {refreshBusy ? '⟳ starting…' : '⟳ REFRESH'}
        </button>
        <span>{openFiles.length > 0 ? `${openFiles.length} open` : ''}</span>
        <button
          onClick={() => setTermOpen(o => !o)}
          className={`ml-auto tracking-[0.05em] ${termOpen ? 'text-(--cm-atlas)' : 'text-(--cm-muted) hover:text-(--cm-atlas)'}`}
        >
          ◨ ATLAS TERMINAL
        </button>
      </footer>
    </div>
  );
}

interface Crumb { label: string; action?: () => void }

function buildCrumbs(
  projectName: string,
  scene: CodeModeScene,
  goHome: () => void,
  areaName: (id: string) => string,
  ownerOf: (path: string) => string | undefined,
  goArea: (areaId: string) => void,
  goLog: () => void,
): Crumb[] {
  // Home is ALWAYS clickable — on the map it deselects + collapses the drawer.
  const home: Crumb = { label: projectName, action: goHome };

  // Every stage gets a clickable hop: home → owning area → current. The area
  // is derived from atlas paths even when the file was opened via tree/search.
  const fileTrail = (path: string, explicitAreaId?: string): Crumb[] => {
    const areaId = explicitAreaId ?? ownerOf(path);
    const parts = path.split('/');
    const dirs = parts.slice(0, -1).map(p => ({ label: p }));
    const file = { label: parts[parts.length - 1] };
    return areaId
      ? [{ label: areaName(areaId), action: () => goArea(areaId) }, ...dirs, file]
      : [...dirs, file];
  };

  switch (scene.kind) {
    case 'map':
      return [home];
    case 'area':
      return [home, { label: areaName(scene.areaId) }];
    case 'file':
      return [home, ...fileTrail(scene.path, scene.areaId)];
    case 'editor':
      return [home, ...fileTrail(scene.target.path)];
    case 'diff':
      return [home, { label: 'diff' }, { label: scene.path ?? 'working tree' }];
    case 'commit':
      return [home, { label: 'history', action: goLog }, { label: `${scene.hash.slice(0, 8)}${scene.subject ? ` ${scene.subject}` : ''}` }];
    case 'log':
      return [home, { label: 'history' }, ...(scene.path ? [{ label: scene.path }] : [])];
  }
}
