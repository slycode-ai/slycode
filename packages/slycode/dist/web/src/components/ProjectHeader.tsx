'use client';

import { useState, useCallback, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { SlyActionConfigModal } from './SlyActionConfigModal';
import { ActionUpdatesModal } from './ActionUpdatesModal';
import { ShortcutsConfigModal } from './ShortcutsConfigModal';
import { DefaultProviderConfig } from './DefaultProviderConfig';
import { HealthMonitor } from './HealthMonitor';
import { SearchBar } from './SearchBar';
import { ThemeToggle } from './ThemeToggle';
import Tooltip from './Tooltip';
import { VoiceSettingsButton } from './VoiceSettingsButton';

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
  codeMode?: boolean;
  onToggleCodeMode?: () => void;
  /** true when board-side sessions are busy while the user is in Code Mode */
  boardActive?: boolean;
}

export function ProjectHeader({ name, description, tags: _tags, projectId, projectPath, showArchived = false, onToggleArchived, showAutomations = false, hasActiveAutomations = false, onToggleAutomations, onRefresh, codeMode = false, onToggleCodeMode, boardActive = false }: ProjectHeaderProps) {
  const [showCommandConfig, setShowCommandConfig] = useState(false);
  const [showActionUpdates, setShowActionUpdates] = useState(false);
  const [showShortcutsConfig, setShowShortcutsConfig] = useState(false);
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
      <header className={`fox-rule relative z-10 flex-shrink-0 bg-surface-1${!codeMode && !showAutomations ? ' lane-rule' : ''}`}>
        <div className="px-4 py-2">
          <div className="flex items-center gap-2 sm:gap-4">
            {/* Fox logo nav */}
            <Link href="/" className="shrink-0 rounded-lg p-0.5">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/slycode_logo_light.webp"
                alt="Home"
                className="logo-nav h-[36px] w-[36px] sm:h-[40px] sm:w-[40px] object-contain mix-blend-multiply dark:hidden"
              />
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/slycode_logo.webp"
                alt="Home"
                className="logo-nav hidden h-[36px] w-[36px] sm:h-[40px] sm:w-[40px] object-contain mix-blend-lighten dark:block"
              />
            </Link>
            <div className="hidden min-w-0 flex-1 sm:block">
              <h1 className="truncate text-base font-semibold leading-6 text-ink-1">
                {name}
              </h1>
              <p className="truncate text-[13px] leading-5 text-ink-3">
                {description}
              </p>
            </div>

            {/* Mobile voice settings (#0376) */}
            <VoiceSettingsButton />

            {/* Mobile search trigger */}
            <button
              onClick={() => setShowMobileSearch(true)}
              className="flex min-h-[44px] min-w-[44px] sm:min-h-9 sm:min-w-9 items-center justify-center rounded-lg p-2 text-ink-3 transition-colors hover:bg-surface-3 hover:text-ink-1 sm:hidden"
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
                  // Archived hits need the board in archived mode or the card
                  // isn't loaded and the deep-link silently finds nothing.
                  const archived = result.isArchived ? '&archived=1' : '';
                  router.push(`/project/${result.projectId}?card=${result.cardId}${archived}`);
                }}
              />
            </div>

            <div className="ml-auto flex items-center gap-1 sm:gap-2">
              {/* Board | Code Mode toggle (feature 076) */}
              {onToggleCodeMode && (
                <div className="hidden gap-0.5 rounded-lg border border-line bg-surface-2 p-0.5 text-[13px] font-medium sm:flex">
                  <Tooltip content={codeMode && boardActive ? 'Board sessions are busy — click to watch' : 'Kanban board'} placement="bottom">
                    <button
                      onClick={onToggleCodeMode}
                      className={`h-8 rounded-md px-3 transition-colors ${
                        !codeMode
                          ? 'bg-surface-1 text-ink-1 shadow-(--shadow-card)'
                          : `text-ink-3 hover:text-ink-1${boardActive ? ' active-glow-board-btn' : ''}`
                      }`}
                    >
                      Board
                    </button>
                  </Tooltip>
                  <Tooltip content="Code Mode — codebase atlas & explorer" placement="bottom">
                    <button
                      onClick={onToggleCodeMode}
                      className={`h-8 rounded-md px-3 transition-colors ${
                        codeMode
                          ? 'bg-surface-1 text-teal-700 shadow-(--shadow-card) dark:text-teal-300'
                          : 'text-ink-3 hover:text-ink-1'
                      }`}
                    >
                      Code mode
                    </button>
                  </Tooltip>
                </div>
              )}

              {/* Refresh board */}
              {onRefresh && (
                <Tooltip content="Refresh board from disk" placement="bottom">
                  <button
                    onClick={handleRefresh}
                    aria-label="Refresh board from disk"
                    className="flex min-h-[44px] min-w-[44px] sm:min-h-9 sm:min-w-9 items-center justify-center rounded-lg p-2 text-ink-3 transition-colors hover:bg-surface-3 hover:text-ink-1"
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
                </Tooltip>
              )}

              {/* Theme toggle */}
              <ThemeToggle />

              {/* Health Monitor */}
              <HealthMonitor />

              <span aria-hidden="true" className="mx-1 hidden h-5 w-px bg-line sm:block" />

              {/* Actions button - ghost neon — hidden on mobile */}
              <Tooltip content="Sly Actions" placement="bottom">
                <button
                  onClick={() => setShowCommandConfig(true)}
                  aria-label="Sly Actions"
                  className="relative hidden sm:flex min-h-[44px] min-w-[44px] sm:min-h-9 sm:min-w-9 items-center justify-center rounded-lg p-2 text-ink-3 transition-colors hover:bg-surface-3 hover:text-ink-1"
                >
                  <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h7" />
                  </svg>
                  {actionUpdateCount > 0 && (
                    <span className="absolute -right-1 -top-1 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-accent px-1 font-mono text-[10px] font-semibold text-white dark:text-[#04121a]">
                      {actionUpdateCount}
                    </span>
                  )}
                </button>
              </Tooltip>

              {/* Shortcuts button — ghost neon, sibling to Actions */}
              <Tooltip content="Quick-launch shortcuts" placement="bottom">
                <button
                  onClick={() => setShowShortcutsConfig(true)}
                  aria-label="Quick-launch shortcuts"
                  className="relative hidden sm:flex min-h-[44px] min-w-[44px] sm:min-h-9 sm:min-w-9 items-center justify-center rounded-lg p-2 text-ink-3 transition-colors hover:bg-surface-3 hover:text-ink-1"
                >
                  <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                  </svg>
                </button>
              </Tooltip>

              {/* Per-project default provider/model — ghost neon, sibling to Shortcuts (feature 073) */}
              {projectId && <DefaultProviderConfig projectId={projectId} />}

              <span aria-hidden="true" className="mx-1 hidden h-5 w-px bg-line sm:block" />

              {/* Automations toggle button - ghost orange, pulses when automations are active */}
              <Tooltip content={showAutomations ? 'Show kanban board' : 'Show automations'} placement="bottom">
                <button
                  onClick={onToggleAutomations}
                  aria-label={showAutomations ? 'Show kanban board' : 'Show automations'}
                  className={`flex min-h-[44px] min-w-[44px] sm:min-h-9 sm:min-w-9 items-center justify-center rounded-lg border p-2 transition-all ${
                    showAutomations
                      ? 'border-transparent bg-agent/10 text-agent-text'
                      : `border-transparent text-ink-3 hover:bg-surface-3 hover:text-ink-1${hasActiveAutomations ? ' active-glow-automation-btn' : ''}`
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
              </Tooltip>

              {/* Archive toggle button - ghost neon */}
              <Tooltip content={showArchived ? 'Show active cards' : 'Show archived cards'} placement="bottom">
                <button
                  onClick={onToggleArchived}
                  aria-label={showArchived ? 'Show active cards' : 'Show archived cards'}
                  className={`flex min-h-[44px] min-w-[44px] sm:min-h-9 sm:min-w-9 items-center justify-center rounded-lg border p-2 transition-all ${
                    showArchived
                      ? 'border-transparent bg-surface-3 text-ink-1'
                      : 'border-transparent text-ink-3 hover:bg-surface-3 hover:text-ink-1'
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
              </Tooltip>
            </div>
          </div>
        </div>
      </header>

      {/* Mobile search overlay */}
      {showMobileSearch && (
        <div className="fixed inset-x-0 top-0 z-50 bg-surface-2 p-3 shadow-lg sm:hidden">
          <div className="flex items-center gap-2">
            <div className="flex-1">
              <SearchBar
                contextProjectId={projectId}
                onResultClick={(result) => {
                  setShowMobileSearch(false);
                  const archived = result.isArchived ? '&archived=1' : '';
                  router.push(`/project/${result.projectId}?card=${result.cardId}${archived}`);
                }}
              />
            </div>
            <button
              onClick={() => setShowMobileSearch(false)}
              className="flex min-h-[44px] min-w-[44px] sm:min-h-9 sm:min-w-9 items-center justify-center rounded-lg p-2 text-ink-3 hover:text-ink-2"
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

      {/* Quick-launch Shortcuts Modal */}
      {showShortcutsConfig && projectId && (
        <ShortcutsConfigModal
          onClose={() => setShowShortcutsConfig(false)}
          projectId={projectId}
          projectName={name}
        />
      )}
    </>
  );
}
