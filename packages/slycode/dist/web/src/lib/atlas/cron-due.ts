/**
 * Atlas nightly dueness (feature 076) — pure and unit-testable.
 *
 * BUG HISTORY: the first implementation used croner's `previousRun()`, which
 * reports the last ACTUAL EXECUTION of a job object — always null for a
 * pattern-only instance — so the scan skipped every project forever. The
 * boundary must be computed by walking `nextRun()` forward instead.
 */

import { Cron } from 'croner';

/** How stale a missed boundary may be and still fire (e.g. after downtime). */
export const BOUNDARY_WINDOW_MS = 6 * 3600_000;

/**
 * The most recent cron boundary at or before `nowMs` within the window,
 * or null when there is none.
 */
export function latestBoundaryBefore(schedule: string, timezone: string | undefined, nowMs: number): Date | null {
  let cron: Cron;
  try {
    cron = new Cron(schedule, timezone ? { timezone } : undefined);
  } catch {
    return null;
  }
  let t = new Date(nowMs - BOUNDARY_WINDOW_MS - 60_000);
  let boundary: Date | null = null;
  // Cap guards pathological every-minute patterns: window ≈ 6h → ≤ ~365 steps.
  for (let i = 0; i < 500; i++) {
    const n = cron.nextRun(t);
    if (!n || n.getTime() > nowMs) break;
    boundary = n;
    t = new Date(n.getTime() + 1000);
  }
  return boundary;
}

/**
 * Should the nightly refresh fire now? True when a boundary inside the
 * window has passed that `lastRunMs` predates.
 */
export function atlasRefreshDue(
  schedule: string,
  timezone: string | undefined,
  lastRunMs: number,
  nowMs: number,
): boolean {
  const boundary = latestBoundaryBefore(schedule, timezone, nowMs);
  if (!boundary) return false;
  return lastRunMs < boundary.getTime();
}
