/**
 * Convert a cron expression or one-shot schedule to human-readable text.
 * Shared between UI components and the automation scheduler.
 *
 * When timezoneAbbr is provided, it's appended to time-based descriptions
 * e.g. "Daily at 6:00 (AEST)"
 */

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function cronToHumanReadable(
  cron: string,
  scheduleType: 'recurring' | 'one-shot',
  fallback = 'Not set',
  timezoneAbbr?: string,
): string {
  const tzSuffix = timezoneAbbr ? ` (${timezoneAbbr})` : '';

  if (scheduleType === 'one-shot') {
    try {
      const d = new Date(cron);
      if (isNaN(d.getTime())) return cron || fallback;
      return `Once on ${d.toLocaleDateString()} at ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}${tzSuffix}`;
    } catch {
      return cron || fallback;
    }
  }
  if (!cron) return fallback;
  const parts = cron.split(' ');
  if (parts.length !== 5) return cron;
  const [min, hour, dom, , dow] = parts;

  // Detect interval: range/step like "0 9-20/2 * * *"
  const rangeStep = hour.match(/^(\d+)-(\d+)\/(\d+)$/);
  if (rangeStep && dom === '*' && dow === '*') {
    const [, start, end, step] = rangeStep;
    return `Every ${step}h from ${start.padStart(2, '0')}:${min.padStart(2, '0')} to ${end.padStart(2, '0')}:${min.padStart(2, '0')}${tzSuffix}`;
  }

  // Detect interval: comma-separated hours (overnight wrap)
  if (hour.includes(',') && dom === '*' && dow === '*') {
    const hours = hour.split(',').map(Number);
    if (hours.length >= 2) {
      const step = ((hours[1] - hours[0]) + 24) % 24;
      if (step > 0) {
        const s = String(hours[0]).padStart(2, '0');
        const e = String(hours[hours.length - 1]).padStart(2, '0');
        return `Every ${step}h from ${s}:${min.padStart(2, '0')} to ${e}:${min.padStart(2, '0')}${tzSuffix}`;
      }
    }
  }

  if (hour === '*' && dom === '*' && dow === '*') {
    return `Every hour at :${min.padStart(2, '0')}${tzSuffix}`;
  }
  if (dom === '*' && dow === '*') {
    return `Daily at ${hour}:${min.padStart(2, '0')}${tzSuffix}`;
  }
  if (dom === '*' && dow !== '*') {
    const days = dow.split(',').map(d => DAY_NAMES[parseInt(d)] || d).join(', ');
    return `Weekly on ${days} at ${hour}:${min.padStart(2, '0')}${tzSuffix}`;
  }
  if (dom !== '*' && dow === '*') {
    return `Monthly on day ${dom} at ${hour}:${min.padStart(2, '0')}${tzSuffix}`;
  }
  return cron;
}
