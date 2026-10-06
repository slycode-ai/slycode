'use client';

import { copyText } from '@/lib/clipboard';
import { useEffect, useState } from 'react';
import { MarkdownContent } from './MarkdownContent';
import { docFileName, docViewerHref, type DocKind } from '@/lib/doc-refs';
import Tooltip from './Tooltip';

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
 *
 * "Open in new tab" (card #0372) links to the standalone /doc-viewer page —
 * the Markdown counterpart of HtmlAttachmentsTab's /html-viewer link. Plain
 * `<a target="_blank">` so it's a user-gesture navigation (never popup-blocked,
 * works on mobile). In the index it's always visible, not hover-revealed, so
 * touch devices can reach it.
 */

interface DocAttachmentsTabProps {
  refs: string[];
  projectId: string;
  cardId: string;
  kind: DocKind;
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
    copyText(path);
    setCopiedPath(true);
    setTimeout(() => setCopiedPath(false), 2000);
  };

  // ------ Empty state ------
  if (refs.length === 0) {
    return (
      <div className="flex h-full items-center justify-center p-8 text-center text-sm text-ink-3">
        <div>
          <p className="mb-2 font-medium">No {KIND_LABEL[kind]}s.</p>
          <p className="text-xs opacity-70">
            Agents attach documents via{' '}
            <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-xs">
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
            className="group flex items-center gap-3 rounded-lg border border-line bg-surface-1 p-4 text-left backdrop-blur-sm transition-all hover:border-accent/50 hover:bg-accent/5"
          >
            <button onClick={() => setSelectedRef(ref)} className="flex min-w-0 flex-1 items-center gap-3">
              <span
                aria-hidden
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded border border-accent/30 bg-accent/10 text-accent"
              >
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium text-ink-1">{docFileName(ref)}</div>
                <Tooltip content={ref}>
                  <div className="mt-0.5 truncate font-mono text-xs text-ink-3">
                    {ref}
                  </div>
                </Tooltip>
              </div>
            </button>
            <Tooltip content={`Open ${docFileName(ref)} in a new tab`}>
              <a
                href={docViewerHref(ref, projectId, kind)}
                target="_blank"
                rel="noopener noreferrer"
                className="shrink-0 rounded p-1.5 text-ink-3 transition-colors hover:bg-accent/10 hover:text-accent"
                aria-label={`Open ${docFileName(ref)} in a new tab`}
              >
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                </svg>
              </a>
            </Tooltip>
            <Tooltip content={`Unlink ${docFileName(ref)} (removes the reference; file is not deleted)`}>
              <button
                onClick={() => onUnlink(ref)}
                className="shrink-0 rounded p-1.5 text-ink-3 opacity-0 transition-opacity hover:bg-red-100 hover:text-red-600 group-hover:opacity-100 dark:hover:bg-red-900/30 dark:hover:text-red-400"
                aria-label={`Unlink ${docFileName(ref)}`}
              >
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                </svg>
              </button>
            </Tooltip>
          </div>
        ))}
      </div>
    );
  }

  // ------ Viewer (selected / sole doc) ------
  return (
    <div className="relative flex h-full flex-col">
      <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-2 text-xs">
        <div className="flex min-w-0 items-center gap-2">
          {refs.length > 1 && (
            <Tooltip content="All documents" placement="bottom">
              <button
                onClick={() => setSelectedRef(null)}
                className="flex shrink-0 items-center gap-1 text-accent hover:text-accent"
                aria-label="All documents"
              >
                <span aria-hidden>←</span>
                <span className="hidden sm:inline">All</span>
              </button>
            </Tooltip>
          )}
          <Tooltip content={copiedPath ? 'Copied!' : `Copy path: ${effectiveRef}`} placement="bottom">
            <button
              onClick={() => handleCopyPath(effectiveRef)}
              className="rounded p-1 text-ink-3 hover:bg-surface-3 hover:text-ink-2"
              aria-label="Copy path"
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
          </Tooltip>
          <Tooltip content={effectiveRef} placement="bottom">
            <span className="truncate font-mono text-ink-2">
              {docFileName(effectiveRef)}
            </span>
          </Tooltip>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Tooltip content="Open in new tab" placement="bottom">
            <a
              href={docViewerHref(effectiveRef, projectId, kind)}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 rounded border border-accent/40 bg-accent/15 px-2 py-1 text-accent hover:bg-accent/25"
              aria-label="Open in new tab"
            >
              <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
              </svg>
              <span className="hidden sm:inline">Open in new tab</span>
            </a>
          </Tooltip>
          <Tooltip content="Unlink this document (removes the reference; file is not deleted)" placement="bottom">
            <button
              onClick={() => onUnlink(effectiveRef)}
              className="flex items-center gap-1 rounded border border-red-300/40 px-2 py-1 text-red-500 hover:bg-red-100 hover:text-red-600 dark:border-red-500/30 dark:hover:bg-red-900/30 dark:hover:text-red-400"
              aria-label="Unlink this document"
            >
              <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
              </svg>
              <span className="hidden sm:inline">Unlink</span>
            </button>
          </Tooltip>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {(loading || doc?.path !== effectiveRef) && (
          <div className="flex items-center justify-center py-8 text-ink-3">Loading document...</div>
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
