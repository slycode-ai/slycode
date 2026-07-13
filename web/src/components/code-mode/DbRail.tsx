'use client';

/**
 * DB rail (feature 079) — the fifth left-rail tab. Lists discovered database
 * sources and their tables; clicking a table opens the DB schema scene
 * focused on it. Kept intentionally light — the scene carries the detail.
 */

import { useEffect, useState } from 'react';
import type { DbIntrospection } from './types';

interface DbRailProps {
  projectId: string;
  onOpenTable: (table?: string) => void;
}

export function DbRail({ projectId, onOpenTable }: DbRailProps) {
  const [data, setData] = useState<DbIntrospection | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/atlas/db?projectId=${encodeURIComponent(projectId)}`)
      .then(async r => {
        if (!r.ok) throw new Error((await r.json()).error ?? `HTTP ${r.status}`);
        return r.json();
      })
      .then(d => { if (!cancelled) setData(d.introspection); })
      .catch(e => { if (!cancelled) setError(String(e.message ?? e)); });
    return () => { cancelled = true; };
  }, [projectId]);

  if (error) return <p className="p-3 font-mono text-[11px] text-(--cm-stale)">{error}</p>;
  if (!data) return <p className="animate-pulse p-3 font-mono text-[11px] text-(--cm-faint)">introspecting…</p>;
  if (data.sources.length === 0) {
    return (
      <p className="p-3 font-mono text-[11px] leading-relaxed text-(--cm-faint)">
        No database sources — SQLite files, schema.prisma, or CREATE TABLE .sql files would show here.
      </p>
    );
  }

  return (
    <div className="p-2">
      <button
        onClick={() => onOpenTable(undefined)}
        className="mb-2 w-full rounded-md border border-(--cm-line2) px-2 py-1 font-mono text-[10px] uppercase tracking-[0.08em] text-(--cm-muted) transition-all hover:border-(--cm-atlas) hover:text-(--cm-atlas)"
      >
        Open schema view
      </button>
      {data.sources.map(src => (
        <div key={src.path} className="mb-2.5">
          <p className="truncate px-1 font-mono text-[9.5px] uppercase tracking-[0.1em] text-(--cm-faint)" title={src.path}>
            {src.kind} · {src.path.split('/').pop()}
          </p>
          {src.error && <p className="px-1 font-mono text-[10px] text-(--cm-stale)">{src.error}</p>}
          {src.tables.map(t => (
            <button
              key={t.name}
              onClick={() => onOpenTable(t.name)}
              className="block w-full truncate rounded px-1.5 py-0.5 text-left font-mono text-[11px] text-(--cm-muted) transition-colors hover:bg-(--cm-panel3) hover:text-(--cm-text)"
              title={`${t.name} — ${t.columns.length} columns`}
            >
              {t.name}
              <span className="ml-1.5 text-[9.5px] text-(--cm-faint)">{t.columns.length}</span>
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}
