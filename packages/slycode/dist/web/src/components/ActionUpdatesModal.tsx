'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { createTwoFilesPatch } from 'diff';

interface ActionUpdateEntry {
  name: string;
  assetType: 'action';
  status: 'new' | 'update';
  currentVersion?: string;
  upstreamVersion: string;
  contentHash: string;
  description?: string;
  changedFields?: string[];
  newClasses?: string[];
}

interface ActionUpdatesModalProps {
  onClose: () => void;
}

// ============================================================================
// Diff Viewer (inline — reuses SkillDiffViewer patterns)
// ============================================================================

interface DiffLine {
  type: 'add' | 'remove' | 'context' | 'header';
  content: string;
  oldLineNo?: number;
  newLineNo?: number;
}

function parseDiffLines(patch: string): DiffLine[] {
  const lines: DiffLine[] = [];
  let oldLine = 0;
  let newLine = 0;

  for (const raw of patch.split('\n')) {
    if (raw.startsWith('@@')) {
      const match = raw.match(/@@ -(\d+)/);
      if (match) {
        oldLine = parseInt(match[1], 10) - 1;
        const newMatch = raw.match(/\+(\d+)/);
        if (newMatch) newLine = parseInt(newMatch[1], 10) - 1;
      }
      lines.push({ type: 'header', content: raw });
    } else if (raw.startsWith('---') || raw.startsWith('+++') || raw.startsWith('Index:') || raw.startsWith('===')) {
      // Skip file headers
    } else if (raw.startsWith('+')) {
      newLine++;
      lines.push({ type: 'add', content: raw.slice(1), newLineNo: newLine });
    } else if (raw.startsWith('-')) {
      oldLine++;
      lines.push({ type: 'remove', content: raw.slice(1), oldLineNo: oldLine });
    } else if (raw.startsWith(' ') || raw === '') {
      oldLine++;
      newLine++;
      lines.push({ type: 'context', content: raw.startsWith(' ') ? raw.slice(1) : raw, oldLineNo: oldLine, newLineNo: newLine });
    }
  }

  return lines;
}

const lineStyles: Record<string, string> = {
  add: 'bg-emerald-950/40 text-emerald-300',
  remove: 'bg-red-950/40 text-red-300',
  context: 'text-void-300',
  header: 'bg-neon-blue-950/30 text-neon-blue-300 font-medium',
};

const lineNoStyles: Record<string, string> = {
  add: 'text-emerald-600',
  remove: 'text-red-600',
  context: 'text-void-600',
  header: 'text-neon-blue-600',
};

const prefixChars: Record<string, string> = {
  add: '+',
  remove: '-',
  context: ' ',
  header: '',
};

interface DiffViewerState {
  entry: ActionUpdateEntry;
  currentContent: string | null;
  newContent: string;
}

function ActionDiffViewer({
  entry,
  currentContent,
  newContent,
  onClose,
}: DiffViewerState & { onClose: () => void }) {
  const [viewMode, setViewMode] = useState<'diff' | 'new'>('diff');
  const isNew = currentContent === null;

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') { e.stopPropagation(); onClose(); }
    }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onClose]);

  const diffLines = useMemo(() => {
    const oldContent = currentContent ?? '';
    const patch = createTwoFilesPatch(
      `current/${entry.name}.md`,
      `updated/${entry.name}.md`,
      oldContent,
      newContent,
      entry.currentVersion ?? '(none)',
      entry.upstreamVersion,
      { context: 4 },
    );
    return parseDiffLines(patch);
  }, [currentContent, newContent, entry]);

  const stats = useMemo(() => {
    let additions = 0;
    let deletions = 0;
    for (const line of diffLines) {
      if (line.type === 'add') additions++;
      if (line.type === 'remove') deletions++;
    }
    return { additions, deletions };
  }, [diffLines]);

  return (
    <div
      className="fixed inset-0 z-[55] flex items-center justify-center bg-black/60"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="mx-4 flex max-h-[85vh] w-full max-w-4xl flex-col overflow-hidden rounded-lg border border-void-700 bg-void-850 shadow-(--shadow-overlay)">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-void-700 px-5 py-4">
          <div className="flex items-center gap-3">
            <h3 className="text-lg font-semibold text-void-100">{entry.name}</h3>
            {isNew ? (
              <span className="rounded bg-emerald-900/40 px-2 py-0.5 text-xs font-medium text-emerald-300">
                New action
              </span>
            ) : (
              <span className="rounded bg-amber-900/40 px-2 py-0.5 text-xs font-medium text-amber-300">
                v{entry.currentVersion} &rarr; v{entry.upstreamVersion}
              </span>
            )}
            <span className="text-xs text-void-500">
              <span className="text-emerald-400">+{stats.additions}</span>
              {' '}
              <span className="text-red-400">-{stats.deletions}</span>
            </span>
          </div>
          <div className="flex items-center gap-2">
            {!isNew && (
              <div className="flex gap-1 rounded-md border border-void-700 bg-void-900 p-0.5">
                <button
                  onClick={() => setViewMode('diff')}
                  className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
                    viewMode === 'diff'
                      ? 'bg-void-800 text-void-100 shadow-sm'
                      : 'text-void-400 hover:text-void-200'
                  }`}
                >
                  Diff
                </button>
                <button
                  onClick={() => setViewMode('new')}
                  className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
                    viewMode === 'new'
                      ? 'bg-void-800 text-void-100 shadow-sm'
                      : 'text-void-400 hover:text-void-200'
                  }`}
                >
                  Full
                </button>
              </div>
            )}
            <button
              onClick={onClose}
              className="rounded p-1 text-void-400 hover:bg-void-800 hover:text-void-200"
            >
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Metadata chips */}
        {(entry.changedFields?.length || entry.newClasses?.length) && (
          <div className="flex flex-wrap gap-2 border-b border-void-700 px-5 py-3">
            {entry.changedFields?.map(field => (
              <span key={field} className="rounded bg-amber-900/40 px-2 py-0.5 text-[10px] font-medium text-amber-300">
                {field} changed
              </span>
            ))}
            {entry.newClasses?.length ? (
              <span className="rounded bg-neon-blue-900/40 px-2 py-0.5 text-[10px] font-medium text-neon-blue-300">
                New classes: {entry.newClasses.join(', ')}
              </span>
            ) : null}
          </div>
        )}

        {/* Diff content */}
        <div className="flex-1 overflow-y-auto">
          <div className="font-mono text-xs leading-relaxed">
            {(viewMode === 'diff' || isNew) ? (
              diffLines.map((line, i) => (
                <div key={i} className={`flex ${lineStyles[line.type]}`}>
                  <span className={`w-10 flex-shrink-0 select-none px-2 text-right ${lineNoStyles[line.type]}`}>
                    {line.type === 'header' ? '···' : (line.oldLineNo ?? line.newLineNo ?? '')}
                  </span>
                  <span className={`w-10 flex-shrink-0 select-none px-2 text-right ${lineNoStyles[line.type]}`}>
                    {line.type === 'header' ? '···' : (line.newLineNo ?? '')}
                  </span>
                  <span className={`w-4 flex-shrink-0 select-none text-center ${lineNoStyles[line.type]}`}>
                    {prefixChars[line.type]}
                  </span>
                  <span className="flex-1 whitespace-pre-wrap break-all px-2">
                    {line.content}
                  </span>
                </div>
              ))
            ) : (
              newContent.split('\n').map((line, i) => (
                <div key={i} className="flex text-void-300">
                  <span className="w-10 flex-shrink-0 select-none px-2 text-right text-void-600">
                    {i + 1}
                  </span>
                  <span className="flex-1 whitespace-pre-wrap break-all px-2">{line}</span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Main Modal
// ============================================================================

export function ActionUpdatesModal({ onClose }: ActionUpdatesModalProps) {
  const [entries, setEntries] = useState<ActionUpdateEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [acceptingName, setAcceptingName] = useState<string | null>(null);
  const [acceptingAll, setAcceptingAll] = useState(false);
  const [justAccepted, setJustAccepted] = useState<Set<string>>(new Set());
  const [diffViewer, setDiffViewer] = useState<DiffViewerState | null>(null);

  const fetchEntries = useCallback(async () => {
    try {
      const res = await fetch('/api/cli-assets/updates');
      if (res.ok) {
        const data = await res.json();
        setEntries(data.actionEntries ?? []);
      }
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchEntries();
  }, [fetchEntries]);

  // Close on Escape (only if diff viewer isn't open)
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !diffViewer) onClose();
    }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onClose, diffViewer]);

  async function handlePreview(entry: ActionUpdateEntry) {
    try {
      // Fetch new content from updates/actions/
      const newRes = await fetch(`/api/file?${new URLSearchParams({
        path: `updates/actions/${entry.name}.md`,
      })}`);
      const newData = newRes.ok ? await newRes.json() : null;
      const newContent = newData?.content ?? '';

      // Fetch current content from store/actions/ (if exists)
      let currentContent: string | null = null;
      if (entry.status === 'update') {
        const curRes = await fetch(`/api/file?${new URLSearchParams({
          path: `store/actions/${entry.name}.md`,
        })}`);
        const curData = curRes.ok ? await curRes.json() : null;
        currentContent = curData?.content ?? null;
      }

      setDiffViewer({ entry, currentContent, newContent });
    } catch {
      // Silently fail
    }
  }

  async function handleAccept(entry: ActionUpdateEntry) {
    setAcceptingName(entry.name);
    try {
      const res = await fetch('/api/cli-assets/updates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assetType: 'action', assetName: entry.name }),
      });
      if (res.ok) {
        setJustAccepted(prev => new Set(prev).add(entry.name));
        // Also invalidate actions cache
        fetch('/api/sly-actions/invalidate', { method: 'POST' }).catch(() => {});
      }
    } finally {
      setAcceptingName(null);
    }
  }

  async function handleDismiss(entry: ActionUpdateEntry) {
    try {
      await fetch('/api/cli-assets/updates', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          assetType: 'action',
          assetName: entry.name,
          contentHash: entry.contentHash,
        }),
      });
      // Remove from local list
      setEntries(prev => prev.filter(e => e.name !== entry.name));
    } catch { /* ignore */ }
  }

  async function handleAcceptAll() {
    setAcceptingAll(true);
    const pending = entries.filter(e => !justAccepted.has(e.name));
    for (const entry of pending) {
      await handleAccept(entry);
    }
    setAcceptingAll(false);
  }

  const pendingEntries = entries.filter(e => !justAccepted.has(e.name));
  const acceptedEntries = entries.filter(e => justAccepted.has(e.name));

  return (
    <>
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
        onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      >
        <div className="mx-4 flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-lg border border-void-200 bg-white shadow-(--shadow-overlay) dark:border-void-700 dark:bg-void-850">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-void-200 px-5 py-4 dark:border-void-700">
            <div className="flex items-center gap-3">
              <svg className="h-5 w-5 text-neon-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h7" />
              </svg>
              <h3 className="text-lg font-semibold text-void-900 dark:text-void-100">Action Updates</h3>
              {pendingEntries.length > 0 && (
                <span className="rounded-full bg-neon-blue-500 px-2 py-0.5 text-[10px] font-bold text-white">
                  {pendingEntries.length}
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              {pendingEntries.length > 1 && (
                <button
                  onClick={handleAcceptAll}
                  disabled={acceptingAll}
                  className="rounded-md border border-emerald-400/40 bg-emerald-400/15 px-3 py-1.5 text-xs font-medium text-emerald-600 transition-colors hover:bg-emerald-400/25 disabled:opacity-50 dark:text-emerald-400"
                >
                  {acceptingAll ? (
                    <span className="flex items-center gap-1.5">
                      <span className="h-3 w-3 animate-spin rounded-full border-2 border-emerald-600 border-t-emerald-300" />
                      Accepting...
                    </span>
                  ) : (
                    `Accept All (${pendingEntries.length})`
                  )}
                </button>
              )}
              <button
                onClick={onClose}
                className="rounded p-1 text-void-400 hover:bg-void-100 hover:text-void-700 dark:hover:bg-void-800 dark:hover:text-void-200"
              >
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto p-4">
            {loading ? (
              <div className="flex items-center justify-center py-16">
                <div className="h-6 w-6 animate-spin rounded-full border-2 border-neon-blue-400 border-t-transparent" />
              </div>
            ) : pendingEntries.length === 0 && acceptedEntries.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16">
                <svg className="mb-3 h-10 w-10 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <p className="text-sm font-medium text-void-500 dark:text-void-400">All actions are up to date</p>
                <p className="mt-1 text-xs text-void-400 dark:text-void-500">No updates available</p>
              </div>
            ) : (
              <div className="space-y-3">
                {/* Accepted entries */}
                {acceptedEntries.map(entry => (
                  <div
                    key={entry.name}
                    className="rounded-lg border border-emerald-500/30 bg-emerald-50 p-4 dark:bg-emerald-950/20"
                  >
                    <div className="flex items-center gap-3">
                      <svg className="h-5 w-5 text-emerald-500 dark:text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                      <span className="text-sm font-medium text-emerald-700 dark:text-emerald-300">{entry.name}</span>
                      <span className="text-xs text-emerald-600/70 dark:text-emerald-400/70">
                        {entry.status === 'new' ? 'Installed' : `Updated to v${entry.upstreamVersion}`}
                      </span>
                    </div>
                  </div>
                ))}

                {/* Pending entries */}
                {pendingEntries.map(entry => {
                  const isAccepting = acceptingName === entry.name;

                  return (
                    <div
                      key={entry.name}
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
                          </div>

                          {/* Version info */}
                          <div className="mt-1 flex items-center gap-2 text-xs text-void-500 dark:text-void-400">
                            {entry.status === 'update' ? (
                              <span>v{entry.currentVersion} &rarr; v{entry.upstreamVersion}</span>
                            ) : (
                              <span>v{entry.upstreamVersion}</span>
                            )}
                          </div>

                          {/* Description */}
                          {entry.description && (
                            <p className="mt-1.5 text-xs text-void-500 line-clamp-2 dark:text-void-400">
                              {entry.description}
                            </p>
                          )}

                          {/* Change chips */}
                          {(entry.changedFields?.length || entry.newClasses?.length) ? (
                            <div className="mt-2 flex flex-wrap gap-1.5">
                              {entry.changedFields?.map(field => (
                                <span key={field} className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
                                  {field} changed
                                </span>
                              ))}
                              {entry.newClasses?.length ? (
                                <span className="rounded bg-neon-blue-100 px-1.5 py-0.5 text-[10px] font-medium text-neon-blue-700 dark:bg-neon-blue-900/40 dark:text-neon-blue-300">
                                  +{entry.newClasses.length} class{entry.newClasses.length !== 1 ? 'es' : ''}
                                </span>
                              ) : null}
                            </div>
                          ) : null}
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
                            disabled={isAccepting || acceptingAll}
                            title={entry.status === 'update' ? `Update to v${entry.upstreamVersion}` : 'Install action'}
                            className="rounded-md border border-emerald-400/40 bg-emerald-400/15 p-1.5 text-emerald-500 transition-colors hover:bg-emerald-400/25 disabled:opacity-50 dark:text-emerald-400"
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
            )}
          </div>
        </div>
      </div>

      {/* Diff viewer overlay (on top of modal) */}
      {diffViewer && (
        <ActionDiffViewer
          entry={diffViewer.entry}
          currentContent={diffViewer.currentContent}
          newContent={diffViewer.newContent}
          onClose={() => setDiffViewer(null)}
        />
      )}
    </>
  );
}
