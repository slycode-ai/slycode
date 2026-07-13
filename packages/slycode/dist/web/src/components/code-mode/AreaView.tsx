'use client';

/**
 * Area view — L1 zoom (feature 076). Modules of one area as "rooms" with a
 * BOTTOM DRAWER for the area's explanation/key-files/rename/pin — the same
 * layout pattern as the L0 map, so the UI never rearranges between zoom
 * levels (the right-column context panel is gone).
 */

import { useState } from 'react';
import type { AtlasSnapshot } from './types';
import { relTime } from './AtlasMap';

interface AreaViewProps {
  projectId: string;
  snapshot: AtlasSnapshot;
  areaId: string;
  onOpenFileSmart: (path: string, areaId: string) => void;
  onOpenFile: (path: string) => void;
  onAreaChanged: () => void;
  onRunRefresh: () => void;
  refreshBusy: boolean;
  /** guided tours (feature 079) — this area's tours listed in the drawer */
  onStartTour?: (tourId: string) => void;
}

export function AreaView({ projectId, snapshot, areaId, onOpenFileSmart, onOpenFile, onAreaChanged, onRunRefresh, refreshBusy, onStartTour }: AreaViewProps) {
  const [drawerExpanded, setDrawerExpanded] = useState(false);
  const area = snapshot.root?.areas.find(a => a.id === areaId);
  const node = snapshot.nodes[areaId];
  const fresh = snapshot.freshness[areaId];
  if (!area) return <p className="p-6 font-mono text-[12px] text-(--cm-stale)">unknown area</p>;

  const modules = node?.modules?.length
    ? node.modules
    : (node?.key_files ?? []).map(k => ({ path: k.path, name: k.path.split('/').pop() ?? k.path, summary: k.role }));

  // Which modules drifted since analysis? changedFiles carries exact paths
  // plus 'prefix/ (membership changed)' entries. Prefix entries only flag a
  // module when the prefix is a DECLARED collection (the family card) — an
  // area-path membership change must not paint every card amber.
  const collectionPrefixes = new Set(
    (node?.collections ?? []).map(c => (c.prefix.endsWith('/') ? c.prefix : c.prefix + '/')),
  );
  const changedExact = new Set<string>();
  const changedCollections: string[] = [];
  for (const c of fresh?.changedFiles ?? []) {
    const m = c.match(/^(.+\/) \(membership changed\)$/);
    if (m && collectionPrefixes.has(m[1])) changedCollections.push(m[1]);
    else if (!m) changedExact.add(c);
  }
  const isChanged = (p: string) =>
    changedExact.has(p) || changedCollections.some(pre => p === pre.slice(0, -1) || p.startsWith(pre));

  return (
    <div className="flex h-full flex-col">
      {/* Scrollable content: header + module grid + drift banner */}
      <div className={drawerExpanded ? 'hidden' : 'min-h-0 flex-1 overflow-y-auto p-6 pb-3'}>
        <div className="mx-auto max-w-[1100px]">
          <p className="cm-hue-ink font-mono text-[10px] uppercase tracking-[0.22em]" style={{ color: area.color }}>
            Codebase Atlas · zoom level 1
          </p>
          <h1 className="mb-5 text-balance text-lg font-semibold text-(--cm-text)">
            {area.name}
            <span className="ml-3 font-mono text-[11px] font-normal text-(--cm-muted)">
              {area.paths.join(' · ')}
              {fresh?.analyzedAt ? ` · analyzed ${relTime(fresh.analyzedAt)}` : ' · no analysis yet'}
              {fresh?.stale ? ' · STALE' : ''}
            </span>
          </h1>

          {!node && (
            <p className="max-w-lg text-[13px] text-(--cm-muted)">
              No analysis for this area yet — the next atlas refresh will write one. The deterministic
              explorer still works: use the Files rail or search.
            </p>
          )}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {modules.map(m => (
              <button
                key={m.path}
                onClick={() => onOpenFileSmart(m.path, areaId)}
                className={`cm-card rounded-[9px] border bg-(--cm-panel2) p-3 text-left transition-all hover:-translate-y-0.5 ${
                  isChanged(m.path) ? 'border-(--cm-changed) shadow-[inset_0_0_12px_rgba(245,158,11,0.06)]' : 'border-(--cm-line2)'
                }`}
                style={{ ['--hue' as string]: area.color ?? 'var(--cm-atlas)' }}
              >
                <h4 className="flex items-baseline gap-2 truncate font-mono text-[12.5px] font-bold text-(--cm-text)" title={m.path}>
                  <span className="min-w-0 truncate">{m.name}</span>
                  {isChanged(m.path) && (
                    <span className="ml-auto shrink-0 rounded bg-amber-500/15 px-1.5 py-px font-sans text-[8.5px] font-semibold uppercase tracking-[0.08em] text-amber-600 dark:text-amber-400">
                      changed
                    </span>
                  )}
                </h4>
                <p className="mt-1.5 text-[11.5px] leading-relaxed text-(--cm-muted)">{m.summary}</p>
                <p className="mt-2 truncate font-mono text-[9.5px] text-(--cm-faint)">{m.path}</p>
              </button>
            ))}
          </div>

          {fresh && fresh.changedFiles.length > 0 && (
            <div className="mt-6 max-w-2xl rounded-lg border border-amber-500/40 bg-amber-500/8 px-4 py-2.5 text-[12px] leading-relaxed text-amber-600 dark:text-amber-400">
              ⚠ {fresh.changedFiles.length} described file{fresh.changedFiles.length === 1 ? '' : 's'} changed since this
              analysis — explanations may be outdated.{' '}
              <button onClick={onRunRefresh} disabled={refreshBusy} className="font-mono text-[11px] uppercase tracking-wide underline disabled:opacity-50">
                {refreshBusy ? 'starting…' : 'refresh now'}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Bottom drawer — same pattern as the map */}
      <AreaDrawer
        projectId={projectId}
        snapshot={snapshot}
        areaId={areaId}
        expanded={drawerExpanded}
        onToggleExpand={() => setDrawerExpanded(e => !e)}
        onOpenFile={onOpenFile}
        onAreaChanged={onAreaChanged}
        onStartTour={onStartTour}
      />
    </div>
  );
}

function AreaDrawer({ projectId, snapshot, areaId, expanded, onToggleExpand, onOpenFile, onAreaChanged, onStartTour }: {
  projectId: string;
  snapshot: AtlasSnapshot;
  areaId: string;
  expanded: boolean;
  onToggleExpand: () => void;
  onOpenFile: (path: string) => void;
  onAreaChanged: () => void;
  onStartTour?: (tourId: string) => void;
}) {
  const area = snapshot.root!.areas.find(a => a.id === areaId)!;
  const node = snapshot.nodes[areaId];
  const fresh = snapshot.freshness[areaId];
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(area.name);

  const patchArea = async (patch: { name?: string; pinned?: boolean }) => {
    await fetch('/api/atlas/artifacts', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId, areaId, ...patch }),
    }).catch(() => {});
    onAreaChanged();
  };

  const stale = !fresh || !fresh.hasNode || fresh.stale;

  return (
    <div className={`border-t border-(--cm-line) bg-(--cm-panel) px-6 py-3 ${expanded ? 'min-h-0 flex-1' : 'h-[340px] flex-none'}`}>
      <div className="mx-auto flex h-full max-w-[1100px] min-w-0 flex-col">
        <div className="mb-1.5 flex items-center gap-2.5">
          <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: area.color }} />
          {renaming ? (
            <form
              onSubmit={e => { e.preventDefault(); setRenaming(false); if (name.trim() && name !== area.name) patchArea({ name: name.trim(), pinned: true }); }}
              className="flex min-w-0 items-center gap-1.5"
            >
              <input
                value={name}
                onChange={e => setName(e.target.value)}
                autoFocus
                className="min-w-0 rounded border border-(--cm-line2) bg-(--cm-bg2) px-2 py-0.5 text-[13px] text-(--cm-text) outline-none focus:border-(--cm-atlas)"
              />
              <button type="submit" className="shrink-0 font-mono text-[10px] text-(--cm-atlas)">save</button>
            </form>
          ) : (
            <>
              <span className="text-[13.5px] font-semibold text-(--cm-text)">{area.name}</span>
              <button onClick={() => { setName(area.name); setRenaming(true); }} title="Rename (pins the area)" className="text-[10px] text-(--cm-faint) hover:text-(--cm-atlas)">✎</button>
              <button
                onClick={() => patchArea({ pinned: !area.pinned })}
                title={area.pinned ? 'Unpin' : 'Pin — name survives refreshes'}
                className={`text-[11px] ${area.pinned ? '' : 'opacity-35 hover:opacity-100'}`}
              >
                📌
              </button>
            </>
          )}
          <span className="font-mono text-[10px] text-(--cm-faint)">{area.paths.join(' · ')}</span>
          <span
            className={`rounded px-1.5 py-px font-sans text-[9px] font-semibold uppercase tracking-[0.08em] ${
              stale ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400' : 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
            }`}
          >
            {!fresh || !fresh.hasNode ? 'no analysis' : fresh.stale ? 'stale' : `analyzed ${relTime(fresh.analyzedAt!)}`}
          </span>
          <button
            onClick={onToggleExpand}
            title={expanded ? 'Close full view' : 'Expand info panel to full view'}
            className="ml-auto rounded-md border border-(--cm-line2) px-2 py-1 font-mono text-[11px] leading-none text-(--cm-muted) transition-all hover:border-(--cm-atlas) hover:text-(--cm-atlas)"
          >
            {expanded ? '✕' : '⤢'}
          </button>
        </div>

        <div className="flex min-h-0 flex-1 gap-6">
          <div className="min-w-0 flex-[2] overflow-y-auto pr-2 text-[12.5px] leading-relaxed text-(--cm-muted)">
            {(node?.explanation ?? 'No AI analysis for this area yet — the next refresh will write one.')
              .split(/\n{2,}/)
              .map((para, i) => (
                <p key={i} className="mb-2.5 last:mb-0">{para}</p>
              ))}
          </div>
          {node && node.key_files.length > 0 && (
            <div className="w-[320px] min-w-0 flex-none overflow-y-auto">
              {/* This area's guided tours (feature 079) */}
              {onStartTour && (snapshot.tours ?? []).some(t => t.tour.area === areaId) && (
                <div className="mb-2">
                  <p className="mb-1 font-mono text-[9px] uppercase tracking-[0.18em] text-(--cm-faint)">Guided tours</p>
                  {(snapshot.tours ?? []).filter(t => t.tour.area === areaId).map(({ tour, stale: tourStale }) => (
                    <button
                      key={tour.id}
                      onClick={() => onStartTour(tour.id)}
                      className="block w-full rounded px-1.5 py-1 text-left hover:bg-(--cm-panel3)"
                      title={tour.description ?? tour.title}
                    >
                      <span className="flex items-center gap-1.5 truncate text-[11.5px] font-medium text-(--cm-text)">
                        ▶ {tour.title}
                        {tourStale && (
                          <span className="shrink-0 rounded bg-amber-500/15 px-1 py-px font-sans text-[8.5px] font-semibold uppercase tracking-[0.08em] text-amber-600 dark:text-amber-400">
                            stale
                          </span>
                        )}
                      </span>
                      <span className="block font-mono text-[9.5px] text-(--cm-faint)">{tour.steps.length} steps</span>
                    </button>
                  ))}
                </div>
              )}
              <p className="mb-1 font-mono text-[9px] uppercase tracking-[0.18em] text-(--cm-faint)">Key files</p>
              {node.key_files.map(k => (
                <button
                  key={k.path}
                  onClick={() => onOpenFile(k.path)}
                  className="block w-full rounded px-1.5 py-1 text-left hover:bg-(--cm-panel3)"
                  title={k.path}
                >
                  <span className="block truncate font-mono text-[10.5px] text-(--cm-muted)">
                    {k.path.split('/').slice(-2).join('/')}
                  </span>
                  <span className="block text-[10px] leading-snug text-(--cm-faint)">{k.role}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
