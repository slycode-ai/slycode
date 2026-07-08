'use client';

/** Code Mode — commit history scene (Phase 1). */

import { useEffect, useState } from 'react';
import type { GitLogEntry } from './types';

interface LogViewProps {
  projectId: string;
  /** repo-relative file (follows renames), or undefined for project history */
  path?: string;
  onShowCommit: (hash: string, subject: string) => void;
}

export function LogView({ projectId, path, onShowCommit }: LogViewProps) {
  const [entries, setEntries] = useState<GitLogEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams({ projectId, op: 'log' });
    if (path) params.set('path', path);
    fetch(`/api/atlas/git?${params}`)
      .then(async r => {
        const data = await r.json();
        if (!r.ok) throw new Error(data.error ?? `HTTP ${r.status}`);
        return data.entries as GitLogEntry[];
      })
      .then(d => { if (!cancelled) setEntries(d); })
      .catch(e => { if (!cancelled) setError(String(e.message ?? e)); });
    return () => { cancelled = true; };
  }, [projectId, path]);

  if (error) return <p className="p-4 font-mono text-[12px] text-(--cm-stale)">{error}</p>;
  if (!entries) return <p className="p-4 font-mono text-[12px] text-(--cm-faint)">loading history…</p>;

  return (
    <div className="h-full overflow-y-auto p-4">
      <p className="mb-3 font-mono text-[10px] uppercase tracking-[0.22em] text-(--cm-faint)">
        History · {path ?? 'project'} · last {entries.length} commits
      </p>
      <div className="max-w-3xl">
        {entries.map(e => (
          <button
            key={e.hash}
            onClick={() => onShowCommit(e.hash, e.subject)}
            title="Show what this commit changed"
            className="flex w-full items-baseline gap-3 border-b border-(--cm-line) py-1.5 text-left font-mono text-[12px] transition-colors hover:bg-(--cm-panel3)"
          >
            <span className="shrink-0 text-(--cm-atlas)">{e.shortHash}</span>
            <span className="min-w-0 flex-1 truncate text-(--cm-text)" title={e.subject}>{e.subject}</span>
            <span className="hidden shrink-0 text-[10.5px] text-(--cm-muted) sm:inline">{e.author}</span>
            <span className="shrink-0 text-[10.5px] text-(--cm-faint)">
              {new Date(e.date).toLocaleDateString()}
            </span>
          </button>
        ))}
        {entries.length === 0 && <p className="font-mono text-[12px] text-(--cm-faint)">no commits</p>}
      </div>
    </div>
  );
}
