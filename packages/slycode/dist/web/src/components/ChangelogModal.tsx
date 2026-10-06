'use client';

import { useEffect, useState, useCallback } from 'react';
import type { ChangelogVersion, ChangelogChangeType } from '@/lib/types';
import { formatDate as formatDateValue } from '@/lib/date-format';

interface ChangelogModalProps {
  onClose: () => void;
}

// ============================================================================
// Type styling
// ============================================================================

const TYPE_LABELS: Record<ChangelogChangeType, string> = {
  feature: 'Feature',
  bugfix: 'Fix',
  improvement: 'Improved',
  chore: 'Chore',
};

const TYPE_STYLES: Record<ChangelogChangeType, string> = {
  feature:
    'border-accent/40 bg-accent/15 text-accent',
  bugfix:
    'border-red-400/40 bg-red-400/15 text-red-600 dark:text-red-400',
  improvement:
    'border-emerald-400/40 bg-emerald-400/15 text-emerald-600 dark:text-emerald-400',
  chore:
    'border-void-400/40 bg-void-400/15 text-ink-2',
};

// ============================================================================
// Component
// ============================================================================

export function ChangelogModal({ onClose }: ChangelogModalProps) {
  const [data, setData] = useState<ChangelogVersion[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Fetch changelog on mount
  useEffect(() => {
    let cancelled = false;
    fetch('/api/changelog')
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((json) => {
        if (cancelled) return;
        setData(Array.isArray(json) ? (json as ChangelogVersion[]) : []);
        setError(null);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : 'Unknown error';
        setError(message);
        setData([]);
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Escape to close
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onClose]);

  const formatDate = useCallback((iso: string): string => {
    if (!iso) return '';
    try {
      const d = new Date(`${iso}T00:00:00`);
      if (Number.isNaN(d.getTime())) return iso;
      return formatDateValue(d);
    } catch {
      return iso;
    }
  }, []);

  return (
    <div
      className="fixed inset-0 z-[55] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="flex w-full max-w-3xl max-h-[85vh] flex-col overflow-hidden rounded-xl border border-line bg-surface-1 shadow-(--shadow-overlay)">
        {/* Header */}
        <div className="flex items-start justify-between border-b border-line px-6 py-5">
          <div>
            <div className="font-mono text-[10px] tracking-[0.22em] text-accent">
              Release History
            </div>
            <h2 className="mt-1 text-2xl font-semibold tracking-tight text-ink-1">
              Changelog
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close changelog"
            className="rounded-md p-1.5 text-ink-3 transition-colors hover:bg-surface-3 hover:text-ink-1"
          >
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden>
              <path
                d="M5 5l10 10M15 5L5 15"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-6 py-6">
          {loading && (
            <div className="flex items-center justify-center py-16">
              <div className="font-mono text-xs text-ink-3">
                Loading…
              </div>
            </div>
          )}

          {!loading && error && (
            <div className="rounded-lg border border-red-300/60 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-300">
              Couldn&apos;t load the changelog: {error}
            </div>
          )}

          {!loading && !error && data && data.length === 0 && (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <div className="mb-2 font-mono text-[10px] tracking-[0.22em] text-ink-3">
                No entries
              </div>
              <p className="text-sm text-ink-3">
                The changelog is empty. Future releases will appear here.
              </p>
            </div>
          )}

          {!loading && !error && data && data.length > 0 && (
            <ol className="relative space-y-9">
              {/* Timeline rail */}
              <div
                className="absolute left-[7px] top-2 bottom-2 w-px bg-gradient-to-b from-accent/50 via-void-300 to-transparent dark:via-void-700"
                aria-hidden
              />

              {data.map((version, idx) => (
                <li key={version.version} className="relative pl-8">
                  {/* Timeline dot */}
                  <div
                    className={`absolute left-0 top-[6px] h-[15px] w-[15px] rounded-full border-2 ${
                      idx === 0
                        ? 'border-accent bg-accent/20'
                        : 'border-line-strong bg-surface-1'
                    }`}
                    aria-hidden
                  >
                    {idx === 0 && (
                      <div className="absolute inset-[2px] animate-pulse rounded-full bg-accent/70" />
                    )}
                  </div>

                  {/* Version header */}
                  <div className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <span className="font-mono text-lg font-semibold text-ink-1">
                      v{version.version}
                    </span>
                    <span className="font-mono text-[11px] tracking-[0.15em] text-ink-3">
                      {formatDate(version.date)}
                    </span>
                    {idx === 0 && (
                      <span className="rounded border border-accent/50 bg-accent/15 px-1.5 py-[2px] font-mono text-[9px] font-medium tracking-[0.15em] text-accent">
                        Latest
                      </span>
                    )}
                  </div>

                  {/* Changes */}
                  <ul className="space-y-2.5">
                    {version.changes.map((change, ci) => (
                      <li key={ci} className="flex items-start gap-3">
                        <span
                          className={`mt-[2px] inline-flex w-20 shrink-0 items-center justify-center rounded border px-1.5 py-[3px] font-mono text-[10px] font-medium ${TYPE_STYLES[change.type]}`}
                        >
                          {TYPE_LABELS[change.type]}
                        </span>
                        <span className="text-sm leading-relaxed text-ink-2">
                          {change.description}
                        </span>
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ol>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-center gap-2 border-t border-line bg-surface-2 px-6 py-3">
          <span className="font-mono text-[10px] tracking-[0.18em] text-ink-3">
            Press
          </span>
          <kbd className="rounded border border-line-strong bg-surface-1 px-1.5 py-[1px] font-mono text-[10px] text-ink-2">
            Esc
          </kbd>
          <span className="font-mono text-[10px] tracking-[0.18em] text-ink-3">
            to close
          </span>
        </div>
      </div>
    </div>
  );
}
