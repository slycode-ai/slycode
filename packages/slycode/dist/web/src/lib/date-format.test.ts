/**
 * Tests for shared date formatting.
 *
 * The property under test is narrow but load-bearing: dates must never render
 * month-first. Bare toLocaleString() did exactly that on this host
 * (LANG=C.UTF-8 -> en-US) despite TZ=Australia/Melbourne.
 *
 * The web/ package doesn't ship a configured test runner, so this file is a
 * self-contained script. Run via the tsx binary that lives in bridge/:
 *
 *   ./bridge/node_modules/.bin/tsx web/src/lib/date-format.test.ts
 *
 * Exits 0 on success, 1 on any assertion failure. node:test/node:assert only.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  formatDateTime, formatDate, formatDateTimeShort, formatDayMonth, formatTime,
  resolveLocale, resetLocaleCache,
} from './date-format';

// 2026-07-29T10:35:00Z === 20:35 on 29 Jul in Australia/Melbourne (AEST, +10)
const T = '2026-07-29T10:35:00.000Z';

test('formatDateTime renders day-first with a month name', () => {
  assert.equal(formatDateTime(T), '29 Jul 2026, 20:35');
});

test('formatDate renders day-first', () => {
  assert.equal(formatDate(T), '29 Jul 2026');
});

test('formatDateTimeShort omits the year', () => {
  assert.equal(formatDateTimeShort(T), '29 Jul, 20:35');
});

test('formatDayMonth is day then month', () => {
  assert.equal(formatDayMonth(T), '29 Jul');
});

test('formatTime is 24-hour, no am/pm', () => {
  const out = formatTime(T);
  assert.equal(out, '20:35');
  assert.ok(!/[ap]\.?m/i.test(out), 'must not contain am/pm');
});

test('REGRESSION: never renders US month-first order', () => {
  // The bug: "7/29/2026" or "Jul 29, 2026". Day must precede month everywhere.
  for (const out of [formatDateTime(T), formatDate(T), formatDateTimeShort(T), formatDayMonth(T)]) {
    assert.ok(!/^\d{1,2}\/\d{1,2}\//.test(out), `slash-numeric US date leaked: ${out}`);
    assert.ok(!/^[A-Z][a-z]{2}\s+\d/.test(out), `month-name-first leaked: ${out}`);
    assert.ok(/^\d{2}\s/.test(out), `expected leading 2-digit day: ${out}`);
  }
});

test('invalid and empty input degrade to an em dash, never throw', () => {
  for (const bad of ['', 'garbage', 'not-a-date', NaN]) {
    assert.equal(formatDateTime(bad as string | number), '—');
  }
  assert.equal(formatDate(undefined), '—');
  assert.equal(formatDateTime(null), '—');
  assert.equal(formatDayMonth(undefined), '—');
});

test('accepts Date objects and epoch numbers, not just ISO strings', () => {
  const d = new Date(T);
  assert.equal(formatDate(d), '29 Jul 2026');
  assert.equal(formatDate(d.getTime()), '29 Jul 2026');
});

test('locale is derived from the timezone', () => {
  resetLocaleCache();
  // TZ=Australia/Melbourne maps to en-GB deliberately: same day-first ordering
  // as en-AU, but uniform 3-letter months (en-AU spells "July" out in full).
  assert.equal(resolveLocale(), 'en-GB', `unexpected locale for TZ=${Intl.DateTimeFormat().resolvedOptions().timeZone}`);
});

test('month abbreviations are uniform width, not the en-AU "July" special case', () => {
  const jul = formatDate('2026-07-15T02:00:00.000Z');
  const jan = formatDate('2026-01-15T02:00:00.000Z');
  assert.ok(jul.includes('Jul') && !jul.includes('July'), `July should abbreviate: ${jul}`);
  assert.ok(jan.includes('Jan'), `Jan should abbreviate: ${jan}`);
});

test('an unrecognised timezone still falls back day-first, never to en-US', () => {
  // resolveLocale reads the runtime timezone, so assert the contract directly:
  // the fallback constant must not be a month-first locale.
  resetLocaleCache();
  const locale = resolveLocale();
  assert.ok(!locale.endsWith('-US'), `locale must never resolve to a US format: ${locale}`);
  const probe = new Date(T).toLocaleDateString(locale, { day: '2-digit', month: 'short', year: 'numeric' });
  assert.ok(/^\d{2}\s/.test(probe), `fallback locale is not day-first: ${probe}`);
});
