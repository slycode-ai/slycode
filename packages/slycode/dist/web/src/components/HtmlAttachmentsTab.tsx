'use client';

import { useEffect, useMemo, useState } from 'react';

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

export function HtmlAttachmentsTab({ refs, projectId, cardId }: HtmlAttachmentsTabProps) {
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
    navigator.clipboard.writeText(path);
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
      <div className="flex h-full items-center justify-center p-8 text-center text-sm text-void-500 dark:text-void-400">
        <div>
          <p className="mb-2 font-medium">No HTML attachments.</p>
          <p className="text-xs opacity-70">
            Agents attach HTML documents via{' '}
            <code className="rounded bg-void-100 px-1.5 py-0.5 font-mono text-xs dark:bg-void-800">
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
          <button
            key={ref}
            onClick={() => setSelectedRef(ref)}
            className="block w-full rounded-lg border border-void-200/60 bg-white/40 p-4 text-left backdrop-blur-sm transition-all hover:border-neon-blue-400/50 hover:bg-neon-blue-400/5 dark:border-void-700/50 dark:bg-void-900/40"
          >
            <div className="flex items-center gap-3">
              <span
                aria-hidden
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded border border-neon-blue-400/30 bg-neon-blue-400/10 text-neon-blue-500 dark:text-neon-blue-300"
              >
                {/* SVG instead of a text glyph — fonts baseline-shift, SVGs center true */}
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
                </svg>
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium text-void-900 dark:text-void-100">
                  {titles[ref] || fileName(ref)}
                </div>
                <div className="mt-0.5 truncate font-mono text-xs text-void-500 dark:text-void-400" title={ref}>
                  {ref}
                </div>
              </div>
              <svg
                className="h-4 w-4 shrink-0 text-void-300 dark:text-void-600"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </div>
          </button>
        ))}
      </div>
    );
  }

  // ------ Viewer (selected attachment) ------
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between gap-2 border-b border-void-200 px-4 py-2 text-xs dark:border-void-700">
        <div className="flex min-w-0 items-center gap-2">
          {refs.length > 1 && (
            <button
              onClick={() => setSelectedRef(null)}
              className="flex shrink-0 items-center gap-1 text-neon-blue-500 hover:text-neon-blue-400"
              title="All attachments"
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
            {selectedLabel}
          </span>
          <span className="hidden text-void-400 dark:text-void-500 sm:inline">·</span>
          <span className="hidden text-void-400 dark:text-void-500 sm:inline">sandboxed (no fetch, no remote images)</span>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            onClick={() => handlePrint(effectiveRef)}
            className="flex items-center gap-1 rounded border border-neon-blue-400/40 bg-neon-blue-400/15 px-2 py-1 text-neon-blue-600 hover:bg-neon-blue-400/25 hover:shadow-[0_0_12px_rgba(0,191,255,0.3)] dark:text-neon-blue-300"
            title="Print this attachment (opens a print tab — no app chrome)"
          >
            <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
            </svg>
            Print
          </button>
          <a
            href={viewerHref(effectiveRef, projectId)}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 rounded border border-neon-blue-400/40 bg-neon-blue-400/15 px-2 py-1 text-neon-blue-600 hover:bg-neon-blue-400/25 hover:shadow-[0_0_12px_rgba(0,191,255,0.3)] dark:text-neon-blue-300"
            title="Open in new tab"
          >
            <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
            </svg>
            <span className="hidden sm:inline">Open in new tab</span>
          </a>
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
