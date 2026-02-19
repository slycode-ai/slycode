'use client';

import { useState, useEffect, useCallback } from 'react';

const DISMISS_KEY = 'slycode-update-dismissed';
const CHECK_INTERVAL = 6 * 60 * 60 * 1000; // 6 hours

function getTodayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

export function VersionUpdateToast() {
  const [info, setInfo] = useState<{ current: string; latest: string } | null>(null);
  const [dismissed, setDismissed] = useState(false);

  const checkVersion = useCallback(async () => {
    try {
      const res = await fetch('/api/version-check');
      if (!res.ok) return;
      const data = await res.json();
      if (data.updateAvailable && data.latest) {
        setInfo({ current: data.current, latest: data.latest });
        // Re-show if dismissed on a previous day
        const dismissedDate = localStorage.getItem(DISMISS_KEY);
        setDismissed(dismissedDate === getTodayStr());
      } else {
        setInfo(null);
      }
    } catch {
      // Fail silently
    }
  }, []);

  useEffect(() => {
    checkVersion();
    const interval = setInterval(checkVersion, CHECK_INTERVAL);
    return () => clearInterval(interval);
  }, [checkVersion]);

  const handleDismiss = () => {
    localStorage.setItem(DISMISS_KEY, getTodayStr());
    setDismissed(true);
  };

  if (!info || dismissed) return null;

  return (
    <div className="fixed bottom-4 left-4 z-50 flex items-center gap-3 rounded-lg border border-neon-blue-400/40 bg-void-50 px-4 py-2.5 shadow-(--shadow-card) dark:border-neon-blue-400/25 dark:bg-void-900">
      <div className="flex items-center gap-2">
        <span
          className="h-2 w-2 rounded-full bg-neon-blue-400"
          style={{ boxShadow: '0 0 6px rgba(0,191,255,0.5)' }}
        />
        <span className="text-sm text-void-700 dark:text-void-300">
          SlyCode <span className="font-medium text-neon-blue-500 dark:text-neon-blue-400">v{info.latest}</span> available
          <span className="text-void-500 dark:text-void-400"> (current: v{info.current})</span>
        </span>
      </div>
      <code className="rounded bg-void-100 px-1.5 py-0.5 text-xs text-void-600 dark:bg-void-800 dark:text-void-400">
        slycode update
      </code>
      <button
        onClick={handleDismiss}
        className="ml-1 rounded p-0.5 text-void-400 transition-colors hover:bg-void-200 hover:text-void-600 dark:text-void-500 dark:hover:bg-void-800 dark:hover:text-void-300"
        aria-label="Dismiss"
      >
        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  );
}
