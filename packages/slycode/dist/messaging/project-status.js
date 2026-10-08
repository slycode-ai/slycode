/**
 * Project status (card #0381, feature 089) — LOCKSTEP with
 * web/src/lib/project-status.ts and scripts/kanban.js projectStatus():
 * absent or unknown → 'active'. Only active projects fire timers (the web
 * scheduler enforces that); here status shapes Telegram's project lists.
 */
export const PROJECT_STATUSES = ['active', 'paused', 'complete', 'archived'];
export function projectStatus(project) {
    const s = project.status;
    return typeof s === 'string' && PROJECT_STATUSES.includes(s) ? s : 'active';
}
/**
 * What a project picker lists: Active always; Paused + Complete only when
 * asked (behind a "Show paused & complete" button); Archived never.
 */
export function pickerProjects(projects, includeHeld) {
    return projects.filter((p) => {
        const s = projectStatus(p);
        if (s === 'active')
            return true;
        if (s === 'archived')
            return false;
        return includeHeld;
    });
}
/** Paused + complete projects — the count on the "Show paused & complete" button. */
export function heldCount(projects) {
    return projects.filter((p) => {
        const s = projectStatus(p);
        return s === 'paused' || s === 'complete';
    }).length;
}
/** " (paused)" / " (complete)" / "" — suffix for labels and breadcrumbs. */
export function statusSuffix(project) {
    const s = projectStatus(project);
    return s === 'active' ? '' : ` (${s})`;
}
//# sourceMappingURL=project-status.js.map