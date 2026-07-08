'use client';

/** Code Mode — git rail (Phase 1): working-tree status + entry to diff/log. */

import { useCallback, useEffect, useState } from 'react';
import type { BranchInfo, GitFileStatus, GitStatusResult, OpenTarget } from './types';

const STATUS_COLORS: Record<string, string> = {
  M: 'text-amber-500',
  A: 'text-emerald-500',
  D: 'text-red-500',
  R: 'text-sky-500',
  C: 'text-sky-500',
  '?': 'text-zinc-400',
};

interface GitRailProps {
  projectId: string;
  onShowDiff: (path?: string) => void;
  onShowLog: (path?: string) => void;
  onOpenFile: (target: OpenTarget) => void;
}

export function GitRail({ projectId, onShowDiff, onShowLog, onOpenFile }: GitRailProps) {
  const [status, setStatus] = useState<GitStatusResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [branchesOpen, setBranchesOpen] = useState(false);
  const [branches, setBranches] = useState<BranchInfo[] | null>(null);
  const [newBranch, setNewBranch] = useState('');
  const [branchBusy, setBranchBusy] = useState(false);
  const [branchError, setBranchError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/atlas/git?projectId=${encodeURIComponent(projectId)}&op=status`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setStatus(data);
      setError(null);
    } catch (e) {
      setError(String((e as Error).message ?? e));
    }
  }, [projectId]);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 15000);
    return () => clearInterval(t);
  }, [refresh]);

  const loadBranches = useCallback(async () => {
    try {
      const res = await fetch(`/api/atlas/git?projectId=${encodeURIComponent(projectId)}&op=branches`);
      const data = await res.json();
      if (res.ok) setBranches(data.branches);
    } catch { /* leave stale */ }
  }, [projectId]);

  const branchOp = useCallback(async (op: 'checkout' | 'create-branch', branch: string) => {
    if (branchBusy) return;
    setBranchBusy(true);
    setBranchError(null);
    try {
      const res = await fetch('/api/atlas/git', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, op, branch }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setNewBranch('');
      setBranchesOpen(false);
      await Promise.all([refresh(), loadBranches()]);
    } catch (e) {
      setBranchError(String((e as Error).message ?? e));
    } finally {
      setBranchBusy(false);
    }
  }, [projectId, branchBusy, refresh, loadBranches]);

  if (error) return <p className="p-3 font-mono text-[11px] text-(--cm-stale)">{error}</p>;
  if (!status) return <p className="p-3 font-mono text-[11px] text-(--cm-faint)">reading git…</p>;
  if (!status.isRepo) return <p className="p-3 font-mono text-[11px] text-(--cm-faint)">not a git repository</p>;

  const byCategory: Record<GitFileStatus['category'], GitFileStatus[]> = { staged: [], unstaged: [], untracked: [] };
  for (const f of status.files) byCategory[f.category].push(f);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-(--cm-line) px-2.5 py-2">
        <button
          onClick={() => {
            setBranchesOpen(o => !o);
            setBranchError(null);
            if (!branchesOpen) loadBranches();
          }}
          className="flex min-w-0 items-center gap-1 truncate font-mono text-[11.5px] font-semibold text-(--cm-text) hover:text-(--cm-atlas)"
          title="Switch or create a branch"
        >
          ⎇ {status.branch}
          <span className="text-[9px] text-(--cm-faint)">{branchesOpen ? '▴' : '▾'}</span>
        </button>
        <span className="ml-auto flex gap-1">
          <button onClick={() => onShowDiff(undefined)} className="rounded border border-(--cm-line) px-1.5 py-0.5 font-mono text-[10px] text-(--cm-muted) hover:border-(--cm-atlas) hover:text-(--cm-atlas)">
            diff all
          </button>
          <button onClick={() => onShowLog(undefined)} className="rounded border border-(--cm-line) px-1.5 py-0.5 font-mono text-[10px] text-(--cm-muted) hover:border-(--cm-atlas) hover:text-(--cm-atlas)">
            history
          </button>
        </span>
      </div>
      {/* Branch panel: switch / create */}
      {branchesOpen && (
        <div className="border-b border-(--cm-line) bg-(--cm-panel2) px-2 py-2">
          {branches === null ? (
            <p className="px-1 font-mono text-[11px] text-(--cm-faint)">loading branches…</p>
          ) : (
            <div className="max-h-44 overflow-y-auto">
              {branches.map(b => (
                <button
                  key={b.name}
                  disabled={b.current || branchBusy}
                  onClick={() => branchOp('checkout', b.name)}
                  className={`flex w-full items-center gap-1.5 rounded px-1.5 py-1 text-left font-mono text-[11px] ${
                    b.current ? 'text-(--cm-atlas)' : 'text-(--cm-muted) hover:bg-(--cm-panel3) hover:text-(--cm-text)'
                  } disabled:cursor-default`}
                  title={b.current ? 'Current branch' : `Switch to ${b.name}`}
                >
                  <span className="w-3 shrink-0">{b.current ? '●' : ''}</span>
                  <span className="truncate">{b.name}</span>
                </button>
              ))}
            </div>
          )}
          <form
            onSubmit={e => { e.preventDefault(); if (newBranch.trim()) branchOp('create-branch', newBranch.trim()); }}
            className="mt-1.5 flex gap-1.5"
          >
            <input
              value={newBranch}
              onChange={e => setNewBranch(e.target.value)}
              placeholder="new branch name…"
              spellCheck={false}
              className="min-w-0 flex-1 rounded border border-(--cm-line2) bg-(--cm-bg2) px-2 py-1 font-mono text-[11px] text-(--cm-text) placeholder-(--cm-faint) outline-none focus:border-(--cm-atlas)"
            />
            <button
              type="submit"
              disabled={!newBranch.trim() || branchBusy}
              className="shrink-0 rounded border border-(--cm-line2) px-2 py-1 font-mono text-[10px] text-(--cm-muted) enabled:hover:border-(--cm-atlas) enabled:hover:text-(--cm-atlas) disabled:opacity-40"
            >
              {branchBusy ? '…' : '+ create'}
            </button>
          </form>
          {branchError && (
            <p className="mt-1.5 rounded border border-(--cm-stale) bg-amber-500/8 px-2 py-1 font-mono text-[10px] leading-snug text-(--cm-stale)">
              {branchError}
            </p>
          )}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto px-1 py-1.5">
        {status.files.length === 0 && <p className="p-2 font-mono text-[11px] text-(--cm-faint)">working tree clean</p>}
        {(['staged', 'unstaged', 'untracked'] as const).map(cat =>
          byCategory[cat].length > 0 ? (
            <div key={cat} className="mb-1.5">
              <p className="px-2 pt-1 font-mono text-[9.5px] uppercase tracking-[0.15em] text-(--cm-faint)">
                {cat} ({byCategory[cat].length})
              </p>
              {byCategory[cat].map((f, i) => (
                <div key={`${f.path}-${i}`} className="group flex items-center gap-1.5 rounded px-2 py-0.5 hover:bg-(--cm-panel3)">
                  <span className={`w-3 shrink-0 text-center font-mono text-[11px] font-bold ${STATUS_COLORS[f.status] ?? 'text-(--cm-muted)'}`}>
                    {f.status}
                  </span>
                  <button
                    onClick={() => (f.category === 'untracked' ? onOpenFile({ path: f.path }) : onShowDiff(f.path))}
                    className="min-w-0 flex-1 truncate text-left font-mono text-[11px] text-(--cm-muted) group-hover:text-(--cm-text)"
                    title={f.category === 'untracked' ? 'Open file' : 'Show diff'}
                  >
                    {f.path}
                  </button>
                  <button
                    onClick={() => onOpenFile({ path: f.path })}
                    className="hidden shrink-0 rounded px-1 font-mono text-[10px] text-(--cm-faint) hover:text-(--cm-atlas) group-hover:inline"
                    title="Open in editor"
                  >
                    edit
                  </button>
                </div>
              ))}
            </div>
          ) : null,
        )}
      </div>
    </div>
  );
}
