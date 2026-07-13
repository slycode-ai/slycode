'use client';

import { useState, useEffect } from 'react';

const DISMISS_KEY = 'claude-retention-dismissed';
const RESHOW_AFTER_MS = 30 * 24 * 60 * 60 * 1000; // monthly nag until fixed
const SAFE_PERIOD_DAYS = 365;
const SETTINGS_LINE = '"cleanupPeriodDays": 99999';

/**
 * Warns when the server machine's Claude Code install still deletes old
 * transcripts (feature 080). Claude Code's `cleanupPeriodDays` (default 30)
 * permanently removes session files at startup — card sessions older than
 * that stop being resumable. The toast only renders while the setting is
 * missing or below a year; fixing the setting retires it for good.
 */
export function RetentionWarningToast() {
  const [periodDays, setPeriodDays] = useState<number | null | undefined>(undefined);
  const [dismissed, setDismissed] = useState(true);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/claude-retention')
      .then(res => (res.ok ? res.json() : null))
      .then(data => {
        if (cancelled || !data) return;
        setPeriodDays(data.periodDays ?? null);
        const dismissedAt = Number(localStorage.getItem(DISMISS_KEY) || 0);
        setDismissed(dismissedAt > 0 && Date.now() - dismissedAt < RESHOW_AFTER_MS);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const handleDismiss = () => {
    localStorage.setItem(DISMISS_KEY, String(Date.now()));
    setDismissed(true);
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(SETTINGS_LINE);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard unavailable — the line is visible to copy by hand
    }
  };

  const atRisk = periodDays === null || (typeof periodDays === 'number' && periodDays < SAFE_PERIOD_DAYS);
  if (periodDays === undefined || !atRisk || dismissed) return null;

  return (
    <div className="fixed bottom-4 left-4 z-50 max-w-lg rounded-lg border border-amber-500/40 bg-void-50 px-4 py-3 shadow-(--shadow-card) dark:border-amber-500/25 dark:bg-void-900">
      <div className="flex items-start gap-3">
        <span
          className="mt-1 h-2 w-2 shrink-0 rounded-full bg-amber-400"
          style={{ boxShadow: '0 0 6px rgba(251,191,36,0.5)' }}
        />
        <div className="min-w-0">
          <p className="text-sm text-void-700 dark:text-void-300">
            Claude Code deletes session transcripts after{' '}
            <span className="font-medium text-amber-600 dark:text-amber-400">
              {periodDays === null ? '30 days (default)' : `${periodDays} days`}
            </span>{' '}
            — older card sessions become unresumable.
          </p>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs text-void-500 dark:text-void-400">
            <span>To keep them, add</span>
            <code className="rounded bg-void-100 px-1.5 py-0.5 text-void-600 dark:bg-void-800 dark:text-void-400">
              {SETTINGS_LINE}
            </code>
            <button
              onClick={handleCopy}
              className="rounded border border-void-300 px-1.5 py-0.5 text-void-500 transition-colors hover:bg-void-200 hover:text-void-700 dark:border-void-600 dark:text-void-400 dark:hover:bg-void-800 dark:hover:text-void-200"
            >
              {copied ? 'Copied' : 'Copy'}
            </button>
            <span>to</span>
            <code className="rounded bg-void-100 px-1.5 py-0.5 text-void-600 dark:bg-void-800 dark:text-void-400">
              ~/.claude/settings.json
            </code>
            <span>on this machine.</span>
          </div>
        </div>
        <button
          onClick={handleDismiss}
          className="ml-1 shrink-0 rounded p-0.5 text-void-400 transition-colors hover:bg-void-200 hover:text-void-600 dark:text-void-500 dark:hover:bg-void-800 dark:hover:text-void-300"
          aria-label="Dismiss for 30 days"
        >
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    </div>
  );
}
