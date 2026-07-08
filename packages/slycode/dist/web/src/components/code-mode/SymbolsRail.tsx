'use client';

/**
 * Code Mode — symbols rail (Phase 1). The deterministic jump-to-definition
 * surface: live-filtered list from the tree-sitter index (NO LSP).
 */

import { useEffect, useRef, useState } from 'react';
import type { CodeSymbol, OpenTarget, SymbolKind } from './types';

const KIND_STYLES: Record<SymbolKind, string> = {
  fn: 'bg-sky-400/15 text-sky-500 dark:text-sky-300',
  method: 'bg-sky-400/10 text-sky-600 dark:text-sky-400',
  class: 'bg-amber-400/15 text-amber-600 dark:text-amber-300',
  interface: 'bg-violet-400/15 text-violet-600 dark:text-violet-300',
  type: 'bg-violet-400/10 text-violet-500 dark:text-violet-400',
  enum: 'bg-emerald-400/15 text-emerald-600 dark:text-emerald-300',
  const: 'bg-zinc-400/15 text-zinc-500 dark:text-zinc-300',
};

interface SymbolsRailProps {
  projectId: string;
  onOpenFile: (target: OpenTarget) => void;
}

export function SymbolsRail({ projectId, onOpenFile }: SymbolsRailProps) {
  const [q, setQ] = useState('');
  const [symbols, setSymbols] = useState<CodeSymbol[] | null>(null);
  const [status, setStatus] = useState<'indexing' | 'ready' | 'error'>('indexing');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const controller = new AbortController();
    debounceRef.current = setTimeout(async () => {
      try {
        const params = new URLSearchParams({ projectId, limit: '150' });
        if (q.trim()) params.set('q', q.trim());
        const res = await fetch(`/api/atlas/symbols?${params}`, { signal: controller.signal });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        setSymbols(data.symbols);
        setStatus('ready');
      } catch (e) {
        if ((e as Error).name !== 'AbortError') setStatus('error');
      }
    }, q ? 200 : 0);
    return () => {
      controller.abort();
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [projectId, q]);

  return (
    <div className="flex h-full flex-col">
      <input
        value={q}
        onChange={e => setQ(e.target.value)}
        placeholder="Jump to symbol…"
        className="m-1.5 rounded-md border border-(--cm-line2) bg-(--cm-bg2) px-2.5 py-1.5 font-mono text-[12px] text-(--cm-text) placeholder-(--cm-faint) outline-none focus:border-(--cm-atlas)"
      />
      <div className="min-h-0 flex-1 overflow-y-auto px-1 pb-2">
        {status === 'indexing' && !symbols && (
          <p className="p-2 font-mono text-[11px] text-(--cm-faint)">indexing… (first pass parses the project)</p>
        )}
        {status === 'error' && <p className="p-2 font-mono text-[11px] text-(--cm-stale)">symbol index unavailable</p>}
        {symbols?.map((s, i) => (
          <button
            key={`${s.file}:${s.line}:${s.name}:${i}`}
            onClick={() => onOpenFile({ path: s.file, line: s.line })}
            className="flex w-full items-center gap-2 rounded px-2 py-1 text-left font-mono text-[12px] text-(--cm-muted) hover:bg-(--cm-panel3) hover:text-(--cm-text)"
            title={`${s.file}:${s.line}`}
          >
            <span className={`rounded px-1 py-px font-sans text-[9px] font-semibold uppercase tracking-wide ${KIND_STYLES[s.kind]}`}>
              {s.kind}
            </span>
            <span className="truncate">
              {s.container ? <span className="text-(--cm-faint)">{s.container}.</span> : null}
              {s.name}
            </span>
            <span className="ml-auto shrink-0 text-[9.5px] text-(--cm-faint)">{s.line}</span>
          </button>
        ))}
        {symbols && symbols.length === 0 && (
          <p className="p-2 font-mono text-[11px] text-(--cm-faint)">no symbols match</p>
        )}
      </div>
    </div>
  );
}
