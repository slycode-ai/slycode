export async function register() {
  // Only run on the server (not edge runtime)
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { isSchedulerDisabled } = await import('./lib/scheduler-switch');
    if (isSchedulerDisabled()) {
      console.log('[scheduler] Disabled by SLYCODE_SCHEDULER=off — this instance will not run automations');
      return;
    }
    const { startScheduler } = await import('./lib/scheduler');
    startScheduler();
  }
}
