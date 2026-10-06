'use client';

import { copyText } from '@/lib/clipboard';
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
      await copyText(SETTINGS_LINE);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard unavailable — the line is visible to copy by hand
    }
  };

  const atRisk = periodDays === null || (typeof periodDays === 'number' && periodDays < SAFE_PERIOD_DAYS);
  if (periodDays === undefined || !atRisk || dismissed) return null;

  return (
    <div className="fixed bottom-4 left-4 z-50 max-w-lg rounded-xl border border-line border-l-[3px] border-l-warn bg-surface-1 px-4 py-3 shadow-(--shadow-overlay)">
      <div className="flex items-start gap-3">
        <span
          className="mt-1 h-2 w-2 shrink-0 rounded-full bg-warn"
          style={{ boxShadow: '0 0 6px rgba(251,191,36,0.5)' }}
        />
        <div className="min-w-0">
          <p className="text-sm text-ink-2">
            Claude Code deletes session transcripts after{' '}
            <span className="font-medium text-amber-600 dark:text-amber-400">
              {periodDays === null ? '30 days (default)' : `${periodDays} days`}
            </span>{' '}
            — older card sessions become unresumable.
          </p>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs text-ink-3">
            <span>To keep them, add</span>
            <code className="rounded bg-surface-2 px-1.5 py-0.5 text-ink-2">
              {SETTINGS_LINE}
            </code>
            <button
              onClick={handleCopy}
              className="rounded border border-line-strong px-1.5 py-0.5 text-ink-3 transition-colors hover:bg-surface-3 hover:text-ink-2"
            >
              {copied ? 'Copied' : 'Copy'}
            </button>
            <span>to</span>
            <code className="rounded bg-surface-2 px-1.5 py-0.5 text-ink-2">
              ~/.claude/settings.json
            </code>
            <span>on this machine.</span>
          </div>
        </div>
        <button
          onClick={handleDismiss}
          className="ml-1 shrink-0 rounded p-0.5 text-ink-3 transition-colors hover:bg-surface-3 hover:text-ink-2"
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
