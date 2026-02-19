/**
 * Event Log — append-only event log for activity feed
 *
 * Stores events in documentation/events.json, capped at MAX_EVENTS entries.
 * Used by the kanban CLI, CLI assets sync, and API routes to record actions.
 */

import fs from 'fs';
import path from 'path';
import type { ActivityEvent, EventType } from './types';

import { getSlycodeRoot } from './paths';

const MASTER_PATH = getSlycodeRoot();
const EVENTS_FILE = path.join(MASTER_PATH, 'documentation', 'events.json');
const MAX_EVENTS = 500;

// ============================================================================
// Read / Write
// ============================================================================

function readEvents(): ActivityEvent[] {
  try {
    if (!fs.existsSync(EVENTS_FILE)) return [];
    const content = fs.readFileSync(EVENTS_FILE, 'utf-8');
    const data = JSON.parse(content);
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

function writeEvents(events: ActivityEvent[]): void {
  const dir = path.dirname(EVENTS_FILE);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(EVENTS_FILE, JSON.stringify(events, null, 2));
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Append a new event to the log. Generates an ID and trims old events if over cap.
 */
export function appendEvent(
  event: Omit<ActivityEvent, 'id'>,
): ActivityEvent {
  const events = readEvents();

  const newEvent: ActivityEvent = {
    id: `evt-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    ...event,
  };

  events.push(newEvent);

  // Trim oldest events if over cap
  if (events.length > MAX_EVENTS) {
    events.splice(0, events.length - MAX_EVENTS);
  }

  writeEvents(events);
  return newEvent;
}

/**
 * Query events with optional filters.
 */
export function queryEvents(options: {
  project?: string;
  type?: EventType;
  limit?: number;
  since?: string;  // ISO timestamp
} = {}): ActivityEvent[] {
  let events = readEvents();

  // Filter by project
  if (options.project) {
    events = events.filter(e => e.project === options.project);
  }

  // Filter by type
  if (options.type) {
    events = events.filter(e => e.type === options.type);
  }

  // Filter by since timestamp
  if (options.since) {
    const sinceTime = new Date(options.since).getTime();
    events = events.filter(e => new Date(e.timestamp).getTime() >= sinceTime);
  }

  // Reverse chronological order
  events.reverse();

  // Apply limit
  if (options.limit && options.limit > 0) {
    events = events.slice(0, options.limit);
  }

  return events;
}

/**
 * Get the N most recent events.
 */
export function getRecentEvents(limit: number = 50): ActivityEvent[] {
  return queryEvents({ limit });
}

/**
 * Get the path to the events file (for use by kanban.js which can't import this module).
 */
export function getEventsFilePath(): string {
  return EVENTS_FILE;
}
