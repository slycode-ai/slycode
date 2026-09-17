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
      className="conn-budget sticky top-0 z-[110] w-full border-t-2 border-neon-orange-400 bg-void-900 text-void-100 shadow-(--shadow-overlay)"
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
                  ? 'conn-budget-breathe bg-neon-orange-400 shadow-[0_0_10px_rgba(255,140,0,0.7)]'
                  : mine
                    ? 'bg-neon-blue-400 shadow-[0_0_8px_rgba(0,191,255,0.55)]'
                    : 'bg-neon-blue-800';
              return (
                <span key={i} className="flex items-end gap-[3px]">
                  {i === limit && <span className="mx-[3px] h-6 w-px bg-neon-orange-400" />}
                  <span className={`block h-4 w-[7px] rounded-[1px] ${cls}`} />
                </span>
              );
            })}
          </div>
          <span className="font-mono text-[11px] leading-none text-void-300" style={{ fontFamily: 'var(--font-jetbrains-mono), ui-monospace, monospace' }}>
            <span className={total >= limit ? 'text-neon-orange-300' : 'text-neon-blue-300'}>{total}</span>
            <span className="text-void-500">/{limit}</span>
            <span className="ml-2 text-void-400">{own} here{others > 0 ? `, ${others} elsewhere` : ''}</span>
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
                className="rounded-sm font-mono text-neon-blue-300 underline decoration-neon-blue-700 underline-offset-2 hover:text-neon-blue-200 focus-visible:outline-2 focus-visible:outline-neon-blue-400"
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
