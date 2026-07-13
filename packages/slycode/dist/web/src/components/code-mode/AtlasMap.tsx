'use client';

/**
 * Atlas map — L0 system view (feature 076, Phase 2).
 *
 * Nested-container "buildings" per approved mockup: area cards with churn
 * pips, freshness tags, amber stale borders (fog-of-war was retired as too
 * visually aggressive — same amber treatment as L1 changed cards), a
 * text-based key-flows strip (deterministically ordered), and a legend.
 * Layout, sizing, and color assignment are ALL deterministic — the AI only
 * supplied the structure.
 */

import { useState } from 'react';
import type { AtlasSnapshot, ContextSelection, TourWithFreshness } from './types';
import { DigestTab } from './DigestPanel';

interface AtlasMapProps {
  /** null = first fetch still in flight — show loading, never the empty state */
  snapshot: AtlasSnapshot | null;
  selection: ContextSelection;
  onEnterArea: (areaId: string) => void;
  onSelectArea: (areaId: string) => void;
  onOpenFile: (path: string, line?: number) => void;
  onRunFirstScan: () => void;
  firstScanBusy: boolean;
  drawerExpanded: boolean;
  onToggleDrawer: () => void;
  /** guided tours + catch-up digest (feature 079) — drawer tabs */
  tours?: TourWithFreshness[];
  onStartTour?: (tourId: string) => void;
  onRefreshTour?: (tourId: string) => void;
  onCreateTour?: (request: string) => void;
  onAckDigest?: (action: 'digest-read' | 'digest-dismiss') => void;
}

export function AtlasMap({ snapshot, selection, onEnterArea, onSelectArea, onOpenFile, onRunFirstScan, firstScanBusy, drawerExpanded, onToggleDrawer, tours, onStartTour, onRefreshTour, onCreateTour, onAckDigest }: AtlasMapProps) {
  // Never claim "no atlas" until we KNOW — the artifacts fetch takes a few
  // seconds (churn + hash checks) and the empty state was flashing meanwhile.
  if (snapshot === null) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
        <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-(--cm-faint)">Codebase Atlas</p>
        <p className="animate-pulse font-mono text-[12px] text-(--cm-muted)">reading atlas…</p>
      </div>
    );
  }
  if (!snapshot.exists || !snapshot.root) {
    return <FirstScanEmptyState onRun={onRunFirstScan} busy={firstScanBusy} invalid={snapshot.rootErrors} />;
  }
  const { root } = snapshot;
  const maxChurn = Math.max(1, ...Object.values(snapshot.freshness).map(f => f.churn));

  return (
    <div className="flex h-full flex-col">
      <div className={drawerExpanded ? 'hidden' : 'min-h-0 flex-1 overflow-y-auto p-6 pb-3'}>
        <div className="mx-auto max-w-[1100px]">
        <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-(--cm-faint)">Codebase Atlas · zoom level 0</p>
        <h1 className="mb-5 flex items-baseline text-balance text-lg font-semibold text-(--cm-text)">
          System map
          <span className="ml-3 font-mono text-[11px] font-normal text-(--cm-muted)">
            {root.areas.length} areas · updated {relTime(root.updated_at)}
          </span>
          <button
            onClick={onRunFirstScan}
            disabled={firstScanBusy}
            title="Start an atlas refresh in the Atlas terminal — re-analyzes stale areas and enriches thin ones"
            className="ml-auto rounded-md border border-(--cm-line2) px-2.5 py-1 font-mono text-[10.5px] font-normal uppercase tracking-[0.08em] text-(--cm-muted) transition-all hover:border-(--cm-atlas) hover:text-(--cm-atlas) disabled:opacity-50"
          >
            {firstScanBusy ? 'starting…' : '⟳ Refresh atlas'}
          </button>
        </h1>

        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-3">
          {root.areas.map(area => {
            const fresh = snapshot.freshness[area.id];
            const stale = !fresh || fresh.stale || !fresh.hasNode;
            const isSelected = selection.kind === 'area' && selection.areaId === area.id;
            const churnLevel = fresh ? Math.round((fresh.churn / maxChurn) * 5) : 0;
            return (
              <button
                key={area.id}
                // First click selects (details in the drawer); second click zooms.
                onClick={() => (isSelected ? onEnterArea(area.id) : onSelectArea(area.id))}
                style={{
                  ['--hue' as string]: area.color ?? 'var(--cm-atlas)',
                  ...(isSelected
                    ? { boxShadow: 'inset 3px 0 0 var(--hue), 0 0 0 1.5px var(--hue), 0 0 22px -4px var(--hue)' }
                    : {}),
                }}
                className={`cm-card group relative rounded-[10px] border bg-(--cm-panel2) p-3.5 text-left transition-all hover:-translate-y-0.5 hover:border-(--hue) ${
                  isSelected
                    ? 'border-(--hue)'
                    : stale
                      ? 'border-(--cm-changed) shadow-[inset_3px_0_0_var(--hue),inset_0_0_14px_rgba(245,158,11,0.07)]'
                      : 'border-(--cm-line2) shadow-[inset_3px_0_0_var(--hue)]'
                }`}
              >
                <h3 className="flex items-center gap-2 text-[14px] font-semibold text-(--cm-text)">
                  <span className="h-2 w-2 rounded-full" style={{ background: 'var(--hue)', boxShadow: '0 0 8px var(--hue)' }} />
                  {area.name}
                  {area.pinned && <span title="Pinned — name survives refreshes" className="text-[10px] text-(--cm-faint)">📌</span>}
                </h3>
                <p className="mt-0.5 font-mono text-[10px] text-(--cm-faint)">{area.paths.join(' · ')}</p>
                {area.summary && <p className="mt-2 text-[11.5px] leading-relaxed text-(--cm-muted)">{area.summary}</p>}
                <div className="mt-2.5 flex items-center gap-2.5 font-mono text-[10px] text-(--cm-faint)">
                  <span className="flex items-center gap-[3px]" title={`${fresh?.churn ?? 0} commits touched this area (14 days)`}>
                    {[1, 2, 3, 4, 5].map(i => (
                      <i key={i} className="h-[5px] w-[5px] rounded-[1px]" style={{ background: i <= churnLevel ? 'var(--hue)' : 'var(--cm-panel3)' }} />
                    ))}
                  </span>
                  <FreshTag fresh={fresh} />
                </div>
              </button>
            );
          })}
        </div>

        <div className="mt-4 flex justify-center gap-5 font-mono text-[10px] text-(--cm-faint)">
          <span className="flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-[2px] bg-emerald-500/50" /> analysis fresh</span>
          <span className="flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-[2px] border border-(--cm-changed) bg-amber-500/15" /> amber border — drifted since analysis</span>
          <span>▪ churn, last 14 days</span>
        </div>
        </div>
      </div>

      {/* Bottom drawer: hovered area's explanation (wide = readable), or the
          project overview + key flows when nothing is hovered. Replaces the
          right context column on the map — horizontal space wins. */}
      <AtlasDrawer
        snapshot={snapshot}
        selection={selection}
        onOpenFile={onOpenFile}
        onEnterArea={onEnterArea}
        expanded={drawerExpanded}
        onToggleExpand={onToggleDrawer}
        onDeselect={() => onSelectArea('')}
        tours={tours}
        onStartTour={onStartTour}
        onRefreshTour={onRefreshTour}
        onCreateTour={onCreateTour}
        onAckDigest={onAckDigest}
      />
    </div>
  );
}

type DrawerTab = 'overview' | 'catchup' | 'tours';

function AtlasDrawer({ snapshot, selection, onOpenFile, onEnterArea, expanded, onToggleExpand, onDeselect, tours, onStartTour, onRefreshTour, onCreateTour, onAckDigest }: {
  snapshot: AtlasSnapshot;
  selection: ContextSelection;
  onOpenFile: (path: string, line?: number) => void;
  onEnterArea: (areaId: string) => void;
  expanded: boolean;
  onToggleExpand: () => void;
  onDeselect: () => void;
  tours?: TourWithFreshness[];
  onStartTour?: (tourId: string) => void;
  onRefreshTour?: (tourId: string) => void;
  onCreateTour?: (request: string) => void;
  onAckDigest?: (action: 'digest-read' | 'digest-dismiss') => void;
}) {
  // Drawer tabs (test-review rework): Overview | Catch-up | Tours replace the
  // stacked-band + crammed-columns layout. An unseen digest auto-selects the
  // Catch-up tab (with a pulse dot) until the user picks a tab themselves.
  const digest = snapshot.digest;
  const unseen = Boolean(
    digest && (!snapshot.viewState?.digest_seen || digest.generated_at > snapshot.viewState.digest_seen),
  );
  const [touchedTab, setTouchedTab] = useState<DrawerTab | null>(null);
  const tab: DrawerTab = touchedTab ?? (unseen ? 'catchup' : 'overview');
  const markRead = () => {
    setTouchedTab('catchup'); // stay here — don't snap back to overview mid-read
    onAckDigest?.('digest-read');
  };
  const root = snapshot.root!;
  const area = selection.kind === 'area' ? root.areas.find(a => a.id === selection.areaId) : undefined;
  const node = area ? snapshot.nodes[area.id] : undefined;
  const fresh = area ? snapshot.freshness[area.id] : undefined;

  return (
    <div className={`border-t border-(--cm-line) bg-(--cm-panel) px-6 py-3 ${expanded ? 'min-h-0 flex-1' : 'h-[340px] flex-none'}`}>
      <div className="relative mx-auto flex h-full max-w-[1100px] min-w-0 flex-col">
        {area ? (
          <>
            <div className="mb-1.5 flex items-center gap-2.5">
              <span className="h-2 w-2 rounded-full" style={{ background: area.color }} />
              <span className="text-[13.5px] font-semibold text-(--cm-text)">{area.name}</span>
              <span className="font-mono text-[10px] text-(--cm-faint)">{area.paths.join(' · ')}</span>
              <span
                className={`rounded px-1.5 py-px font-sans text-[9px] font-semibold uppercase tracking-[0.08em] ${
                  !fresh || !fresh.hasNode || fresh.stale
                    ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
                    : 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                }`}
              >
                {!fresh || !fresh.hasNode ? 'no analysis' : fresh.stale ? 'stale' : `analyzed ${relTime(fresh.analyzedAt!)}`}
              </span>
              <span className="ml-auto flex items-center gap-1.5">
                <button
                  onClick={onDeselect}
                  title="Back to project overview & key flows"
                  className="rounded-md border border-(--cm-line2) px-2 py-1 font-mono text-[10px] uppercase tracking-[0.08em] text-(--cm-muted) transition-all hover:border-(--cm-atlas) hover:text-(--cm-atlas)"
                >
                  ‹ overview
                </button>
                <button
                  onClick={() => onEnterArea(area.id)}
                  className="rounded-md border border-(--cm-line2) px-2 py-1 font-mono text-[10px] uppercase tracking-[0.08em] text-(--cm-muted) transition-all hover:border-(--hue,var(--cm-atlas))"
                  style={{ ['--hue' as string]: area.color ?? 'var(--cm-atlas)' }}
                >
                  Zoom in ⤵
                </button>
                <button
                  onClick={onToggleExpand}
                  title={expanded ? 'Close full view — back to the map' : 'Expand info panel to full view'}
                  className="rounded-md border border-(--cm-line2) px-2 py-1 font-mono text-[11px] leading-none text-(--cm-muted) transition-all hover:border-(--cm-atlas) hover:text-(--cm-atlas)"
                >
                  {expanded ? '✕' : '⤢'}
                </button>
              </span>
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
                  <p className="mb-1 font-mono text-[9px] uppercase tracking-[0.18em] text-(--cm-faint)">Key files</p>
                  {node.key_files.slice(0, 8).map(k => (
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
          </>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col">
            {/* Tab bar + actions */}
            <div className="mb-2 flex items-center gap-1 border-b border-(--cm-line)">
              {([
                ['overview', 'Overview', null],
                ['catchup', 'Catch-up', unseen],
                ['tours', `Tours${tours?.length ? ` · ${tours.length}` : ''}`, null],
              ] as Array<[DrawerTab, string, boolean | null]>).map(([id, label, dot]) => (
                <button
                  key={id}
                  onClick={() => setTouchedTab(id)}
                  className={`flex items-center gap-1.5 px-2.5 pb-1.5 pt-0.5 font-mono text-[10px] uppercase tracking-[0.12em] transition-colors ${
                    tab === id
                      ? 'text-(--cm-text) shadow-[inset_0_-2px_0_var(--cm-atlas)]'
                      : 'text-(--cm-faint) hover:text-(--cm-muted)'
                  }`}
                >
                  {label}
                  {dot && (
                    <span className="relative flex h-1.5 w-1.5">
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-(--cm-atlas) opacity-60 motion-reduce:hidden" />
                      <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-(--cm-atlas)" />
                    </span>
                  )}
                </button>
              ))}
              <span className="ml-auto flex items-center gap-1.5 pb-1">
                {tab === 'catchup' && digest && (
                  unseen ? (
                    <button
                      onClick={markRead}
                      title="Mark read — the next digest starts from here"
                      className="rounded-md border border-(--cm-atlas) bg-(--cm-atlas-dim) px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.08em] text-(--cm-atlas) transition-all hover:brightness-110"
                    >
                      ✓ Mark read
                    </button>
                  ) : (
                    <span className="font-mono text-[9.5px] text-(--cm-faint)">read · anchor advanced</span>
                  )
                )}
                <button
                  onClick={onToggleExpand}
                  title={expanded ? 'Close full view — back to the map' : 'Expand info panel to full view'}
                  className="rounded-md border border-(--cm-line2) px-2 py-1 font-mono text-[11px] leading-none text-(--cm-muted) transition-all hover:border-(--cm-atlas) hover:text-(--cm-atlas)"
                >
                  {expanded ? '✕' : '⤢'}
                </button>
              </span>
            </div>

            {/* Tab content */}
            {tab === 'overview' && (
              <div className="flex min-h-0 flex-1 gap-8">
                <div className="flex min-w-0 flex-[2] flex-col">
                  <p className="mb-1 font-mono text-[9px] uppercase tracking-[0.18em] text-(--cm-faint)">Project overview · click an area for its explanation</p>
                  <div className="min-h-0 flex-1 overflow-y-auto pr-2 text-[12.5px] leading-relaxed text-(--cm-muted)">
                    {(root.project_overview ?? 'No project overview yet.').split(/\n{2,}/).map((para, i) => (
                      <p key={i} className="mb-2.5 last:mb-0">{para}</p>
                    ))}
                  </div>
                </div>
                {root.flows && root.flows.length > 0 && (
                  <div className="flex min-w-0 flex-[2] flex-col">
                    <p className="mb-1 font-mono text-[9px] uppercase tracking-[0.18em] text-(--cm-faint)">Key flows</p>
                    <div className="min-h-0 flex-1 space-y-1 overflow-y-auto pr-2">
                      {root.flows.map((f, i) => {
                        const from = root.areas.find(a => a.id === f.from);
                        const to = root.areas.find(a => a.id === f.to);
                        return (
                          <div key={i} className="font-mono text-[11px] leading-snug">
                            <span className="cm-hue-ink font-semibold" style={{ color: from?.color }}>{from?.name ?? f.from}</span>
                            <span className="text-(--cm-faint)"> → </span>
                            <span className="cm-hue-ink font-semibold" style={{ color: to?.color }}>{to?.name ?? f.to}</span>
                            <span className="text-(--cm-muted)"> — {f.label}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}
            {tab === 'catchup' && (
              <div className="min-h-0 flex-1">
                <DigestTab snapshot={snapshot} onOpenFile={onOpenFile} onEnterArea={onEnterArea} />
              </div>
            )}
            {tab === 'tours' && (
              <ToursTab
                snapshot={snapshot}
                tours={tours ?? []}
                onStartTour={onStartTour}
                onRefreshTour={onRefreshTour}
                onCreateTour={onCreateTour}
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function ToursTab({ snapshot, tours, onStartTour, onRefreshTour, onCreateTour }: {
  snapshot: AtlasSnapshot;
  tours: TourWithFreshness[];
  onStartTour?: (tourId: string) => void;
  onRefreshTour?: (tourId: string) => void;
  onCreateTour?: (request: string) => void;
}) {
  const root = snapshot.root!;
  return (
    <div className="grid min-h-0 flex-1 auto-rows-min grid-cols-1 gap-3 overflow-y-auto pr-2 md:grid-cols-2">
      {tours.map(({ tour, stale }) => {
        const area = tour.area ? root.areas.find(a => a.id === tour.area) : undefined;
        return (
          <div
            key={tour.id}
            className="cm-card rounded-[9px] border border-(--cm-line2) bg-(--cm-panel2) p-3"
            style={{ ['--hue' as string]: area?.color ?? 'var(--cm-atlas)' }}
          >
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <h4 className="flex items-center gap-1.5 text-[12.5px] font-semibold text-(--cm-text)">
                  {area && <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: area.color }} />}
                  <span className="min-w-0">{tour.title}</span>
                </h4>
                {tour.prompt && (
                  <p className="mt-0.5 text-[11px] italic leading-snug text-(--cm-atlas)">“{tour.prompt}”</p>
                )}
                {tour.description && (
                  <p className="mt-0.5 text-[11px] leading-snug text-(--cm-muted)">{tour.description}</p>
                )}
              </div>
              {stale && (
                <span className="shrink-0 rounded bg-amber-500/15 px-1.5 py-px font-sans text-[8.5px] font-semibold uppercase tracking-[0.08em] text-amber-600 dark:text-amber-400">
                  stale
                </span>
              )}
            </div>
            <div className="mt-2 flex items-center gap-1.5">
              <button
                onClick={() => onStartTour?.(tour.id)}
                className="rounded-md border border-(--cm-atlas) bg-(--cm-atlas-dim) px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.08em] text-(--cm-atlas) transition-all hover:brightness-110"
              >
                ▶ Start
              </button>
              {onRefreshTour && (
                <button
                  onClick={() => onRefreshTour(tour.id)}
                  title={stale
                    ? 'Source files changed — ask the Atlas to re-answer this tour against the current code'
                    : 'Ask the Atlas to rewrite this tour against the current code'}
                  className={`rounded-md border px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.08em] transition-all ${
                    stale
                      ? 'border-amber-500/50 text-amber-600 hover:brightness-110 dark:text-amber-400'
                      : 'border-(--cm-line2) text-(--cm-muted) hover:border-(--cm-atlas) hover:text-(--cm-atlas)'
                  }`}
                >
                  ⟳ Refresh
                </button>
              )}
              <span className="ml-auto font-mono text-[9.5px] text-(--cm-faint)">
                {tour.steps.length} steps · {relTime(tour.updated_at)}
              </span>
            </div>
          </div>
        );
      })}
      {onCreateTour && <CreateTourCard onCreate={onCreateTour} soleCard={tours.length === 0} />}
    </div>
  );
}

/** The "+ new tour" card at the end of the tours grid: describe what the tour
 *  should explain → the request goes to the Atlas terminal, which authors the
 *  artifact via write-tour; it appears here when written. */
function CreateTourCard({ onCreate, soleCard }: { onCreate: (request: string) => void; soleCard: boolean }) {
  const [request, setRequest] = useState('');
  const submit = () => {
    const text = request.trim();
    if (!text) return;
    onCreate(text);
    setRequest('');
  };
  return (
    <div className="flex flex-col rounded-[9px] border border-dashed border-(--cm-line2) bg-transparent p-3 transition-colors focus-within:border-(--cm-atlas)">
      <p className="mb-1.5 font-mono text-[9px] uppercase tracking-[0.18em] text-(--cm-faint)">
        + New tour{soleCard ? ' — none yet' : ''}
      </p>
      <textarea
        value={request}
        onChange={e => setRequest(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            submit();
          }
        }}
        rows={3}
        placeholder={'What should this tour explain?\ne.g. "Walk me through how a kanban card becomes a running terminal session"'}
        className="min-h-0 w-full flex-1 resize-none rounded-md border border-(--cm-line) bg-(--cm-bg2) px-2 py-1.5 text-[12px] leading-relaxed text-(--cm-text) outline-none placeholder:text-(--cm-faint) focus:border-(--cm-atlas)"
      />
      <div className="mt-2 flex items-center gap-2">
        <button
          onClick={submit}
          disabled={!request.trim()}
          className="rounded-md border border-(--cm-atlas) bg-(--cm-atlas-dim) px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.08em] text-(--cm-atlas) transition-all hover:brightness-110 disabled:opacity-40"
        >
          ✦ Create
        </button>
        <span className="font-mono text-[9px] text-(--cm-faint)">the Atlas researches & writes it · Ctrl+Enter</span>
      </div>
    </div>
  );
}

function FreshTag({ fresh }: { fresh?: { hasNode: boolean; stale: boolean } }) {
  const stale = !fresh || !fresh.hasNode || fresh.stale;
  return (
    <span
      className={`ml-auto rounded px-1.5 py-px font-sans text-[9px] font-semibold uppercase tracking-[0.08em] ${
        stale ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400' : 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
      }`}
    >
      {!fresh || !fresh.hasNode ? 'no analysis' : fresh.stale ? 'stale' : 'fresh'}
    </span>
  );
}

function FirstScanEmptyState({ onRun, busy, invalid }: { onRun: () => void; busy: boolean; invalid?: string[] }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 p-8 text-center">
      <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-(--cm-faint)">Codebase Atlas</p>
      <h2 className="text-lg font-semibold text-(--cm-text)">No atlas yet</h2>
      {invalid ? (
        <p className="max-w-md font-mono text-[11px] text-(--cm-stale)">atlas.json is invalid: {invalid.join('; ')}</p>
      ) : (
        <p className="max-w-md text-[13px] leading-relaxed text-(--cm-muted)">
          The Atlas agent explores the codebase, proposes the top-level areas, and writes an
          explanation for each — schema-validated, hash-stamped, refreshed nightly. Run the first
          scan to build it (a few minutes in the Atlas terminal).
        </p>
      )}
      <button
        onClick={onRun}
        disabled={busy}
        className="rounded-lg border border-(--cm-atlas) bg-(--cm-atlas-dim) px-5 py-2 font-mono text-[12px] uppercase tracking-[0.08em] text-(--cm-atlas) transition-all hover:brightness-110 disabled:opacity-50"
      >
        {busy ? 'Starting…' : 'Run first scan'}
      </button>
      <p className="font-mono text-[10.5px] text-(--cm-faint)">Explorer, search, symbols, and git work without it — left rail.</p>
    </div>
  );
}

export function relTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (isNaN(ms)) return iso;
  const min = Math.floor(ms / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const h = Math.floor(min / 60);
  if (h < 48) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}
