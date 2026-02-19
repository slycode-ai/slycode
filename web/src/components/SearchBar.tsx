'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import type { SearchResult, KanbanStage } from '@/lib/types';

interface SearchBarProps {
  contextProjectId?: string;
  onResultClick?: (result: SearchResult) => void;
}

const stageColors: Record<KanbanStage, string> = {
  backlog: 'bg-void-200 text-void-500 dark:bg-void-700 dark:text-void-300',
  design: 'bg-neon-blue-50 text-neon-blue-600 dark:bg-neon-blue-900/50 dark:text-neon-blue-300',
  implementation: 'bg-neon-blue-100 text-neon-blue-700 dark:bg-neon-blue-900/50 dark:text-neon-blue-300',
  testing: 'bg-neon-orange-50 text-neon-orange-600 dark:bg-neon-orange-900/50 dark:text-neon-orange-300',
  done: 'bg-green-50 text-green-700 dark:bg-green-900/50 dark:text-green-300',
};

export function SearchBar({ contextProjectId, onResultClick }: SearchBarProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [activeResults, setActiveResults] = useState<SearchResult[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
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

  return (
    <div ref={containerRef} className="relative w-full max-w-md">
      <div className="relative">
        <svg
          className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-void-400"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
        <input
          type="text"
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
          className="w-full rounded-lg border border-void-200 bg-void-50 py-2 pl-10 pr-4 text-sm text-void-950 placeholder-void-400 focus:border-neon-blue-400/60 focus:bg-white focus:shadow-[0_0_12px_-2px_rgba(0,191,255,0.25)] focus:outline-none dark:border-void-700/50 dark:bg-void-800/50 dark:text-void-100 dark:placeholder-void-500 dark:focus:border-neon-blue-400/60 dark:focus:bg-void-800"
        />
        {loading && (
          <div className="absolute right-3 top-1/2 -translate-y-1/2">
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-void-300 border-t-neon-blue-400" />
          </div>
        )}
      </div>

      {isOpen && (
        <div className="absolute top-full z-50 mt-1 w-full overflow-hidden rounded-lg border border-void-200 bg-void-50 shadow-(--shadow-overlay) dark:border-void-700 dark:bg-void-900">
          {deduped.length === 0 ? (
            <div className="px-4 py-3 text-sm text-void-500 dark:text-void-400">
              {showingActiveSessions ? 'No active sessions' : 'No results found'}
            </div>
          ) : (
            <div className="max-h-80 overflow-y-auto">
              {/* Active sessions header */}
              {showingActiveSessions && (
                <div className="sticky top-0 z-10 border-b border-neon-blue-200 bg-neon-blue-50 px-3 py-1.5 text-xs font-medium text-neon-blue-600 dark:border-neon-blue-800 dark:bg-neon-blue-950/50 dark:text-neon-blue-400">
                  <span className="inline-flex items-center gap-1.5">
                    <span className="relative flex h-2 w-2">
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-neon-blue-400 opacity-75"></span>
                      <span className="relative inline-flex h-2 w-2 rounded-full bg-neon-blue-500"></span>
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
                      ? 'top-[29px] border-void-100/50 bg-void-50 text-void-400 dark:border-void-700/50 dark:bg-void-900 dark:text-void-500'
                      : 'top-0 border-void-100 bg-void-100 text-void-500 dark:border-void-700 dark:bg-void-800 dark:text-void-400'
                  }`}>
                    {projectResults[0].projectName}
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
                        showingActiveSessions ? 'border-l-2 border-l-neon-blue-400/50' : ''
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        {showingActiveSessions && (
                          <span className="flex h-2 w-2 shrink-0 rounded-full bg-neon-blue-400" style={{ boxShadow: '0 0 6px rgba(0,191,255,0.5)' }} />
                        )}
                        <span className="text-sm font-medium text-void-900 dark:text-void-100">
                          {result.cardTitle}
                        </span>
                        <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${stageColors[result.stage]}`}>
                          {result.stage}
                        </span>
                      </div>
                      <p className={`mt-0.5 truncate text-xs text-void-500 dark:text-void-400 ${showingActiveSessions ? 'ml-4' : ''}`}>
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
                      <div className="border-b border-void-100 bg-void-100/50 px-3 py-1 text-[10px] text-void-400 dark:border-void-700 dark:bg-void-800/50 dark:text-void-500">
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
                          className="block w-full px-3 py-2 text-left opacity-70 hover:bg-void-100 dark:hover:bg-void-800"
                        >
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium text-void-600 dark:text-void-400">
                              {result.cardTitle}
                            </span>
                            <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-600 dark:bg-amber-900/40 dark:text-amber-400">
                              archived
                            </span>
                          </div>
                          <p className="mt-0.5 truncate text-xs text-void-500 dark:text-void-400">
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
