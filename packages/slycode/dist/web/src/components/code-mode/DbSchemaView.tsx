'use client';

/**
 * DB schema view (feature 079) — deterministic schema introspection rendered
 * as a table-card grid, annotated by the AI db.json artifact.
 *
 * Relationships render two ways, both deterministic and reflow-proof:
 * on-card FK chips (click → scroll to + flash the referenced table) and a
 * relations strip (introspected FKs ∪ AI-annotated relations). No SVG edge
 * routing over a responsive grid — comprehension without fragility.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { DbAnnotations, DbIntrospection, DbSource, DbTable } from './types';

interface DbSchemaViewProps {
  projectId: string;
  focusTable?: string;
}

const KIND_LABEL: Record<DbSource['kind'], string> = {
  sqlite: 'SQLite',
  prisma: 'Prisma',
  sql: 'SQL DDL',
};

export function DbSchemaView({ projectId, focusTable }: DbSchemaViewProps) {
  const [data, setData] = useState<{ introspection: DbIntrospection; annotations: DbAnnotations | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/atlas/db?projectId=${encodeURIComponent(projectId)}`)
      .then(async r => {
        if (!r.ok) throw new Error((await r.json()).error ?? `HTTP ${r.status}`);
        return r.json();
      })
      .then(d => { if (!cancelled) setData(d); })
      .catch(e => { if (!cancelled) setError(String(e.message ?? e)); });
    return () => { cancelled = true; };
  }, [projectId]);

  const flashTable = useCallback((name: string) => {
    const el = containerRef.current?.querySelector<HTMLElement>(`[data-db-table="${CSS.escape(name)}"]`);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.classList.remove('db-flash');
    // restart the animation
    void el.offsetWidth;
    el.classList.add('db-flash');
  }, []);

  useEffect(() => {
    if (focusTable && data) {
      const t = setTimeout(() => flashTable(focusTable), 150);
      return () => clearTimeout(t);
    }
  }, [focusTable, data, flashTable]);

  if (error) {
    return <CenterNote title="DB schema" note={error} />;
  }
  if (!data) {
    return <CenterNote title="DB schema" note="introspecting…" pulse />;
  }
  const { introspection, annotations } = data;
  if (introspection.sources.length === 0) {
    return (
      <CenterNote
        title="DB schema"
        note="No database sources detected — SQLite files, schema.prisma, or .sql files with CREATE TABLE statements would appear here."
      />
    );
  }

  return (
    <div ref={containerRef} className="h-full overflow-y-auto p-6">
      <div className="mx-auto max-w-[1100px]">
        <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-(--cm-faint)">Database schema</p>
        <h1 className="mb-1 text-lg font-semibold text-(--cm-text)">
          Tables & relationships
          <span className="ml-3 font-mono text-[11px] font-normal text-(--cm-muted)">
            {introspection.sources.length} source{introspection.sources.length === 1 ? '' : 's'}
          </span>
        </h1>
        {annotations?.summary && (
          <div className="mb-4 max-w-[760px] text-[12.5px] leading-relaxed text-(--cm-muted)">
            {annotations.summary.split(/\n{2,}/).map((p, i) => <p key={i} className="mb-2 last:mb-0">{p}</p>)}
          </div>
        )}
        {!annotations && (
          <p className="mb-4 font-mono text-[10.5px] text-(--cm-faint)">
            structure is live introspection — AI annotations arrive with the next atlas refresh
          </p>
        )}

        {introspection.sources.map(src => (
          <section key={src.path} className="mb-7">
            <h2 className="mb-2.5 flex items-baseline gap-2 font-mono text-[11px] text-(--cm-muted)">
              <span className="rounded bg-(--cm-panel3) px-1.5 py-px text-[9px] font-semibold uppercase tracking-[0.1em] text-(--cm-atlas)">
                {KIND_LABEL[src.kind]}
              </span>
              {src.path}
              {src.error && <span className="text-(--cm-stale)">— {src.error}</span>}
            </h2>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {src.tables.map(table => (
                <TableCard
                  key={table.name}
                  table={table}
                  annotation={annotations?.tables?.[table.name]}
                  onJump={flashTable}
                />
              ))}
            </div>
          </section>
        ))}

        <RelationsStrip introspection={introspection} annotations={annotations} onJump={flashTable} />
      </div>
    </div>
  );
}

function TableCard({ table, annotation, onJump }: {
  table: DbTable;
  annotation?: { summary?: string; columns?: Record<string, string> };
  onJump: (table: string) => void;
}) {
  return (
    <div
      data-db-table={table.name}
      className="cm-card rounded-[10px] border border-(--cm-line2) bg-(--cm-panel2) p-3 shadow-[inset_3px_0_0_var(--cm-atlas)]"
    >
      <h3 className="font-mono text-[12.5px] font-semibold text-(--cm-text)">{table.name}</h3>
      {annotation?.summary && (
        <p className="mt-1 text-[11px] leading-snug text-(--cm-muted)">{annotation.summary}</p>
      )}
      <div className="mt-2 space-y-px">
        {table.columns.map(col => {
          const fk = table.fks.find(f => f.column === col.name);
          const note = annotation?.columns?.[col.name];
          return (
            <div key={col.name} className="flex items-baseline gap-1.5 font-mono text-[10.5px]" title={note}>
              <span className={col.pk ? 'text-(--cm-atlas)' : 'text-(--cm-muted)'}>
                {col.pk ? '●' : '·'} {col.name}
              </span>
              <span className="text-(--cm-faint)">{col.type}{col.nullable ? '?' : ''}</span>
              {fk && (
                <button
                  onClick={() => onJump(fk.refTable)}
                  title={`references ${fk.refTable}${fk.refColumn ? '.' + fk.refColumn : ''}`}
                  className="ml-auto rounded bg-(--cm-atlas-dim) px-1 py-px text-[9px] text-(--cm-atlas) transition-all hover:brightness-125"
                >
                  → {fk.refTable}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function RelationsStrip({ introspection, annotations, onJump }: {
  introspection: DbIntrospection;
  annotations: DbAnnotations | null;
  onJump: (table: string) => void;
}) {
  // Introspected FKs ∪ AI-annotated relations (AI labels win when both exist).
  const rows = new Map<string, { from: string; to: string; label?: string }>();
  for (const src of introspection.sources) {
    for (const t of src.tables) {
      for (const fk of t.fks) {
        rows.set(`${t.name}→${fk.refTable}`, { from: t.name, to: fk.refTable, label: `${fk.column}${fk.refColumn ? ' → ' + fk.refColumn : ''}` });
      }
    }
  }
  for (const r of annotations?.relations ?? []) {
    rows.set(`${r.from}→${r.to}`, { from: r.from, to: r.to, label: r.label ?? rows.get(`${r.from}→${r.to}`)?.label });
  }
  if (rows.size === 0) return null;
  return (
    <section className="mt-2 border-t border-(--cm-line) pt-3">
      <p className="mb-1.5 font-mono text-[9px] uppercase tracking-[0.18em] text-(--cm-faint)">Relationships</p>
      <div className="space-y-1">
        {[...rows.values()].map((r, i) => (
          <div key={i} className="font-mono text-[11px] leading-snug">
            <button onClick={() => onJump(r.from)} className="font-semibold text-(--cm-atlas) hover:underline">{r.from}</button>
            <span className="text-(--cm-faint)"> → </span>
            <button onClick={() => onJump(r.to)} className="font-semibold text-(--cm-atlas) hover:underline">{r.to}</button>
            {r.label && <span className="text-(--cm-muted)"> — {r.label}</span>}
          </div>
        ))}
      </div>
    </section>
  );
}

function CenterNote({ title, note, pulse }: { title: string; note: string; pulse?: boolean }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
      <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-(--cm-faint)">{title}</p>
      <p className={`max-w-md font-mono text-[12px] text-(--cm-muted) ${pulse ? 'animate-pulse' : ''}`}>{note}</p>
    </div>
  );
}
