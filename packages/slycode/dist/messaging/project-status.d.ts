/**
 * Project status (card #0381, feature 089) — LOCKSTEP with
 * web/src/lib/project-status.ts and scripts/kanban.js projectStatus():
 * absent or unknown → 'active'. Only active projects fire timers (the web
 * scheduler enforces that); here status shapes Telegram's project lists.
 */
import type { Project, ProjectStatus } from './types.js';
export declare const PROJECT_STATUSES: readonly ProjectStatus[];
export declare function projectStatus(project: Pick<Project, 'status'> | {
    status?: unknown;
}): ProjectStatus;
/**
 * What a project picker lists: Active always; Paused + Complete only when
 * asked (behind a "Show paused & complete" button); Archived never.
 */
export declare function pickerProjects<T extends {
    status?: unknown;
}>(projects: readonly T[], includeHeld: boolean): T[];
/** Paused + complete projects — the count on the "Show paused & complete" button. */
export declare function heldCount(projects: readonly {
    status?: unknown;
}[]): number;
/** " (paused)" / " (complete)" / "" — suffix for labels and breadcrumbs. */
export declare function statusSuffix(project: {
    status?: unknown;
}): string;
