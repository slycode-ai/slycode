'use client';

import { copyText } from '@/lib/clipboard';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { MarkdownContent } from '@/components/MarkdownContent';
import { docFileName, type DocKind } from '@/lib/doc-refs';

/**
 * Standalone Markdown doc viewer (card #0372) — the Design / Feature / Test
 * counterpart of /html-viewer. Opened from DocAttachmentsTab's "Open in new
 * tab" control so a long doc can be read beside the board.
 *
 * Same URL shape as /html-viewer (`/doc-viewer/<segments>?projectId=&kind=`),
 * same content source as the modal (`/api/file`, so its path allowlist and
 * traversal checks apply), same renderer (MarkdownContent). The global auth
 * gate (proxy.ts) covers both this page and the API with no extra wiring.
 *
 * The document scrolls with the page (no inner scroll box) so print gets every
 * page, not just the visible viewport.
 */

const KIND_LABEL: Record<DocKind, string> = {
  design: 'Design doc',
  feature: 'Feature spec',
  test: 'Test doc',
};

function safeDecode(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

type DocState = { content: string } | { error: string } | null;

export default function DocViewerPage() {
  const params = useParams();
  const searchParams = useSearchParams();

  const filePath = useMemo(() => {
    const segments = Array.isArray(params.path) ? params.path : params.path ? [params.path] : [];
    return segments.map((s) => safeDecode(String(s))).join('/');
  }, [params]);
  const projectId = searchParams.get('projectId');
  const kindParam = searchParams.get('kind');
  const kindLabel = kindParam && kindParam in KIND_LABEL ? KIND_LABEL[kindParam as DocKind] : 'Document';
  const fileName = filePath ? docFileName(filePath) : '';

  const [doc, setDoc] = useState<DocState>(null);
  const [refreshFailed, setRefreshFailed] = useState(false);
  const [copied, setCopied] = useState(false);
  const requestSeq = useRef(0);

  // Fetch the doc. Later requests win (a focus re-fetch can overlap the first
  // load). A failed re-fetch keeps the last good copy on screen and flags it,
  // rather than replacing what the reader is looking at with an error.
  const load = useCallback(async () => {
    if (!filePath) return;
    const seq = ++requestSeq.current;
    const qs = new URLSearchParams({ path: filePath });
    if (projectId) qs.set('projectId', projectId);
    let next: { content: string } | { error: string };
    try {
      const res = await fetch(`/api/file?${qs.toString()}`);
      const data = await res.json();
      next = data.error ? { error: String(data.error) } : { content: String(data.content ?? '') };
    } catch (err) {
      next = { error: err instanceof Error ? err.message : 'Network error' };
    }
    if (seq !== requestSeq.current) return;
    setDoc((prev) => {
      if ('error' in next) return prev && 'content' in prev ? prev : next;
      // Unchanged content → keep the same object so nothing re-renders.
      return prev && 'content' in prev && prev.content === next.content ? prev : next;
    });
    setRefreshFailed('error' in next);
  }, [filePath, projectId]);

  // Initial load, then re-fetch whenever the window comes back into view, so a
  // doc an agent is still editing is current when you look back at it.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- load() only sets state after its fetch resolves
    void load();
    const onReturn = () => {
      if (document.visibilityState === 'visible') void load();
    };
    window.addEventListener('focus', onReturn);
    document.addEventListener('visibilitychange', onReturn);
    return () => {
      window.removeEventListener('focus', onReturn);
      document.removeEventListener('visibilitychange', onReturn);
    };
  }, [load]);

  // Tab title = filename, so several open docs are told apart in the tab strip.
  useEffect(() => {
    if (fileName) document.title = `${fileName} · SlyCode`;
  }, [fileName]);

  // Print in light mode: browsers drop backgrounds when printing, so dark-mode
  // prose (light text) would print near-invisible. Also covers Ctrl+P.
  useEffect(() => {
    const root = document.documentElement;
    let wasDark = false;
    const before = () => {
      wasDark = root.classList.contains('dark');
      root.classList.remove('dark');
    };
    const after = () => {
      if (wasDark) root.classList.add('dark');
    };
    window.addEventListener('beforeprint', before);
    window.addEventListener('afterprint', after);
    return () => {
      window.removeEventListener('beforeprint', before);
      window.removeEventListener('afterprint', after);
    };
  }, []);

  const handleCopyPath = () => {
    if (!filePath) return;
    void copyText(filePath);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const hasContent = doc !== null && 'content' in doc;

  return (
    <div className="min-h-screen bg-void-50 dark:bg-[#0d0e12] print:bg-white">
      <header className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-void-200 bg-white/85 px-3 py-2.5 backdrop-blur-md dark:border-white/10 dark:bg-[#16181f]/85 sm:px-4 print:hidden">
        <div className="flex min-w-0 items-center gap-3">
          <button
            onClick={() => window.close()}
            className="shrink-0 rounded border border-accent/40 bg-accent/15 px-3 py-1.5 text-sm text-accent transition hover:bg-accent/25"
            title="Close this tab and return to SlyCode"
          >
            Close
          </button>
          <div className="min-w-0 leading-tight">
            <div className="hidden text-xs text-ink-3 sm:block">{kindLabel}</div>
            <div className="truncate font-mono text-sm text-ink-1" title={filePath}>
              {fileName || '(loading…)'}
            </div>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {refreshFailed && hasContent && (
            <span
              className="hidden text-xs text-amber-600 dark:text-amber-400 md:inline"
              title="The latest version couldn't be loaded; this is the last copy that loaded."
            >
              Couldn&apos;t refresh, showing last loaded copy
            </span>
          )}
          <button
            onClick={handleCopyPath}
            className="rounded p-1.5 text-ink-3 transition hover:bg-surface-3 hover:text-ink-2"
            title={copied ? 'Copied!' : `Copy path: ${filePath}`}
            aria-label="Copy path"
          >
            {copied ? (
              <svg className="h-4 w-4 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            ) : (
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" />
              </svg>
            )}
          </button>
          <button
            onClick={() => window.print()}
            disabled={!hasContent}
            className="flex items-center gap-1.5 rounded border border-accent/40 bg-accent/15 px-2.5 py-1.5 text-sm text-accent transition hover:bg-accent/25 disabled:opacity-40 disabled:hover:shadow-none"
            title="Print this document"
            aria-label="Print this document"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
            </svg>
            <span className="hidden sm:inline">Print</span>
          </button>
        </div>
      </header>

      <main className="mx-auto w-full max-w-[94ch] sm:px-6 sm:py-8 print:max-w-none print:p-0">
        <article className="min-h-[50vh] bg-white px-4 py-6 dark:bg-[#16181f] sm:rounded-lg sm:border sm:border-void-200 sm:px-10 sm:py-10 sm:shadow-(--shadow-surface) sm:dark:border-white/10 print:border-0 print:p-0 print:shadow-none">
          {doc === null && (
            <div className="py-12 text-center text-sm text-ink-3">Loading document…</div>
          )}
          {doc !== null && 'error' in doc && (
            <div className="rounded-lg bg-red-50 p-4 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-300">
              <p className="font-medium">Couldn&apos;t load {filePath || 'this document'}.</p>
              <p className="mt-1 opacity-80">
                {doc.error}. If the file was moved or unlinked, reopen it from the card.
              </p>
            </div>
          )}
          {hasContent && <MarkdownContent>{doc.content}</MarkdownContent>}
        </article>
      </main>
    </div>
  );
}
