'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import type { SearchResult, KanbanStage } from '@/lib/types';
import { PROJECT_STATUS_LABELS } from '@/lib/project-status';

interface SearchBarProps {
  contextProjectId?: string;
  onResultClick?: (result: SearchResult) => void;
}

const stageColors: Record<KanbanStage, string> = {
  backlog: 'bg-st-backlog/12 text-ink-2',
  design: 'bg-st-design/12 text-st-design',
  implementation: 'bg-st-impl/12 text-st-impl',
  testing: 'bg-st-test/12 text-st-test',
  done: 'bg-st-done/12 text-st-done',
};

export function SearchBar({ contextProjectId, onResultClick }: SearchBarProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [activeResults, setActiveResults] = useState<SearchResult[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<NodeJS.Timeout>(undefined);

  // Fetch active sessions (cards being actively worked on)
  const fetchActiveSessions = useCallback(async () => {
    try {
      const res = await fetch('/api/search?mode=active');
      if (res.ok) {
        const data = await res.json();
        const active = data.results || [];
        setActiveResults(active);
        if (active.length > 0) {
          setIsOpen(true);
        }
      }
    } catch {
      // ignore - bridge may not be running
    }
  }, []);

  const search = useCallback(async (q: string) => {
    if (q.trim().length < 2) {
      setResults([]);
      // When query is cleared, show active sessions if we have them
      if (q.trim().length === 0 && activeResults.length > 0) {
        setIsOpen(true);
      } else {
        setIsOpen(false);
      }
      return;
    }

    setLoading(true);
    try {
      const params = new URLSearchParams({ q: q.trim() });
      if (contextProjectId) params.set('projectId', contextProjectId);

      const res = await fetch(`/api/search?${params}`);
      if (res.ok) {
        const data = await res.json();
        setResults(data.results || []);
        setIsOpen(true);
      }
    } catch {
      // ignore
    }
    setLoading(false);
  }, [contextProjectId, activeResults.length]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => search(query), 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, search]);

  // Close on click outside
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') {
      setIsOpen(false);
      setQuery('');
    }
  }

  // Determine if we're showing active sessions or search results
  const showingActiveSessions = query.trim().length === 0 && activeResults.length > 0;
  const displayResults = showingActiveSessions ? activeResults : results;

  // Deduplicate by cardId (keep first match per card)
  const seen = new Set<string>();
  const deduped = displayResults.filter(r => {
    if (seen.has(r.cardId)) return false;
    seen.add(r.cardId);
    return true;
  });

  // Split active vs archived, then group by project
  const activeSearchResults = deduped.filter(r => !r.isArchived);
  const archivedSearchResults = deduped.filter(r => r.isArchived);

  const grouped = activeSearchResults.reduce<Record<string, SearchResult[]>>((acc, r) => {
    if (!acc[r.projectId]) acc[r.projectId] = [];
    acc[r.projectId].push(r);
    return acc;
  }, {});

  const archivedGrouped = archivedSearchResults.reduce<Record<string, SearchResult[]>>((acc, r) => {
    if (!acc[r.projectId]) acc[r.projectId] = [];
    acc[r.projectId].push(r);
    return acc;
  }, {});

  // "/" or Ctrl/⌘+K jumps to search. Never steals keys from a field or a
  // terminal (Ctrl+K is kill-line there), and stays out of the way while a
  // modal overlay is open.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const slash = e.key === '/' && !e.ctrlKey && !e.metaKey && !e.altKey;
      const modK = (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'k';
      if (!slash && !modK) return;
      const input = inputRef.current;
      if (!input || input.offsetParent === null) return; // hidden instance (other breakpoint)
      const t = e.target as HTMLElement | null;
      if (t && (t.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"], .xterm'))) return;
      if (document.querySelector('.fixed.inset-0.z-50')) return;
      e.preventDefault();
      input.focus();
      input.select();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div ref={containerRef} className="relative w-full max-w-md">
      <div className="relative">
        <svg
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-3"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
        <input
          ref={inputRef}
          type="text"
          aria-label="Search cards"
          aria-keyshortcuts="/ Control+K Meta+K"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => {
            if (results.length > 0) {
              setIsOpen(true);
            } else if (query.trim().length === 0) {
              fetchActiveSessions();
            }
          }}
          onKeyDown={handleKeyDown}
          placeholder={contextProjectId ? "Search cards..." : "Search cards across projects..."}
          className="peer w-full rounded-lg border border-line bg-surface-2 py-2 pl-10 pr-10 text-sm text-ink-1 placeholder-ink-3 transition-colors focus:border-accent focus:bg-surface-1 focus:outline-none"
        />
        {loading ? (
          <div className="absolute right-3 top-1/2 -translate-y-1/2">
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-line-strong border-t-accent" />
          </div>
        ) : !query && (
          <kbd className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 rounded border border-line bg-surface-1 px-1.5 font-mono text-[11px] leading-[18px] text-ink-3 peer-focus:hidden" aria-hidden="true">/</kbd>
        )}
      </div>

      {isOpen && (
        <div className="absolute top-full z-50 mt-1 w-full overflow-hidden rounded-lg border border-line bg-surface-1 shadow-(--shadow-overlay)">
          {deduped.length === 0 ? (
            <div className="px-4 py-3 text-sm text-ink-3">
              {showingActiveSessions ? 'No active sessions' : 'No results found'}
            </div>
          ) : (
            <div className="max-h-80 overflow-y-auto">
              {/* Active sessions header */}
              {showingActiveSessions && (
                <div className="sticky top-0 z-10 border-b border-line bg-surface-2 px-3 py-1.5 text-xs font-medium text-ink-2">
                  <span className="inline-flex items-center gap-1.5">
                    <span className="relative flex h-2 w-2">
                      <span className="absolute inline-flex h-full w-full rounded-full bg-live opacity-40"></span>
                      <span className="relative inline-flex h-2 w-2 rounded-full bg-live"></span>
                    </span>
                    Active Sessions
                  </span>
                </div>
              )}

              {/* Results grouped by project */}
              {Object.entries(grouped).map(([projectId, projectResults]) => (
                <div key={projectId}>
                  <div className={`sticky border-b px-3 py-1.5 text-xs font-medium ${
                    showingActiveSessions
                      ? 'top-[29px] border-line bg-surface-2 text-ink-3'
                      : 'top-0 border-line bg-surface-2 text-ink-3'
                  }`}>
                    {projectResults[0].projectName}
                    {projectResults[0].projectStatus && (
                      <span className="ml-2 font-normal text-warn-text">{PROJECT_STATUS_LABELS[projectResults[0].projectStatus]}</span>
                    )}
                  </div>
                  {projectResults.map((result, idx) => (
                    <button
                      key={`${result.cardId}-${result.matchField}-${idx}`}
                      onClick={() => {
                        setIsOpen(false);
                        setQuery('');
                        onResultClick?.(result);
                      }}
                      className={`block w-full px-3 py-2 text-left hover:bg-void-100 dark:hover:bg-void-800 ${
                        showingActiveSessions ? 'border-l-2 border-l-live/60' : ''
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        {showingActiveSessions && (
                          <span className="flex h-2 w-2 shrink-0 rounded-full bg-live" />
                        )}
                        <span className="text-sm font-medium text-ink-1">
                          {result.cardTitle}
                        </span>
                        <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${stageColors[result.stage]}`}>
                          {result.stage}
                        </span>
                      </div>
                      <p className={`mt-0.5 truncate text-xs text-ink-3 ${showingActiveSessions ? 'ml-4' : ''}`}>
                        {result.snippet}
                      </p>
                    </button>
                  ))}
                </div>
              ))}

              {/* Archived results */}
              {archivedSearchResults.length > 0 && !showingActiveSessions && (
                <>
                  <div className="sticky top-0 border-b border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-600 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-400">
                    Archived
                  </div>
                  {Object.entries(archivedGrouped).map(([projectId, projectResults]) => (
                    <div key={`archived-${projectId}`}>
                      <div className="border-b border-line bg-surface-2 px-3 py-1 text-[10px] text-ink-3">
                        {projectResults[0].projectName}
                      </div>
                      {projectResults.map((result, idx) => (
                        <button
                          key={`archived-${result.cardId}-${result.matchField}-${idx}`}
                          onClick={() => {
                            setIsOpen(false);
                            setQuery('');
                            onResultClick?.(result);
                          }}
                          className="block w-full px-3 py-2 text-left opacity-70 hover:bg-surface-3"
                        >
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium text-ink-2">
                              {result.cardTitle}
                            </span>
                            <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-600 dark:bg-amber-900/40 dark:text-amber-400">
                              archived
                            </span>
                          </div>
                          <p className="mt-0.5 truncate text-xs text-ink-3">
                            {result.snippet}
                          </p>
                        </button>
                      ))}
                    </div>
                  ))}
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
