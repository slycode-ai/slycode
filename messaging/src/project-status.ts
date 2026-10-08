/**
 * Project status (card #0381, feature 089) — LOCKSTEP with
 * web/src/lib/project-status.ts and scripts/kanban.js projectStatus():
 * absent or unknown → 'active'. Only active projects fire timers (the web
 * scheduler enforces that); here status shapes Telegram's project lists.
 */

import type { Project, ProjectStatus } from './types.js';

export const PROJECT_STATUSES: readonly ProjectStatus[] = ['active', 'paused', 'complete', 'archived'];

export function projectStatus(project: Pick<Project, 'status'> | { status?: unknown }): ProjectStatus {
  const s = project.status;
  return typeof s === 'string' && (PROJECT_STATUSES as readonly string[]).includes(s) ? (s as ProjectStatus) : 'active';
}

/**
 * What a project picker lists: Active always; Paused + Complete only when
 * asked (behind a "Show paused & complete" button); Archived never.
 */
export function pickerProjects<T extends { status?: unknown }>(projects: readonly T[], includeHeld: boolean): T[] {
  return projects.filter((p) => {
    const s = projectStatus(p);
    if (s === 'active') return true;
    if (s === 'archived') return false;
    return includeHeld;
  });
}

/** Paused + complete projects — the count on the "Show paused & complete" button. */
export function heldCount(projects: readonly { status?: unknown }[]): number {
  return projects.filter((p) => {
    const s = projectStatus(p);
    return s === 'paused' || s === 'complete';
  }).length;
}

/** " (paused)" / " (complete)" / "" — suffix for labels and breadcrumbs. */
export function statusSuffix(project: { status?: unknown }): string {
  const s = projectStatus(project);
  return s === 'active' ? '' : ` (${s})`;
}
