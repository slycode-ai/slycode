'use client';

import { useState, useRef, useEffect, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import type { KanbanCard, KanbanStage } from '@/lib/types';
import { readStatus, type CardStatus } from '@/lib/status';

// Status panel: single static text with ellipsis at rest.
// On hover, IF the text overflows the container, fade in a marquee overlay
// that scrolls. If text fits, no marquee, no ellipsis — just the text.
function CardStatusPanel({ status, stage }: { status: CardStatus; stage: KanbanStage }) {
  const restRef = useRef<HTMLDivElement>(null);
  const [overflows, setOverflows] = useState(false);

  // The "rest" layer is a `display:block; overflow:hidden; text-overflow:ellipsis`
  // wrapper. If the text inside is wider than the wrapper, scrollWidth > clientWidth
  // and we know overflow exists.
  useLayoutEffect(() => {
    const el = restRef.current;
    if (!el) return;
    const measure = () => setOverflows(el.scrollWidth > el.clientWidth + 0.5);
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [status.text]);

  const gap = '\u00A0'.repeat(6);
  return (
    <div className={`card-status stage-${stage}`} data-overflows={overflows ? 'true' : 'false'}>
      {/* Rest layer: always present. Block-level with ellipsis when text overflows. */}
      <div ref={restRef} className="card-status-rest">
        <span className="card-status-text">{status.text}</span>
      </div>
      {/* Marquee layer: only rendered when text overflows. Absolute overlay; fades
          in on group hover, animates the track for a seamless scroll. */}
      {overflows && (
        <div className="card-status-marquee" aria-hidden="true">
          <div className="card-status-track">
            <span className="card-status-text">{status.text}{gap}</span>
            <span className="card-status-text">{status.text}{gap}</span>
          </div>
        </div>
      )}
    </div>
  );
}

type CardSessionStatus = 'running' | 'detached' | 'resumable' | 'none';

interface KanbanCardItemProps {
  card: KanbanCard;
  sessionStatus: CardSessionStatus;
  isActivelyWorking?: boolean;
  stage?: KanbanStage;
  onClick: () => void;
  onContextMenu?: (e: React.MouseEvent) => void;
  onDragStart?: () => void;
  onDragEnd?: () => void;
}

const priorityIndicators: Record<string, { border: string; hoverGlow: string; glowRgb: string }> = {
  critical: {
    border: 'border-l-[#ff1744]',
    glowRgb: '255, 23, 68',
    hoverGlow: 'hover:shadow-[var(--shadow-card),inset_5px_0_8px_-6px_rgba(255,23,68,0.5)] dark:hover:shadow-[var(--shadow-card),inset_6px_0_14px_-6px_rgba(255,23,68,0.5),_-4px_0_16px_-3px_rgba(255,23,68,0.55)] hover:before:bg-white/40 dark:hover:before:bg-white/60',
  },
  high: {
    border: 'border-l-[#ff9100]',
    glowRgb: '255, 145, 0',
    hoverGlow: 'hover:shadow-[var(--shadow-card),inset_4px_0_7px_-5px_rgba(255,145,0,0.45)] dark:hover:shadow-[var(--shadow-card),inset_5px_0_12px_-5px_rgba(255,145,0,0.45),_-3px_0_14px_-3px_rgba(255,145,0,0.45)] hover:before:bg-white/35 dark:hover:before:bg-white/50',
  },
  medium: {
    border: 'border-l-[#00bfff]',
    glowRgb: '0, 191, 255',
    hoverGlow: 'hover:shadow-[var(--shadow-card),inset_4px_0_6px_-5px_rgba(0,191,255,0.4)] dark:hover:shadow-[var(--shadow-card),inset_4px_0_10px_-4px_rgba(0,191,255,0.4),_-3px_0_12px_-3px_rgba(0,191,255,0.35)] hover:before:bg-white/30 dark:hover:before:bg-white/45',
  },
  low: {
    border: 'border-l-[#00c853]',
    glowRgb: '0, 200, 83',
    hoverGlow: 'hover:shadow-[var(--shadow-card),inset_4px_0_6px_-5px_rgba(0,200,83,0.35)] dark:hover:shadow-[var(--shadow-card),inset_4px_0_10px_-4px_rgba(0,200,83,0.35),_-3px_0_12px_-3px_rgba(0,200,83,0.3)] hover:before:bg-white/25 dark:hover:before:bg-white/40',
  },
};

const typeEmojis: Record<string, string> = {
  bug: '\u{1FAB3}',
  feature: '\u{2728}',
  chore: '\u{1F527}',
};

interface TooltipPosition {
  top: number;
  left: number;
}

// Progress ring component for checklist status
function ChecklistProgress({ completed, total }: { completed: number; total: number }) {
  const isComplete = completed === total;
  const progress = total > 0 ? completed / total : 0;
  const size = 13;
  const strokeWidth = 1.5;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference * (1 - progress);

  if (isComplete) {
    // Green circle with checkmark when complete
    return (
      <div className="flex items-center" title="Checklist complete">
        <svg width={size} height={size} viewBox="0 0 16 16" className="text-void-400 dark:text-void-500">
          <circle cx="8" cy="8" r="7" fill="currentColor" />
          <path
            d="M5 8l2 2 4-4"
            stroke="white"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
          />
        </svg>
      </div>
    );
  }

  // Red at 0%, orange when in progress
  const isZero = completed === 0;
  const progressColor = 'text-orange-500 dark:text-orange-400';
  const bgColor = isZero
    ? 'text-red-500'
    : 'text-void-200 dark:text-void-600';

  return (
    <div className="flex items-center gap-1" title={`${completed}/${total} items complete`}>
      <svg width={size} height={size} className="-rotate-90">
        {/* Background circle - bright red when 0%, gray otherwise */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth={strokeWidth}
          className={bgColor}
        />
        {/* Progress circle */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={strokeDashoffset}
          className={progressColor}
        />
      </svg>
      <span className="font-[family-name:var(--font-jetbrains-mono)] text-[10px] text-void-500 dark:text-void-400">{completed}/{total}</span>
    </div>
  );
}

function formatCardNumber(num: number): string {
  return `#${String(num).padStart(num > 9999 ? 0 : 4, '0')}`;
}

export function KanbanCardItem({ card, sessionStatus, isActivelyWorking = false, stage, onClick, onContextMenu, onDragStart, onDragEnd }: KanbanCardItemProps) {
  const unresolvedProblems = card.problems.filter((p) => !p.resolved_at).length;
  const checklistTotal = card.checklist?.length || 0;
  const checklistCompleted = card.checklist?.filter((item) => item.done).length || 0;
  const isCompact = stage === 'done';
  const [showTooltip, setShowTooltip] = useState(false);
  const [tooltipPos, setTooltipPos] = useState<TooltipPosition>({ top: 0, left: 0 });
  const [tooltipFlipped, setTooltipFlipped] = useState(false);
  const hoverTimeout = useRef<NodeJS.Timeout | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);

  const priority = priorityIndicators[card.priority] || priorityIndicators.medium;

  const handleMouseEnter = () => {
    if (card.description) {
      hoverTimeout.current = setTimeout(() => {
        if (cardRef.current) {
          const rect = cardRef.current.getBoundingClientRect();
          const tooltipWidth = 256;
          const tooltipHeight = 100;
          const gap = 8;
          const fitsRight = rect.right + gap + tooltipWidth <= window.innerWidth;
          const left = fitsRight
            ? rect.right + gap
            : rect.left - gap - tooltipWidth;
          const top = Math.min(rect.top, window.innerHeight - tooltipHeight - gap);
          setTooltipPos({ top, left });
          setTooltipFlipped(!fitsRight);
        }
        setShowTooltip(true);
      }, 500);
    }
  };

  const handleMouseLeave = () => {
    if (hoverTimeout.current) {
      clearTimeout(hoverTimeout.current);
      hoverTimeout.current = null;
    }
    setShowTooltip(false);
  };

  useEffect(() => {
    const dismiss = () => {
      if (hoverTimeout.current) {
        clearTimeout(hoverTimeout.current);
        hoverTimeout.current = null;
      }
      setShowTooltip(false);
    };
    window.addEventListener('kanban-card-drag', dismiss);
    return () => {
      window.removeEventListener('kanban-card-drag', dismiss);
      if (hoverTimeout.current) {
        clearTimeout(hoverTimeout.current);
      }
    };
  }, []);

  const handleDragStart = (e: React.DragEvent) => {
    e.dataTransfer.setData('text/plain', card.id);
    e.dataTransfer.effectAllowed = 'move';
    onDragStart?.();
    window.dispatchEvent(new CustomEvent('kanban-card-drag'));
  };

  const handleDragEnd = () => {
    onDragEnd?.();
    window.dispatchEvent(new CustomEvent('kanban-card-drag'));
  };

  const status = !isCompact ? readStatus(card.status) : null;
  const hasTags = !isCompact && !status && (card.areas.length > 0 || card.tags.length > 0);
  const hasFooterContent = hasTags || !!status;

  return (
    <>
      <div
        ref={cardRef}
        draggable
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onClick={onClick}
        style={{ '--glow-color': priority.glowRgb } as React.CSSProperties}
        onContextMenu={(e) => {
          if (onContextMenu) {
            setShowTooltip(false);
            if (hoverTimeout.current) clearTimeout(hoverTimeout.current);
            onContextMenu(e);
          }
        }}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        className={`group relative cursor-pointer rounded-lg border-l-4 border-t border-t-white/50 backdrop-blur-lg bg-white/55 px-3 pt-3 pb-2 shadow-(--shadow-card) ring-1 ring-transparent transition-[transform,ring-color,box-shadow] duration-200 hover:translate-y-0.5 hover:ring-[rgba(var(--glow-color),0.4)] before:pointer-events-none before:absolute before:inset-y-1 before:-left-[3px] before:w-px before:rounded-full before:bg-white/0 before:transition-colors before:duration-200 dark:border-t-white/10 dark:backdrop-blur-xl dark:bg-[#20232a]/55 dark:hover:ring-[rgba(var(--glow-color),0.25)] ${priority.border} ${priority.hoverGlow} ${isActivelyWorking ? 'active-glow-card' : ''}`}
      >
        {/* Header: title on left, number + dot on right */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1">
            <h4 className="text-sm font-medium text-void-900 dark:text-void-100">
              {card.title}
            </h4>
          </div>
          <div className="flex items-center gap-1.5">
            {/* Card number */}
            {card.number != null && (
              <span className="font-[family-name:var(--font-jetbrains-mono)] text-[10px] leading-none text-void-400 dark:text-void-500">
                {formatCardNumber(card.number)}
              </span>
            )}
            {/* Session status dot */}
            {(isActivelyWorking || sessionStatus === 'running') && (
              <span className="relative flex h-2.5 w-2.5 -translate-y-px" title="Session running">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#00e676] opacity-75"></span>
                <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-[#00e676] dark:drop-shadow-[0_0_4px_rgba(0,230,118,0.6)]" style={{ boxShadow: '0 0 6px rgba(0,230,118,0.6)' }}></span>
              </span>
            )}
            {!isActivelyWorking && (sessionStatus === 'detached' || sessionStatus === 'resumable') && (
              <span className="flex h-2.5 w-2.5 -translate-y-px rounded-full bg-neon-orange-400 dark:drop-shadow-[0_0_4px_rgba(255,140,0,0.5)]" title="Session paused" style={{ boxShadow: '0 0 4px rgba(255,140,0,0.4)' }} />
            )}
            {!isActivelyWorking && sessionStatus === 'none' && (
              <span className="flex h-2 w-2 -translate-y-px rounded-full bg-void-300 dark:bg-void-600" title="No session" />
            )}
          </div>
        </div>

        {/* Problems indicator */}
        {unresolvedProblems > 0 && (
          <div className="mt-2 flex items-center gap-1 rounded bg-red-50 px-2 py-1 text-xs text-red-700 dark:bg-red-900/30 dark:text-red-300">
            <svg className="h-3 w-3" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
            </svg>
            <span>{unresolvedProblems} issue{unresolvedProblems !== 1 ? 's' : ''}</span>
          </div>
        )}

        {/* Footer: status panel OR tags row on the left, checklist + emoji on right */}
        <div className={`${hasFooterContent ? 'mt-2' : 'mt-1'} flex items-center justify-end gap-2`}>
          {status && stage && <CardStatusPanel status={status} stage={stage} />}
          {hasTags && (
            <div className="flex min-w-0 flex-1 gap-1 overflow-hidden">
              {/* Areas */}
              {card.areas.slice(0, 1).map((area) => (
                <span
                  key={area}
                  className="shrink-0 rounded border border-neon-blue-400/25 bg-transparent px-1 py-px font-[family-name:var(--font-jetbrains-mono)] text-[10px] text-neon-blue-700 transition-colors group-hover:bg-neon-blue-400/8 dark:border-neon-blue-400/20 dark:text-neon-blue-400/70 dark:group-hover:bg-neon-blue-400/10"
                >
                  {area}
                </span>
              ))}
              {card.areas.length > 1 && (
                <span className="shrink-0 rounded border border-neon-blue-400/25 bg-transparent px-1 py-px font-[family-name:var(--font-jetbrains-mono)] text-[10px] text-neon-blue-600 transition-colors group-hover:bg-neon-blue-400/8 dark:border-neon-blue-400/20 dark:text-neon-blue-400/50 dark:group-hover:bg-neon-blue-400/10">
                  +{card.areas.length - 1}
                </span>
              )}
              {/* Tags */}
              {card.tags.slice(0, 1).map((tag) => (
                <span
                  key={tag}
                  className="shrink-0 rounded border border-void-300 bg-transparent px-1 py-px font-[family-name:var(--font-jetbrains-mono)] text-[10px] text-void-600 transition-colors group-hover:bg-void-100 dark:border-void-600 dark:text-void-400 dark:group-hover:bg-void-800"
                >
                  {tag}
                </span>
              ))}
              {card.tags.length > 1 && (
                <span className="shrink-0 rounded border border-void-300 bg-transparent px-1 py-px font-[family-name:var(--font-jetbrains-mono)] text-[10px] text-void-600 transition-colors group-hover:bg-void-100 dark:border-void-600 dark:text-void-500 dark:group-hover:bg-void-800">
                  +{card.tags.length - 1}
                </span>
              )}
            </div>
          )}
          <div className="flex shrink-0 items-center gap-1.5">
            {checklistTotal > 0 && (
              <ChecklistProgress completed={checklistCompleted} total={checklistTotal} />
            )}
            <span className="text-base leading-none">
              {typeEmojis[card.type] || typeEmojis.chore}
            </span>
          </div>
        </div>
      </div>

      {/* Tooltip - rendered in portal */}
      {showTooltip && card.description && typeof document !== 'undefined' && createPortal(
        <div
          className={`fixed z-[100] w-64 animate-in fade-in duration-200 ${tooltipFlipped ? 'slide-in-from-right-1' : 'slide-in-from-left-1'}`}
          style={{ top: tooltipPos.top, left: tooltipPos.left }}
        >
          <div className="rounded-lg border border-neon-blue-400/20 bg-void-50 p-3 shadow-(--shadow-overlay) dark:bg-void-850">
            <p className="whitespace-pre-wrap text-sm text-void-700 dark:text-void-300">
              {card.description.length > 200
                ? card.description.slice(0, 200) + '...'
                : card.description}
            </p>
          </div>
          {/* Arrow */}
          <div className={`absolute top-3 h-2 w-2 rotate-45 ${tooltipFlipped ? '-right-1 border-t border-r' : '-left-1 border-b border-l'} border-neon-blue-400/20 bg-void-50 dark:bg-void-850`} />
        </div>,
        document.body
      )}
    </>
  );
}
