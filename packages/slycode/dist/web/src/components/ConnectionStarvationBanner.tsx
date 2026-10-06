'use client';

/**
 * Plain-HTTP connection starvation banner (card #0356, option E).
 *
 * Browsers allow 6 live HTTP/1.1 connections per host. Every SlyCode window
 * holds a few long-lived streams to the same host, so three or four windows
 * silently starve the input path: output keeps flowing, nothing typed lands.
 * This strip refuses to let that be silent. It appears when this browser's
 * windows hold the whole budget — or when one of this window's streams has
 * waited seconds for a slot that never frees — and clears when the count
 * drops. It never renders on HTTPS (HTTP/2 multiplexes; no cap).
 *
 * Signature: a six-cell slot gauge. One cell per connection the browser
 * allows; this window's cells lit bright, other windows' dim, and anything
 * past the sixth spills over the limit rule in orange. The number IS the
 * content, so the gauge is structure, not decoration. No dismiss control by
 * design — the state it describes is broken, and the fix is one click away.
 */

import { useConnectionBudget } from '@/hooks/useConnectionBudget';
import { BROWSER_H1_CONNECTION_LIMIT } from '@/lib/connection-budget';

export default function ConnectionStarvationBanner() {
  const { capped, verdict, httpsUrl } = useConnectionBudget();
  if (!capped || !verdict || !verdict.starved) return null;

  const limit = verdict.limit || BROWSER_H1_CONNECTION_LIMIT;
  const total = verdict.total;
  const own = Math.min(verdict.own, total);
  const others = Math.max(0, total - own);
  // Gauge shows the budget plus any overflow, capped so a runaway count can't stretch the strip.
  const cells = Math.min(Math.max(limit, total), limit + 6);

  return (
    <div
      role="alert"
      aria-live="assertive"
      className="conn-budget sticky top-0 z-[110] w-full border-b border-line border-t-2 border-t-warn bg-surface-1 text-ink-1 shadow-(--shadow-overlay)"
    >
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-6 gap-y-3 px-4 py-3 sm:px-6">
        {/* Slot gauge */}
        <div className="flex shrink-0 items-center gap-3" aria-hidden="true">
          <div className="flex items-end gap-[3px]">
            {Array.from({ length: cells }, (_, i) => {
              const overflow = i >= limit;
              const held = i < total;
              const mine = i < own;
              const cls = !held
                ? 'bg-void-700/70'
                : overflow
                  ? 'conn-budget-breathe bg-neon-orange-400'
                  : mine
                    ? 'bg-accent'
                    : 'bg-accent';
              return (
                <span key={i} className="flex items-end gap-[3px]">
                  {i === limit && <span className="mx-[3px] h-6 w-px bg-neon-orange-400" />}
                  <span className={`block h-4 w-[7px] rounded-[1px] ${cls}`} />
                </span>
              );
            })}
          </div>
          <span className="font-mono text-[11px] leading-none text-void-300" style={{ fontFamily: 'var(--font-jetbrains-mono), ui-monospace, monospace' }}>
            <span className={total >= limit ? 'text-neon-orange-300' : 'text-accent'}>{total}</span>
            <span className="text-ink-3">/{limit}</span>
            <span className="ml-2 text-ink-3">{own} here{others > 0 ? `, ${others} elsewhere` : ''}</span>
          </span>
        </div>

        {/* Copy */}
        <p className="min-w-0 flex-1 text-sm leading-snug">
          <span className="font-semibold text-white">You&rsquo;re on plain HTTP, which allows {limit} live connections;</span>{' '}
          your SlyCode windows are using {total}.
          {verdict.reason === 'stalled-connecting' && total < limit && (
            <span className="text-void-300"> One of this window&rsquo;s connections has been waiting for a free slot for several seconds.</span>
          )}{' '}
          <span className="text-void-200">
            Close another window, or open SlyCode at{' '}
            {httpsUrl ? (
              <a
                href={httpsUrl}
                className="rounded-sm font-mono text-accent underline decoration-accent underline-offset-2 hover:text-accent focus-visible:outline-2 focus-visible:outline-accent"
                style={{ fontFamily: 'var(--font-jetbrains-mono), ui-monospace, monospace' }}
              >
                {httpsUrl.replace(/^https:\/\//, '')}
              </a>
            ) : (
              <span>its HTTPS address</span>
            )}
            .
          </span>
        </p>
      </div>
    </div>
  );
}
