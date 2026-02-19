'use client';

import { useState, useEffect } from 'react';
import type { AutomationConfig as AutomationConfigType } from '@/lib/types';
import { cronToHumanReadable } from '@/lib/cron-utils';

interface AutomationConfigProps {
  config: AutomationConfigType;
  cardId: string;
  projectId: string;
  onChange: (config: AutomationConfigType) => void;
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

export function AutomationConfig({ config, cardId, projectId, onChange }: AutomationConfigProps) {
  const [showAdvancedCron, setShowAdvancedCron] = useState(false);
  const [providers, setProviders] = useState<ProviderOption[]>([]);
  const [runNowLoading, setRunNowLoading] = useState(false);
  const [runNowResult, setRunNowResult] = useState<'success' | 'error' | null>(null);
  const [timezoneAbbr, setTimezoneAbbr] = useState<string>('');

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
      .then(data => { if (data?.abbreviation) setTimezoneAbbr(data.abbreviation); })
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

  const inputClass = 'rounded border border-void-300 bg-white px-2 py-1 text-sm text-void-700 focus:border-orange-400 focus:outline-none focus:ring-1 focus:ring-orange-400/30 dark:border-void-600 dark:bg-void-800 dark:text-void-300';
  const labelClass = 'text-xs font-medium text-void-500 dark:text-void-400';

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
                : 'bg-void-200 text-void-600 hover:bg-void-300 dark:bg-void-700 dark:text-void-400 dark:hover:bg-void-600'
            }`}
          >
            Recurring
          </button>
          <button
            onClick={() => onChange({ ...config, scheduleType: 'one-shot', schedule: '', nextRun: undefined })}
            className={`rounded-r-lg px-3 py-1.5 text-xs font-medium transition-colors ${
              config.scheduleType === 'one-shot'
                ? 'bg-orange-500 text-white'
                : 'bg-void-200 text-void-600 hover:bg-void-300 dark:bg-void-700 dark:text-void-400 dark:hover:bg-void-600'
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
                          : 'bg-void-200 text-void-600 hover:bg-void-300 dark:bg-void-700 dark:text-void-400'
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
                className="text-xs text-void-500 hover:text-orange-500 dark:text-void-400"
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
              value={config.schedule ? config.schedule.slice(0, 16) : ''}
              onChange={(e) => onChange({ ...config, schedule: new Date(e.target.value).toISOString(), nextRun: undefined })}
              className={inputClass}
            />
            {timezoneAbbr && (
              <span className="text-xs text-void-500 dark:text-void-400">({timezoneAbbr})</span>
            )}
          </div>
        )}

        {/* Human-readable preview */}
        <div className="mt-2 rounded bg-orange-100/50 px-2 py-1 text-xs text-orange-700 dark:bg-orange-900/20 dark:text-orange-300">
          {humanReadable}
        </div>

        {/* Last run / Next run */}
        {(config.lastRun || config.nextRun) && (
          <div className="mt-2 flex gap-4 text-xs text-void-500 dark:text-void-400">
            {config.lastRun && (
              <span>
                Last run: {new Date(config.lastRun).toLocaleString()}
                {config.lastResult && (
                  <span className={config.lastResult === 'success' ? ' text-green-600 dark:text-green-400' : ' text-red-600 dark:text-red-400'}>
                    {' '}({config.lastResult})
                  </span>
                )}
              </span>
            )}
            {config.nextRun && (
              <span>Next run: {new Date(config.nextRun).toLocaleString()}</span>
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

          {/* Toggles row */}
          <div className="flex flex-wrap gap-4">
            {/* Fresh session toggle */}
            <label className="flex cursor-pointer items-center gap-2">
              <span className={labelClass}>Fresh session:</span>
              <button
                type="button"
                role="switch"
                aria-checked={config.freshSession}
                onClick={() => onChange({ ...config, freshSession: !config.freshSession })}
                className={`relative inline-flex h-5 w-9 flex-shrink-0 rounded-full border-2 border-transparent transition-colors ${
                  config.freshSession
                    ? 'bg-orange-500'
                    : 'bg-void-300 dark:bg-void-600'
                }`}
              >
                <span className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow transition ${config.freshSession ? 'translate-x-4' : 'translate-x-0'}`} />
              </button>
            </label>

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
                    : 'bg-void-300 dark:bg-void-600'
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
          <div className="flex items-center justify-between rounded-lg border border-orange-400/20 bg-white/50 p-2 dark:bg-void-800/50">
            <div>
              <span className="text-sm font-medium text-void-700 dark:text-void-300">Enabled</span>
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
                  }
                }}
                className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-all ${
                  runNowResult === 'success'
                    ? 'border-green-400/40 bg-green-400/15 text-green-600 dark:text-green-400'
                    : runNowResult === 'error'
                      ? 'border-red-400/40 bg-red-400/15 text-red-600 dark:text-red-400'
                      : 'border-orange-400/40 bg-orange-400/15 text-orange-600 hover:bg-orange-400/25 hover:shadow-[0_0_12px_rgba(249,115,22,0.3)] dark:text-orange-400'
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
                    : 'bg-void-300 dark:bg-void-600'
                }`}
              >
                <span className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow transition ${config.enabled ? 'translate-x-5' : 'translate-x-0'}`} />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
