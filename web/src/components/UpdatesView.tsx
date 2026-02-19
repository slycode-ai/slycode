'use client';

import { useState } from 'react';
import type { UpdateEntry } from '@/lib/types';
import { SkillDiffViewer } from './SkillDiffViewer';

interface UpdatesViewProps {
  entries: UpdateEntry[];
  onAccept: (entry: UpdateEntry) => Promise<void>;
  onDismiss: (entry: UpdateEntry) => void;
  onPushToProjects: (entry: UpdateEntry, fullSkillFolder: boolean) => void;
  onPushDeclined?: () => void;
}

interface DiffViewerState {
  entry: UpdateEntry;
  currentContent: string | null;
  newContent: string;
}

export function UpdatesView({
  entries,
  onAccept,
  onDismiss,
  onPushToProjects,
  onPushDeclined,
}: UpdatesViewProps) {
  const [diffViewer, setDiffViewer] = useState<DiffViewerState | null>(null);
  const [acceptingName, setAcceptingName] = useState<string | null>(null);
  const [justAccepted, setJustAccepted] = useState<Set<string>>(new Set());
  // Keep a snapshot of accepted entries so they survive polling refreshes
  const [acceptedEntries, setAcceptedEntries] = useState<Map<string, UpdateEntry>>(new Map());

  async function handlePreview(entry: UpdateEntry) {
    try {
      // Fetch new content from updates/
      const newRes = await fetch(`/api/file?${new URLSearchParams({
        path: `updates/${entry.updatesPath}/SKILL.md`,
      })}`);
      const newData = newRes.ok ? await newRes.json() : null;
      const newContent = newData?.content ?? '';

      // Fetch current content from store/ (if exists)
      let currentContent: string | null = null;
      if (entry.status === 'update') {
        const curRes = await fetch(`/api/file?${new URLSearchParams({
          path: `store/${entry.storePath}/SKILL.md`,
        })}`);
        const curData = curRes.ok ? await curRes.json() : null;
        currentContent = curData?.content ?? null;
      }

      setDiffViewer({ entry, currentContent, newContent });
    } catch {
      // Silently fail — user can try again
    }
  }

  async function handleAccept(entry: UpdateEntry) {
    setAcceptingName(entry.name);
    try {
      await onAccept(entry);
      const key = entry.name;
      setJustAccepted(prev => new Set(prev).add(key));
      setAcceptedEntries(prev => new Map(prev).set(key, entry));
    } finally {
      setAcceptingName(null);
    }
  }

  function handleDismiss(entry: UpdateEntry) {
    onDismiss(entry);
  }

  // Empty state
  if (entries.length === 0 && justAccepted.size === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-lg border border-void-200 bg-white py-16 dark:border-void-700 dark:bg-void-850">
        <svg className="mb-3 h-10 w-10 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <p className="text-sm font-medium text-void-400 dark:text-void-400">All skills are up to date</p>
        <p className="mt-1 text-xs text-void-400 dark:text-void-500">No updates available</p>
      </div>
    );
  }

  // Merge entries with accepted entries that may have been removed by polling
  const displayEntries: UpdateEntry[] = [...entries];
  for (const [key, entry] of acceptedEntries) {
    if (justAccepted.has(key) && !entries.some(e => e.name === key)) {
      displayEntries.push(entry);
    }
  }

  return (
    <>
      <div className="space-y-3">
        {displayEntries.map(entry => {
          const key = entry.name;
          const wasAccepted = justAccepted.has(key);
          const isAccepting = acceptingName === entry.name;

          if (wasAccepted) {
            const clearAccepted = () => {
              setJustAccepted(prev => { const next = new Set(prev); next.delete(key); return next; });
              setAcceptedEntries(prev => { const next = new Map(prev); next.delete(key); return next; });
            };
            const hasExtraFiles = !entry.skillMdOnly;

            // Show post-accept state with push option
            return (
              <div
                key={key}
                className="rounded-lg border border-emerald-500/30 bg-emerald-950/20 p-4"
              >
                {/* Header row */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <svg className="h-5 w-5 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                    <div>
                      <span className="text-sm font-medium text-emerald-300">{entry.name}</span>
                      <span className="ml-2 text-xs text-emerald-400/70">
                        Updated to v{entry.availableVersion}
                      </span>
                    </div>
                  </div>
                  {!hasExtraFiles ? (
                    /* SKILL.md only — simple push prompt */
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-void-400">Push to all projects?</span>
                      <button
                        onClick={() => { onPushToProjects(entry, false); clearAccepted(); }}
                        className="rounded-md border border-emerald-400/40 bg-emerald-400/15 px-3 py-1 text-xs font-medium text-emerald-400 hover:bg-emerald-400/25"
                      >
                        Yes
                      </button>
                      <button
                        onClick={() => { clearAccepted(); onPushDeclined?.(); }}
                        className="rounded-md border border-void-600 bg-void-800 px-3 py-1 text-xs font-medium text-void-300 hover:bg-void-700"
                      >
                        No
                      </button>
                    </div>
                  ) : (
                    /* Has additional files — buttons on the right */
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => { onPushToProjects(entry, false); clearAccepted(); }}
                        className="rounded-md border border-emerald-400/40 bg-emerald-400/15 px-3 py-1 text-xs font-medium text-emerald-400 hover:bg-emerald-400/25"
                      >
                        SKILL.md only
                      </button>
                      <button
                        onClick={() => { onPushToProjects(entry, true); clearAccepted(); }}
                        className="rounded-md border border-amber-400/40 bg-amber-400/15 px-3 py-1 text-xs font-medium text-amber-400 hover:bg-amber-400/25"
                      >
                        All files
                      </button>
                      <button
                        onClick={() => { clearAccepted(); onPushDeclined?.(); }}
                        className="rounded-md border border-void-600 bg-void-800 px-3 py-1 text-xs font-medium text-void-300 hover:bg-void-700"
                      >
                        Skip
                      </button>
                    </div>
                  )}
                </div>

                {/* File tree for multi-file skills */}
                {hasExtraFiles && (
                  <div className="mt-3 ml-8 rounded-md border border-void-700 bg-void-900/60 px-3 py-2">
                    <p className="mb-1.5 text-[10px] font-medium uppercase tracking-wider text-amber-400/70">Push to projects will include:</p>
                    <div className="font-mono text-xs text-void-400">
                      <div className="text-emerald-400">SKILL.md</div>
                      {entry.filesAffected
                        .filter(f => f !== 'SKILL.md')
                        .sort()
                        .map((file, i, arr) => {
                          const isLast = i === arr.length - 1;
                          return (
                            <div key={file} className="text-amber-400/70">
                              <span className="text-void-600">{isLast ? '└── ' : '├── '}</span>
                              {file}
                            </div>
                          );
                        })}
                    </div>
                  </div>
                )}
              </div>
            );
          }

          return (
            <div
              key={key}
              className="rounded-lg border border-void-200 bg-white p-4 dark:border-void-700 dark:bg-void-850"
            >
              <div className="flex items-start justify-between gap-4">
                {/* Info */}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-void-900 dark:text-void-100">
                      {entry.name}
                    </span>
                    {entry.status === 'update' ? (
                      <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
                        Update
                      </span>
                    ) : (
                      <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
                        New
                      </span>
                    )}
                    {entry.skillMdOnly ? (
                      <span className="text-[10px] text-void-400 dark:text-void-500">
                        SKILL.md only
                      </span>
                    ) : (
                      <span className="text-[10px] text-amber-500" title={entry.filesAffected.join(', ')}>
                        {entry.filesAffected.length} files
                      </span>
                    )}
                  </div>
                  <div className="mt-1 flex items-center gap-2 text-xs text-void-500 dark:text-void-400">
                    {entry.status === 'update' ? (
                      <span>v{entry.currentVersion} → v{entry.availableVersion}</span>
                    ) : (
                      <span>v{entry.availableVersion}</span>
                    )}
                  </div>
                  {entry.description && (
                    <p className="mt-1.5 text-xs text-void-500 dark:text-void-400 line-clamp-2">
                      {entry.description}
                    </p>
                  )}
                </div>

                {/* Actions */}
                <div className="flex flex-shrink-0 items-center gap-1.5">
                  {/* Preview */}
                  <button
                    onClick={() => handlePreview(entry)}
                    title="Preview changes"
                    className="rounded-md border border-void-300 bg-void-50 p-1.5 text-void-500 transition-colors hover:bg-void-100 hover:text-void-700 dark:border-void-600 dark:bg-void-800 dark:hover:bg-void-700 dark:hover:text-void-200"
                  >
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                      <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                    </svg>
                  </button>

                  {/* Accept */}
                  <button
                    onClick={() => handleAccept(entry)}
                    disabled={isAccepting}
                    title={entry.status === 'update' ? `Update to v${entry.availableVersion}` : 'Import skill'}
                    className="rounded-md border border-emerald-400/40 bg-emerald-400/15 p-1.5 text-emerald-400 transition-colors hover:bg-emerald-400/25 disabled:opacity-50"
                  >
                    {isAccepting ? (
                      <div className="h-4 w-4 animate-spin rounded-full border-2 border-emerald-600 border-t-emerald-300" />
                    ) : (
                      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                  </button>

                  {/* Dismiss */}
                  <button
                    onClick={() => handleDismiss(entry)}
                    title="Dismiss this version"
                    className="rounded-md border border-void-300 bg-void-50 p-1.5 text-void-400 transition-colors hover:bg-red-50 hover:text-red-500 dark:border-void-600 dark:bg-void-800 dark:hover:bg-red-950/30 dark:hover:text-red-400"
                  >
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Diff viewer modal */}
      {diffViewer && (
        <SkillDiffViewer
          skillName={diffViewer.entry.name}
          currentVersion={diffViewer.entry.currentVersion}
          newVersion={diffViewer.entry.availableVersion}
          currentContent={diffViewer.currentContent}
          newContent={diffViewer.newContent}
          onClose={() => setDiffViewer(null)}
        />
      )}
    </>
  );
}
