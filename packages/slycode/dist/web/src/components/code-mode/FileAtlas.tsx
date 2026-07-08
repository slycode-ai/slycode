'use client';

/**
 * File atlas — L3 zoom (feature 076, Phase 2). A big file's symbols as cards:
 * deterministic list from the tree-sitter index, one-liners from the area
 * node's symbol_summaries. Clicking a symbol opens the editor AT that symbol.
 */

import { useEffect, useState } from 'react';
import type { AtlasSnapshot, CodeSymbol } from './types';

interface FileAtlasProps {
  projectId: string;
  path: string;
  areaId?: string;
  snapshot: AtlasSnapshot | null;
  onOpenAt: (path: string, line: number) => void;
}

const KIND_ORDER: Record<string, number> = { class: 0, interface: 1, enum: 2, type: 3, fn: 4, method: 5, const: 6 };

export function FileAtlas({ projectId, path, areaId, snapshot, onOpenAt }: FileAtlasProps) {
  const [symbols, setSymbols] = useState<CodeSymbol[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams({ projectId, path, limit: '400' });
    fetch(`/api/atlas/symbols?${params}`)
      .then(async r => {
        const data = await r.json();
        if (!r.ok) throw new Error(data.error ?? `HTTP ${r.status}`);
        return data.symbols as CodeSymbol[];
      })
      .then(d => { if (!cancelled) setSymbols(d); })
      .catch(e => { if (!cancelled) setError(String(e.message ?? e)); });
    return () => { cancelled = true; };
  }, [projectId, path]);

  // AI one-liners for this file, from whichever area node describes it.
  const summaries: Record<string, string> =
    (areaId ? snapshot?.nodes[areaId]?.symbol_summaries?.[path] : undefined) ??
    findSummariesAnywhere(snapshot, path) ?? {};

  if (error) return <p className="p-6 font-mono text-[12px] text-(--cm-stale)">{error}</p>;
  if (!symbols) return <p className="p-6 font-mono text-[12px] text-(--cm-faint)">reading symbols…</p>;

  const sorted = [...symbols].sort(
    (a, b) => (KIND_ORDER[a.kind] ?? 9) - (KIND_ORDER[b.kind] ?? 9) || a.line - b.line,
  );

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="mx-auto max-w-[1100px]">
        <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-(--cm-faint)">Codebase Atlas · file atlas</p>
        <h1 className="mb-5 text-balance text-lg font-semibold text-(--cm-text)">
          {path.split('/').pop()}
          <span className="ml-3 font-mono text-[11px] font-normal text-(--cm-muted)">{path} · {symbols.length} symbols</span>
          <button
            onClick={() => onOpenAt(path, 1)}
            className="ml-4 rounded border border-(--cm-line2) px-2 py-0.5 align-middle font-mono text-[10px] text-(--cm-muted) hover:border-(--cm-atlas) hover:text-(--cm-atlas)"
          >
            Open whole file
          </button>
        </h1>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {sorted.map((s, i) => (
            <button
              key={`${s.name}:${s.line}:${i}`}
              onClick={() => onOpenAt(path, s.line)}
              className="cm-card rounded-[9px] border border-(--cm-line2) bg-(--cm-panel2) p-3 text-left transition-all hover:-translate-y-0.5 hover:border-(--cm-atlas)"
            >
              <h4 className="flex items-baseline gap-2 font-mono text-[12.5px] font-bold text-(--cm-text)">
                <span className="rounded bg-(--cm-atlas-dim) px-1 py-px font-sans text-[9px] font-semibold uppercase tracking-wide text-(--cm-atlas)">
                  {s.kind}
                </span>
                <span className="truncate">
                  {s.container ? <span className="font-normal text-(--cm-faint)">{s.container}.</span> : null}
                  {s.name}
                </span>
                <span className="ml-auto shrink-0 text-[9.5px] font-normal text-(--cm-faint)">:{s.line}</span>
              </h4>
              <p className="mt-1.5 text-[11.5px] leading-relaxed text-(--cm-muted)">
                {summaries[s.name] ?? <span className="text-(--cm-faint) italic">no AI summary yet — the coverage crawl fills these in over successive refreshes</span>}
              </p>
            </button>
          ))}
        </div>
        {symbols.length === 0 && (
          <p className="text-[13px] text-(--cm-muted)">No symbols found — this file type may not be indexed. Opening the editor instead is a click away above.</p>
        )}
      </div>
    </div>
  );
}

function findSummariesAnywhere(snapshot: AtlasSnapshot | null, path: string): Record<string, string> | undefined {
  if (!snapshot) return undefined;
  for (const node of Object.values(snapshot.nodes)) {
    const hit = node.symbol_summaries?.[path];
    if (hit) return hit;
  }
  return undefined;
}
