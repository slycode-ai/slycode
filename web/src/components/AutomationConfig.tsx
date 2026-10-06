'use client';

import { useState, useEffect, useCallback } from 'react';
import type { AutomationConfig as AutomationConfigType, AutomationLogEntry } from '@/lib/types';
import { cronToHumanReadable, isoToDatetimeLocal, datetimeLocalToIso } from '@/lib/cron-utils';
import { formatDateTime } from '@/lib/date-format';
import {
  FRESH_DAYS_DEFAULT, FRESH_DAYS_MAX, FRESH_DAYS_MIN, calendarDaysBetween, formatDateKey, freshMode,
  isValidFreshDays, localDateKey, resolveFreshness, type FreshnessSession,
} from '@/lib/automation-freshness';

interface AutomationConfigProps {
  config: AutomationConfigType;
  cardId: string;
  projectId: string;
  onChange: (config: AutomationConfigType) => void;
  /** The automation provider's bridge session: undefined while unknown, null when there is none (card #0373). */
  session?: FreshnessSession | null;
}

type Frequency = 'hourly' | 'daily' | 'weekly' | 'monthly' | 'interval';

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

interface BuilderState {
  frequency: Frequency;
  hour: string;
  minute: string;
  days: number[];
  dayOfMonth: string;
  intervalHours: string;
  startHour: string;
  endHour: string;
}

function parseCronToBuilder(cron: string): BuilderState {
  const defaults: BuilderState = {
    frequency: 'daily', hour: '6', minute: '0', days: [], dayOfMonth: '1',
    intervalHours: '2', startHour: '9', endHour: '20',
  };
  if (!cron) return defaults;
  const parts = cron.split(' ');
  if (parts.length !== 5) return defaults;
  const [min, hour, dom, , dow] = parts;

  // Detect interval: range/step like "0 9-20/2 * * *"
  const rangeStep = hour.match(/^(\d+)-(\d+)\/(\d+)$/);
  if (rangeStep && dom === '*' && dow === '*') {
    return { ...defaults, frequency: 'interval', minute: min, startHour: rangeStep[1], endHour: rangeStep[2], intervalHours: rangeStep[3] };
  }

  // Detect interval: comma-separated hours (wrap-around overnight), e.g. "0 18,20,22,0,2,4,6,8 * * *"
  if (hour.includes(',') && dom === '*' && dow === '*') {
    const hours = hour.split(',').map(Number);
    if (hours.length >= 2) {
      // Detect step from first two hours
      const step = ((hours[1] - hours[0]) + 24) % 24;
      if (step > 0 && step <= 12) {
        return { ...defaults, frequency: 'interval', minute: min, startHour: String(hours[0]), endHour: String(hours[hours.length - 1]), intervalHours: String(step) };
      }
    }
  }

  if (hour === '*') {
    return { ...defaults, frequency: 'hourly', minute: min };
  }
  if (dom !== '*') {
    return { ...defaults, frequency: 'monthly', hour, minute: min, dayOfMonth: dom };
  }
  if (dow !== '*') {
    return { ...defaults, frequency: 'weekly', hour, minute: min, days: dow.split(',').map(Number) };
  }
  return { ...defaults, frequency: 'daily', hour, minute: min };
}

/**
 * Enumerate hours for an interval schedule.
 * Handles wrap-around (e.g. 18-8 = overnight).
 */
function enumerateIntervalHours(start: number, end: number, step: number): number[] {
  const hours: number[] = [];
  let h = start;
  if (start <= end) {
    // Normal range: e.g. 9 to 20
    while (h <= end) { hours.push(h); h += step; }
  } else {
    // Wrap-around: e.g. 18 to 8 (overnight)
    while (h < 24) { hours.push(h); h += step; }
    h = h - 24; // continue from wrapped hour
    while (h <= end) { hours.push(h); h += step; }
  }
  return hours;
}

function builderToCron(b: BuilderState): string {
  switch (b.frequency) {
    case 'hourly': return `${b.minute} * * * *`;
    case 'daily': return `${b.minute} ${b.hour} * * *`;
    case 'weekly': return `${b.minute} ${b.hour} * * ${b.days.length ? b.days.sort((a, c) => a - c).join(',') : '1'}`;
    case 'monthly': return `${b.minute} ${b.hour} ${b.dayOfMonth} * *`;
    case 'interval': {
      const start = parseInt(b.startHour);
      const end = parseInt(b.endHour);
      const step = parseInt(b.intervalHours);
      if (start <= end) {
        // Simple range — use cron range/step syntax
        return `${b.minute} ${start}-${end}/${step} * * *`;
      }
      // Wrap-around — enumerate hours
      const hours = enumerateIntervalHours(start, end, step);
      return `${b.minute} ${hours.join(',')} * * *`;
    }
  }
}

interface ProviderOption {
  id: string;
  displayName: string;
}

const RUN_HISTORY_LIMIT = 20;

function daysAgoText(days: number): string {
  if (days <= 0) return 'today';
  return days === 1 ? '1 day ago' : `${days} days ago`;
}

/** Expanded run-history value for "Fresh session" (card #0373). Older entries have no reason. */
function describeFreshRun(run: AutomationLogEntry, timeZone: string): string {
  const age = run.conversationStartedAt
    ? calendarDaysBetween(new Date(run.conversationStartedAt), new Date(run.timestamp), timeZone)
    : null;
  const ageText = age === null ? null : `${age} day${age === 1 ? '' : 's'} old`;
  switch (run.freshReason) {
    case 'always': return 'yes (every run)';
    case 'age': return ageText ? `yes (conversation was ${ageText})` : 'yes (conversation reached its limit)';
    case 'age-unknown': return 'yes (conversation start unknown)';
    case 'within-window': return ageText ? `no (conversation ${ageText})` : 'no';
    case 'no-session': return 'new conversation (no earlier session)';
    case 'probe-failed': return 'no (could not check the session age)';
    case 'never': return ageText ? `no (conversation ${ageText})` : 'no';
    default: return run.fresh ? 'yes' : 'no';
  }
}

/** Humanise a run duration: 840 -> "0.8s", 64200 -> "1m 4s". */
function formatElapsed(ms: number | undefined): string {
  if (typeof ms !== 'number' || !isFinite(ms) || ms < 0) return '—';
  if (ms < 1000) return `${ms}ms`;
  const secs = ms / 1000;
  if (secs < 60) return `${secs.toFixed(1)}s`;
  const m = Math.floor(secs / 60);
  const s = Math.round(secs % 60);
  return `${m}m ${s}s`;
}

export function AutomationConfig({ config, cardId, projectId, onChange, session }: AutomationConfigProps) {
  const [showAdvancedCron, setShowAdvancedCron] = useState(false);
  const [providers, setProviders] = useState<ProviderOption[]>([]);
  const [runNowLoading, setRunNowLoading] = useState(false);
  const [runNowResult, setRunNowResult] = useState<'success' | 'error' | null>(null);
  const [timezoneAbbr, setTimezoneAbbr] = useState<string>('');
  const [timezone, setTimezone] = useState<string>('UTC');
  // Typed value for "Every N days" — kept apart from config so the field can be
  // cleared mid-edit; only valid whole numbers reach config.
  const [freshDaysDraft, setFreshDaysDraft] = useState<string>(String(config.freshSessionDays ?? FRESH_DAYS_DEFAULT));
  useEffect(() => {
    if (isValidFreshDays(config.freshSessionDays)) setFreshDaysDraft(String(config.freshSessionDays));
  }, [config.freshSessionDays]);
  const [runs, setRuns] = useState<AutomationLogEntry[]>([]);
  const [runsLoaded, setRunsLoaded] = useState(false);
  const [expandedRun, setExpandedRun] = useState<string | null>(null);

  // Run history is diagnostic, not load-bearing — a failed fetch leaves the
  // section empty rather than surfacing an error into the config modal.
  const loadRuns = useCallback(() => {
    fetch(`/api/scheduler/log?cardId=${encodeURIComponent(cardId)}&limit=${RUN_HISTORY_LIMIT}`)
      .then(res => res.ok ? res.json() : null)
      .then(data => { if (data?.runs) setRuns(data.runs); })
      .catch(() => {})
      .finally(() => setRunsLoaded(true));
  }, [cardId]);

  useEffect(() => { loadRuns(); }, [loadRuns]);

  // Parse current cron into builder state
  const parsed = parseCronToBuilder(config.schedule);
  const [builder, setBuilder] = useState<BuilderState>(parsed);

  // Fetch providers and timezone
  useEffect(() => {
    fetch('/api/providers')
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        if (data?.providers) {
          setProviders(
            Object.entries(data.providers).map(([id, p]) => ({
              id,
              displayName: (p as { displayName: string }).displayName || id,
            }))
          );
        }
      })
      .catch(() => {});
    fetch('/api/scheduler')
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        if (data?.abbreviation) setTimezoneAbbr(data.abbreviation);
        if (data?.timezone) setTimezone(data.timezone);
      })
      .catch(() => {});
  }, []);

  // Fetch nextRun from backend after any schedule/config change
  const refreshNextRun = (schedule: string, scheduleType: 'recurring' | 'one-shot', configOverrides?: Partial<AutomationConfigType>) => {
    if (scheduleType !== 'recurring' || !schedule) return;
    fetch('/api/scheduler', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'nextRun', schedule, scheduleType }),
    })
      .then(res => res.ok ? res.json() : null)
      .then(data => { if (data?.nextRun) onChange({ ...config, ...configOverrides, schedule, nextRun: data.nextRun }); })
      .catch(() => {});
  };

  const updateBuilder = (patch: Partial<BuilderState>) => {
    const next = { ...builder, ...patch };
    setBuilder(next);
    const cron = builderToCron(next);
    onChange({ ...config, schedule: cron, nextRun: undefined });
    if (config.enabled) refreshNextRun(cron, config.scheduleType);
  };

  const humanReadable = cronToHumanReadable(config.schedule, config.scheduleType, 'Not set', timezoneAbbr || undefined);

  const mode = freshMode(config);
  const segOn = 'bg-orange-500 text-white';
  const segOff = 'bg-surface-3 text-ink-2 hover:bg-surface-3';
  // When the current conversation started and, in every-N-days mode, when the
  // next fresh start is due. Same rule the scheduler applies (card #0373).
  const sessionAgeText = (() => {
    if (mode === 'always' || session === undefined) return null;
    if (session === null) return 'No conversation yet. The next run starts one.';
    const now = new Date();
    const d = resolveFreshness(config, { ok: true, session }, now, timezone);
    if (!d.conversationStartedAt || d.ageDays === undefined) {
      return mode === 'interval' ? 'Conversation start unknown. The next run starts fresh.' : null;
    }
    const started = `Conversation started ${formatDateKey(localDateKey(new Date(d.conversationStartedAt), timezone), now)}, ${daysAgoText(d.ageDays)}.`;
    if (mode === 'never') return started;
    if (d.fresh) return `${started} The next run starts fresh.`;
    return `${started} Next fresh start: the first run on or after ${formatDateKey(d.nextFreshDate!, now)}.`;
  })();

  const inputClass = 'rounded border border-line-strong bg-surface-1 px-2 py-1 text-sm text-ink-2 focus:border-orange-400 focus:outline-none focus:ring-1 focus:ring-orange-400/30';
  const labelClass = 'text-xs font-medium text-ink-3';

  return (
    <div className="space-y-4">
      {/* Schedule Section */}
      <div className="rounded-lg border border-orange-400/20 bg-orange-50/50 p-3 dark:bg-orange-950/10">
        <h4 className="mb-3 text-sm font-semibold text-orange-700 dark:text-orange-400">Schedule</h4>

        {/* Schedule type toggle */}
        <div className="mb-3 flex items-center gap-2">
          <button
            onClick={() => {
              const cron = builderToCron(builder);
              onChange({ ...config, scheduleType: 'recurring', schedule: cron, nextRun: undefined });
              if (config.enabled) refreshNextRun(cron, 'recurring');
            }}
            className={`rounded-l-lg px-3 py-1.5 text-xs font-medium transition-colors ${
              config.scheduleType === 'recurring'
                ? 'bg-orange-500 text-white'
                : 'bg-surface-3 text-ink-2 hover:bg-surface-3'
            }`}
          >
            Recurring
          </button>
          <button
            onClick={() => onChange({ ...config, scheduleType: 'one-shot', schedule: '', nextRun: undefined })}
            className={`rounded-r-lg px-3 py-1.5 text-xs font-medium transition-colors ${
              config.scheduleType === 'one-shot'
                ? 'bg-orange-500 text-white'
                : 'bg-surface-3 text-ink-2 hover:bg-surface-3'
            }`}
          >
            One-shot
          </button>
        </div>

        {config.scheduleType === 'recurring' ? (
          <div className="space-y-3">
            {/* Frequency selector */}
            <div className="flex items-center gap-2">
              <span className={labelClass}>Frequency:</span>
              <select
                value={builder.frequency}
                onChange={(e) => updateBuilder({ frequency: e.target.value as Frequency })}
                className={inputClass}
              >
                <option value="hourly">Hourly</option>
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
                <option value="monthly">Monthly</option>
                <option value="interval">Interval (hour range)</option>
              </select>
            </div>

            {/* Interval: every X hours between start-end */}
            {builder.frequency === 'interval' && (
              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={labelClass}>Every</span>
                  <select
                    value={builder.intervalHours}
                    onChange={(e) => updateBuilder({ intervalHours: e.target.value })}
                    className={inputClass}
                  >
                    {[1, 2, 3, 4, 6, 8].map(n => (
                      <option key={n} value={String(n)}>{n} hour{n > 1 ? 's' : ''}</option>
                    ))}
                  </select>
                  <span className={labelClass}>between</span>
                  <select
                    value={builder.startHour}
                    onChange={(e) => updateBuilder({ startHour: e.target.value })}
                    className={inputClass}
                  >
                    {Array.from({ length: 24 }, (_, i) => (
                      <option key={i} value={String(i)}>{String(i).padStart(2, '0')}:00</option>
                    ))}
                  </select>
                  <span className={labelClass}>and</span>
                  <select
                    value={builder.endHour}
                    onChange={(e) => updateBuilder({ endHour: e.target.value })}
                    className={inputClass}
                  >
                    {Array.from({ length: 24 }, (_, i) => (
                      <option key={i} value={String(i)}>{String(i).padStart(2, '0')}:00</option>
                    ))}
                  </select>
                </div>
                <div className="flex items-center gap-2">
                  <span className={labelClass}>At minute:</span>
                  <select
                    value={builder.minute}
                    onChange={(e) => updateBuilder({ minute: e.target.value })}
                    className={inputClass}
                  >
                    {[0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55].map(m => (
                      <option key={m} value={String(m)}>:{String(m).padStart(2, '0')}</option>
                    ))}
                  </select>
                </div>
              </div>
            )}

            {/* Time picker (for daily/weekly/monthly) */}
            {(builder.frequency === 'daily' || builder.frequency === 'weekly' || builder.frequency === 'monthly') && (
              <div className="flex items-center gap-2">
                <span className={labelClass}>At:</span>
                <input
                  type="time"
                  value={`${builder.hour.padStart(2, '0')}:${builder.minute.padStart(2, '0')}`}
                  onChange={(e) => {
                    const [h, m] = e.target.value.split(':');
                    updateBuilder({ hour: String(parseInt(h)), minute: String(parseInt(m)) });
                  }}
                  className={inputClass}
                />
              </div>
            )}

            {/* Minute offset for hourly */}
            {builder.frequency === 'hourly' && (
              <div className="flex items-center gap-2">
                <span className={labelClass}>At minute:</span>
                <select
                  value={builder.minute}
                  onChange={(e) => updateBuilder({ minute: e.target.value })}
                  className={inputClass}
                >
                  {[0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55].map(m => (
                    <option key={m} value={String(m)}>:{String(m).padStart(2, '0')}</option>
                  ))}
                </select>
              </div>
            )}

            {/* Day checkboxes for weekly */}
            {builder.frequency === 'weekly' && (
              <div className="flex items-center gap-2">
                <span className={labelClass}>Days:</span>
                <div className="flex gap-1">
                  {DAY_LABELS.map((label, i) => (
                    <button
                      key={i}
                      onClick={() => {
                        const newDays = builder.days.includes(i) ? builder.days.filter(d => d !== i) : [...builder.days, i];
                        updateBuilder({ days: newDays });
                      }}
                      className={`rounded px-2 py-1 text-xs font-medium transition-colors ${
                        builder.days.includes(i)
                          ? 'bg-orange-500 text-white'
                          : 'bg-surface-3 text-ink-2 hover:bg-void-300'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Day of month for monthly */}
            {builder.frequency === 'monthly' && (
              <div className="flex items-center gap-2">
                <span className={labelClass}>Day:</span>
                <select
                  value={builder.dayOfMonth}
                  onChange={(e) => updateBuilder({ dayOfMonth: e.target.value })}
                  className={inputClass}
                >
                  {Array.from({ length: 28 }, (_, i) => i + 1).map(d => (
                    <option key={d} value={String(d)}>{d}</option>
                  ))}
                </select>
              </div>
            )}

            {/* Advanced cron */}
            <div>
              <button
                onClick={() => setShowAdvancedCron(!showAdvancedCron)}
                className="text-xs text-ink-3 hover:text-orange-500"
              >
                {showAdvancedCron ? 'Hide' : 'Show'} advanced (cron)
              </button>
              {showAdvancedCron && (
                <div className="mt-1 flex items-center gap-2">
                  <input
                    type="text"
                    value={config.schedule}
                    onChange={(e) => {
                      const val = e.target.value;
                      onChange({ ...config, schedule: val, nextRun: undefined });
                      const p = parseCronToBuilder(val);
                      setBuilder(p);
                      if (config.enabled) refreshNextRun(val, 'recurring');
                    }}
                    placeholder="* * * * *"
                    className={`flex-1 font-mono text-xs ${inputClass}`}
                  />
                </div>
              )}
            </div>
          </div>
        ) : (
          /* One-shot: date + time picker */
          <div className="flex items-center gap-2">
            <span className={labelClass}>Date & Time:</span>
            <input
              type="datetime-local"
              value={isoToDatetimeLocal(config.schedule)}
              onChange={(e) => onChange({ ...config, schedule: datetimeLocalToIso(e.target.value), nextRun: undefined })}
              className={inputClass}
            />
            {timezoneAbbr && (
              <span className="text-xs text-ink-3">({timezoneAbbr})</span>
            )}
          </div>
        )}

        {/* Human-readable preview */}
        <div className="mt-2 rounded bg-orange-100/50 px-2 py-1 text-xs text-orange-700 dark:bg-orange-900/20 dark:text-orange-300">
          {humanReadable}
        </div>

        {/* Last run / Next run */}
        {(config.lastRun || config.nextRun) && (
          <div className="mt-2 flex gap-4 text-xs text-ink-3">
            {config.lastRun && (
              <span>
                Last run: {formatDateTime(config.lastRun)}
                {config.lastResult && (
                  <span className={config.lastResult === 'success' ? ' text-green-600 dark:text-green-400' : ' text-red-600 dark:text-red-400'}>
                    {' '}({config.lastResult})
                  </span>
                )}
              </span>
            )}
            {config.nextRun && (
              <span>Next run: {formatDateTime(config.nextRun)}</span>
            )}
          </div>
        )}
      </div>

      {/* Execution Section */}
      <div className="rounded-lg border border-orange-400/20 bg-orange-50/50 p-3 dark:bg-orange-950/10">
        <h4 className="mb-3 text-sm font-semibold text-orange-700 dark:text-orange-400">Execution</h4>

        <div className="space-y-3">
          {/* Provider */}
          <div className="flex items-center gap-2">
            <span className={labelClass}>Provider:</span>
            <select
              value={config.provider}
              onChange={(e) => onChange({ ...config, provider: e.target.value })}
              className={inputClass}
            >
              {providers.length > 0 ? (
                providers.map(p => (
                  <option key={p.id} value={p.id}>{p.displayName}</option>
                ))
              ) : (
                <option value={config.provider}>{config.provider}</option>
              )}
            </select>
          </div>

          {/* Fresh session: every run / every N days / never (card #0373) */}
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className={labelClass}>Fresh session:</span>
              <div className="flex items-center gap-2" role="group" aria-label="Fresh session">
                <button
                  type="button"
                  aria-pressed={mode === 'always'}
                  onClick={() => onChange({ ...config, freshSession: true, freshSessionDays: undefined })}
                  className={`rounded-l-lg px-3 py-1.5 text-xs font-medium transition-colors ${mode === 'always' ? segOn : segOff}`}
                >
                  Every run
                </button>
                {mode === 'interval' ? (
                  <span className={`flex items-center gap-1.5 px-3 py-1 text-xs font-medium ${segOn}`}>
                    Every
                    <input
                      type="number"
                      inputMode="numeric"
                      min={FRESH_DAYS_MIN}
                      max={FRESH_DAYS_MAX}
                      step={1}
                      value={freshDaysDraft}
                      aria-label="Days between fresh sessions"
                      onChange={(e) => {
                        setFreshDaysDraft(e.target.value);
                        const n = Number(e.target.value);
                        if (isValidFreshDays(n)) onChange({ ...config, freshSession: false, freshSessionDays: n });
                      }}
                      onBlur={() => setFreshDaysDraft(String(config.freshSessionDays ?? FRESH_DAYS_DEFAULT))}
                      className="w-12 rounded bg-white/20 px-1 py-0.5 text-center text-xs text-white focus:outline-none focus:ring-1 focus:ring-white/70 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                    />
                    {config.freshSessionDays === 1 ? 'day' : 'days'}
                  </span>
                ) : (
                  <button
                    type="button"
                    aria-pressed={false}
                    onClick={() => {
                      const n = Number(freshDaysDraft);
                      onChange({ ...config, freshSession: false, freshSessionDays: isValidFreshDays(n) ? n : FRESH_DAYS_DEFAULT });
                    }}
                    className={`px-3 py-1.5 text-xs font-medium transition-colors ${segOff}`}
                  >
                    Every {isValidFreshDays(Number(freshDaysDraft)) ? freshDaysDraft : FRESH_DAYS_DEFAULT} days
                  </button>
                )}
                <button
                  type="button"
                  aria-pressed={mode === 'never'}
                  onClick={() => onChange({ ...config, freshSession: false, freshSessionDays: undefined })}
                  className={`rounded-r-lg px-3 py-1.5 text-xs font-medium transition-colors ${mode === 'never' ? segOn : segOff}`}
                >
                  Never
                </button>
              </div>
            </div>
            {sessionAgeText && (
              <p className="mt-1.5 text-xs text-ink-3">{sessionAgeText}</p>
            )}
          </div>

          {/* Toggles row */}
          <div className="flex flex-wrap gap-4">
            {/* Report via messaging toggle */}
            <label className="flex cursor-pointer items-center gap-2">
              <span className={labelClass}>Report via messaging:</span>
              <button
                type="button"
                role="switch"
                aria-checked={config.reportViaMessaging}
                onClick={() => onChange({ ...config, reportViaMessaging: !config.reportViaMessaging })}
                className={`relative inline-flex h-5 w-9 flex-shrink-0 rounded-full border-2 border-transparent transition-colors ${
                  config.reportViaMessaging
                    ? 'bg-orange-500'
                    : 'bg-surface-3'
                }`}
              >
                <span className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow transition ${config.reportViaMessaging ? 'translate-x-4' : 'translate-x-0'}`} />
              </button>
            </label>
          </div>

          {/* Working directory override */}
          <div className="flex items-center gap-2">
            <span className={labelClass}>Working dir:</span>
            <input
              type="text"
              value={config.workingDirectory || ''}
              onChange={(e) => onChange({ ...config, workingDirectory: e.target.value || undefined })}
              placeholder="(uses card's project directory)"
              className={`flex-1 ${inputClass}`}
            />
          </div>

          {/* Enabled toggle + Run Now */}
          <div className="flex items-center justify-between rounded-lg border border-orange-400/20 bg-surface-1 p-2">
            <div>
              <span className="text-sm font-medium text-ink-2">Enabled</span>
              {!config.enabled && (
                <p className="text-xs text-orange-600 dark:text-orange-400">This automation won&apos;t run until enabled</p>
              )}
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={runNowLoading}
                onClick={async () => {
                  setRunNowLoading(true);
                  setRunNowResult(null);
                  try {
                    const res = await fetch('/api/scheduler', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ action: 'trigger', cardId, projectId }),
                    });
                    const data = await res.json();
                    setRunNowResult(data.success ? 'success' : 'error');
                  } catch {
                    setRunNowResult('error');
                  } finally {
                    setRunNowLoading(false);
                    setTimeout(() => setRunNowResult(null), 3000);
                    // Surface the run we just triggered without reopening the modal
                    loadRuns();
                  }
                }}
                className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-all ${
                  runNowResult === 'success'
                    ? 'border-green-400/40 bg-green-400/15 text-green-600 dark:text-green-400'
                    : runNowResult === 'error'
                      ? 'border-red-400/40 bg-red-400/15 text-red-600 dark:text-red-400'
                      : 'border-orange-400/40 bg-orange-400/15 text-orange-600 hover:bg-orange-400/25 dark:text-orange-400'
                } disabled:cursor-not-allowed disabled:opacity-50`}
              >
                {runNowLoading ? 'Running...' : runNowResult === 'success' ? 'Triggered' : runNowResult === 'error' ? 'Failed' : 'Run Now'}
              </button>
              <button
                type="button"
                role="switch"
                aria-checked={config.enabled}
                onClick={() => {
                  const willEnable = !config.enabled;
                  onChange({ ...config, enabled: willEnable });
                  if (willEnable) refreshNextRun(config.schedule, config.scheduleType, { enabled: true });
                }}
                className={`relative inline-flex h-6 w-11 flex-shrink-0 rounded-full border-2 border-transparent transition-colors ${
                  config.enabled
                    ? 'bg-green-500'
                    : 'bg-surface-3'
                }`}
              >
                <span className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow transition ${config.enabled ? 'translate-x-5' : 'translate-x-0'}`} />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Recent Runs Section */}
      <div className="rounded-lg border border-orange-400/20 bg-orange-50/50 p-3 dark:bg-orange-950/10">
        <div className="mb-3 flex items-center justify-between">
          <h4 className="text-sm font-semibold text-orange-700 dark:text-orange-400">Recent runs</h4>
          <button
            type="button"
            onClick={loadRuns}
            className="rounded px-2 py-0.5 text-xs text-ink-3 hover:bg-orange-400/10 hover:text-orange-600 dark:hover:text-orange-400"
          >
            Refresh
          </button>
        </div>

        {runs.length === 0 ? (
          <p className="text-xs text-ink-3">
            {runsLoaded ? 'No runs recorded yet.' : 'Loading run history...'}
          </p>
        ) : (
          <div className="space-y-1">
            {runs.map((run, i) => {
              const key = `${run.timestamp}-${i}`;
              const isExpanded = expandedRun === key;
              const failed = run.outcome === 'error';
              return (
                <div
                  key={key}
                  className="overflow-hidden rounded-lg border border-orange-400/20 bg-surface-1"
                >
                  <button
                    type="button"
                    onClick={() => setExpandedRun(isExpanded ? null : key)}
                    aria-expanded={isExpanded}
                    className="flex w-full items-center gap-2 px-2 py-1.5 text-left hover:bg-orange-400/5"
                  >
                    <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${
                      failed
                        ? 'bg-red-50 text-red-600 dark:bg-red-900/20 dark:text-red-400'
                        : 'bg-green-50 text-green-600 dark:bg-green-900/20 dark:text-green-400'
                    }`}>
                      {failed ? 'Err' : 'OK'}
                    </span>
                    <span className="text-xs text-ink-2">
                      {formatDateTime(run.timestamp)}
                    </span>
                    <span className="rounded bg-surface-2 px-1.5 py-0.5 text-[11px] text-ink-3">
                      {run.trigger}
                    </span>
                    {run.fresh && (
                      <span className="rounded bg-orange-100 px-1.5 py-0.5 text-[11px] text-orange-700 dark:bg-orange-900/30 dark:text-orange-300">
                        fresh
                      </span>
                    )}
                    <span className="text-[11px] text-ink-3">
                      {formatElapsed(run.elapsedMs)}
                    </span>
                    {failed && run.error && (
                      <span className="min-w-0 flex-1 truncate text-[11px] text-red-600 dark:text-red-400">
                        {run.error}
                      </span>
                    )}
                    <span className="ml-auto flex-shrink-0 text-[11px] text-ink-3">
                      {isExpanded ? '−' : '+'}
                    </span>
                  </button>

                  {isExpanded && (
                    <dl className="space-y-1 border-t border-orange-400/20 px-2 py-2 text-[11px]">
                      {[
                        ['Provider', run.provider],
                        ['Session', run.sessionName],
                        ['Fresh session', describeFreshRun(run, timezone)],
                        ['Bridge', run.bridgeRequest
                          ? `status ${run.bridgeRequest.status}${run.bridgeRequest.resumed ? ' (resumed)' : ''}${run.bridgeRequest.pid ? ` pid ${run.bridgeRequest.pid}` : ''}${run.bridgeRequest.error ? ` — ${run.bridgeRequest.error}` : ''}`
                          : null],
                        ['Liveness', run.livenessCheck
                          ? `${run.livenessCheck.type}: ${run.livenessCheck.result}${typeof run.livenessCheck.exitCode === 'number' ? ` (exit ${run.livenessCheck.exitCode})` : ''}`
                          : null],
                        ['Delivery', run.delivery
                          ? `${run.delivery.outcome} — ${run.delivery.attempts} attempt(s), ${run.delivery.resends} resend(s)${run.delivery.reason ? ` — ${run.delivery.reason}` : ''}`
                          : null],
                      ].map(([label, value]) => value ? (
                        <div key={label as string} className="flex gap-2">
                          <dt className="w-24 flex-shrink-0 text-ink-3">{label}</dt>
                          <dd className="min-w-0 break-words text-ink-2">{value}</dd>
                        </div>
                      ) : null)}
                      {run.error && (
                        <div className="flex gap-2">
                          <dt className="w-24 flex-shrink-0 text-ink-3">Error</dt>
                          <dd className="min-w-0 break-words text-red-600 dark:text-red-400">{run.error}</dd>
                        </div>
                      )}
                    </dl>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
