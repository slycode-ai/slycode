'use client';

import { useEffect, useState } from 'react';
import type { KanbanCard } from '@/lib/types';
import { cronToHumanReadable } from '@/lib/cron-utils';
import { formatDateTimeShort } from '@/lib/date-format';
import Tooltip from './Tooltip';

interface AutomationsScreenProps {
  cards: KanbanCard[];
  activeCards: Set<string>;
  triggeringCards?: Set<string>;
  onCardClick: (card: KanbanCard) => void;
  onCardContextMenu?: (card: KanbanCard, e: React.MouseEvent) => void;
  onCreateAutomation: () => void;
  /** #0381: the project is paused/complete/archived — nothing fires on schedule. */
  held?: boolean;
}

function CountdownTimer({ nextRun, enabled, held }: { nextRun?: string; enabled?: boolean; held?: boolean }) {
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (!nextRun || !enabled || held) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [nextRun, enabled, held]);

  if (held && enabled) {
    return (
      <div className="flex flex-col items-center justify-center">
        <span className="font-mono text-lg font-medium text-warn-text">Held</span>
        <span className="text-[11px] text-ink-3">Project paused</span>
      </div>
    );
  }

  if (!nextRun || !enabled) {
    return (
      <div className="flex flex-col items-center justify-center">
        <span className="font-mono text-lg font-medium tabular-nums text-ink-3">
          --:--
        </span>
        <span className="text-[11px] text-ink-3">
          Off
        </span>
      </div>
    );
  }

  const target = new Date(nextRun).getTime();
  const diff = Math.max(0, target - now);

  if (diff === 0) {
    return (
      <div className="flex flex-col items-center justify-center">
        <span className="font-mono text-lg font-medium text-agent-text">Now</span>
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
    label = 'until next run';
  } else if (hours > 0) {
    display = `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
    label = 'until next run';
  } else {
    display = `${pad(minutes)}:${pad(seconds)}`;
    label = 'until next run';
  }

  return (
    <div className="flex flex-col items-center justify-center">
      <span className="font-mono text-lg font-medium tabular-nums text-ink-1">
        {display}
      </span>
      <span className="text-[11px] text-ink-3">{label}</span>
    </div>
  );
}

export function AutomationsScreen({ cards, activeCards, triggeringCards, onCardClick, onCardContextMenu, onCreateAutomation, held = false }: AutomationsScreenProps) {
  const [, setSchedulerRunning] = useState<boolean | null>(null);
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
          <h2 className="text-xl font-semibold tracking-tight text-ink-1">
            Automations
            <span className="ml-2 font-mono text-[13px] font-normal text-ink-3">
              ({cards.length} card{cards.length !== 1 ? 's' : ''})
            </span>
            {timezoneAbbr && (
              <span className="ml-2 rounded border border-line px-1.5 py-0.5 font-mono text-[11px] font-normal text-ink-3">
                {timezoneAbbr}
              </span>
            )}
          </h2>
          <button
            onClick={onCreateAutomation}
            className="rounded-lg bg-primary px-3 py-1.5 text-[13px] font-medium text-on-primary transition-opacity hover:opacity-90"
          >
            New automation
          </button>
        </div>

        {cards.length === 0 ? (
          <div className="py-16 text-center">
            <div className="mb-3 text-void-300 dark:text-void-600">
              <svg className="mx-auto h-14 w-14" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <p className="text-sm text-ink-3">No automations configured yet.</p>
            <p className="mt-1 text-xs text-ink-3">Toggle any card to automation mode, or create a new automation above.</p>
          </div>
        ) : (
          <div className="space-y-6">
            {sortedGroupNames.map((groupName) => (
              <div key={groupName}>
                {/* Group header */}
                <details open>
                  <summary className="mb-3 cursor-pointer text-[13px] font-semibold text-ink-2 hover:text-ink-1">
                    <span className="ml-1">{groupName}</span>
                    <span className="ml-1.5 font-mono font-normal text-ink-3">{groups[groupName].length}</span>
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
                          className={`group relative overflow-hidden rounded-xl border border-line border-l-[3px] border-l-agent bg-surface-1 text-left shadow-(--shadow-card) transition-[transform,border-color] duration-150 hover:-translate-y-px hover:border-line-strong hover:border-l-agent ${!isEnabled ? 'opacity-70' : ''}`}
                        >
                          {isActive && <div className="live-wire" aria-hidden />}
                          {/* Card body with chevron background — 2 row layout */}
                          <div className={`automation-chevron px-5 py-3 ${isActive ? 'automation-chevron-active' : ''}`}>
                            <div className="relative z-10 flex items-stretch gap-4">
                              {/* Left: 2 rows (title + schedule/badges) */}
                              <div className="min-w-0 flex-1 flex flex-col gap-1.5 justify-center">
                                <h3 className="truncate text-[15px] font-semibold text-ink-1">
                                  {card.title}
                                </h3>
                                <div className="flex items-center gap-3">
                                  <p className="min-w-0 flex-1 truncate text-[13px] text-ink-2">
                                    {card.automation
                                      ? cronToHumanReadable(card.automation.schedule, card.automation.scheduleType, 'No schedule', timezoneAbbr || undefined)
                                      : 'No schedule'}
                                  </p>
                                  <div className="flex shrink-0 items-center gap-1.5">
                                    {card.automation?.provider && (
                                      <span className="rounded border border-line px-1.5 py-0.5 font-mono text-[11px] text-ink-2">
                                        {card.automation.provider}
                                      </span>
                                    )}
                                    <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${
                                      isEnabled
                                        ? 'bg-agent/10 text-agent-text'
                                        : 'bg-surface-3 text-ink-3'
                                    }`}>
                                      {isEnabled ? 'Enabled' : 'Disabled'}
                                    </span>
                                    {card.automation?.lastResult && (
                                      // Only failures carry error text; success renders the badge untouched.
                                      <Tooltip
                                        content={
                                          card.automation.lastResult === 'error' && card.automation.lastError
                                            ? card.automation.lastError
                                            : undefined
                                        }
                                      >
                                        <span
                                          className={`rounded px-1.5 py-0.5 text-[11px] ${
                                            card.automation.lastResult === 'success'
                                              ? 'text-ink-3'
                                              : 'bg-danger/10 text-danger-text'
                                          } ${card.automation.lastResult === 'error' && card.automation.lastError ? 'cursor-help' : ''}`}
                                        >
                                          {card.automation.lastResult === 'success' ? 'Started' : 'Kickoff failed'}
                                        </span>
                                      </Tooltip>
                                    )}
                                  </div>
                                </div>
                              </div>

                              {/* Right: Timer + previous run — spans full card height, fixed size */}
                              <div className="flex min-h-[52px] min-w-[112px] shrink-0 flex-col items-end justify-center border-l border-line pl-4">
                                {isTriggering ? (
                                  <div className="flex flex-col items-center justify-center">
                                    <span className="font-mono text-lg font-medium text-agent-text">
                                      Starting
                                    </span>
                                    <span className="text-[11px] text-transparent">placeholder</span>
                                  </div>
                                ) : (
                                  <CountdownTimer nextRun={card.automation?.nextRun} enabled={card.automation?.enabled} held={held} />
                                )}
                                <div className="mt-0.5 h-4 text-[11px] text-ink-3">
                                  {card.automation?.lastRun
                                    ? `Last ${formatDateTimeShort(card.automation.lastRun)}`
                                    : ''}
                                </div>
                              </div>
                            </div>
                          </div>

                          {/* Hazard stripe only when the last kickoff failed */}
                          {card.automation?.lastResult === 'error' && <div className="h-1 hazard-stripe" />}
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
