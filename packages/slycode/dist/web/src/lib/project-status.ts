/**
 * Project status (card #0381, feature 089) — pure, client-safe.
 *
 * One rule covers every timer: only an ACTIVE project fires (automations,
 * scheduled card prompts, atlas refresh). Paused / complete / archived hold
 * them. When a project goes back to active, `resumedAt` is stamped and the
 * scheduler skips — never replays — any fire time earlier than it.
 *
 * The registry has four independent readers that must agree on this:
 *   web       this file (scheduler, Den, API routes)
 *   CLI       scripts/kanban.js            projectStatus()
 *   messaging messaging/src/state.ts       projectStatus()
 *   bridge    bridge/src/speak-route.ts    (tolerates the fields; no behaviour)
 * Keep the absent/unknown → 'active' rule identical in all of them.
 */

import type { Project, ProjectStatus } from './types';

export const PROJECT_STATUSES: readonly ProjectStatus[] = ['active', 'paused', 'complete', 'archived'];

export const PROJECT_STATUS_LABELS: Record<ProjectStatus, string> = {
  active: 'Active',
  paused: 'Paused',
  complete: 'Complete',
  archived: 'Archived',
};

export function isProjectStatus(value: unknown): value is ProjectStatus {
  return typeof value === 'string' && (PROJECT_STATUSES as readonly string[]).includes(value);
}

/**
 * Absent or unrecognised → 'active'. A hand-typo must not silently stop a
 * project's automations; every write path validates, so an unknown value
 * only comes from a hand edit.
 */
export function projectStatus(project: Pick<Project, 'status'> | { status?: unknown }): ProjectStatus {
  return isProjectStatus(project.status) ? project.status : 'active';
}

export function isProjectActive(project: Pick<Project, 'status'> | { status?: unknown }): boolean {
  return projectStatus(project) === 'active';
}

/**
 * The resume fence: true when `fireIso` is a valid instant strictly earlier
 * than the project's `resumedAt`. Such a fire time fell while the project was
 * held (or before it), and is skipped rather than caught up.
 */
export function firesBeforeResume(fireIso: string | undefined | null, project: Pick<Project, 'resumedAt'>): boolean {
  if (!fireIso || !project.resumedAt) return false;
  const fire = Date.parse(fireIso);
  const resumed = Date.parse(project.resumedAt);
  if (!Number.isFinite(fire) || !Number.isFinite(resumed)) return false;
  return fire < resumed;
}

/** `resumedAt` as epoch ms, or 0 when absent/invalid (a floor that never blocks). */
export function resumedAtMs(project: Pick<Project, 'resumedAt'>): number {
  if (!project.resumedAt) return 0;
  const t = Date.parse(project.resumedAt);
  return Number.isFinite(t) ? t : 0;
}

export type StatusPatch = Pick<Project, 'status' | 'statusChangedAt'> & { resumedAt?: string };

/**
 * The registry fields to write for a status change, or null when the status
 * is unchanged (a no-op must not move statusChangedAt or resumedAt).
 * `resumedAt` is written only on a non-active → active move.
 */
export function statusChangePatch(
  project: Pick<Project, 'status'>,
  next: ProjectStatus,
  nowIso: string = new Date().toISOString(),
): StatusPatch | null {
  const current = projectStatus(project);
  if (current === next) return null;
  const patch: StatusPatch = { status: next, statusChangedAt: nowIso };
  if (next === 'active') patch.resumedAt = nowIso;
  return patch;
}

/** Short "since" label for badges: 3d, 2w, 5h, 10m. */
export function heldForLabel(sinceIso: string | undefined, nowMs: number = Date.now()): string {
  if (!sinceIso) return '';
  const t = Date.parse(sinceIso);
  if (!Number.isFinite(t)) return '';
  const mins = Math.max(0, Math.floor((nowMs - t) / 60_000));
  if (mins < 60) return `${Math.max(1, mins)}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 14) return `${days}d`;
  return `${Math.floor(days / 7)}w`;
}
