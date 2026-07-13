'use client';

/**
 * Catch-up digest tab (feature 079, reworked after test review) — "what
 * changed since you last looked", rendered INSIDE the map's bottom drawer as
 * one of its tabs (Overview | Catch-up | Tours) instead of a third stacked
 * band above the map. The headline wraps in full — no truncation, no browser
 * tooltip. Mark-read lives in the drawer's header row (owned by AtlasMap).
 *
 * Per-area summaries are ordered by comprehension debt (deterministic:
 * commits since anchor weighted by how rarely the area gets viewed).
 */

import type { AtlasSnapshot } from './types';
import { relTime } from './AtlasMap';

interface DigestTabProps {
  snapshot: AtlasSnapshot;
  onOpenFile: (path: string, line?: number) => void;
  onEnterArea: (areaId: string) => void;
}

export function DigestTab({ snapshot, onOpenFile, onEnterArea }: DigestTabProps) {
  const digest = snapshot.digest;
  if (!digest) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="max-w-md text-center font-mono text-[11px] leading-relaxed text-(--cm-faint)">
          No catch-up digest yet — the nightly atlas refresh writes one whenever the codebase
          moved since you last looked.
        </p>
      </div>
    );
  }

  const debtById = new Map((snapshot.debt ?? []).map(d => [d.areaId, d]));
  // Debt-ordered: the areas the user most needs to catch up on come first.
  const ordered = [...digest.areas].sort(
    (a, b) => (debtById.get(b.area)?.score ?? 0) - (debtById.get(a.area)?.score ?? 0),
  );
  const areaMeta = (id: string) => snapshot.root?.areas.find(a => a.id === id);
  const totalCommits = digest.areas.reduce((n, a) => n + (a.commits ?? 0), 0);

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Headline — full width, generous rhythm (no text-balance: it broke
          the line early and read as crumpled at drawer widths) */}
      <p className="mb-1.5 font-mono text-[9px] uppercase tracking-[0.2em] text-(--cm-atlas)">
        since {digest.since_date ? relTime(digest.since_date) : digest.since_commit.slice(0, 8)}
        {totalCommits > 0 && ` · ${totalCommits} commits`}
        {' · generated '}{relTime(digest.generated_at)}
      </p>
      <p className="mb-3.5 w-full text-[14.5px] font-medium leading-[1.55] text-(--cm-text)">
        {digest.headline}
      </p>

      <div className="flex min-h-0 flex-1 gap-8">
        {/* Per-area catch-up, debt-ordered */}
        <div className="min-w-0 flex-[2] space-y-3.5 overflow-y-auto pr-3">
          {ordered.map(entry => {
            const meta = areaMeta(entry.area);
            const debt = debtById.get(entry.area);
            const rarelyViewed = debt !== undefined && debt.commits >= 3 && debt.views === 0;
            return (
              <div key={entry.area} className="min-w-0">
                <button
                  onClick={() => onEnterArea(entry.area)}
                  className="flex items-center gap-1.5 font-mono text-[10.5px] text-(--cm-muted) transition-colors hover:text-(--cm-text)"
                  title={`Open ${meta?.name ?? entry.area}`}
                >
                  <span className="h-1.5 w-1.5 rounded-full" style={{ background: meta?.color ?? 'var(--cm-atlas)' }} />
                  <span className="font-semibold">{meta?.name ?? entry.area}</span>
                  {entry.commits !== undefined && <span className="text-(--cm-faint)">{entry.commits}c</span>}
                  {entry.files_changed !== undefined && <span className="text-(--cm-faint)">{entry.files_changed}f</span>}
                  {rarelyViewed && (
                    <span className="rounded bg-amber-500/15 px-1 py-px font-sans text-[8.5px] font-semibold uppercase tracking-[0.08em] text-amber-600 dark:text-amber-400">
                      rarely viewed
                    </span>
                  )}
                </button>
                <p className="mt-0.5 text-[12px] leading-relaxed text-(--cm-muted)">{entry.summary}</p>
              </div>
            );
          })}
        </div>

        {/* Notable jump targets */}
        {digest.notable && digest.notable.length > 0 && (
          <div className="w-[320px] min-w-0 flex-none overflow-y-auto">
            <p className="mb-1 font-mono text-[9px] uppercase tracking-[0.18em] text-(--cm-faint)">Worth a look</p>
            <div className="space-y-0.5">
              {digest.notable.map((n, i) => (
                <button
                  key={i}
                  onClick={() => onOpenFile(n.file, n.line)}
                  className="block w-full rounded px-1.5 py-1 text-left transition-colors hover:bg-(--cm-panel3)"
                  title={`${n.file}${n.line ? ':' + n.line : ''}`}
                >
                  <span className="block truncate font-mono text-[10.5px] text-(--cm-atlas)">
                    {n.file.split('/').slice(-2).join('/')}{n.line ? `:${n.line}` : ''}
                  </span>
                  <span className="block text-[10.5px] leading-snug text-(--cm-muted)">{n.note}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
