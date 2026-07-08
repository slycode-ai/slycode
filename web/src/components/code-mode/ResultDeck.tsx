'use client';

/**
 * Result deck — AI-presented clickable location cards (feature 076, Phase 3).
 * Rendered when the Atlas agent runs `sly-atlas deck`. Fully client-side after
 * delivery: clicking navigates, dismissing clears — the agent is never in the
 * interaction loop.
 */

import type { NavEvent } from './types';

interface ResultDeckProps {
  event: NavEvent; // type === 'deck'
  onOpen: (file: string, line?: number) => void;
  onDismiss: () => void;
}

export function ResultDeck({ event, onOpen, onDismiss }: ResultDeckProps) {
  const deck = event.deck!;
  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-(--cm-panel)">
      <div className="flex items-center gap-2 border-b border-(--cm-line) bg-(--cm-atlas-dim) px-3 py-2">
        <span className="font-mono text-[9.5px] uppercase tracking-[0.18em] text-(--cm-atlas)">✦ Atlas deck</span>
        <span className="min-w-0 flex-1 truncate text-[12px] font-semibold text-(--cm-text)" title={deck.title}>{deck.title}</span>
        <button onClick={onDismiss} className="font-mono text-[12px] text-(--cm-faint) hover:text-(--cm-text)" title="Dismiss">✕</button>
      </div>
      {event.note && <p className="border-b border-(--cm-line) px-3 py-1.5 text-[11.5px] text-(--cm-muted)">{event.note}</p>}
      <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
        {deck.items.map((item, i) => (
          <button
            key={`${item.file}:${item.line}:${i}`}
            onClick={() => onOpen(item.file, item.line)}
            className="mb-1 w-full rounded-md border border-(--cm-line) bg-(--cm-panel2) px-2.5 py-1.5 text-left transition-colors hover:border-(--cm-atlas)"
          >
            <span className="block truncate font-mono text-[11px] text-(--cm-text)">
              {item.file}
              {item.line ? <span className="text-(--cm-atlas)">:{item.line}</span> : null}
            </span>
            {item.note && <span className="mt-0.5 block text-[10.5px] leading-snug text-(--cm-muted)">{item.note}</span>}
          </button>
        ))}
      </div>
      <p className="border-t border-(--cm-line) px-3 py-1 font-mono text-[9px] text-(--cm-faint)">
        {deck.items.length} locations · click to jump · breadcrumb ← returns
      </p>
    </div>
  );
}
