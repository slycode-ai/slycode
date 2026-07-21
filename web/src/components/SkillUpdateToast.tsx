'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import type { SkillStatusResponse, SkillUpdateStatus, WatchedSkillName } from '@/lib/types';

interface Props {
  projectId: string;
}

const POLL_INTERVAL = 15 * 60 * 1000; // 15 minutes
const DISMISS_MS = 60 * 60 * 1000;     // 1 hour cool-off
const DISMISS_KEY_PREFIX = 'slycode-skill-update-dismissed';
// The watch list covers every shipped skill; cap the panel so a big release
// doesn't fill the corner — overflow collapses into one summary row.
const MAX_ROWS = 4;

function dismissKey(projectId: string, skill: WatchedSkillName, latestVersion: string | null): string {
  return `${DISMISS_KEY_PREFIX}:${projectId}:${skill}:${latestVersion ?? 'unknown'}`;
}

function readDismiss(key: string): number | null {
  try {
    const v = localStorage.getItem(key);
    if (!v) return null;
    const n = Number.parseInt(v, 10);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

function writeDismiss(key: string, ts: number): void {
  try {
    localStorage.setItem(key, String(ts));
  } catch {
    // localStorage disabled / quota exceeded — fall back to in-memory only.
  }
}

export function SkillUpdateToast({ projectId }: Props) {
  const [statuses, setStatuses] = useState<SkillUpdateStatus[]>([]);
  const [visible, setVisible] = useState<SkillUpdateStatus[]>([]);
  // In-memory dismissed timestamps, used both as fast-path read cache and
  // as fallback when localStorage is unavailable.
  const dismissedRef = useRef<Map<string, number>>(new Map());
  const router = useRouter();

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/skill-status?projectId=${encodeURIComponent(projectId)}`);
      if (!res.ok) return;
      const data: SkillStatusResponse = await res.json();
      setStatuses(data.skills);
    } catch {
      // Silent fail — toast is non-critical.
    }
  }, [projectId]);

  // Initial fetch + 15-min interval poll. The setState happens inside the
  // async refresh callback, but the lint rule still flags the synchronous
  // call site; suppressing matches the codebase pattern (CliAssetsTab,
  // FloatingVoiceWidget, etc.).
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refresh();
    const interval = setInterval(refresh, POLL_INTERVAL);
    return () => clearInterval(interval);
  }, [refresh]);

  // Recheck on window focus / visibility change so the toast updates promptly
  // after the user accepts/deploys an update in another view.
  useEffect(() => {
    const onFocus = () => refresh();
    const onVisibility = () => { if (document.visibilityState === 'visible') refresh(); };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [refresh]);

  // Recompute the visible set whenever statuses change. Kept out of render
  // because Date.now() is impure — React Compiler flags reads during render.
  // Also re-evaluates on a 1-min tick so a row reappears after the cool-off
  // expires even if statuses haven't changed.
  useEffect(() => {
    const recompute = () => {
      const now = Date.now();
      const next = statuses
        .filter(s => s.state === 'accept' || s.state === 'deploy')
        .filter(s => {
          const key = dismissKey(projectId, s.name, s.latestVersion);
          const ts = dismissedRef.current.get(key) ?? readDismiss(key);
          if (ts == null) return true;
          return now - ts >= DISMISS_MS;
        });
      setVisible(next);
    };
    recompute();
    const interval = setInterval(recompute, 60 * 1000);
    return () => clearInterval(interval);
  }, [statuses, projectId]);

  const handleClick = useCallback((s: SkillUpdateStatus) => {
    if (s.state === 'accept') {
      router.push(`/?tab=updates&focus=${encodeURIComponent(s.name)}`);
    } else {
      router.push(`/?tab=cli-assets&projectId=${encodeURIComponent(projectId)}&skill=${encodeURIComponent(s.name)}`);
    }
  }, [router, projectId]);

  const handleDismiss = useCallback(() => {
    const now = Date.now();
    for (const s of visible) {
      const key = dismissKey(projectId, s.name, s.latestVersion);
      dismissedRef.current.set(key, now);
      writeDismiss(key, now);
    }
    setVisible([]);
  }, [visible, projectId]);

  if (visible.length === 0) return null;

  const shown = visible.slice(0, MAX_ROWS);
  const overflow = visible.slice(MAX_ROWS);

  return (
    <div
      className="fixed bottom-4 right-4 z-50 flex max-w-[calc(100vw-2rem)] flex-col gap-1 rounded-lg border border-amber-400/40 bg-void-50 px-3 py-2.5 shadow-(--shadow-card) dark:border-amber-400/30 dark:bg-void-900 sm:max-w-md"
      style={{
        paddingBottom: 'max(0.625rem, env(safe-area-inset-bottom))',
        paddingRight: 'max(0.75rem, env(safe-area-inset-right))',
      }}
    >
      <div className="flex items-start gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          {shown.map(s => (
            <SkillRow key={s.name} status={s} onClick={() => handleClick(s)} />
          ))}
          {overflow.length > 0 && (
            <button
              onClick={() => handleClick(overflow[0])}
              className="text-left text-[11px] text-void-500 hover:text-void-700 dark:text-void-400 dark:hover:text-void-200"
            >
              +{overflow.length} more skill {overflow.length === 1 ? 'update' : 'updates'}
            </button>
          )}
        </div>
        <button
          onClick={handleDismiss}
          className="ml-1 mt-0.5 rounded p-0.5 text-void-400 transition-colors hover:bg-void-200 hover:text-void-600 dark:text-void-500 dark:hover:bg-void-800 dark:hover:text-void-300"
          aria-label="Dismiss for 1 hour"
          title="Dismiss for 1 hour"
        >
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    </div>
  );
}

function SkillRow({ status, onClick }: { status: SkillUpdateStatus; onClick: () => void }) {
  const isAccept = status.state === 'accept';
  const accent = isAccept ? 'bg-amber-400' : 'bg-neon-blue-400';
  const accentGlow = isAccept ? '0 0 6px rgba(251,191,36,0.6)' : '0 0 6px rgba(0,191,255,0.5)';
  const versionColor = isAccept
    ? 'text-amber-500 dark:text-amber-400'
    : 'text-neon-blue-500 dark:text-neon-blue-400';

  const message = isAccept
    ? (
      <>
        <span className="capitalize">{status.name}</span>{' '}
        <span className={`font-mono font-medium ${versionColor}`}>v{status.latestVersion ?? '?'}</span>{' '}
        ready to accept into store
      </>
    )
    : (
      <>
        <span className="capitalize">{status.name}</span>{' '}
        <span className={`font-mono font-medium ${versionColor}`}>v{status.latestVersion ?? '?'}</span>{' '}
        available — this project is on{' '}
        <span className="font-mono text-void-500 dark:text-void-400">v{status.projectVersion ?? '?'}</span>
      </>
    );

  const subtitle = isAccept ? 'Click to review in Updates' : 'Click to deploy to this project';

  return (
    <button
      onClick={onClick}
      className="group flex items-start gap-2 text-left"
    >
      <span
        className={`mt-1.5 h-2 w-2 flex-shrink-0 rounded-full ${accent}`}
        style={{ boxShadow: accentGlow }}
      />
      <span className="flex flex-col">
        <span className="text-sm text-void-700 group-hover:text-void-900 dark:text-void-300 dark:group-hover:text-void-100">
          {message}
        </span>
        <span className="text-[11px] text-void-500 dark:text-void-400">
          {subtitle}
        </span>
      </span>
    </button>
  );
}
