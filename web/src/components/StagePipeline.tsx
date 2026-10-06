'use client';

import { useEffect, useRef, useState } from 'react';
import type { KanbanStage } from '@/lib/types';
import Tooltip from './Tooltip';

/** How long a stage chip must be held before the card moves. */
export const STAGE_HOLD_MS = 1000;
const COMMIT_PULSE_MS = 320;

type Phase = 'idle' | 'holding' | 'committed';

/**
 * One chevron in the card modal's stage strip. Moving is press-and-hold: the
 * chip fills in its stage colour over STAGE_HOLD_MS and the move fires only
 * when the fill completes; releasing early cancels. A plain click does
 * nothing — one stray click once sent a card to Backlog unnoticed.
 * Mouse, touch and keyboard (hold Enter or Space) all work.
 */
function StageHoldStep({ id, label, current, onCommit }: {
  id: KanbanStage;
  label: string;
  current: boolean;
  onCommit: () => void;
}) {
  const [phase, setPhase] = useState<Phase>('idle');
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pulseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearHold = () => {
    if (holdTimer.current) { clearTimeout(holdTimer.current); holdTimer.current = null; }
  };

  useEffect(() => () => {
    clearHold();
    if (pulseTimer.current) clearTimeout(pulseTimer.current);
  }, []);

  const start = () => {
    if (current || holdTimer.current) return;
    setPhase('holding');
    holdTimer.current = setTimeout(() => {
      holdTimer.current = null;
      setPhase('committed');
      onCommit();
      pulseTimer.current = setTimeout(() => setPhase('idle'), COMMIT_PULSE_MS);
    }, STAGE_HOLD_MS);
  };

  const cancel = () => {
    if (!holdTimer.current) return;
    clearHold();
    setPhase('idle');
  };

  const hint = current ? `In ${label}` : `Hold to move to ${label}`;

  return (
    <Tooltip content={hint} placement="bottom">
      <button
        type="button"
        aria-current={current ? 'step' : undefined}
        aria-label={hint}
        aria-disabled={current || undefined}
        onPointerDown={(e) => { if (e.button === 0) start(); }}
        onPointerUp={cancel}
        onPointerLeave={cancel}
        onPointerCancel={cancel}
        onContextMenu={(e) => e.preventDefault()}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            if (!e.repeat) start();
          }
        }}
        onKeyUp={(e) => { if (e.key === 'Enter' || e.key === ' ') cancel(); }}
        onBlur={cancel}
        style={{ '--hold-ms': `${STAGE_HOLD_MS}ms` } as React.CSSProperties}
        className={`sp-step sp-${id}${current ? ' is-current' : ''}${phase === 'holding' ? ' is-holding' : ''}${phase === 'committed' ? ' is-committed' : ''}`}
      >
        <span className="sp-fill" aria-hidden />
        <span className="sp-label">{label}</span>
      </button>
    </Tooltip>
  );
}

export function StagePipeline({ stages, stage, onMove }: {
  stages: { id: KanbanStage; label: string }[];
  stage: KanbanStage;
  onMove: (stage: KanbanStage) => void;
}) {
  return (
    <nav className="stage-pipe ml-auto mr-4 hidden sm:flex" aria-label="Move card to stage (press and hold)">
      {stages.map((s) => (
        <StageHoldStep
          key={s.id}
          id={s.id}
          label={s.label}
          current={s.id === stage}
          onCommit={() => onMove(s.id)}
        />
      ))}
    </nav>
  );
}
