'use client';

/**
 * DeployReviewModal (feature 084) — the shared review-then-apply step for
 * every store→project deploy batch.
 *
 * Both the CLI Assets matrix (Apply Changes) and the Updates push-to-projects
 * flow open this modal instead of writing immediately. It fetches a read-only
 * plan from POST /api/cli-assets/sync/plan and renders, per skill × project ×
 * provider, a file ledger of actual fates computed against the target's real
 * on-disk state:
 *
 *   overwrite — SKILL.md / `updatable:`-declared file will be replaced
 *   new       — file missing at the target, will be created (seed)
 *   unchanged — updatable file already identical, copy is a no-op
 *   kept      — project-owned file (not in the updatable list), never touched
 *
 * Targets whose plan changes nothing collapse to "won't be changed — already
 * up to date". Targets whose project copy is NEWER than the store start
 * EXCLUDED and need an explicit include (sent with overwriteNewer: true) —
 * this absorbs the old PushOverwriteWarning contract. Whole rows can be
 * dropped before applying; there are deliberately no per-file checkboxes.
 *
 * The modal never posts to sync itself: onConfirm receives the surviving
 * changes and the caller owns the write + refresh.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { getProviderColor } from '@/lib/provider-colors';
import type { DeployPlanFile, DeployTargetPlan, PendingChange } from '@/lib/types';
import Tooltip from './Tooltip';

interface Props {
  title: string;
  subtitle?: string;
  changes: PendingChange[];
  onConfirm: (changes: PendingChange[]) => Promise<void>;
  onClose: () => void;
}

/** Stable identity for a queued change within this batch. */
function changeKey(c: PendingChange): string {
  return `${c.action}:${c.assetType}:${c.assetName}:${c.projectId}:${c.provider ?? ''}`;
}

const FATE_BADGE: Record<DeployPlanFile['fate'], { label: string; cls: string; title?: string }> = {
  overwrite: {
    label: 'overwrite',
    cls: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
    title: 'Store-owned file (SKILL.md or updatable) — the project copy will be replaced',
  },
  seed: {
    label: 'new',
    cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
    title: 'Missing at the target — will be created',
  },
  unchanged: {
    label: 'unchanged',
    cls: 'bg-surface-2 text-ink-3',
    title: 'Already identical — copying changes nothing',
  },
  keep: {
    label: 'kept',
    cls: 'bg-surface-2 text-ink-3',
    title: "Not in the skill's updatable list — the project's existing copy is never overwritten",
  },
  skipped: {
    label: 'skipped',
    cls: 'bg-surface-2 text-ink-3',
    title: 'Symlinked source entry — the copy refuses it',
  },
};

function summarize(files: DeployPlanFile[]): string {
  const counts: Record<string, number> = {};
  for (const f of files) counts[f.fate] = (counts[f.fate] ?? 0) + 1;
  const parts: string[] = [];
  if (counts.overwrite) parts.push(`${counts.overwrite} overwrite`);
  if (counts.seed) parts.push(`${counts.seed} new`);
  if (counts.unchanged) parts.push(`${counts.unchanged} unchanged`);
  if (counts.keep) parts.push(`${counts.keep} kept`);
  if (counts.skipped) parts.push(`${counts.skipped} skipped`);
  return parts.join(' · ');
}

export function DeployReviewModal({ title, subtitle, changes, onConfirm, onClose }: Props) {
  const [targets, setTargets] = useState<DeployTargetPlan[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [applying, setApplying] = useState(false);
  const [reloadNonce, setReloadNonce] = useState(0);

  // Fetch the read-only plan
  useEffect(() => {
    let cancelled = false;
    setTargets(null);
    setLoadError(null);
    fetch('/api/cli-assets/sync/plan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ changes }),
    })
      .then(async res => {
        if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? `Plan request failed (${res.status})`);
        return res.json();
      })
      .then(data => {
        if (cancelled) return;
        const t: DeployTargetPlan[] = data.targets ?? [];
        setTargets(t);
        // Newer-copy conflicts and errored targets start excluded
        setExcluded(new Set(
          t.filter(x => x.conflict || x.error).map(x => changeKey(x.change)),
        ));
      })
      .catch(e => { if (!cancelled) setLoadError(String(e?.message ?? e)); });
    return () => { cancelled = true; };
  }, [changes, reloadNonce]);

  // Escape closes (cancel — nothing has been written)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const toggleExcluded = useCallback((key: string) => {
    setExcluded(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }, []);

  // Surviving changes: not excluded, not errored; conflict rows the user
  // included carry explicit overwriteNewer consent.
  const surviving = useMemo(() => {
    if (!targets) return [];
    const out: PendingChange[] = [];
    for (const t of targets) {
      if (t.error) continue;
      if (excluded.has(changeKey(t.change))) continue;
      out.push(t.conflict ? { ...t.change, overwriteNewer: true } : t.change);
    }
    return out;
  }, [targets, excluded]);

  // Group targets by asset for display
  const groups = useMemo(() => {
    if (!targets) return [];
    const map = new Map<string, DeployTargetPlan[]>();
    for (const t of targets) {
      const key = `${t.change.assetType}:${t.change.assetName}:${t.change.action}`;
      const list = map.get(key) ?? [];
      list.push(t);
      map.set(key, list);
    }
    return [...map.values()];
  }, [targets]);

  const handleApply = async () => {
    if (surviving.length === 0 || applying) return;
    setApplying(true);
    try {
      await onConfirm(surviving);
    } finally {
      setApplying(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="flex max-h-[88vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-line bg-surface-1 shadow-(--shadow-overlay)">
        {/* Header */}
        <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-accent">
              <svg className="h-5 w-5 text-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6M9 8h6M5 20h14a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v14a1 1 0 001 1z" />
              </svg>
            </div>
            <div>
              <h3 className="text-lg font-semibold text-ink-1">{title}</h3>
              <p className="text-sm text-ink-3">
                {subtitle ?? 'Nothing is written until you apply. Kept files are never overwritten.'}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded p-1 text-ink-3 hover:bg-surface-3 hover:text-ink-2"
            aria-label="Close"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {loadError ? (
            <div className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-500/40 dark:bg-red-900/20 dark:text-red-300">
              Couldn&apos;t compute the deploy plan: {loadError}
              <button
                onClick={() => setReloadNonce(n => n + 1)}
                className="ml-3 rounded border border-red-300 px-2 py-0.5 text-xs font-medium hover:bg-red-100 dark:border-red-500/40 dark:hover:bg-red-900/40"
              >
                Retry
              </button>
            </div>
          ) : !targets ? (
            /* Loading skeleton */
            <div className="space-y-3" aria-label="Loading deploy plan">
              {[0, 1, 2].map(i => (
                <div key={i} className="animate-pulse rounded-lg border border-line p-4">
                  <div className="h-4 w-48 rounded bg-surface-3" />
                  <div className="mt-3 h-3 w-full rounded bg-surface-2" />
                  <div className="mt-2 h-3 w-2/3 rounded bg-surface-2" />
                </div>
              ))}
            </div>
          ) : (
            <div className="space-y-5">
              {groups.map(group => {
                const head = group[0].change;
                return (
                  <div key={`${head.assetType}:${head.assetName}:${head.action}`}>
                    {/* Asset heading */}
                    <div className="mb-2 flex items-center gap-2">
                      <span className="font-mono text-sm font-semibold text-ink-1">{head.assetName}</span>
                      <span className="rounded bg-surface-2 px-1.5 py-0.5 text-[10px] font-medium text-ink-3">
                        {head.assetType}
                      </span>
                      {head.action === 'remove' && (
                        <span className="rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-medium text-red-600 dark:bg-red-900/40 dark:text-red-400">
                          remove
                        </span>
                      )}
                    </div>
                    <div className="space-y-2">
                      {group.map(t => (
                        <TargetRow
                          key={changeKey(t.change)}
                          target={t}
                          excluded={excluded.has(changeKey(t.change))}
                          onToggle={() => toggleExcluded(changeKey(t.change))}
                        />
                      ))}
                    </div>
                  </div>
                );
              })}
              <p className="text-[11px] text-ink-3">
                Existing project files that aren&apos;t part of the store skill are never removed.
              </p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-3 border-t border-line px-5 py-3">
          <span className="text-xs text-ink-3">
            {targets ? `${surviving.length} of ${targets.length} change${targets.length !== 1 ? 's' : ''} selected` : ''}
          </span>
          <div className="flex items-center gap-3">
            <button
              onClick={onClose}
              className="rounded px-4 py-1.5 text-sm text-ink-2 hover:text-ink-1"
            >
              Cancel
            </button>
            <button
              onClick={handleApply}
              disabled={applying || !targets || surviving.length === 0}
              className="rounded bg-accent px-4 py-1.5 text-sm font-medium text-white hover:bg-accent disabled:opacity-50"
            >
              {applying
                ? 'Applying...'
                : `Apply ${surviving.length} change${surviving.length !== 1 ? 's' : ''}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function TargetRow({ target, excluded, onToggle }: {
  target: DeployTargetPlan;
  excluded: boolean;
  onToggle: () => void;
}) {
  const { change } = target;
  const provider = change.provider ?? 'claude';
  const pc = getProviderColor(provider);

  return (
    <div className={`rounded-lg border p-3 transition-opacity ${
      target.error
        ? 'border-red-300 dark:border-red-500/40'
        : target.conflict && excluded
          ? 'border-amber-300 dark:border-amber-500/40'
          : 'border-line'
    } ${excluded ? 'opacity-55' : ''}`}>
      {/* Target line */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-sm font-medium text-ink-1">{target.projectName}</span>
          <span
            className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium"
            style={{ color: pc.color, backgroundColor: pc.bg, border: `1px solid ${pc.border}` }}
          >
            {provider}
          </span>
          {target.targetDir && (
            <Tooltip content={target.targetDir}>
              <span className="hidden truncate font-mono text-[11px] text-ink-3 sm:inline">
                {target.targetDir}
              </span>
            </Tooltip>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {!target.error && !target.upToDate && target.files.length > 0 && (
            <span className="hidden text-[11px] text-ink-3 md:inline">{summarize(target.files)}</span>
          )}
          {target.error ? (
            <span className="text-[11px] font-medium text-red-500 dark:text-red-400">excluded</span>
          ) : target.conflict ? (
            <button
              onClick={onToggle}
              className={`rounded border px-2 py-0.5 text-[11px] font-medium ${
                excluded
                  ? 'border-amber-400/60 text-amber-600 hover:bg-amber-50 dark:text-amber-400 dark:hover:bg-amber-900/20'
                  : 'border-line-strong text-ink-3 hover:bg-surface-3'
              }`}
            >
              {excluded ? 'Include anyway (overwrite newer copy)' : 'Exclude'}
            </button>
          ) : (
            <Tooltip content={excluded ? 'Restore this change' : 'Drop this change from the batch'} placement="left">
            <button
              onClick={onToggle}
              className="rounded p-1 text-ink-3 hover:bg-surface-3 hover:text-ink-2"
              aria-label={excluded ? `Restore ${change.assetName} for ${target.projectName}` : `Exclude ${change.assetName} for ${target.projectName}`}
            >
              {excluded ? (
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M16 15v-1a4 4 0 00-4-4H8m0 0l3 3m-3-3l3-3" />
                </svg>
              ) : (
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              )}
            </button>
            </Tooltip>
          )}
        </div>
      </div>

      {/* Conflict stripe */}
      {target.conflict && (
        <p className="mt-2 text-[11px] text-amber-600 dark:text-amber-400">
          Project copy is v{target.conflict.projectVersion ?? '?'} — newer than the store&apos;s v{target.conflict.storeVersion ?? '?'}. Excluded unless you include it explicitly.
        </p>
      )}

      {/* Error */}
      {target.error && (
        <p className="mt-2 text-[11px] text-red-500 dark:text-red-400">{target.error}</p>
      )}

      {/* Body: remove / mcp / up-to-date / file ledger */}
      {!target.error && (
        change.action === 'remove' ? (
          <p className="mt-2 text-xs text-red-500 dark:text-red-400">
            {target.exists
              ? `Will be removed from ${target.targetDir || 'the project'}.`
              : 'Nothing to remove — not present at the target.'}
          </p>
        ) : change.assetType === 'mcp' ? (
          <p className="mt-2 text-xs text-ink-3">
            MCP config merge into <span className="font-mono">.mcp.json</span> — existing entries are preserved.
          </p>
        ) : target.upToDate ? (
          <p className="mt-2 text-xs text-ink-3">
            Won&apos;t be changed — already up to date.
          </p>
        ) : target.files.length > 0 ? (
          <div className="mt-2 rounded-md border border-line bg-surface-2 px-3 py-2">
            {!target.exists && (
              <p className="mb-1.5 text-[10px] font-medium text-emerald-600 dark:text-emerald-400/80">New install</p>
            )}
            <div className="font-mono text-xs">
              {target.files.map((f, i) => {
                const isLast = i === target.files.length - 1;
                const badge = FATE_BADGE[f.fate];
                const dim = f.fate === 'keep' || f.fate === 'unchanged' || f.fate === 'skipped';
                return (
                  <div key={f.path} className="flex items-center justify-between gap-2 py-px">
                    <Tooltip content={f.path}>
                      <span className={`truncate ${dim ? 'text-void-400 dark:text-void-500' : 'text-void-700 dark:text-void-300'}`}>
                        {f.path !== 'SKILL.md' && (
                          <span className="text-void-300 dark:text-void-600">{isLast ? '└── ' : '├── '}</span>
                        )}
                        {f.path}
                      </span>
                    </Tooltip>
                    <Tooltip content={badge.title} placement="left">
                      <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${badge.cls}`}>
                        {badge.label}
                      </span>
                    </Tooltip>
                  </div>
                );
              })}
            </div>
          </div>
        ) : null
      )}
    </div>
  );
}
