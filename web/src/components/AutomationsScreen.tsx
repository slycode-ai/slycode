'use client';

import { useEffect, useState } from 'react';
import type { KanbanCard } from '@/lib/types';
import { cronToHumanReadable } from '@/lib/cron-utils';

interface AutomationsScreenProps {
  cards: KanbanCard[];
  activeCards: Set<string>;
  triggeringCards?: Set<string>;
  onCardClick: (card: KanbanCard) => void;
  onCardContextMenu?: (card: KanbanCard, e: React.MouseEvent) => void;
  onCreateAutomation: () => void;
}

function CountdownTimer({ nextRun, enabled }: { nextRun?: string; enabled?: boolean }) {
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (!nextRun || !enabled) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [nextRun, enabled]);

  if (!nextRun || !enabled) {
    return (
      <div className="flex flex-col items-center justify-center">
        <span className="font-mono text-2xl font-bold tracking-wider text-void-300 dark:text-void-600">
          --:--
        </span>
        <span className="text-[9px] uppercase tracking-[0.2em] text-void-300 dark:text-void-600">
          idle
        </span>
      </div>
    );
  }

  const target = new Date(nextRun).getTime();
  const diff = Math.max(0, target - now);

  if (diff === 0) {
    return (
      <div className="flex flex-col items-center justify-center">
        <span className="font-mono text-2xl font-bold tracking-wider text-orange-500 animate-pulse">NOW</span>
      </div>
    );
  }

  const totalSec = Math.floor(diff / 1000);
  const days = Math.floor(totalSec / 86400);
  const hours = Math.floor((totalSec % 86400) / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);
  const seconds = totalSec % 60;

  const pad = (n: number) => String(n).padStart(2, '0');

  let display: string;
  let label: string;
  if (days > 0) {
    display = `${days}d ${pad(hours)}:${pad(minutes)}`;
    label = 'days hrs min';
  } else if (hours > 0) {
    display = `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
    label = 'hrs min sec';
  } else {
    display = `${pad(minutes)}:${pad(seconds)}`;
    label = 'min sec';
  }

  return (
    <div className="flex flex-col items-center justify-center">
      <span className="font-mono text-2xl font-bold tabular-nums tracking-wider text-orange-500 dark:text-orange-400">
        {display}
      </span>
      <span className="text-[9px] uppercase tracking-[0.2em] text-void-400 dark:text-void-500">{label}</span>
    </div>
  );
}

export function AutomationsScreen({ cards, activeCards, triggeringCards, onCardClick, onCardContextMenu, onCreateAutomation }: AutomationsScreenProps) {
  const [schedulerRunning, setSchedulerRunning] = useState<boolean | null>(null);
  const [timezoneAbbr, setTimezoneAbbr] = useState<string>('');

  // Ping scheduler API on mount — triggers auto-start if not running
  useEffect(() => {
    fetch('/api/scheduler')
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        if (data) {
          setSchedulerRunning(data.running);
          if (data.abbreviation) setTimezoneAbbr(data.abbreviation);
        }
      })
      .catch(() => {});
  }, []);

  // Group cards by first tag
  const groups = cards.reduce<Record<string, KanbanCard[]>>((acc, card) => {
    const group = card.tags[0] || 'Ungrouped';
    if (!acc[group]) acc[group] = [];
    acc[group].push(card);
    return acc;
  }, {});

  // Sort groups: named groups first (alphabetical), Ungrouped last
  const sortedGroupNames = Object.keys(groups).sort((a, b) => {
    if (a === 'Ungrouped') return 1;
    if (b === 'Ungrouped') return -1;
    return a.localeCompare(b);
  });

  return (
    <div className="flex-1 overflow-y-auto p-4">
      <div className="mx-auto max-w-5xl">
        {/* Header */}
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-void-900 dark:text-void-100">
            Automations
            <span className="ml-2 text-sm font-normal text-void-500 dark:text-void-400">
              ({cards.length} card{cards.length !== 1 ? 's' : ''})
            </span>
            {timezoneAbbr && (
              <span className="ml-2 rounded bg-void-100 px-1.5 py-0.5 text-xs font-normal text-void-500 dark:bg-void-700 dark:text-void-400">
                {timezoneAbbr}
              </span>
            )}
          </h2>
          <button
            onClick={onCreateAutomation}
            className="rounded-lg border border-orange-500/50 bg-orange-400/10 px-3 py-1.5 text-sm font-medium text-orange-700 transition-colors hover:bg-orange-400/20 dark:border-orange-400/40 dark:text-orange-400"
          >
            + New Automation
          </button>
        </div>

        {cards.length === 0 ? (
          <div className="py-16 text-center">
            <div className="mb-3 text-void-300 dark:text-void-600">
              <svg className="mx-auto h-14 w-14" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <p className="text-sm text-void-500 dark:text-void-400">No automations configured yet.</p>
            <p className="mt-1 text-xs text-void-400 dark:text-void-500">Toggle any card to automation mode, or create a new automation above.</p>
          </div>
        ) : (
          <div className="space-y-6">
            {sortedGroupNames.map((groupName) => (
              <div key={groupName}>
                {/* Group header */}
                <details open>
                  <summary className="mb-3 cursor-pointer text-sm font-medium text-void-600 hover:text-void-800 dark:text-void-400 dark:hover:text-void-200">
                    <span className="ml-1">{groupName}</span>
                    <span className="ml-1 text-void-400 dark:text-void-500">({groups[groupName].length})</span>
                  </summary>

                  {/* 2-column max grid */}
                  <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                    {groups[groupName].map((card) => {
                      const isEnabled = !!card.automation?.enabled;
                      const isActive = activeCards.has(card.id);
                      const isTriggering = triggeringCards?.has(card.id) && !isActive;

                      return (
                        <button
                          key={card.id}
                          onClick={() => onCardClick(card)}
                          onContextMenu={(e) => {
                            if (onCardContextMenu) {
                              e.preventDefault();
                              onCardContextMenu(card, e);
                            }
                          }}
                          className={`group overflow-hidden rounded-lg text-left transition-all border border-void-200/80 border-l-[3px] border-l-orange-500/70 bg-white shadow-(--shadow-card) transition-[transform,box-shadow,border-color] duration-200 hover:translate-y-0.5 hover:shadow-[0_2px_8px_rgba(249,115,22,0.2)] hover:border-orange-400/60 dark:hover:shadow-[0_2px_8px_rgba(249,115,22,0.15)] dark:border-void-700/60 dark:border-l-orange-400/60 dark:bg-void-800 dark:hover:border-orange-400/40 ${isActive ? 'active-glow-automation' : ''}`}
                        >
                          {/* Card body with chevron background — 2 row layout */}
                          <div className={`automation-chevron px-5 py-3 ${isActive ? 'automation-chevron-active' : ''}`}>
                            <div className="relative z-10 flex items-stretch gap-4">
                              {/* Left: 2 rows (title + schedule/badges) */}
                              <div className="min-w-0 flex-1 flex flex-col gap-1.5 justify-center">
                                <h3 className="text-base font-semibold text-void-900 dark:text-void-100 truncate">
                                  {card.title}
                                </h3>
                                <div className="flex items-center gap-3">
                                  <p className="min-w-0 flex-1 truncate text-sm text-void-600 dark:text-void-400">
                                    {card.automation
                                      ? cronToHumanReadable(card.automation.schedule, card.automation.scheduleType, 'No schedule', timezoneAbbr || undefined)
                                      : 'No schedule'}
                                  </p>
                                  <div className="flex shrink-0 items-center gap-1.5">
                                    {card.automation?.provider && (
                                      <span className="rounded bg-void-100 px-1.5 py-0.5 text-[11px] text-void-600 dark:bg-void-700 dark:text-void-400">
                                        {card.automation.provider}
                                      </span>
                                    )}
                                    <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${
                                      isEnabled
                                        ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                                        : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                                    }`}>
                                      {isEnabled ? 'Enabled' : 'Disabled'}
                                    </span>
                                    {card.automation?.lastResult && (
                                      <span className={`rounded px-1.5 py-0.5 text-[11px] ${
                                        card.automation.lastResult === 'success'
                                          ? 'bg-green-50 text-green-600 dark:bg-green-900/20 dark:text-green-400'
                                          : 'bg-red-50 text-red-600 dark:bg-red-900/20 dark:text-red-400'
                                      }`}>
                                        {card.automation.lastResult === 'success' ? 'OK' : 'Err'}
                                      </span>
                                    )}
                                  </div>
                                </div>
                              </div>

                              {/* Right: Timer + previous run — spans full card height, fixed size */}
                              <div className="flex shrink-0 flex-col items-center justify-center border-l border-void-200 pl-4 dark:border-void-700/50 min-h-[52px]">
                                {isTriggering ? (
                                  <div className="flex flex-col items-center justify-center">
                                    <span className="animate-pulse font-mono text-2xl font-bold tracking-wider text-orange-500">
                                      STARTING
                                    </span>
                                    <span className="text-[9px] uppercase tracking-[0.2em] text-transparent">placeholder</span>
                                  </div>
                                ) : (
                                  <CountdownTimer nextRun={card.automation?.nextRun} enabled={card.automation?.enabled} />
                                )}
                                <div className="mt-0.5 h-4 text-[10px] text-void-350 dark:text-void-600">
                                  {card.automation?.lastRun
                                    ? `Prev: ${new Date(card.automation.lastRun).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`
                                    : ''}
                                </div>
                              </div>
                            </div>
                          </div>

                          {/* Hazard stripe bottom bar */}
                          <div className="h-[5px] hazard-stripe" />
                        </button>
                      );
                    })}
                  </div>
                </details>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
