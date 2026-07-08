'use client';

/**
 * Code Mode — diff scene. Reuses the shared DiffLineView renderer.
 *
 * Single-file mode shows that file's patch. Whole-tree mode ("diff all")
 * splits the patch into PER-FILE sections — collapsible cards with their own
 * +/- stats and an open-in-editor action — instead of one confusing
 * concatenated wall (Greg's testing feedback).
 */

import { useEffect, useMemo, useState } from 'react';
import { parseDiffLines, diffStats, DiffLineRows, type DiffLine } from '../DiffLineView';
import type { OpenTarget } from './types';

interface DiffViewProps {
  projectId: string;
  /** repo-relative file, or undefined for the whole working tree */
  path?: string;
  /** show ONE commit's changes instead of the working tree */
  commit?: { hash: string; subject?: string };
  onOpenFile: (target: OpenTarget) => void;
}

interface FileDiff {
  path: string;
  lines: DiffLine[];
  additions: number;
  deletions: number;
}

/** Split a multi-file unified diff on `diff --git` boundaries. */
function splitByFile(raw: string): FileDiff[] {
  const chunks = raw.split(/^(?=diff --git )/m).filter(c => c.trim().length > 0);
  return chunks.map(chunk => {
    const header = chunk.match(/^diff --git a\/(.+?) b\/(.+)$/m);
    const plusLine = chunk.match(/^\+\+\+ b\/(.+)$/m);
    const filePath = plusLine?.[1] ?? header?.[2] ?? 'unknown';
    const lines = parseDiffLines(chunk);
    const stats = diffStats(lines);
    return { path: filePath, lines, additions: stats.additions, deletions: stats.deletions };
  });
}

export function DiffView({ projectId, path, commit, onOpenFile }: DiffViewProps) {
  const [diff, setDiff] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());

  // Reset to the loading state when the target changes (derive-from-props
  // pattern — no setState-in-effect).
  const targetKey = `${path ?? ''}|${commit?.hash ?? ''}`;
  const [prevTarget, setPrevTarget] = useState(targetKey);
  if (targetKey !== prevTarget) {
    setPrevTarget(targetKey);
    setDiff(null);
    setError(null);
  }

  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams({ projectId, op: commit ? 'show' : 'diff' });
    if (commit) params.set('ref', commit.hash);
    if (path) params.set('path', path);
    fetch(`/api/atlas/git?${params}`)
      .then(async r => {
        const data = await r.json();
        if (!r.ok) throw new Error(data.error ?? `HTTP ${r.status}`);
        return data.diff as string;
      })
      .then(d => { if (!cancelled) setDiff(d); })
      .catch(e => { if (!cancelled) setError(String(e.message ?? e)); });
    return () => { cancelled = true; };
    // commit is keyed by hash — the object identity churns per render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, path, commit?.hash]);

  const files = useMemo(() => (diff ? splitByFile(diff) : []), [diff]);
  const totals = useMemo(
    () => files.reduce((acc, f) => ({ add: acc.add + f.additions, del: acc.del + f.deletions }), { add: 0, del: 0 }),
    [files],
  );

  if (error) return <p className="p-4 font-mono text-[12px] text-(--cm-stale)">{error}</p>;
  if (diff === null) return <p className="p-4 font-mono text-[12px] text-(--cm-faint)">computing diff…</p>;
  if (files.length === 0) {
    return <p className="p-4 font-mono text-[12px] text-(--cm-faint)">{commit ? 'empty commit' : 'no uncommitted changes'}</p>;
  }

  const toggle = (p: string) =>
    setCollapsed(prev => {
      const next = new Set(prev);
      if (next.has(p)) next.delete(p);
      else next.add(p);
      return next;
    });

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3 border-b border-(--cm-line) bg-(--cm-panel) px-3 py-1.5 font-mono text-[11.5px]">
        <span className="truncate text-(--cm-text)">
          {commit ? (
            <>
              <span className="text-(--cm-atlas)">{commit.hash.slice(0, 8)}</span>
              {commit.subject ? ` ${commit.subject}` : ''}
            </>
          ) : (
            `${path ?? 'working tree'} · uncommitted changes`
          )}
          {!path && <span className="text-(--cm-muted)"> · {files.length} file{files.length === 1 ? '' : 's'}</span>}
        </span>
        <span className="text-emerald-500">+{totals.add}</span>
        <span className="text-red-500">−{totals.del}</span>
        {!path && files.length > 1 && (
          <button
            onClick={() => setCollapsed(collapsed.size === files.length ? new Set() : new Set(files.map(f => f.path)))}
            className="ml-auto rounded border border-(--cm-line) px-2 py-0.5 text-[10px] text-(--cm-muted) hover:border-(--cm-atlas) hover:text-(--cm-atlas)"
          >
            {collapsed.size === files.length ? 'expand all' : 'collapse all'}
          </button>
        )}
        {path && (
          <button
            onClick={() => onOpenFile({ path })}
            className="ml-auto rounded border border-(--cm-line) px-2 py-0.5 text-[10px] text-(--cm-muted) hover:border-(--cm-atlas) hover:text-(--cm-atlas)"
          >
            Open in editor
          </button>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-auto bg-(--cm-code-bg) p-2">
        {files.map(f => {
          const isCollapsed = !path && collapsed.has(f.path);
          return (
            <div key={f.path} className="mb-2 overflow-hidden rounded-md border border-(--cm-line)">
              {/* Per-file header (skip the extra chrome in single-file mode) */}
              {!path && (
                <div className="flex items-center gap-2 border-b border-(--cm-line) bg-(--cm-panel) px-2.5 py-1.5 font-mono text-[11px]">
                  <button
                    onClick={() => toggle(f.path)}
                    className="flex min-w-0 flex-1 items-center gap-1.5 text-left text-(--cm-text) hover:text-(--cm-atlas)"
                    title={isCollapsed ? 'Expand' : 'Collapse'}
                  >
                    <span className="text-(--cm-faint)">{isCollapsed ? '▸' : '▾'}</span>
                    <span className="truncate">{f.path}</span>
                  </button>
                  <span className="shrink-0 text-emerald-500">+{f.additions}</span>
                  <span className="shrink-0 text-red-500">−{f.deletions}</span>
                  <button
                    onClick={() => onOpenFile({ path: f.path })}
                    className="shrink-0 rounded border border-(--cm-line) px-1.5 py-px text-[9.5px] text-(--cm-muted) hover:border-(--cm-atlas) hover:text-(--cm-atlas)"
                  >
                    edit
                  </button>
                </div>
              )}
              {!isCollapsed && (
                <div className="overflow-x-auto p-1">
                  <DiffLineRows lines={f.lines} />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
