'use client';

import { useEffect, useState } from 'react';
import { MarkdownContent } from './MarkdownContent';
import { docFileName } from '@/lib/doc-refs';

/**
 * Markdown multi-attachment tab (feature 074) — index list + document viewer.
 *
 * Mirrors HtmlAttachmentsTab's structure: index list when more than one doc and
 * none selected, auto-select when exactly one, back affordance to the list.
 * Labels are the filename (user decision — no Markdown H1 parsing). Renders the
 * selected doc via the same /api/file fetch the single-doc tab used, re-fetched
 * on selection so the viewer always shows the latest from disk.
 *
 * `onUnlink` removes the ref from the card (UNLINK, not delete — the file on
 * disk is untouched); persistence is the modal's existing onUpdate path.
 *
 * Rendered with `key={kind}` at the call site, so each of Design/Feature/Test
 * is its own instance with independent selection + fetch state.
 */

interface DocAttachmentsTabProps {
  refs: string[];
  projectId: string;
  cardId: string;
  kind: 'design' | 'feature' | 'test';
  onUnlink: (ref: string) => void;
}

const KIND_LABEL: Record<DocAttachmentsTabProps['kind'], string> = {
  design: 'design document',
  feature: 'feature spec',
  test: 'test document',
};
const KIND_FLAG: Record<DocAttachmentsTabProps['kind'], string> = {
  design: '--design-ref',
  feature: '--feature-ref',
  test: '--test-ref',
};

export function DocAttachmentsTab({ refs, projectId, cardId, kind, onUnlink }: DocAttachmentsTabProps) {
  const [selectedRef, setSelectedRef] = useState<string | null>(null);
  const [copiedPath, setCopiedPath] = useState(false);
  const [doc, setDoc] = useState<{ path: string; content?: string; error?: string } | null>(null);
  const [loading, setLoading] = useState(false);

  // Derived selection (no state-sync effect): auto-select the sole doc, ignore
  // selections that disappeared (e.g. unlink/clear-all while the tab is open).
  const effectiveRef =
    selectedRef && refs.includes(selectedRef)
      ? selectedRef
      : refs.length === 1
        ? refs[0]
        : null;

  // Fetch the selected doc's Markdown, re-fetched whenever the selection
  // changes so the viewer always reflects the latest file on disk. The viewer
  // render gates on `doc.path === effectiveRef`, so stale content never shows
  // while a new fetch is in flight (no synchronous reset needed).
  useEffect(() => {
    if (!effectiveRef) return;
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- gating fetch with loading flag
    setLoading(true);
    fetch(`/api/file?path=${encodeURIComponent(effectiveRef)}&projectId=${encodeURIComponent(projectId)}`)
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return;
        setDoc(
          data.error
            ? { path: effectiveRef, error: data.error }
            : { path: effectiveRef, content: data.content }
        );
      })
      .catch((err) => {
        if (!cancelled) setDoc({ path: effectiveRef, error: err.message });
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [effectiveRef, projectId]);

  const handleCopyPath = (path: string) => {
    navigator.clipboard.writeText(path);
    setCopiedPath(true);
    setTimeout(() => setCopiedPath(false), 2000);
  };

  // ------ Empty state ------
  if (refs.length === 0) {
    return (
      <div className="flex h-full items-center justify-center p-8 text-center text-sm text-void-500 dark:text-void-400">
        <div>
          <p className="mb-2 font-medium">No {KIND_LABEL[kind]}s.</p>
          <p className="text-xs opacity-70">
            Agents attach documents via{' '}
            <code className="rounded bg-void-100 px-1.5 py-0.5 font-mono text-xs dark:bg-void-800">
              sly-kanban update {cardId} {KIND_FLAG[kind]} path/to/doc.md
            </code>
            .
          </p>
        </div>
      </div>
    );
  }

  // ------ Index view (more than one, none selected) ------
  if (!effectiveRef) {
    return (
      <div className="space-y-3 overflow-y-auto p-4">
        {refs.map((ref) => (
          <div
            key={ref}
            className="group flex items-center gap-3 rounded-lg border border-void-200/60 bg-white/40 p-4 text-left backdrop-blur-sm transition-all hover:border-neon-blue-400/50 hover:bg-neon-blue-400/5 dark:border-void-700/50 dark:bg-void-900/40"
          >
            <button onClick={() => setSelectedRef(ref)} className="flex min-w-0 flex-1 items-center gap-3">
              <span
                aria-hidden
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded border border-neon-blue-400/30 bg-neon-blue-400/10 text-neon-blue-500 dark:text-neon-blue-300"
              >
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium text-void-900 dark:text-void-100">{docFileName(ref)}</div>
                <div className="mt-0.5 truncate font-mono text-xs text-void-500 dark:text-void-400" title={ref}>
                  {ref}
                </div>
              </div>
            </button>
            <button
              onClick={() => onUnlink(ref)}
              className="shrink-0 rounded p-1.5 text-void-400 opacity-0 transition-opacity hover:bg-red-100 hover:text-red-600 group-hover:opacity-100 dark:hover:bg-red-900/30 dark:hover:text-red-400"
              title={`Unlink ${docFileName(ref)} (removes the reference; file is not deleted)`}
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
              </svg>
            </button>
          </div>
        ))}
      </div>
    );
  }

  // ------ Viewer (selected / sole doc) ------
  return (
    <div className="relative flex h-full flex-col">
      <div className="flex items-center justify-between gap-2 border-b border-void-200 px-4 py-2 text-xs dark:border-void-700">
        <div className="flex min-w-0 items-center gap-2">
          {refs.length > 1 && (
            <button
              onClick={() => setSelectedRef(null)}
              className="flex shrink-0 items-center gap-1 text-neon-blue-500 hover:text-neon-blue-400"
              title="All documents"
            >
              <span aria-hidden>←</span>
              <span className="hidden sm:inline">All</span>
            </button>
          )}
          <button
            onClick={() => handleCopyPath(effectiveRef)}
            className="rounded p-1 text-void-400 hover:bg-void-100 hover:text-void-600 dark:hover:bg-void-800 dark:hover:text-void-300"
            title={copiedPath ? 'Copied!' : `Copy path: ${effectiveRef}`}
          >
            {copiedPath ? (
              <svg className="h-3.5 w-3.5 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            ) : (
              <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" />
              </svg>
            )}
          </button>
          <span className="truncate font-mono text-void-700 dark:text-void-300" title={effectiveRef}>
            {docFileName(effectiveRef)}
          </span>
        </div>
        <button
          onClick={() => onUnlink(effectiveRef)}
          className="flex shrink-0 items-center gap-1 rounded border border-red-300/40 px-2 py-1 text-red-500 hover:bg-red-100 hover:text-red-600 dark:border-red-500/30 dark:hover:bg-red-900/30 dark:hover:text-red-400"
          title="Unlink this document (removes the reference; file is not deleted)"
        >
          <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
          </svg>
          <span className="hidden sm:inline">Unlink</span>
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {(loading || doc?.path !== effectiveRef) && (
          <div className="flex items-center justify-center py-8 text-void-500">Loading document...</div>
        )}
        {doc?.path === effectiveRef && doc.error && (
          <div className="rounded-lg bg-red-50 p-4 text-red-700 dark:bg-red-900/20 dark:text-red-300">
            Error loading document: {doc.error}
          </div>
        )}
        {doc?.path === effectiveRef && doc.content !== undefined && <MarkdownContent>{doc.content}</MarkdownContent>}
      </div>
    </div>
  );
}
