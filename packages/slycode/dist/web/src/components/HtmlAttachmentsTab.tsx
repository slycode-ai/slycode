'use client';

import { copyText } from '@/lib/clipboard';
import { useEffect, useMemo, useState } from 'react';
import Tooltip from './Tooltip';

/**
 * HTML attachments tab (feature 072) — multi-attachment index + sandboxed viewer.
 *
 * Mirrors QuestionnaireTab's structure: index list when more than one
 * attachment and none selected, auto-select when exactly one, back affordance
 * to return to the list. Labels come from the attachment's own <title> tag
 * (fallback: filename) — no extra CLI/data surface.
 *
 * Print opens the attachment in a dedicated tab via ?print=1. The API route
 * serves ALL attachment responses with a CSP `sandbox allow-scripts
 * allow-modals` directive, so the top-level print tab keeps the same opaque
 * origin as the iframe here — do NOT swap this for a raw un-sandboxed open.
 */

interface HtmlAttachmentsTabProps {
  refs: string[];
  projectId: string;
  cardId: string;
  /** Unlink a single attachment ref (feature 074). Removes the ref only — never deletes the file. */
  onUnlink?: (ref: string) => void;
}

function fileName(ref: string): string {
  const segments = ref.split('/');
  return segments[segments.length - 1] || ref;
}

function attachmentSrc(ref: string, projectId: string, print = false): string {
  const qs = new URLSearchParams({ path: ref, projectId });
  if (print) qs.set('print', '1');
  return `/api/html-attachment?${qs.toString()}`;
}

function viewerHref(ref: string, projectId: string): string {
  return `/html-viewer/${ref.split('/').map(encodeURIComponent).join('/')}?projectId=${encodeURIComponent(projectId)}`;
}

/** Extract <title> text from raw HTML; null when absent/empty. */
function extractTitle(html: string): string | null {
  const match = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  const text = match?.[1]?.replace(/\s+/g, ' ').trim();
  return text || null;
}

export function HtmlAttachmentsTab({ refs, projectId, cardId, onUnlink }: HtmlAttachmentsTabProps) {
  const [selectedRef, setSelectedRef] = useState<string | null>(null);
  const [titles, setTitles] = useState<Record<string, string | null>>({});
  const [copiedPath, setCopiedPath] = useState(false);

  // Derived selection (no state-sync effect): auto-select the sole
  // attachment, ignore selections that disappeared (e.g. CLI clear-all
  // while the modal is open).
  const effectiveRef =
    selectedRef && refs.includes(selectedRef)
      ? selectedRef
      : refs.length === 1
        ? refs[0]
        : null;

  // Fetch friendly labels (<title>) for the index. Cached per ref; only
  // fetches what's missing. Same-origin app-page fetch — the attachment CSP
  // applies to the served document, not to us reading it.
  useEffect(() => {
    const missing = refs.filter(ref => !(ref in titles));
    if (missing.length === 0) return;
    let cancelled = false;
    (async () => {
      const entries = await Promise.all(
        missing.map(async ref => {
          try {
            const res = await fetch(attachmentSrc(ref, projectId));
            if (!res.ok) return [ref, null] as const;
            return [ref, extractTitle(await res.text())] as const;
          } catch {
            return [ref, null] as const;
          }
        })
      );
      if (!cancelled) {
        setTitles(prev => ({ ...Object.fromEntries(entries), ...prev }));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [refs, projectId, titles]);

  const handleCopyPath = (path: string) => {
    copyText(path);
    setCopiedPath(true);
    setTimeout(() => setCopiedPath(false), 2000);
  };

  const handlePrint = (ref: string) => {
    // User-gesture window.open — not popup-blocked. The ?print=1 document
    // auto-prints on load and contains zero app chrome.
    window.open(attachmentSrc(ref, projectId, true), '_blank', 'noopener,noreferrer');
  };

  const selectedLabel = useMemo(
    () => (effectiveRef ? titles[effectiveRef] || fileName(effectiveRef) : null),
    [effectiveRef, titles]
  );

  // ------ Empty state ------
  if (refs.length === 0) {
    return (
      <div className="flex h-full items-center justify-center p-8 text-center text-sm text-ink-3">
        <div>
          <p className="mb-2 font-medium">No HTML attachments.</p>
          <p className="text-xs opacity-70">
            Agents attach HTML documents via{' '}
            <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-xs">
              sly-kanban update {cardId} --html-ref documentation/designs/name.html
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
        {refs.map(ref => (
          <div
            key={ref}
            className="group flex items-center gap-3 rounded-lg border border-line bg-surface-1 p-4 text-left backdrop-blur-sm transition-all hover:border-accent/50 hover:bg-accent/5"
          >
            <button onClick={() => setSelectedRef(ref)} className="flex min-w-0 flex-1 items-center gap-3">
              <span
                aria-hidden
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded border border-accent/30 bg-accent/10 text-accent"
              >
                {/* SVG instead of a text glyph — fonts baseline-shift, SVGs center true */}
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
                </svg>
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium text-ink-1">
                  {titles[ref] || fileName(ref)}
                </div>
                <Tooltip content={ref}>
                  <div className="mt-0.5 truncate font-mono text-xs text-ink-3">
                    {ref}
                  </div>
                </Tooltip>
              </div>
            </button>
            {onUnlink ? (
              <Tooltip content={`Unlink ${fileName(ref)} (removes the reference; file is not deleted)`}>
                <button
                  onClick={() => onUnlink(ref)}
                  className="shrink-0 rounded p-1.5 text-ink-3 opacity-0 transition-opacity hover:bg-red-100 hover:text-red-600 group-hover:opacity-100 dark:hover:bg-red-900/30 dark:hover:text-red-400"
                  aria-label={`Unlink ${fileName(ref)}`}
                >
                  <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                  </svg>
                </button>
              </Tooltip>
            ) : (
              <svg
                className="h-4 w-4 shrink-0 text-void-300 dark:text-void-600"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            )}
          </div>
        ))}
      </div>
    );
  }

  // ------ Viewer (selected attachment) ------
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-2 text-xs">
        <div className="flex min-w-0 items-center gap-2">
          {refs.length > 1 && (
            <Tooltip content="All attachments" placement="bottom">
              <button
                onClick={() => setSelectedRef(null)}
                className="flex shrink-0 items-center gap-1 text-accent hover:text-accent"
                aria-label="All attachments"
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
              {selectedLabel}
            </span>
          </Tooltip>
          <span className="hidden text-ink-3 sm:inline">·</span>
          <span className="hidden text-ink-3 sm:inline">sandboxed (no fetch, no remote images)</span>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Tooltip content="Print this attachment (opens a print tab — no app chrome)" placement="bottom">
            <button
              onClick={() => handlePrint(effectiveRef)}
              className="flex items-center gap-1 rounded border border-accent/40 bg-accent/15 px-2 py-1 text-accent hover:bg-accent/25"
            >
              <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
              </svg>
              Print
            </button>
          </Tooltip>
          <Tooltip content="Open in new tab" placement="bottom">
            <a
              href={viewerHref(effectiveRef, projectId)}
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
          {onUnlink && (
            <Tooltip content="Unlink this attachment (removes the reference; file is not deleted)" placement="bottom">
              <button
                onClick={() => onUnlink(effectiveRef)}
                className="flex items-center gap-1 rounded border border-red-300/40 px-2 py-1 text-red-500 hover:bg-red-100 hover:text-red-600 dark:border-red-500/30 dark:hover:bg-red-900/30 dark:hover:text-red-400"
                aria-label="Unlink this attachment"
              >
                <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                </svg>
                <span className="hidden sm:inline">Unlink</span>
              </button>
            </Tooltip>
          )}
        </div>
      </div>
      <div className="min-h-0 flex-1 bg-white dark:bg-[#1a1a1a]">
        <iframe
          src={attachmentSrc(effectiveRef, projectId)}
          sandbox="allow-scripts"
          className="h-full w-full border-0"
          title={`HTML attachment: ${effectiveRef}`}
        />
      </div>
    </div>
  );
}
