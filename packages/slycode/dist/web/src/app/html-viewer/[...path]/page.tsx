'use client';

import { useMemo } from 'react';
import { useParams, useSearchParams } from 'next/navigation';

export default function HtmlViewerPage() {
  const params = useParams();
  const searchParams = useSearchParams();

  // Derived directly from route params — no state-sync effect needed.
  const filePath = useMemo(() => {
    const segments = Array.isArray(params.path) ? params.path : params.path ? [params.path] : [];
    return segments.map(s => decodeURIComponent(String(s))).join('/');
  }, [params]);
  const projectId = searchParams.get('projectId');

  const iframeSrc = useMemo(() => {
    if (!filePath) return null;
    const qs = new URLSearchParams({ path: filePath });
    if (projectId) qs.set('projectId', projectId);
    return `/api/html-attachment?${qs.toString()}`;
  }, [filePath, projectId]);

  return (
    <div className="flex flex-col h-screen w-screen bg-void-50 dark:bg-[#0d0e12]">
      <header className="flex items-center justify-between px-4 py-3 border-b border-void-200 dark:border-white/10 bg-white/80 dark:bg-[#16181f]/80 backdrop-blur-md">
        <div className="flex items-center gap-3 min-w-0">
          <button
            onClick={() => window.close()}
            className="px-3 py-1.5 text-sm rounded border border-neon-blue-400/40 bg-neon-blue-400/15 text-neon-blue-600 dark:text-neon-blue-300 hover:bg-neon-blue-400/25 hover:shadow-[0_0_12px_rgba(0,191,255,0.3)] transition"
            title="Close this tab and return to SlyCode"
          >
            Close
          </button>
          <span className="text-xs uppercase tracking-wider text-void-500 dark:text-void-400 font-mono">HTML Attachment</span>
          <span className="text-sm text-void-700 dark:text-void-200 font-mono truncate" title={filePath}>
            {filePath || '(loading…)'}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <span className="hidden text-xs text-void-500 dark:text-void-400 sm:inline">
            Sandboxed · no fetch · no remote images
          </span>
          <button
            onClick={() => {
              if (!filePath) return;
              const qs = new URLSearchParams({ path: filePath, print: '1' });
              if (projectId) qs.set('projectId', projectId);
              // Dedicated print tab: the API serves the attachment with a CSP
              // sandbox directive (opaque origin) and an auto-print hook —
              // no app chrome in the output, page-break CSS honored natively.
              window.open(`/api/html-attachment?${qs.toString()}`, '_blank', 'noopener,noreferrer');
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded border border-neon-blue-400/40 bg-neon-blue-400/15 text-neon-blue-600 dark:text-neon-blue-300 hover:bg-neon-blue-400/25 hover:shadow-[0_0_12px_rgba(0,191,255,0.3)] transition"
            title="Print this attachment (opens a print tab — no app chrome)"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
            </svg>
            Print
          </button>
        </div>
      </header>
      <div className="flex-1 min-h-0 bg-white dark:bg-[#1a1a1a]">
        {iframeSrc && (
          <iframe
            src={iframeSrc}
            sandbox="allow-scripts"
            className="w-full h-full border-0"
            title={`HTML attachment: ${filePath}`}
          />
        )}
      </div>
    </div>
  );
}
