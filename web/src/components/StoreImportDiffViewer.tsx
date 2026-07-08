'use client';

import { useState, useEffect, useMemo } from 'react';
import type { AssetType, ProviderId } from '@/lib/types';
import type { StoreImportManifest, StoreImportFile, StoreImportFileStatus } from '@/lib/asset-scanner';
import { buildDiffLines, DiffLineRows } from './DiffLineView';

interface ImportTarget {
  assetName: string;
  assetType: AssetType;
  sourceProjectId: string;
  provider: ProviderId;
}

/**
 * Project→store import review. Shows a per-file diff (SKILL.md + reference files)
 * of the project copy (incoming) against the current store copy, then lets the
 * user commit "SKILL.md only" or "Full folder" — or cancel without writing.
 *
 * The modal chrome is theme-adaptive (light + dark); the diff pane itself is
 * always dark (terminal-style) so the shared diff colors read correctly.
 */
export function StoreImportDiffViewer({
  target,
  onConfirm,
  onClose,
}: {
  target: ImportTarget;
  onConfirm: (fullFolder: boolean) => void;
  onClose: () => void;
}) {
  const [manifest, setManifest] = useState<StoreImportManifest | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string>('SKILL.md');

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onClose]);

  useEffect(() => {
    const params = new URLSearchParams({
      provider: target.provider,
      assetType: target.assetType,
      assetName: target.assetName,
      sourceProjectId: target.sourceProjectId,
    });
    fetch(`/api/cli-assets/store/preview?${params}`)
      .then(async (r) => {
        if (!r.ok) throw new Error((await r.json().catch(() => ({})))?.error || `Preview failed (${r.status})`);
        return r.json();
      })
      .then((data: StoreImportManifest) => {
        setManifest(data);
        // Default-select SKILL.md; fall back to the first file if absent.
        const hasSkillMd = data.files?.some((f) => f.path === 'SKILL.md');
        setSelected(hasSkillMd ? 'SKILL.md' : (data.files?.[0]?.path ?? 'SKILL.md'));
        setLoading(false);
      })
      .catch((e) => {
        setError(String(e?.message ?? e));
        setLoading(false);
      });
  }, [target]);

  const files = useMemo(() => manifest?.files ?? [], [manifest]);

  // Identical *reference* files (not SKILL.md) collapse into a single note.
  const identicalRefs = useMemo(
    () => files.filter((f) => f.status === 'identical' && f.path !== 'SKILL.md'),
    [files],
  );
  // Everything shown individually in the list: SKILL.md + all non-identical files.
  const listedFiles = useMemo(
    () => files.filter((f) => f.path === 'SKILL.md' || f.status !== 'identical'),
    [files],
  );
  // Are there changes to anything beyond SKILL.md? Drives the "Full folder" emphasis.
  const hasExtraChanges = useMemo(
    () => files.some((f) => f.path !== 'SKILL.md' && (f.status === 'added' || f.status === 'changed')),
    [files],
  );

  const counts = useMemo(() => {
    const c = { changed: 0, added: 0, removed: 0, identical: 0 };
    for (const f of files) c[f.status]++;
    return c;
  }, [files]);

  const selectedFile = files.find((f) => f.path === selected) ?? null;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="flex max-h-[88vh] w-full max-w-5xl flex-col overflow-hidden rounded-xl border border-void-200 bg-white shadow-(--shadow-overlay) dark:border-void-700 dark:bg-void-850">
        {/* Header */}
        <div className="flex items-center justify-between gap-3 border-b border-void-200 px-5 py-4 dark:border-void-700">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-purple-100 dark:bg-purple-900/30">
              <svg className="h-5 w-5 text-purple-600 dark:text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
              </svg>
            </div>
            <div>
              <h3 className="text-lg font-semibold text-void-900 dark:text-void-100">Review import to store</h3>
              <p className="text-sm text-void-500 dark:text-void-400">
                {target.assetName}
                {manifest && !manifest.skillExistsInStore && (
                  <span className="ml-2 rounded bg-emerald-100 px-1.5 py-0.5 text-[11px] font-medium text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
                    new — not yet in store
                  </span>
                )}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {manifest && (
              <div className="hidden items-center gap-2 text-xs text-void-500 dark:text-void-400 sm:flex">
                {counts.changed > 0 && <span className="text-amber-600 dark:text-amber-400">{counts.changed} changed</span>}
                {counts.added > 0 && <span className="text-emerald-600 dark:text-emerald-400">{counts.added} added</span>}
                {counts.removed > 0 && <span className="text-void-500 dark:text-void-400">{counts.removed} store-only</span>}
                {counts.identical > 0 && <span className="text-void-400 dark:text-void-500">{counts.identical} identical</span>}
              </div>
            )}
            <button
              onClick={onClose}
              className="rounded p-1 text-void-400 hover:bg-void-100 hover:text-void-700 dark:hover:bg-void-800 dark:hover:text-void-200"
              aria-label="Close"
            >
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Body */}
        {loading ? (
          <div className="flex flex-1 items-center justify-center py-20">
            <div className="h-7 w-7 animate-spin rounded-full border-2 border-void-300 border-t-purple-500" />
          </div>
        ) : error ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 py-20 text-center">
            <p className="text-sm font-medium text-red-600 dark:text-red-400">Couldn&apos;t load the preview</p>
            <p className="max-w-md text-xs text-void-500 dark:text-void-400">{error}</p>
          </div>
        ) : (
          <div className="flex min-h-0 flex-1">
            {/* File list */}
            <div className="w-64 flex-shrink-0 overflow-y-auto border-r border-void-200 bg-void-50 dark:border-void-700 dark:bg-void-900">
              <div className="px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-void-400 dark:text-void-500">
                Files
              </div>
              {listedFiles.map((f) => (
                <FileRow
                  key={f.path}
                  file={f}
                  selected={f.path === selected}
                  onSelect={() => setSelected(f.path)}
                />
              ))}
              {identicalRefs.length > 0 && (
                <div className="m-2 mt-3 rounded-md border border-void-200 bg-void-100/60 px-3 py-2 dark:border-void-700 dark:bg-void-800/40">
                  <p className="text-[11px] font-medium text-void-500 dark:text-void-400">
                    {identicalRefs.length} reference file{identicalRefs.length !== 1 ? 's' : ''} identical
                  </p>
                  <ul className="mt-1 space-y-0.5">
                    {identicalRefs.map((f) => (
                      <li key={f.path} className="truncate font-mono text-[11px] text-void-400 dark:text-void-500" title={f.path}>
                        {f.path}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

            {/* Diff / detail panel — always dark (terminal-style) */}
            <div className="min-w-0 flex-1 overflow-y-auto bg-void-900">
              {selectedFile ? <FileDetail file={selectedFile} /> : (
                <p className="p-6 text-sm text-void-400">Select a file to view its changes.</p>
              )}
            </div>
          </div>
        )}

        {/* Footer */}
        {!loading && !error && (
          <div className="flex items-center justify-between gap-3 border-t border-void-200 px-5 py-4 dark:border-void-700">
            <p className="text-xs text-void-500 dark:text-void-400">
              Cancel writes nothing. Importing never deletes files already in the store.
            </p>
            <div className="flex items-center gap-2">
              <button
                onClick={onClose}
                className="rounded-lg px-4 py-2 text-sm font-medium text-void-500 hover:text-void-700 dark:text-void-400 dark:hover:text-void-200"
              >
                Cancel
              </button>
              <button
                onClick={() => onConfirm(false)}
                className="rounded-lg border border-purple-300 bg-purple-50 px-4 py-2 text-sm font-medium text-purple-700 transition-colors hover:bg-purple-100 dark:border-purple-700 dark:bg-purple-900/20 dark:text-purple-300 dark:hover:bg-purple-900/40"
              >
                Import SKILL.md only
              </button>
              <button
                onClick={() => onConfirm(true)}
                title={hasExtraChanges ? undefined : 'No reference files differ — this is equivalent to SKILL.md only'}
                className={`rounded-lg border px-4 py-2 text-sm font-medium transition-colors ${
                  hasExtraChanges
                    ? 'border-purple-300 bg-purple-600 text-white hover:bg-purple-700 dark:border-purple-700'
                    : 'border-void-200 bg-void-50 text-void-500 hover:bg-void-100 dark:border-void-700 dark:bg-void-900 dark:text-void-400 dark:hover:bg-void-800'
                }`}
              >
                Import full folder
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

const statusBadge: Record<StoreImportFileStatus, { label: string; cls: string }> = {
  changed: { label: 'changed', cls: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300' },
  added: { label: 'added', cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300' },
  // Store-only — deliberately NOT a red "deleted" style; the import keeps it.
  removed: { label: 'store-only', cls: 'bg-void-200 text-void-600 dark:bg-void-700/60 dark:text-void-300' },
  identical: { label: 'identical', cls: 'bg-void-100 text-void-400 dark:bg-void-800 dark:text-void-500' },
};

function FileRow({ file, selected, onSelect }: { file: StoreImportFile; selected: boolean; onSelect: () => void }) {
  const badge = statusBadge[file.status];
  return (
    <button
      onClick={onSelect}
      className={`flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left transition-colors ${
        selected
          ? 'bg-purple-100 dark:bg-purple-900/30'
          : 'hover:bg-void-100 dark:hover:bg-void-800/60'
      }`}
    >
      <span
        className={`truncate font-mono text-xs ${
          file.path === 'SKILL.md'
            ? 'font-semibold text-void-800 dark:text-void-200'
            : 'text-void-600 dark:text-void-400'
        }`}
        title={file.path}
      >
        {file.path}
      </span>
      <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${badge.cls}`}>
        {badge.label}
      </span>
    </button>
  );
}

function FileDetail({ file }: { file: StoreImportFile }) {
  // Removed / store-only — reassure it is NOT deleted.
  if (file.status === 'removed') {
    return (
      <Notice tone="muted">
        <strong className="text-void-200">Store-only file — kept, not deleted.</strong>
        <span className="mt-1 block">
          <span className="font-mono">{file.path}</span> exists in the store but not in this project.
          Importing won&apos;t remove it — it stays in the store exactly as-is.
        </span>
      </Notice>
    );
  }

  if (file.status === 'identical') {
    return <Notice tone="muted">No changes — <span className="font-mono">{file.path}</span> is identical in the store.</Notice>;
  }

  if (!file.previewable) {
    const why = file.reason === 'binary'
      ? 'Binary file — not previewable.'
      : 'File is too large to preview.';
    return (
      <Notice tone="amber">
        <strong className="text-amber-200">{file.status === 'added' ? 'Added' : 'Changed'} — {why}</strong>
        <span className="mt-1 block">Detected by content hash. <span className="font-mono">{file.path}</span> will be written on import.</span>
      </Notice>
    );
  }

  // Previewable: build a line diff. For "added", the store side is empty.
  const oldContent = file.status === 'added' ? '' : (file.storeContent ?? '');
  const newContent = file.projectContent ?? '';
  const lines = buildDiffLines({ oldContent, newContent, fileName: file.path });

  return (
    <div>
      <div className="sticky top-0 z-10 border-b border-void-700 bg-void-900/95 px-4 py-2 backdrop-blur">
        <span className="font-mono text-xs text-void-300">{file.path}</span>
        {file.status === 'added' && (
          <span className="ml-2 rounded bg-emerald-900/40 px-1.5 py-0.5 text-[10px] font-medium text-emerald-300">new file</span>
        )}
      </div>
      <DiffLineRows lines={lines} />
    </div>
  );
}

function Notice({ tone, children }: { tone: 'muted' | 'amber'; children: React.ReactNode }) {
  const cls = tone === 'amber' ? 'text-amber-300/90' : 'text-void-400';
  return (
    <div className="p-6">
      <div className={`max-w-xl rounded-lg border border-void-700 bg-void-800/40 px-4 py-3 text-sm ${cls}`}>
        {children}
      </div>
    </div>
  );
}
