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

import type { AtlasSnapshot, ContextSelection } from './types';

interface AtlasMapProps {
  /** null = first fetch still in flight — show loading, never the empty state */
  snapshot: AtlasSnapshot | null;
  selection: ContextSelection;
  onEnterArea: (areaId: string) => void;
  onSelectArea: (areaId: string) => void;
  onOpenFile: (path: string) => void;
  onRunFirstScan: () => void;
  firstScanBusy: boolean;
  drawerExpanded: boolean;
  onToggleDrawer: () => void;
}

export function AtlasMap({ snapshot, selection, onEnterArea, onSelectArea, onOpenFile, onRunFirstScan, firstScanBusy, drawerExpanded, onToggleDrawer }: AtlasMapProps) {
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
      />
    </div>
  );
}

function AtlasDrawer({ snapshot, selection, onOpenFile, onEnterArea, expanded, onToggleExpand, onDeselect }: {
  snapshot: AtlasSnapshot;
  selection: ContextSelection;
  onOpenFile: (path: string) => void;
  onEnterArea: (areaId: string) => void;
  expanded: boolean;
  onToggleExpand: () => void;
  onDeselect: () => void;
}) {
  const root = snapshot.root!;
  const area = selection.kind === 'area' ? root.areas.find(a => a.id === selection.areaId) : undefined;
  const node = area ? snapshot.nodes[area.id] : undefined;
  const fresh = area ? snapshot.freshness[area.id] : undefined;

  return (
    <div className={`border-t border-(--cm-line) bg-(--cm-panel) px-6 py-3 ${expanded ? 'min-h-0 flex-1' : 'h-[280px] flex-none'}`}>
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
          <div className="flex min-h-0 flex-1 gap-8">
            <button
              onClick={onToggleExpand}
              title={expanded ? 'Close full view — back to the map' : 'Expand info panel to full view'}
              className="absolute right-0 top-0 rounded-md border border-(--cm-line2) px-2 py-1 font-mono text-[11px] leading-none text-(--cm-muted) transition-all hover:border-(--cm-atlas) hover:text-(--cm-atlas)"
            >
              {expanded ? '✕' : '⤢'}
            </button>
            <div className="flex min-w-0 flex-[2] flex-col">
              <p className="mb-1 font-mono text-[9px] uppercase tracking-[0.18em] text-(--cm-faint)">Project overview · click an area for its explanation</p>
              <div className="min-h-0 flex-1 overflow-y-auto pr-2 text-[12.5px] leading-relaxed text-(--cm-muted)">
                {(root.project_overview ?? 'No project overview yet.').split(/\n{2,}/).map((para, i) => (
                  <p key={i} className="mb-2.5 last:mb-0">{para}</p>
                ))}
              </div>
            </div>
            {root.flows && root.flows.length > 0 && (
              <div className="flex min-w-0 flex-[3] flex-col">
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
