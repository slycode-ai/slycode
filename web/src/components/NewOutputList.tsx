'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { formatCardNumber } from '@/lib/kanban-numbering';
import { placePopover, POPOVER_MARGIN } from '@/lib/popover-placement';

export interface NewOutputItem {
  projectId: string;
  projectName: string;
  cardId: string;
  number?: number;
  title: string;
}

const WIDTH = 360;

/**
 * Small anchored list of cards with output nobody has looked at yet
 * (feature 082 roll-up). Opened from the dashboard's "N new output" chip, or a
 * project tile's "N new" chip (filtered to that project). Each row opens its
 * card, which also marks it seen.
 */
export function NewOutputList({
  anchor,
  items,
  heading,
  showProject,
  onClose,
}: {
  anchor: HTMLElement;
  items: NewOutputItem[];
  heading: string;
  showProject: boolean;
  onClose: () => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top?: number; bottom?: number; left: number; maxHeight: number } | null>(null);

  useLayoutEffect(() => {
    const place = () => {
      const r = anchor.getBoundingClientRect();
      const vw = window.innerWidth;
      const width = Math.min(WIDTH, vw - POPOVER_MARGIN * 2);
      const p = placePopover(r, { width: vw, height: window.innerHeight });
      const left = Math.min(Math.max(POPOVER_MARGIN, r.left), vw - width - POPOVER_MARGIN);
      setPos(p.side === 'below'
        ? { top: p.top, left, maxHeight: Math.min(p.maxHeight, 420) }
        : { bottom: p.bottom, left, maxHeight: Math.min(p.maxHeight, 420) });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [anchor]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (panelRef.current?.contains(t) || anchor.contains(t)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onClose(); anchor.focus(); }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [anchor, onClose]);

  useEffect(() => {
    if (pos) panelRef.current?.querySelector<HTMLElement>('a')?.focus();
  }, [pos]);

  if (!pos) return null;

  return createPortal(
    <div
      ref={panelRef}
      role="dialog"
      aria-label={heading}
      className="fixed z-50 flex flex-col overflow-hidden rounded-lg border border-line bg-surface-1 shadow-(--shadow-overlay)"
      style={{ top: pos.top, bottom: pos.bottom, left: pos.left, width: `min(${WIDTH}px, calc(100vw - ${POPOVER_MARGIN * 2}px))`, maxHeight: pos.maxHeight }}
    >
      <div className="flex items-center gap-2 border-b border-line px-3 py-2 text-[13px] font-semibold text-ink-1">
        {heading}
        <span className="font-mono text-[12px] font-medium tabular-nums text-ink-3">{items.length}</span>
      </div>
      {items.length === 0 ? (
        <p className="px-3 py-3 text-[13px] text-ink-3">Nothing new right now.</p>
      ) : (
        <ul className="min-h-0 overflow-y-auto py-1">
          {items.map((item) => (
            <li key={`${item.projectId}:${item.cardId}`}>
              <Link
                href={`/project/${item.projectId}?card=${item.cardId}`}
                onClick={onClose}
                className="flex min-h-10 items-center gap-2.5 px-3 py-1.5 outline-none transition-colors hover:bg-surface-3 focus-visible:bg-surface-3"
              >
                <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent" aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] leading-5 text-ink-1">{item.title}</span>
                  <span className="block truncate text-[12px] leading-4 text-ink-3">
                    {item.number !== undefined && <span className="font-mono">{formatCardNumber(item.number)}</span>}
                    {showProject && <>{item.number !== undefined && ' · '}{item.projectName}</>}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>,
    document.body,
  );
}
