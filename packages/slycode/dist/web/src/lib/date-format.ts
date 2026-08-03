/**
 * Shared date/time formatting.
 *
 * WHY THIS EXISTS: bare `toLocaleString()` follows the *viewer's* locale. This
 * deployment runs with LANG=C.UTF-8, which Node resolves to en-US, and browsers
 * commonly report en-US too — so dates rendered month-first (7/29/2026) despite
 * the host being configured for Australia/Melbourne.
 *
 * LOCALE vs TIMEZONE — they are different settings and it's worth being precise:
 *   - Timezone decides WHICH INSTANT a timestamp refers to (already configured
 *     here via TZ=Australia/Melbourne in .env).
 *   - Locale decides HOW it is written down — field order, 12h vs 24h.
 * A timezone carries no formatting information, so one cannot be read off the
 * other. What we CAN do is infer a sensible locale from the timezone's region,
 * which is what resolveLocale does — it means the format follows wherever the
 * install is configured to be, with no second setting to keep in sync.
 *
 * The fallback is deliberately day-first, never month-first: an unrecognised
 * region should degrade to unambiguous, not to US convention.
 */

/** Day-first, 24-hour. Used when the timezone tells us nothing useful. */
const FALLBACK_LOCALE = 'en-GB';

/**
 * Map an IANA timezone to a FORMATTING locale.
 *
 * This picks a date format, not a national identity — so Australia maps to
 * en-GB rather than en-AU on purpose. The two are identical in ordering
 * (day-first) and differ in exactly one respect: en-AU spells July out in full
 * while abbreviating every other month, so a column of timestamps reads
 * "29 July 2026" beside "15 Jul 2026". en-GB abbreviates uniformly, which
 * matters in the run-history table where dates stack vertically.
 *
 * Anything unrecognised falls through to FALLBACK_LOCALE, which is also
 * day-first — an unknown region degrades to unambiguous, never to US order.
 */
function localeForTimeZone(tz: string): string {
  if (tz.startsWith('Australia/')) return 'en-GB';
  if (tz.startsWith('Pacific/')) return 'en-NZ';
  if (tz.startsWith('Europe/') || tz.startsWith('Asia/') || tz.startsWith('Africa/')) return 'en-GB';
  return FALLBACK_LOCALE;
}

let cachedLocale: string | null = null;

/**
 * The locale every formatter here uses.
 *
 * Derived from the runtime's IANA timezone: in the browser that is the viewer's
 * machine, and on the server it is TZ from .env. Both resolve to
 * Australia/Melbourne for this install, giving en-AU.
 *
 * Exported for tests and for surfaces that need to format something this module
 * doesn't cover — always prefer the helpers below.
 */
export function resolveLocale(): string {
  if (cachedLocale) return cachedLocale;
  let locale = FALLBACK_LOCALE;
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (tz) locale = localeForTimeZone(tz);
  } catch { /* Intl unavailable — keep the day-first fallback */ }
  cachedLocale = locale;
  return locale;
}

/** Test seam: clear the memoised locale so a test can vary the timezone. */
export function resetLocaleCache(): void {
  cachedLocale = null;
}

function toDate(value: string | number | Date): Date | null {
  const d = value instanceof Date ? value : new Date(value);
  return isNaN(d.getTime()) ? null : d;
}

/** "29 Jul 2026, 20:35" — the default for a timestamp shown in full. */
export function formatDateTime(value: string | number | Date | undefined | null): string {
  const d = value == null ? null : toDate(value);
  if (!d) return '—';
  return d.toLocaleString(resolveLocale(), {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: false,
  });
}

/** "29 Jul 2026" — date only. */
export function formatDate(value: string | number | Date | undefined | null): string {
  const d = value == null ? null : toDate(value);
  if (!d) return '—';
  return d.toLocaleDateString(resolveLocale(), {
    day: '2-digit', month: 'short', year: 'numeric',
  });
}

/** "29 Jul, 20:35" — no year, for compact inline labels. */
export function formatDateTimeShort(value: string | number | Date | undefined | null): string {
  const d = value == null ? null : toDate(value);
  if (!d) return '—';
  return d.toLocaleString(resolveLocale(), {
    day: '2-digit', month: 'short',
    hour: '2-digit', minute: '2-digit', hour12: false,
  });
}

/** "29 Jul" — day and month only, for grouping labels. */
export function formatDayMonth(value: string | number | Date | undefined | null): string {
  const d = value == null ? null : toDate(value);
  if (!d) return '—';
  return d.toLocaleDateString(resolveLocale(), { day: '2-digit', month: 'short' });
}

/** "20:35" — time only. */
export function formatTime(value: string | number | Date | undefined | null): string {
  const d = value == null ? null : toDate(value);
  if (!d) return '—';
  return d.toLocaleTimeString(resolveLocale(), {
    hour: '2-digit', minute: '2-digit', hour12: false,
  });
}
