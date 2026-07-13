'use client';

/**
 * Guided tour player (feature 079) — fully client-side playback of a tour
 * artifact. Each step jumps the editor to its file/line anchor with the MVP's
 * highlight machinery; Prev/Next (and ←/→) drive playback locally. Mid-tour
 * questions escalate to the Atlas terminal via the onAsk callback — the agent
 * is never in the playback loop (no-puppeteering rule).
 */

import { useCallback, useEffect } from 'react';
import type { AtlasTour, TourStep } from './types';

interface TourPlayerProps {
  tour: AtlasTour;
  stale: boolean;
  stepIndex: number;
  onStep: (index: number) => void;   // parent owns the index; steps re-anchor the editor
  onAsk: (step: TourStep, index: number) => void;
  onRefresh?: (tourId: string) => void;
  onExit: () => void;
}

export function TourPlayer({ tour, stale, stepIndex, onStep, onAsk, onRefresh, onExit }: TourPlayerProps) {
  const step = tour.steps[stepIndex];
  const canPrev = stepIndex > 0;
  const canNext = stepIndex < tour.steps.length - 1;

  const go = useCallback((delta: number) => {
    const next = stepIndex + delta;
    if (next >= 0 && next < tour.steps.length) onStep(next);
  }, [stepIndex, tour.steps.length, onStep]);

  // ←/→ page through; Escape exits. Skipped while typing in inputs/editor.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
      if (target && target.closest('.monaco-editor')) return;
      if (e.key === 'ArrowRight') { e.preventDefault(); go(1); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); go(-1); }
      else if (e.key === 'Escape') { e.preventDefault(); onExit(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [go, onExit]);

  if (!step) return null;

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-4 z-30 flex justify-center px-4">
      <div className="pointer-events-auto w-full max-w-[640px] overflow-hidden rounded-[10px] border border-(--cm-atlas)/60 bg-(--cm-panel2) shadow-[0_12px_40px_rgba(0,0,0,0.45),0_0_24px_-8px_var(--cm-atlas)]">
        {/* Segmented progress — one cell per step */}
        <div className="flex gap-px bg-(--cm-panel3)" aria-hidden>
          {tour.steps.map((_, i) => (
            <button
              key={i}
              onClick={() => onStep(i)}
              title={`Step ${i + 1}: ${tour.steps[i].title}`}
              className="h-[3px] flex-1 transition-colors"
              style={{ background: i <= stepIndex ? 'var(--cm-atlas)' : 'transparent' }}
            />
          ))}
        </div>

        {stale && (
          <p className="flex items-center gap-2 border-b border-amber-500/25 bg-amber-500/10 px-3.5 py-1 font-mono text-[9.5px] uppercase tracking-[0.1em] text-amber-600 dark:text-amber-400">
            <span className="min-w-0 flex-1">source files changed since this tour was written — anchors may have drifted</span>
            {onRefresh && (
              <button
                onClick={() => onRefresh(tour.id)}
                title="Ask the Atlas to re-answer this tour against the current code"
                className="shrink-0 rounded border border-amber-500/50 px-1.5 py-px transition-all hover:brightness-110"
              >
                ⟳ refresh
              </button>
            )}
          </p>
        )}

        <div className="px-3.5 py-2.5">
          <div className="flex items-baseline gap-2">
            <p className="font-mono text-[9px] uppercase tracking-[0.2em] text-(--cm-atlas)">
              Tour · {tour.title}
            </p>
            <span className="ml-auto font-mono text-[10px] text-(--cm-faint)">
              {stepIndex + 1}/{tour.steps.length}
            </span>
          </div>
          <h3 className="mt-1 text-[13.5px] font-semibold text-(--cm-text)">{step.title}</h3>
          <p className="mt-0.5 font-mono text-[10px] text-(--cm-faint)">
            {step.file}{step.line ? `:${step.line}${step.endLine ? `-${step.endLine}` : ''}` : ''}
          </p>
          <div className="mt-1.5 max-h-[130px] overflow-y-auto pr-1 text-[12.5px] leading-relaxed text-(--cm-muted)">
            {step.body.split(/\n{2,}/).map((para, i) => (
              <p key={i} className="mb-2 last:mb-0">{para}</p>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-1.5 border-t border-(--cm-line) px-3.5 py-2">
          <button
            onClick={() => go(-1)}
            disabled={!canPrev}
            className="rounded-md border border-(--cm-line2) px-2.5 py-1 font-mono text-[10.5px] uppercase tracking-[0.08em] text-(--cm-muted) transition-all hover:border-(--cm-atlas) hover:text-(--cm-atlas) disabled:opacity-40"
          >
            ← Prev
          </button>
          <button
            onClick={() => go(1)}
            disabled={!canNext}
            className="rounded-md border border-(--cm-atlas) bg-(--cm-atlas-dim) px-2.5 py-1 font-mono text-[10.5px] uppercase tracking-[0.08em] text-(--cm-atlas) transition-all hover:brightness-110 disabled:opacity-40"
          >
            Next →
          </button>
          <button
            onClick={() => onAsk(step, stepIndex)}
            title="Ask the Atlas terminal about this step"
            className="ml-2 rounded-md border border-(--cm-line2) px-2.5 py-1 font-mono text-[10.5px] tracking-[0.03em] text-(--cm-muted) transition-all hover:border-(--cm-atlas) hover:text-(--cm-atlas)"
          >
            ✦ Ask about this step
          </button>
          <button
            onClick={onExit}
            className="ml-auto rounded-md px-2 py-1 font-mono text-[10.5px] uppercase tracking-[0.08em] text-(--cm-faint) hover:text-(--cm-text)"
          >
            End tour
          </button>
        </div>
      </div>
    </div>
  );
}
