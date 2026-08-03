/**
 * Convert a cron expression or one-shot schedule to human-readable text.
 * Shared between UI components and the automation scheduler.
 *
 * When timezoneAbbr is provided, it's appended to time-based descriptions
 * e.g. "Daily at 6:00 (AEST)"
 */

import { formatDate, formatTime } from './date-format';

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
      return `Once on ${formatDate(d)} at ${formatTime(d)}${tzSuffix}`;
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

/**
 * Convert a stored one-shot schedule (UTC ISO string) into the
 * `YYYY-MM-DDTHH:mm` shape a `datetime-local` input expects, in LOCAL time.
 *
 * A datetime-local input always reads and writes local wall-clock. Slicing the
 * raw ISO string instead (`iso.slice(0, 16)`) hands it UTC digits, which it
 * then presents as local — so a 09:00 AEST one-shot redisplays as 23:00 the
 * previous day, disagreeing with the human-readable preview beside it and
 * silently rewriting the schedule if the form is saved untouched.
 *
 * Returns '' for missing or unparseable input so the input renders empty.
 */
export function isoToDatetimeLocal(iso: string | undefined | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * Inverse of isoToDatetimeLocal — a local `datetime-local` value to a stored
 * UTC ISO string. Returns '' when the input is empty or unparseable (clearing
 * the picker), which callers store as "no schedule" rather than throwing.
 */
export function datetimeLocalToIso(value: string): string {
  if (!value) return '';
  const d = new Date(value);
  if (isNaN(d.getTime())) return '';
  return d.toISOString();
}
