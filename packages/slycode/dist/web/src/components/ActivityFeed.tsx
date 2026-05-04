'use client';

import { useState, useCallback } from 'react';
import { usePolling } from '@/hooks/usePolling';
import type { ActivityEvent, EventType } from '@/lib/types';

interface ActivityFeedProps {
  projectFilter?: string;
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
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function ActivityFeed({ projectFilter }: ActivityFeedProps) {
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [isCollapsed, setIsCollapsed] = useState(false);

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
                {dayEvents.map((event) => (
                  <div
                    key={event.id}
                    className="flex items-start gap-2 px-4 py-2 text-xs"
                  >
                    <span className={`mt-0.5 font-medium ${eventColor(event.type)}`}>
                      {eventLabel(event.type)}
                    </span>
                    <span className="flex-1 text-void-600 dark:text-void-400">
                      {renderDetail(event)}
                    </span>
                    <span className="flex-shrink-0 text-void-400 dark:text-void-500">
                      {relativeTime(event.timestamp)}
                    </span>
                  </div>
                ))}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
