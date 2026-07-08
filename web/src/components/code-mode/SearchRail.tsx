'use client';

/** Code Mode — ripgrep-backed search rail (Phase 1). Enter to search. */

import { useState } from 'react';
import type { OpenTarget, SearchMatch } from './types';

interface SearchRailProps {
  projectId: string;
  onOpenFile: (target: OpenTarget) => void;
}

export function SearchRail({ projectId, onOpenFile }: SearchRailProps) {
  const [q, setQ] = useState('');
  const [matches, setMatches] = useState<SearchMatch[] | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    const query = q.trim();
    if (query.length < 2 || busy) return;
    setBusy(true);
    setError(null);
    try {
      const params = new URLSearchParams({ projectId, q: query, max: '200' });
      const res = await fetch(`/api/atlas/search?${params}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setMatches(data.matches);
      setTruncated(!!data.truncated);
    } catch (e) {
      setError(String((e as Error).message ?? e));
      setMatches(null);
    } finally {
      setBusy(false);
    }
  };

  // Group by file for scannability
  const groups = new Map<string, SearchMatch[]>();
  for (const m of matches ?? []) {
    const g = groups.get(m.file);
    if (g) g.push(m);
    else groups.set(m.file, [m]);
  }

  return (
    <div className="flex h-full flex-col">
      <input
        value={q}
        onChange={e => setQ(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') run(); }}
        placeholder="Search code… (Enter)"
        className="m-1.5 rounded-md border border-(--cm-line2) bg-(--cm-bg2) px-2.5 py-1.5 font-mono text-[12px] text-(--cm-text) placeholder-(--cm-faint) outline-none focus:border-(--cm-atlas)"
      />
      <div className="min-h-0 flex-1 overflow-y-auto px-1 pb-2">
        {busy && <p className="p-2 font-mono text-[11px] text-(--cm-faint)">searching…</p>}
        {error && <p className="p-2 font-mono text-[11px] text-(--cm-stale)">{error}</p>}
        {matches && matches.length === 0 && !busy && (
          <p className="p-2 font-mono text-[11px] text-(--cm-faint)">no matches</p>
        )}
        {[...groups.entries()].map(([file, fileMatches]) => (
          <div key={file} className="mb-1.5">
            <p className="truncate px-2 pt-1 font-mono text-[10.5px] font-semibold text-(--cm-text)" title={file}>
              {file} <span className="font-normal text-(--cm-faint)">({fileMatches.length})</span>
            </p>
            {fileMatches.map((m, i) => (
              <button
                key={`${m.line}-${i}`}
                onClick={() => onOpenFile({ path: m.file, line: m.line })}
                className="flex w-full gap-2 rounded px-2 py-0.5 text-left font-mono text-[11px] text-(--cm-muted) hover:bg-(--cm-panel3) hover:text-(--cm-text)"
              >
                <span className="shrink-0 text-(--cm-faint)">{m.line}</span>
                <span className="truncate">{highlight(m)}</span>
              </button>
            ))}
          </div>
        ))}
        {truncated && (
          <p className="p-2 font-mono text-[10.5px] text-(--cm-stale)">result cap hit — refine the query</p>
        )}
      </div>
    </div>
  );
}

function highlight(m: SearchMatch) {
  const text = m.text;
  if (m.spans.length === 0) return text;
  const parts: React.ReactNode[] = [];
  let cursor = 0;
  m.spans.forEach(([start, end], i) => {
    if (start > cursor) parts.push(text.slice(cursor, start));
    parts.push(
      <mark key={i} className="rounded-sm bg-(--cm-atlas-dim) px-px text-(--cm-atlas)">
        {text.slice(start, end)}
      </mark>,
    );
    cursor = Math.max(cursor, end);
  });
  if (cursor < text.length) parts.push(text.slice(cursor));
  return parts;
}
