/**
 * SLYCODE_SCHEDULER=off turns the automation scheduler off for this web
 * instance. Used when a second web instance shares the same boards (e.g. a
 * worktree dev server on another port with SLYCODE_HOME pointing at the main
 * folder): two schedulers against one kanban.json would double-fire
 * automations. Manual "Run now" is unaffected — it's an explicit user action.
 */
export function isSchedulerDisabled(env: Record<string, string | undefined> = process.env): boolean {
  const value = (env.SLYCODE_SCHEDULER ?? '').trim().toLowerCase();
  return value === 'off' || value === '0' || value === 'false';
}
