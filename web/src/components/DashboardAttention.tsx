'use client';

import Link from 'next/link';
import { useSyncExternalStore } from 'react';
import { AlertTriangle, CalendarClock, FlaskConical, PauseCircle } from 'lucide-react';
import type { AttentionItem, UpcomingRun } from '@/lib/types';
import { formatCardNumber } from '@/lib/kanban-numbering';
import { formatTime } from '@/lib/date-format';

const MAX_ROWS = 5;

// Minute clock shared by every subscriber. The server snapshot is null so
// relative times only render after hydration (server and browser clocks and
// timezones differ).
let nowMs = Date.now();
function subscribeMinute(cb: () => void) {
  const id = setInterval(() => { nowMs = Date.now(); cb(); }, 60_000);
  return () => clearInterval(id);
}
function useNow(): number | null {
  return useSyncExternalStore(subscribeMinute, () => nowMs, () => null);
}

function until(iso: string, now: number): string {
  const mins = Math.max(0, Math.round((Date.parse(iso) - now) / 60_000));
  if (mins < 1) return 'now';
  if (mins < 60) return `in ${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `in ${h}h ${m}m` : `in ${h}h`;
}

function ago(iso: string | undefined, now: number): string {
  if (!iso) return '';
  const mins = Math.round((now - Date.parse(iso)) / 60_000);
  if (isNaN(mins)) return '';
  if (mins < 60) return `${Math.max(1, mins)}m ago`;
  const h = Math.round(mins / 60);
  if (h < 48) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

function cardHref(projectId: string, cardId: string) {
  return `/project/${projectId}?card=${cardId}`;
}

function Panel({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  return (
    <section className="min-w-0 rounded-xl border border-line bg-surface-1">
      <h2 className="flex items-center gap-2 border-b border-line px-4 py-2.5 text-[13px] font-semibold text-ink-1">
        {title}
        {count > 0 && <span className="font-mono text-[12px] font-medium text-ink-3">{count}</span>}
      </h2>
      {children}
    </section>
  );
}

function Row({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <li>
      <Link href={href} className="flex min-h-11 items-center gap-3 px-4 py-2 transition-colors hover:bg-surface-2 focus-visible:bg-surface-2 focus-visible:outline-none">
        {children}
      </Link>
    </li>
  );
}

function CardLabel({ projectName, number, title }: { projectName: string; number?: number; title: string }) {
  return (
    <span className="min-w-0 flex-1">
      <span className="block truncate text-[13px] leading-5 text-ink-1">{title}</span>
      <span className="block truncate text-[12px] leading-4 text-ink-3">
        {number !== undefined && <span className="font-mono">{formatCardNumber(number)}</span>}
        {number !== undefined && ' · '}
        {projectName}
      </span>
    </span>
  );
}

function More({ n }: { n: number }) {
  if (n <= 0) return null;
  return <p className="border-t border-line px-4 py-2 text-[12px] text-ink-3">and {n} more</p>;
}

export function DashboardAttention({ needsYou, upcoming, heldRunsNext24h = 0 }: { needsYou: AttentionItem[]; upcoming: UpcomingRun[]; heldRunsNext24h?: number }) {
  const now = useNow();

  return (
    <div className="mb-10 grid gap-4 lg:grid-cols-2">
      <Panel title="Needs you" count={needsYou.length}>
        {needsYou.length === 0 ? (
          <p className="px-4 py-4 text-[13px] text-ink-3">Nothing waiting on you.</p>
        ) : (
          <>
            <ul className="divide-y divide-line">
              {needsYou.slice(0, MAX_ROWS).map((item) => (
                <Row key={`${item.reason}-${item.cardId}`} href={cardHref(item.projectId, item.cardId)}>
                  {item.reason === 'failed-run' ? (
                    <AlertTriangle aria-hidden className="h-4 w-4 shrink-0 text-danger-text" strokeWidth={1.75} />
                  ) : item.reason === 'skipped-run' ? (
                    <PauseCircle aria-hidden className="h-4 w-4 shrink-0 text-warn-text" strokeWidth={1.75} />
                  ) : (
                    <FlaskConical aria-hidden className="h-4 w-4 shrink-0 text-st-test" strokeWidth={1.75} />
                  )}
                  <CardLabel projectName={item.projectName} number={item.number} title={item.title} />
                  <span className="shrink-0 text-right text-[12px] leading-4">
                    <span className={`block ${item.reason === 'failed-run' ? 'text-danger-text' : item.reason === 'skipped-run' ? 'text-warn-text' : 'text-ink-2'}`}>
                      {item.reason === 'failed-run' ? 'Run failed' : item.reason === 'skipped-run' ? 'Skipped while paused' : 'Ready to test'}
                    </span>
                    {now !== null && item.at && <span className="block text-ink-3">{ago(item.at, now)}</span>}
                  </span>
                </Row>
              ))}
            </ul>
            <More n={needsYou.length - MAX_ROWS} />
          </>
        )}
      </Panel>

      <Panel title="Next 24 hours" count={upcoming.length}>
        {upcoming.length === 0 ? (
          <p className="px-4 py-4 text-[13px] text-ink-3">No automations due in the next 24 hours.</p>
        ) : (
          <>
            <ul className="divide-y divide-line">
              {upcoming.slice(0, MAX_ROWS).map((run) => (
                <Row key={run.cardId} href={cardHref(run.projectId, run.cardId)}>
                  <CalendarClock aria-hidden className="h-4 w-4 shrink-0 text-agent-text" strokeWidth={1.75} />
                  <CardLabel projectName={run.projectName} number={run.number} title={run.title} />
                  <span className="shrink-0 text-right text-[12px] leading-4">
                    <span className="block font-mono text-agent-text">{now !== null ? formatTime(run.nextRun) : ' '}</span>
                    {now !== null && <span className="block text-ink-3">{until(run.nextRun, now)}</span>}
                  </span>
                </Row>
              ))}
            </ul>
            <More n={upcoming.length - MAX_ROWS} />
          </>
        )}
        {heldRunsNext24h > 0 && (
          <p className="border-t border-line px-4 py-2 text-[12px] text-ink-3">
            {heldRunsNext24h >= 99 ? '99+' : heldRunsNext24h} run{heldRunsNext24h !== 1 ? 's' : ''} held in paused projects.
          </p>
        )}
      </Panel>
    </div>
  );
}
