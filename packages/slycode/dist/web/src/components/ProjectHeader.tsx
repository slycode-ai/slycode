'use client';

import { useState, useCallback, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { SlyActionConfigModal } from './SlyActionConfigModal';
import { ActionUpdatesModal } from './ActionUpdatesModal';
import { HealthMonitor } from './HealthMonitor';
import { SearchBar } from './SearchBar';
import { ThemeToggle } from './ThemeToggle';

interface ProjectHeaderProps {
  name: string;
  description: string;
  tags: string[];
  projectId?: string;
  projectPath?: string;
  showArchived?: boolean;
  onToggleArchived?: () => void;
  showAutomations?: boolean;
  hasActiveAutomations?: boolean;
  onToggleAutomations?: () => void;
  onRefresh?: () => Promise<void>;
}

export function ProjectHeader({ name, description, tags: _tags, projectId, projectPath, showArchived = false, onToggleArchived, showAutomations = false, hasActiveAutomations = false, onToggleAutomations, onRefresh }: ProjectHeaderProps) {
  const [showCommandConfig, setShowCommandConfig] = useState(false);
  const [showActionUpdates, setShowActionUpdates] = useState(false);
  const [showMobileSearch, setShowMobileSearch] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [actionUpdateCount, setActionUpdateCount] = useState(0);
  const router = useRouter();

  // Poll for action updates
  useEffect(() => {
    let mounted = true;
    async function checkUpdates() {
      try {
        const res = await fetch('/api/cli-assets/updates');
        if (res.ok && mounted) {
          const data = await res.json();
          setActionUpdateCount(data.actionEntries?.length ?? 0);
        }
      } catch { /* ignore */ }
    }
    checkUpdates();
    const interval = setInterval(checkUpdates, 60_000);
    return () => { mounted = false; clearInterval(interval); };
  }, []);

  const handleRefresh = useCallback(async () => {
    if (isRefreshing || !onRefresh) return;
    setIsRefreshing(true);
    try {
      await onRefresh();
    } finally {
      // Keep spinning briefly so the animation is visible
      setTimeout(() => setIsRefreshing(false), 400);
    }
  }, [isRefreshing, onRefresh]);

  return (
    <>
      <header className="neon-header-border relative z-10 flex-shrink-0 bg-void-50 shadow-[0_4px_12px_-2px_rgba(0,0,0,0.15)] dark:bg-void-800 dark:shadow-[0_4px_12px_-2px_rgba(0,0,0,0.5)]">
        <div className="px-4 py-3">
          <div className="flex items-center gap-2 sm:gap-4">
            {/* Fox logo nav */}
            <Link href="/" className="shrink-0 rounded-lg p-0.5">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/slycode_logo_light.webp"
                alt="Home"
                className="logo-nav h-[40px] w-[40px] sm:h-[52px] sm:w-[52px] object-contain mix-blend-multiply dark:hidden"
              />
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/slycode_logo.webp"
                alt="Home"
                className="logo-nav hidden h-[40px] w-[40px] sm:h-[52px] sm:w-[52px] object-contain mix-blend-lighten dark:block"
              />
            </Link>
            <div className="hidden min-w-0 flex-1 sm:block">
              <h1 className="truncate text-xl font-bold text-void-950 dark:text-void-100">
                {name}
              </h1>
              <p className="truncate text-sm text-void-500 dark:text-void-400">
                {description}
              </p>
            </div>

            {/* Mobile search trigger */}
            <button
              onClick={() => setShowMobileSearch(true)}
              className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg border border-void-200/40 bg-transparent p-2 text-void-500 transition-all hover:border-neon-blue-400/40 hover:bg-neon-blue-400/5 hover:text-neon-blue-400 dark:border-void-700/40 dark:text-void-400 dark:hover:border-neon-blue-400/40 dark:hover:bg-neon-blue-400/5 dark:hover:text-neon-blue-400 sm:hidden"
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </button>

            {/* Desktop search bar */}
            <div className="hidden w-64 shrink-0 sm:block">
              <SearchBar
                contextProjectId={projectId}
                onResultClick={(result) => {
                  router.push(`/project/${result.projectId}?card=${result.cardId}`);
                }}
              />
            </div>

            <div className="ml-auto flex items-center gap-1 sm:gap-2">
              {/* Refresh board */}
              {onRefresh && (
                <button
                  onClick={handleRefresh}
                  title="Refresh board from disk"
                  className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg border border-void-200/40 bg-transparent p-2 text-void-500 transition-all hover:border-neon-blue-400/40 hover:bg-neon-blue-400/5 hover:text-neon-blue-400 dark:border-void-700/40 dark:text-void-400 dark:hover:border-neon-blue-400/40 dark:hover:bg-neon-blue-400/5 dark:hover:text-neon-blue-400"
                >
                  <svg
                    className={`h-4 w-4 transition-transform${isRefreshing ? ' animate-spin' : ''}`}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                </button>
              )}

              {/* Theme toggle */}
              <ThemeToggle />

              {/* Health Monitor */}
              <HealthMonitor />

              {/* Actions button - ghost neon — hidden on mobile */}
              <button
                onClick={() => setShowCommandConfig(true)}
                title="Sly Actions"
                className="relative hidden sm:flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg border border-void-200/40 bg-transparent p-2 text-void-500 transition-all hover:border-neon-blue-400/40 hover:bg-neon-blue-400/5 hover:text-neon-blue-400 dark:border-void-700/40 dark:text-void-400 dark:hover:border-neon-blue-400/40 dark:hover:bg-neon-blue-400/5 dark:hover:text-neon-blue-400"
              >
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h7" />
                </svg>
                {actionUpdateCount > 0 && (
                  <span className="absolute -right-1 -top-1 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-neon-blue-500 px-1 text-[10px] font-bold text-white">
                    {actionUpdateCount}
                  </span>
                )}
              </button>

              {/* Automations toggle button - ghost orange, pulses when automations are active */}
              <button
                onClick={onToggleAutomations}
                title={showAutomations ? 'Show kanban board' : 'Show automations'}
                className={`flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg border p-2 transition-all ${
                  showAutomations
                    ? 'border-orange-400/50 bg-orange-400/10 text-orange-500 hover:bg-orange-400/20 dark:text-orange-400'
                    : `border-void-200/40 bg-transparent text-void-500 hover:border-orange-400/40 hover:bg-orange-400/5 hover:text-orange-400 dark:border-void-700/40 dark:text-void-400 dark:hover:border-orange-400/40 dark:hover:bg-orange-400/5 dark:hover:text-orange-400${hasActiveAutomations ? ' active-glow-automation-btn text-orange-400 dark:text-orange-400' : ''}`
                }`}
              >
                {showAutomations ? (
                  <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
                  </svg>
                ) : (
                  <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                )}
              </button>

              {/* Archive toggle button - ghost neon */}
              <button
                onClick={onToggleArchived}
                title={showArchived ? 'Show active cards' : 'Show archived cards'}
                className={`flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg border p-2 transition-all ${
                  showArchived
                    ? 'border-neon-orange-400/50 bg-neon-orange-400/8 text-neon-orange-500 hover:bg-neon-orange-400/15 dark:text-neon-orange-400'
                    : 'border-void-200/40 bg-transparent text-void-500 hover:border-neon-blue-400/40 hover:bg-neon-blue-400/5 hover:text-neon-blue-400 dark:border-void-700/40 dark:text-void-400 dark:hover:border-neon-blue-400/40 dark:hover:bg-neon-blue-400/5 dark:hover:text-neon-blue-400'
                }`}
              >
                {showArchived ? (
                  <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
                  </svg>
                ) : (
                  <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" />
                  </svg>
                )}
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Mobile search overlay */}
      {showMobileSearch && (
        <div className="fixed inset-x-0 top-0 z-50 bg-void-50 p-3 shadow-lg dark:bg-void-800 sm:hidden">
          <div className="flex items-center gap-2">
            <div className="flex-1">
              <SearchBar
                contextProjectId={projectId}
                onResultClick={(result) => {
                  setShowMobileSearch(false);
                  router.push(`/project/${result.projectId}?card=${result.cardId}`);
                }}
              />
            </div>
            <button
              onClick={() => setShowMobileSearch(false)}
              className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg p-2 text-void-500 hover:text-void-700 dark:text-void-400 dark:hover:text-void-200"
            >
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
      )}

      {/* Command Configuration Modal */}
      {showCommandConfig && (
        <SlyActionConfigModal
          onClose={() => {
            setShowCommandConfig(false);
            // Invalidate actions cache on modal close
            fetch('/api/sly-actions/invalidate', { method: 'POST' }).catch(() => {});
          }}
          projectId={projectId}
          projectPath={projectPath}
          actionUpdateCount={actionUpdateCount}
          onShowActionUpdates={() => {
            setShowCommandConfig(false);
            setShowActionUpdates(true);
          }}
        />
      )}

      {/* Action Updates Modal */}
      {showActionUpdates && (
        <ActionUpdatesModal
          onClose={() => {
            setShowActionUpdates(false);
            // Re-check for updates after closing
            fetch('/api/cli-assets/updates')
              .then(r => r.json())
              .then(d => setActionUpdateCount(d.actionEntries?.length ?? 0))
              .catch(() => {});
          }}
        />
      )}
    </>
  );
}
