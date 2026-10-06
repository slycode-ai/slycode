'use client';

/**
 * Scheduled sends — the stopwatch button in the terminal footer's right
 * cluster and its popover (card #0352).
 *
 * The popover has three regions: compose (message + quick offsets + time of
 * day with a Today/Tomorrow toggle), Pending (edit / cancel per row), Sent
 * (delivered / failed history with Retry). All times are shown in the
 * BROWSER's local zone because the inputs are local (the #0320 lesson);
 * storage is UTC ISO.
 *
 * Design: documentation/designs/scheduled_card_prompts.md §Q7.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ScheduledPrompt } from '@/lib/types';
import {
  QUICK_OFFSETS,
  autoDayFor,
  finishedEntries,
  formatCountdown,
  formatFireTime,
  localZoneAbbreviation,
  nextPendingFireAt,
  offsetFireAt,
  pendingEntries,
  timeOfDayFireAt,
  toLocalHHMM,
  validateScheduledPromptInput,
  type PickerDay,
} from '@/lib/scheduled-prompts';
import { StopwatchGlyph } from './StopwatchGlyph';
import { getProviderColor } from '@/lib/provider-colors';
import { providerFromSessionName } from '@/lib/scheduled-prompts';
import Tooltip from './Tooltip';

interface Props {
  projectId: string;
  cardId: string;
  sessionName: string;
  /** Live list from the board (SSE-refreshed). Local state re-seeds from it. */
  list: ScheduledPrompt[];
  /** provider id → display name (from /api/providers); falls back to a built-in map. */
  providerNames?: Record<string, string>;
}

const FALLBACK_PROVIDER_NAMES: Record<string, string> = { claude: 'Claude', codex: 'Codex', opencode: 'OpenCode' };

/** Small brand-tinted provider label (registry colours via provider-colors). */
function ProviderChip({ id, names, size = 'sm' }: { id: string; names?: Record<string, string>; size?: 'sm' | 'md' }) {
  const c = getProviderColor(id);
  const label = names?.[id] ?? FALLBACK_PROVIDER_NAMES[id] ?? (id.charAt(0).toUpperCase() + id.slice(1));
  return (
    <Tooltip content={`${label} session`}>
      <span
        className={`inline-flex shrink-0 items-center rounded border font-medium leading-none ${size === 'md' ? 'px-1.5 py-0.5 text-[11px]' : 'px-1 py-px text-[9px]'}`}
        style={{ color: c.color, backgroundColor: c.bg, borderColor: c.border }}
      >
        {label}
      </span>
    </Tooltip>
  );
}

const API = '/api/scheduler/prompts';

const isSameLocalDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

export function ScheduledSendsControl({ projectId, cardId, sessionName, list: liveList, providerNames }: Props) {
  const sessionProvider = providerFromSessionName(sessionName) ?? 'claude';
  const [open, setOpen] = useState(false);
  const [list, setList] = useState<ScheduledPrompt[]>(liveList);
  const [now, setNow] = useState(() => new Date());
  const [message, setMessage] = useState('');
  const [hhmm, setHhmm] = useState('');
  const [day, setDay] = useState<PickerDay>('today');
  const [fireAt, setFireAt] = useState<Date | null>(null);
  const [selectedOffset, setSelectedOffset] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Re-seed from the board whenever it changes (a fired send moves to Sent).
  useEffect(() => { setList(liveList); }, [liveList]);

  // Hydrate from the server on mount and on open. The board copy can lag the
  // store by up to one poll interval (and by however long a stale modal was
  // open), so the server list is the truth for the button count and popover.
  const hydrate = useCallback(async (signal?: AbortSignal) => {
    try {
      const res = await fetch(`${API}?projectId=${encodeURIComponent(projectId)}&cardId=${encodeURIComponent(cardId)}`, { signal });
      if (!res.ok) return;
      const data = await res.json();
      if (Array.isArray(data.list)) setList(data.list);
    } catch {
      // Network blip — the prop re-seed and the next open will catch up.
    }
  }, [projectId, cardId]);

  useEffect(() => {
    const ac = new AbortController();
    hydrate(ac.signal);
    return () => ac.abort();
  }, [hydrate]);

  useEffect(() => { if (open) hydrate(); }, [open, hydrate]);

  // Tick the clock while open so countdowns stay honest.
  useEffect(() => {
    if (!open) return;
    setNow(new Date());
    const t = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(t);
  }, [open]);

  // Close on outside click / Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  useEffect(() => { if (open) textareaRef.current?.focus(); }, [open]);

  const pending = useMemo(() => pendingEntries(list).sort((a, b) => Date.parse(a.fireAt) - Date.parse(b.fireAt)), [list]);
  const sent = useMemo(() => finishedEntries(list).sort((a, b) => Date.parse(b.finishedAt || b.fireAt) - Date.parse(a.finishedAt || a.fireAt)).slice(0, 5), [list]);
  const nextFire = nextPendingFireAt(list);
  const zone = useMemo(() => localZoneAbbreviation(now), [now]);

  const resetForm = useCallback(() => {
    setMessage(''); setHhmm(''); setDay('today'); setFireAt(null); setSelectedOffset(null); setEditingId(null); setError(null);
  }, []);

  const pickOffset = (label: string, ms: number) => {
    const d = offsetFireAt(ms, new Date());
    setFireAt(d);
    setSelectedOffset(label);
    setHhmm(toLocalHHMM(d));
    setDay(isSameLocalDay(d, new Date()) ? 'today' : 'tomorrow');
    setError(null);
  };

  const changeTime = (value: string, nextDay?: PickerDay) => {
    const current = new Date();
    const d = nextDay ?? autoDayFor(value, current);
    setHhmm(value);
    setDay(d);
    setSelectedOffset(null);
    setFireAt(value ? timeOfDayFireAt(value, d, current) : null);
    setError(null);
  };

  // Today is only offered while that wall-clock time is still ahead.
  const todayStillAhead = hhmm ? autoDayFor(hhmm, now) === 'today' : true;

  const startEdit = (entry: ScheduledPrompt) => {
    const d = new Date(entry.fireAt);
    setEditingId(entry.id);
    setMessage(entry.message);
    setFireAt(d);
    setHhmm(toLocalHHMM(d));
    setDay(isSameLocalDay(d, new Date()) ? 'today' : 'tomorrow');
    setSelectedOffset(null);
    setError(null);
    textareaRef.current?.focus();
  };

  const call = async (method: 'POST' | 'PATCH' | 'DELETE', body: Record<string, unknown>) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(API, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ projectId, cardId, ...body }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setError(data.error || `Request failed (${res.status})`); return false; }
      if (Array.isArray(data.list)) setList(data.list);
      return true;
    } catch (err) {
      setError((err as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  };

  const submit = async () => {
    if (!fireAt) { setError('Pick a time'); return; }
    const v = validateScheduledPromptInput({ message, fireAt: fireAt.toISOString() });
    if (!v.ok) { setError(v.error); return; }
    const ok = editingId
      ? await call('PATCH', { id: editingId, message: v.message, fireAt: v.fireAt })
      : await call('POST', { sessionName, message: v.message, fireAt: v.fireAt });
    if (ok) resetForm();
  };

  const cancelEntry = (id: string) => call('DELETE', { id });
  const retry = (entry: ScheduledPrompt) => call('POST', { sessionName, message: entry.message, fireAt: offsetFireAt(60_000, new Date()).toISOString() });

  const preview = fireAt
    ? `Fires ${fireAt.toLocaleDateString(undefined, { weekday: 'short' })} ${toLocalHHMM(fireAt)} ${zone} · ${formatCountdown(fireAt.toISOString(), now)}`
    : 'Pick an offset or a time';
  const canSubmit = !busy && !!fireAt && message.trim().length > 0;

  const chip = 'rounded border px-1.5 py-0.5 font-[family-name:var(--font-jetbrains-mono)] text-[11px] transition-colors';
  const chipIdle = 'border-void-600 text-ink-3 hover:border-neon-orange-400/40 hover:text-neon-orange-300';
  const chipOn = 'border-neon-orange-400/50 bg-neon-orange-400/15 text-neon-orange-300';

  return (
    <div className="relative" ref={rootRef}>
      <Tooltip content={pending.length
          ? `${pending.length} scheduled send${pending.length === 1 ? '' : 's'} — next ${formatFireTime(nextFire!, now)} (${formatCountdown(nextFire!, now)})`
          : 'Schedule a message to send to this session later'}>
        <button
          type="button"
          onClick={() => setOpen(o => !o)}
          aria-expanded={open}
          aria-label={pending.length ? `Scheduled sends: next ${formatFireTime(nextFire!, now)}` : 'Schedule a send'}
          className={`relative flex items-center rounded-md border px-2 py-1 text-neon-orange-400 transition-all hover:bg-neon-orange-400/20 hover:border-neon-orange-400/40 ${open ? 'border-neon-orange-400/40 bg-neon-orange-400/20' : 'border-neon-orange-400/25 bg-neon-orange-400/10'}`}
        >
          <StopwatchGlyph pointAt={nextFire} />
          {pending.length > 0 && (
            <span className="absolute -right-1.5 -top-1.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-neon-orange-400 px-0.5 font-[family-name:var(--font-jetbrains-mono)] text-[9px] font-bold leading-none text-void-950">
              {pending.length}
            </span>
          )}
        </button>
      </Tooltip>

      {open && (
        <div className="absolute bottom-full right-0 z-50 mb-2 w-[22rem] rounded-lg border border-void-600 bg-void-800 shadow-(--shadow-overlay)">
          {/* Compose */}
          <div className="border-b border-void-700 p-3">
            <div className="mb-2 flex items-center justify-between">
              <span className="flex items-center gap-1.5 text-[11px] font-medium text-ink-3">
                {editingId ? 'Edit send for' : 'Schedule for'}
                <ProviderChip id={sessionProvider} names={providerNames} size="md" />
                <span className="normal-case tracking-normal text-ink-3">· this card</span>
              </span>
              <span className="font-[family-name:var(--font-jetbrains-mono)] text-[10px] text-ink-3">{zone}</span>
            </div>
            <textarea
              ref={textareaRef}
              value={message}
              onChange={e => { setMessage(e.target.value); setError(null); }}
              onKeyDown={e => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); submit(); } }}
              rows={2}
              placeholder="continue"
              className="mb-2 w-full resize-none rounded border border-void-600 bg-void-900 px-2 py-1.5 text-xs text-void-200 placeholder:text-void-600 focus:border-neon-orange-400/50 focus:outline-none"
            />
            <div className="mb-2 flex flex-wrap gap-1">
              {QUICK_OFFSETS.map(o => (
                <button key={o.label} type="button" onClick={() => pickOffset(o.label, o.ms)} className={`${chip} ${selectedOffset === o.label ? chipOn : chipIdle}`}>
                  {o.label}
                </button>
              ))}
            </div>
            <div className="mb-2 flex items-center gap-2">
              <span className="text-[11px] text-ink-3">at</span>
              <input
                type="time"
                value={hhmm}
                onChange={e => changeTime(e.target.value)}
                className="rounded border border-void-600 bg-void-900 px-1.5 py-0.5 font-[family-name:var(--font-jetbrains-mono)] text-[11px] text-void-200 focus:border-neon-orange-400/50 focus:outline-none [color-scheme:dark]"
              />
              <div className="flex overflow-hidden rounded border border-void-600">
                <Tooltip content={todayStillAhead ? undefined : 'That time has already passed today'}>
                  <span className="inline-flex">
                    <button
                      type="button"
                      disabled={!todayStillAhead}
                      onClick={() => changeTime(hhmm, 'today')}
                      className={`px-2 py-0.5 text-[11px] transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${day === 'today' ? 'bg-neon-orange-400/15 text-neon-orange-300' : 'text-void-400 hover:text-void-200'}`}
                    >
                      Today
                    </button>
                  </span>
                </Tooltip>
                <button
                  type="button"
                  onClick={() => changeTime(hhmm, 'tomorrow')}
                  className={`border-l border-void-600 px-2 py-0.5 text-[11px] transition-colors ${day === 'tomorrow' ? 'bg-neon-orange-400/15 text-neon-orange-300' : 'text-void-400 hover:text-void-200'}`}
                >
                  Tomorrow
                </button>
              </div>
            </div>
            <div className="flex items-center justify-between gap-2">
              <Tooltip content={error ?? preview}>
                <span className={`min-w-0 truncate text-[11px] ${error ? 'text-red-400' : fireAt ? 'text-void-300' : 'text-void-500'}`}>
                  {error ?? preview}
                </span>
              </Tooltip>
              <div className="flex shrink-0 items-center gap-1.5">
                {editingId && (
                  <button type="button" onClick={resetForm} className="text-[11px] text-ink-3 hover:text-void-300">Cancel</button>
                )}
                <button
                  type="button"
                  onClick={submit}
                  disabled={!canSubmit}
                  className="rounded border border-neon-orange-400/40 bg-neon-orange-400/15 px-2 py-1 text-xs font-medium text-neon-orange-300 transition-all hover:bg-neon-orange-400/25 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {busy ? 'Saving…' : editingId ? 'Update' : 'Schedule'}
                </button>
              </div>
            </div>
            <div className="mt-1.5 text-[10px] text-void-600">Delivered even if the agent is busy. A stopped session is resumed first.</div>
          </div>

          {/* Pending */}
          <div className="border-b border-void-700 px-3 py-2">
            <div className="mb-1 text-[11px] font-medium text-ink-3">Pending{pending.length ? ` (${pending.length})` : ''}</div>
            {pending.length === 0 ? (
              <div className="text-[11px] text-void-600">Nothing scheduled</div>
            ) : (
              <ul className="max-h-40 overflow-y-auto">
                {pending.map(e => (
                  <li key={e.id} className={`group flex items-center gap-2 rounded px-1 py-1 hover:bg-void-700/60 ${editingId === e.id ? 'bg-void-700/60' : ''}`}>
                    <StopwatchGlyph pointAt={e.fireAt} className="h-3 w-3 shrink-0 text-neon-orange-400" />
                    <Tooltip content={new Date(e.fireAt).toLocaleString()}>
                      <span className="shrink-0 font-[family-name:var(--font-jetbrains-mono)] text-[11px] text-neon-orange-300">
                        {formatFireTime(e.fireAt, now)}
                      </span>
                    </Tooltip>
                    <Tooltip content={e.deferrals ? `Agent was busy at fire time — retried ${e.deferrals}×, will force after 10 min` : undefined}>
                      <span className="shrink-0 text-[10px] text-ink-3">
                        {e.state === 'firing' ? 'firing…' : e.deferrals ? `waiting (busy ×${e.deferrals})` : formatCountdown(e.fireAt, now)}
                      </span>
                    </Tooltip>
                    <ProviderChip id={e.provider} names={providerNames} />
                    <Tooltip content={e.message}><span className="min-w-0 flex-1 truncate text-[11px] text-void-300">{e.message}</span></Tooltip>
                    {e.state === 'pending' && (
                      <span className="flex shrink-0 items-center gap-1">
                        <button type="button" onClick={() => startEdit(e)} className="rounded border border-transparent px-1 py-px text-[10px] text-ink-3 transition-colors hover:border-neon-orange-400/40 hover:text-neon-orange-300">Edit</button>
                        <button type="button" onClick={() => cancelEntry(e.id)} aria-label="Cancel this send" className="rounded border border-void-600/60 px-1 py-px text-[10px] text-void-300 transition-colors hover:border-red-400/50 hover:bg-red-400/10 hover:text-red-400">Cancel</button>
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Sent */}
          {sent.length > 0 && (
            <div className="px-3 py-2">
              <div className="mb-1 text-[11px] font-medium text-ink-3">Sent</div>
              <ul className="max-h-32 overflow-y-auto">
                {sent.map(e => {
                  const ok = e.state === 'delivered';
                  const forced = ok && e.deliveryNote === 'forced_busy';
                  const label = e.state === 'cancelled' ? 'cancelled' : e.state === 'missed' ? 'missed'
                    : forced ? 'delivered while busy (forced)' : ok && e.deliveryNote === 'after_wait' ? 'delivered after wait' : ok ? 'delivered' : 'failed';
                  const when = e.finishedAt || e.fireAt;
                  const rowTitle = e.error ?? (forced ? 'The agent was still busy 10 min past the fire time, so the message was pasted anyway — check the session picked it up' : undefined);
                  return (
                    <Tooltip key={e.id} content={rowTitle}>
                      <li className="group flex items-center gap-2 rounded px-1 py-1 hover:bg-void-700/60">
                        <span className={`w-3 shrink-0 text-center text-[11px] ${ok ? 'text-neon-green-400' : e.state === 'cancelled' ? 'text-void-500' : 'text-red-400'}`}>{ok ? '✓' : e.state === 'cancelled' ? '–' : '✕'}</span>
                        <span className="shrink-0 font-[family-name:var(--font-jetbrains-mono)] text-[11px] text-ink-3">{formatFireTime(when, now)}</span>
                        <ProviderChip id={e.provider} names={providerNames} />
                        <span className="min-w-0 flex-1 truncate text-[11px] text-ink-3">{e.message}</span>
                        <span className={`shrink-0 text-[10px] ${forced ? 'text-amber-400' : ok ? 'text-void-500' : e.state === 'cancelled' ? 'text-void-600' : 'text-red-400'}`}>{label}</span>
                        <span className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                          {(e.state === 'failed' || e.state === 'missed') && (
                            <button type="button" onClick={() => retry(e)} className="text-[10px] text-ink-3 hover:text-neon-orange-300">Retry</button>
                          )}
                          <button type="button" onClick={() => cancelEntry(e.id)} aria-label="Clear from history" className="rounded border border-transparent px-1 py-px text-[10px] text-ink-3 transition-colors hover:border-void-500 hover:text-void-300">Clear</button>
                        </span>
                      </li>
                    </Tooltip>
                  );
                })}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
