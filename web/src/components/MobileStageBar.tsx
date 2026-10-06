'use client';

import { useEffect, useState, type RefObject } from 'react';
import type { KanbanStage } from '@/lib/types';

const SHORT: Record<KanbanStage, string> = {
  backlog: 'Backlog',
  design: 'Design',
  implementation: 'Build',
  testing: 'Testing',
  done: 'Done',
};

const BAR: Record<KanbanStage, string> = {
  backlog: 'bg-st-backlog',
  design: 'bg-st-design',
  implementation: 'bg-st-impl',
  testing: 'bg-st-test',
  done: 'bg-st-done',
};

/** The board's lane elements: children of the scroller's inner flex row. */
function lanesOf(scroller: HTMLElement | null): HTMLElement[] {
  const row = scroller?.firstElementChild;
  return row ? (Array.from(row.children) as HTMLElement[]) : [];
}

/**
 * Phone-width lane switcher. The board shows one lane at a time on a phone;
 * this bar says which one, how many cards each holds, and jumps on tap.
 */
export function MobileStageBar({
  stages,
  counts,
  scrollRef,
}: {
  stages: { id: KanbanStage; label: string }[];
  counts: Record<KanbanStage, number>;
  scrollRef: RefObject<HTMLDivElement | null>;
}) {
  const [active, setActive] = useState(0);

  useEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    let frame = 0;
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const lanes = lanesOf(scroller);
        if (!lanes.length) return;
        const origin = scroller.getBoundingClientRect().left;
        let best = 0;
        let bestDist = Infinity;
        lanes.forEach((lane, i) => {
          const d = Math.abs(lane.getBoundingClientRect().left - origin);
          if (d < bestDist) { bestDist = d; best = i; }
        });
        setActive(best);
      });
    };
    scroller.addEventListener('scroll', onScroll, { passive: true });
    return () => { scroller.removeEventListener('scroll', onScroll); cancelAnimationFrame(frame); };
  }, [scrollRef]);

  const jump = (i: number) => {
    const scroller = scrollRef.current;
    const lane = lanesOf(scroller)[i];
    if (!scroller || !lane) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    scroller.scrollTo({
      left: scroller.scrollLeft + lane.getBoundingClientRect().left - scroller.getBoundingClientRect().left - 16,
      behavior: reduce ? 'auto' : 'smooth',
    });
    setActive(i);
  };

  return (
    <nav aria-label="Lanes" className="flex shrink-0 border-b border-line bg-surface-1 sm:hidden">
      {stages.map((s, i) => {
        const on = i === active;
        return (
          <button
            key={s.id}
            type="button"
            onClick={() => jump(i)}
            aria-current={on ? 'true' : undefined}
            className={`relative flex min-h-12 flex-1 flex-col items-center justify-center gap-0.5 transition-colors ${on ? 'text-ink-1' : 'text-ink-3'}`}
          >
            <span className="font-mono text-[15px] font-semibold leading-none">{counts[s.id]}</span>
            <span className="text-[11px] leading-none">{SHORT[s.id]}</span>
            <span aria-hidden className={`absolute inset-x-2 bottom-0 h-0.5 rounded-full transition-opacity ${BAR[s.id]} ${on ? 'opacity-100' : 'opacity-0'}`} />
          </button>
        );
      })}
    </nav>
  );
}
