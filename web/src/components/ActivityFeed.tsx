'use client';

import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { usePolling } from '@/hooks/usePolling';
import type { ActivityEvent, EventType } from '@/lib/types';
import { formatDayMonth } from '@/lib/date-format';

interface ActivityFeedProps {
  projectFilter?: string;
  /**
   * Project id -> display name, used for the per-row badge (feature 082).
   * Omitted when the feed is already scoped to one project.
   */
  projectNames?: Record<string, string>;
}

/**
 * Event types that carry no card id but still have a sensible destination:
 * the project's board (feature 082).
 */
const PROJECT_LEVEL_TYPES = new Set<string>(['skill_deployed', 'skill_removed', 'skill_imported']);

/** Where a feed row should navigate, or null if it has nowhere useful to go. */
function eventHref(event: ActivityEvent): string | null {
  if (!event.project) return null;
  if (event.card) return `/project/${event.project}?card=${event.card}`;
  if (PROJECT_LEVEL_TYPES.has(event.type)) return `/project/${event.project}`;
  return null;
}

const eventLabels: Record<EventType, string> = {
  card_created: 'Created',
  card_moved: 'Moved',
  card_updated: 'Updated',
  card_reordered: 'Reordered',
  card_prompt: 'Prompt',
  problem_added: 'Problem',
  problem_resolved: 'Resolved',
  skill_deployed: 'Deployed',
  skill_removed: 'Removed',
  skill_imported: 'Imported',
  session_started: 'Session',
  session_stopped: 'Session',
};

const eventColors: Record<EventType, string> = {
  card_created: 'text-green-500',
  card_moved: 'text-neon-blue-500 dark:text-neon-blue-400',
  card_updated: 'text-void-500',
  card_reordered: 'text-void-500',
  card_prompt: 'text-purple-500',
  problem_added: 'text-red-500',
  problem_resolved: 'text-green-500',
  skill_deployed: 'text-neon-blue-500 dark:text-neon-blue-400',
  skill_removed: 'text-amber-500',
  skill_imported: 'text-purple-500',
  session_started: 'text-green-500',
  session_stopped: 'text-void-500',
};

const FALLBACK_LABEL = 'Event';
const FALLBACK_COLOR = 'text-void-500';

function eventLabel(type: string): string {
  return eventLabels[type as EventType] ?? FALLBACK_LABEL;
}

function eventColor(type: string): string {
  return eventColors[type as EventType] ?? FALLBACK_COLOR;
}

function relativeTime(timestamp: string): string {
  const diff = Date.now() - new Date(timestamp).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'yesterday';
  return `${days}d ago`;
}

const stageColors: Record<string, string> = {
  backlog: 'text-void-500 dark:text-void-400',
  design: 'text-neon-blue-600 dark:text-neon-blue-400',
  implementation: 'text-neon-blue-500 dark:text-neon-blue-400',
  testing: 'text-neon-orange-500 dark:text-neon-orange-400',
  done: 'text-green-500 dark:text-green-400',
};

/**
 * Render a card_moved detail with colored stage names.
 * Format from kanban.js: "Card 'TITLE' moved from STAGE to STAGE"
 */
function renderMovedDetail(detail: string): React.ReactNode {
  const match = detail.match(/^Card '(.+)' moved from (\w+) to (\w+)$/);
  if (!match) return detail;

  const [, title, fromStage, toStage] = match;
  const fromColor = stageColors[fromStage] || 'text-void-500';
  const toColor = stageColors[toStage] || 'text-void-500';

  return (
    <>
      <span className="text-void-500 dark:text-void-400">Card </span>
      <span className="font-medium text-void-700 dark:text-void-300">{title}</span>
      <span className="text-void-500 dark:text-void-400"> moved from </span>
      <span className={`font-medium ${fromColor}`}>{fromStage}</span>
      <span className="text-void-500 dark:text-void-400"> to </span>
      <span className={`font-medium ${toColor}`}>{toStage}</span>
    </>
  );
}

function renderDetail(event: ActivityEvent): React.ReactNode {
  if (event.type === 'card_moved') return renderMovedDetail(event.detail);
  if (typeof event.detail === 'object' && event.detail !== null) {
    return JSON.stringify(event.detail);
  }
  return event.detail;
}

function dayLabel(timestamp: string): string {
  const date = new Date(timestamp);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  if (date.toDateString() === today.toDateString()) return 'Today';
  if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return formatDayMonth(date);
}

export function ActivityFeed({ projectFilter, projectNames }: ActivityFeedProps) {
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const router = useRouter();

  const fetchEvents = useCallback(async (signal: AbortSignal) => {
    try {
      const params = new URLSearchParams({ limit: '50' });
      if (projectFilter) params.set('project', projectFilter);

      const res = await fetch(`/api/events?${params}`, { signal });
      if (res.ok) {
        const data = await res.json();
        setEvents(data.events || []);
      }
    } catch {
      // ignore
    }
  }, [projectFilter]);

  // Poll every 30s (includes initial fetch)
  usePolling(fetchEvents, 30000);

  // Group events by day
  const grouped = events.reduce<Record<string, ActivityEvent[]>>((acc, event) => {
    const day = dayLabel(event.timestamp);
    if (!acc[day]) acc[day] = [];
    acc[day].push(event);
    return acc;
  }, {});

  return (
    <div className="rounded-lg border border-void-200 bg-white shadow-(--shadow-surface) dark:border-void-700 dark:bg-void-850">
      <button
        onClick={() => setIsCollapsed(!isCollapsed)}
        className="flex w-full items-center justify-between px-4 py-3 text-left"
      >
        <h3 className="text-sm font-semibold text-void-900 dark:text-void-100">
          Activity
        </h3>
        <svg
          className={`h-4 w-4 text-void-400 transition-transform ${isCollapsed ? '' : 'rotate-180'}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {!isCollapsed && (
        <div className="max-h-64 overflow-y-auto border-t border-void-100 dark:border-void-700">
          {events.length === 0 ? (
            <div className="px-4 py-6 text-center text-sm text-void-500 dark:text-void-400">
              No recent activity
            </div>
          ) : (
            Object.entries(grouped).map(([day, dayEvents]) => (
              <div key={day}>
                <div className="sticky top-0 bg-void-50 px-4 py-1 text-xs font-medium text-void-500 dark:bg-void-800 dark:text-void-400">
                  {day}
                </div>
                {dayEvents.map((event) => {
                  const href = eventHref(event);
                  // Badge only earns its space on a multi-project feed. Falls
                  // back to the raw id if the project is no longer registered.
                  const badge = projectFilter
                    ? null
                    : (projectNames?.[event.project] ?? event.project);

                  const row = (
                    <>
                      <span className={`mt-0.5 font-medium ${eventColor(event.type)}`}>
                        {eventLabel(event.type)}
                      </span>
                      {badge && (
                        <span className="mt-0.5 max-w-[7rem] flex-shrink-0 truncate rounded border border-void-200 px-1 font-[family-name:var(--font-jetbrains-mono)] text-[10px] text-void-500 dark:border-void-700 dark:text-void-400">
                          {badge}
                        </span>
                      )}
                      <span className="flex-1 text-left text-void-600 dark:text-void-400">
                        {renderDetail(event)}
                      </span>
                      <span className="flex-shrink-0 text-void-400 dark:text-void-500">
                        {relativeTime(event.timestamp)}
                      </span>
                    </>
                  );

                  if (!href) {
                    return (
                      <div key={event.id} className="flex items-start gap-2 px-4 py-2 text-xs">
                        {row}
                      </div>
                    );
                  }

                  return (
                    <button
                      key={event.id}
                      type="button"
                      onClick={() => router.push(href)}
                      className="flex w-full items-start gap-2 px-4 py-2 text-xs hover:bg-void-50 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-neon-blue-400 dark:hover:bg-void-800"
                    >
                      {row}
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
