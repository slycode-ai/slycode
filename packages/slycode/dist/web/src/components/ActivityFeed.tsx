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
  project_status: 'Project',
};

// Event labels are ink; only events that carry state get a state colour.
const eventColors: Record<EventType, string> = {
  card_created: 'text-ink-2',
  card_moved: 'text-ink-2',
  card_updated: 'text-ink-3',
  card_reordered: 'text-ink-3',
  card_prompt: 'text-ink-2',
  problem_added: 'text-danger-text',
  problem_resolved: 'text-live-text',
  skill_deployed: 'text-ink-2',
  skill_removed: 'text-ink-3',
  skill_imported: 'text-ink-2',
  session_started: 'text-live-text',
  session_stopped: 'text-ink-3',
  project_status: 'text-warn-text',
};

const FALLBACK_LABEL = 'Event';
const FALLBACK_COLOR = 'text-ink-3';

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
  backlog: 'text-st-backlog',
  design: 'text-st-design',
  implementation: 'text-st-impl',
  testing: 'text-st-test',
  done: 'text-st-done',
};

/**
 * Render a card_moved detail with colored stage names.
 * Format from kanban.js: "Card 'TITLE' moved from STAGE to STAGE"
 */
function renderMovedDetail(detail: string): React.ReactNode {
  const match = detail.match(/^Card '(.+)' moved from (\w+) to (\w+)$/);
  if (!match) return detail;

  const [, title, fromStage, toStage] = match;
  const fromColor = stageColors[fromStage] || 'text-ink-3';
  const toColor = stageColors[toStage] || 'text-ink-3';

  return (
    <>
      <span className="text-ink-3">Card </span>
      <span className="font-medium text-ink-2">{title}</span>
      <span className="text-ink-3"> moved from </span>
      <span className={`font-medium ${fromColor}`}>{fromStage}</span>
      <span className="text-ink-3"> to </span>
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
    <div className="rounded-xl border border-line bg-surface-1">
      <button
        onClick={() => setIsCollapsed(!isCollapsed)}
        className="flex w-full items-center justify-between px-4 py-3 text-left"
      >
        <h3 className="text-[13px] font-semibold text-ink-1">
          Activity
        </h3>
        <svg
          className={`h-4 w-4 text-ink-3 transition-transform ${isCollapsed ? '' : 'rotate-180'}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {!isCollapsed && (
        <div className="max-h-80 overflow-y-auto border-t border-line">
          {events.length === 0 ? (
            <div className="px-4 py-6 text-center text-sm text-ink-3">
              No recent activity
            </div>
          ) : (
            Object.entries(grouped).map(([day, dayEvents]) => (
              <div key={day}>
                <div className="sticky top-0 bg-surface-2 px-4 py-1 text-[11px] font-medium text-ink-3">
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
                        <span className="mt-0.5 max-w-[7rem] flex-shrink-0 truncate rounded border border-line px-1 font-[family-name:var(--font-jetbrains-mono)] text-[10px] text-ink-3">
                          {badge}
                        </span>
                      )}
                      <span className="flex-1 text-left text-ink-2">
                        {renderDetail(event)}
                      </span>
                      <span className="flex-shrink-0 text-ink-3">
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
                      className="flex w-full items-start gap-2 px-4 py-2 text-xs hover:bg-surface-2 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent"
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
