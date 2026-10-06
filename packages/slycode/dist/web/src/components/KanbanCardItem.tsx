'use client';

import { useState, useRef, useEffect, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import type { KanbanCard, KanbanStage } from '@/lib/types';
import { readStatus, type CardStatus } from '@/lib/status';
import { formatCardNumber } from '@/lib/kanban-numbering';
import { formatFireTime, formatCountdown, nextPendingFireAt, pendingEntries } from '@/lib/scheduled-prompts';
import { StopwatchGlyph } from './StopwatchGlyph';
import Tooltip from './Tooltip';
import { Bug, Sparkles, TriangleAlert, Wrench, type LucideIcon } from 'lucide-react';

// Status panel: single static text with ellipsis at rest.
// On hover, IF the text overflows the container, fade in a marquee overlay
// that scrolls. If text fits, no marquee, no ellipsis — just the text.
function CardStatusPanel({ status, stage }: { status: CardStatus; stage: KanbanStage }) {
  const restRef = useRef<HTMLDivElement>(null);
  const [overflows, setOverflows] = useState(false);
  // Marquee animation duration in seconds. Scaled to keep pixels/sec consistent
  // across status lengths so longer text doesn't appear to scroll faster than
  // shorter text.
  const [marqueeSeconds, setMarqueeSeconds] = useState<number>(5);

  useLayoutEffect(() => {
    const el = restRef.current;
    if (!el) return;
    const measure = () => {
      const overflowing = el.scrollWidth > el.clientWidth + 0.5;
      setOverflows(overflowing);
      if (overflowing) {
        // Target ~96 px/sec horizontal scroll. The track translates by one
        // block width on each loop. Block width \u2248 text scrollWidth + ~30px gap
        // (6 non-breaking spaces at 7px font). Clamp to keep extreme cases sane.
        const blockWidth = el.scrollWidth + 30;
        const seconds = Math.max(2.1, Math.min(20, blockWidth / 96));
        setMarqueeSeconds(seconds);
      }
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [status.text]);

  const gap = '\u00A0'.repeat(6);
  return (
    <Tooltip content={status.text}>
      <div
        className={`card-status stage-${stage}`}
        data-overflows={overflows ? 'true' : 'false'}
        aria-label={`Card status: ${status.text}`}
        style={{ '--card-status-marquee-duration': `${marqueeSeconds}s` } as React.CSSProperties}
      >
        {/* Rest layer: always present. Block-level; long text clips at panel edge
            (no ellipsis — chosen for the LED-marquee aesthetic). The full text is
            available via the title attribute (pointer hover) and aria-label
            (screen readers). */}
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
    </Tooltip>
  );
}

type CardSessionStatus = 'running' | 'detached' | 'resumable' | 'none';

interface KanbanCardItemProps {
  card: KanbanCard;
  sessionStatus: CardSessionStatus;
  isActivelyWorking?: boolean;
  /** Session output arrived that you haven't opened the card since (feature 082). */
  isUnseen?: boolean;
  stage?: KanbanStage;
  /** Force tags to render even in compact (Done) mode. Done-lane tag toggle. */
  showTags?: boolean;
  onClick: () => void;
  onContextMenu?: (e: React.MouseEvent) => void;
  onDragStart?: () => void;
  onDragEnd?: () => void;
}

// Priority as signal bars (ink; critical alone in red) — see .prio-bars in globals.css
const priorityLevels: Record<string, number> = { low: 1, medium: 2, high: 3, critical: 4 };

const typeIcons: Record<string, { Icon: LucideIcon; label: string }> = {
  bug: { Icon: Bug, label: 'Bug' },
  feature: { Icon: Sparkles, label: 'Feature' },
  chore: { Icon: Wrench, label: 'Chore' },
};

interface TooltipPosition {
  top: number;
  left: number;
}

// Progress ring component for checklist status
function ChecklistProgress({ completed, total }: { completed: number; total: number }) {
  const isComplete = completed === total;
  const progress = total > 0 ? completed / total : 0;
  const size = 14;
  const strokeWidth = 2;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference * (1 - progress);

  return (
    <Tooltip content={isComplete ? 'Checklist complete' : `${completed}/${total} items complete`}>
      <div className="flex items-center gap-1">
        <svg width={size} height={size} className="-rotate-90" aria-hidden>
          <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="var(--line-strong)" strokeWidth={strokeWidth} />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke={isComplete ? 'var(--live)' : 'var(--ink-2)'}
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={strokeDashoffset}
          />
        </svg>
        <span className="font-mono text-[11px] tabular-nums text-ink-3">{completed}/{total}</span>
      </div>
    </Tooltip>
  );
}

export function KanbanCardItem({ card, sessionStatus, isActivelyWorking = false, isUnseen = false, stage, showTags = false, onClick, onContextMenu, onDragStart, onDragEnd }: KanbanCardItemProps) {
  const unresolvedProblems = card.problems.filter((p) => !p.resolved_at).length;
  const checklistTotal = card.checklist?.length || 0;
  const checklistCompleted = card.checklist?.filter((item) => item.done).length || 0;
  const isCompact = stage === 'done';
  const [showTooltip, setShowTooltip] = useState(false);
  const [tooltipPos, setTooltipPos] = useState<TooltipPosition>({ top: 0, left: 0 });
  const [tooltipFlipped, setTooltipFlipped] = useState(false);
  const hoverTimeout = useRef<NodeJS.Timeout | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);

  const priorityLevel = priorityLevels[card.priority] ?? 2;
  const priorityLabel = `${card.priority.charAt(0).toUpperCase()}${card.priority.slice(1)} priority`;
  const { Icon: TypeIcon, label: typeLabel } = typeIcons[card.type] || typeIcons.chore;
  const isIdle = !isActivelyWorking && sessionStatus === 'running';
  const isEnded = !isActivelyWorking && (sessionStatus === 'detached' || sessionStatus === 'resumable');

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
  // Scheduled sends chip (card #0352): only while something is pending.
  const nextScheduled = !isCompact ? nextPendingFireAt(card.scheduled_prompts) : null;
  const pendingSends = nextScheduled ? pendingEntries(card.scheduled_prompts) : [];
  const hasTags = !isCompact && !status && (card.areas.length > 0 || card.tags.length > 0);
  // Done-lane tag toggle: in compact (Done) mode, show ALL tags (no areas, no
  // truncation) when the column's toggle is on.
  const showDoneTags = isCompact && showTags && card.tags.length > 0;

  // Unseen-activity marker (feature 082): a 10px lane-coloured corner fold plus
  // a lane-tinted backlight. The lane class supplies --unseen-rgb (light/dark
  // variants live in globals.css). Drop 'unseen-card-backlight' here and its
  // rule in globals.css to keep the fold alone.
  const unseenClasses = isUnseen && stage
    ? `unseen-card unseen-card-backlight unseen-lane-${stage}`
    : '';

  return (
    <>
      <div
        ref={cardRef}
        draggable
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onClick={onClick}
        onContextMenu={(e) => {
          if (onContextMenu) {
            setShowTooltip(false);
            if (hoverTimeout.current) clearTimeout(hoverTimeout.current);
            onContextMenu(e);
          }
        }}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        className={`group relative cursor-pointer overflow-hidden rounded-lg border border-line bg-surface-1 shadow-(--shadow-card) transition-[transform,border-color] duration-150 hover:-translate-y-px hover:border-line-strong ${isCompact ? 'px-3 py-2' : 'px-3 pt-2.5 pb-2.5'} ${unseenClasses}`}
      >
        {isActivelyWorking && <div className="live-wire" aria-hidden />}

        {/* Meta row: number, priority, type, session state */}
        <div className="flex items-center gap-2 text-[11px] leading-4 text-ink-3">
          {card.number != null && (
            <span className="font-mono tabular-nums">{formatCardNumber(card.number)}</span>
          )}
          {!isCompact && (
            <Tooltip content={priorityLabel}>
              <span className={`prio-bars p${priorityLevel}`} role="img" aria-label={priorityLabel}>
                <i /><i /><i /><i />
              </span>
            </Tooltip>
          )}
          <Tooltip content={typeLabel}>
            <span className="flex" role="img" aria-label={typeLabel}>
              <TypeIcon className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden />
            </span>
          </Tooltip>
          <span className="ml-auto flex items-center gap-1.5">
            {isActivelyWorking && (
              <Tooltip content="Agent working">
                <span className="flex items-center gap-1.5 rounded bg-live/10 px-1.5 text-[11px] font-medium leading-[18px] text-live-text">
                  <span className="live-dot" />
                  Working
                </span>
              </Tooltip>
            )}
            {isIdle && (
              <Tooltip content="Session running, idle">
                <span className="inline-block h-2 w-2 rounded-full bg-live" aria-label="Session idle" />
              </Tooltip>
            )}
            {isEnded && (
              <Tooltip content="Session ended (resumable)">
                <span className="ended-ring" aria-label="Session ended, resumable" />
              </Tooltip>
            )}
          </span>
        </div>

        <h4 className={`mt-1.5 text-[13px] leading-5 ${isCompact ? 'font-normal text-ink-2' : 'font-medium text-ink-1'}`}>
          {card.title}
        </h4>

        {/* Problems indicator */}
        {unresolvedProblems > 0 && (
          <div className="mt-2">
            <span className="inline-flex items-center gap-1 rounded bg-danger/10 px-1.5 text-[11px] font-medium leading-[18px] text-danger-text">
              <TriangleAlert className="h-3 w-3" aria-hidden />
              {unresolvedProblems} problem{unresolvedProblems !== 1 ? 's' : ''}
            </span>
          </div>
        )}

        {/* Agent status LED on its own row */}
        {status && stage && (
          <div className="mt-2 flex">
            <CardStatusPanel status={status} stage={stage} />
          </div>
        )}

        {/* Footer: chips left, scheduled send + checklist right */}
        {(hasTags || showDoneTags || nextScheduled || checklistTotal > 0) && (
          <div className="mt-2 flex items-center gap-1.5">
            {hasTags && (
              <div className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden">
                {card.areas.slice(0, 1).map((area) => (
                  <span key={area} className="shrink-0 rounded border border-line px-1.5 text-[11px] leading-[18px] text-ink-2">
                    {area}
                  </span>
                ))}
                {card.areas.length > 1 && (
                  <span className="shrink-0 text-[11px] leading-[18px] text-ink-3">+{card.areas.length - 1}</span>
                )}
                {card.tags.slice(0, 1).map((tag) => (
                  <span key={tag} className="shrink-0 px-1 text-[11px] leading-[18px] text-ink-3">
                    {tag}
                  </span>
                ))}
                {card.tags.length > 1 && (
                  <span className="shrink-0 text-[11px] leading-[18px] text-ink-3">+{card.tags.length - 1}</span>
                )}
              </div>
            )}
            {showDoneTags && (
              <div className="flex min-w-0 flex-1 flex-wrap gap-1 overflow-hidden">
                {card.tags.map((tag) => (
                  <span key={tag} className="shrink-0 rounded border border-line px-1.5 text-[11px] leading-[18px] text-ink-3">
                    {tag}
                  </span>
                ))}
              </div>
            )}
            <div className="ml-auto flex shrink-0 items-center gap-2">
              {nextScheduled && (
                <Tooltip content={pendingSends.map(e => `${formatFireTime(e.fireAt)} (${formatCountdown(e.fireAt)}): ${e.message}`).join('\n')}>
                  <span
                    className="flex items-center gap-1 rounded bg-agent/10 px-1.5 font-mono text-[11px] leading-[18px] text-agent-text"
                    aria-label={`Scheduled send at ${formatFireTime(nextScheduled)}`}
                  >
                    <StopwatchGlyph pointAt={nextScheduled} className="h-2.5 w-2.5" />
                    {formatFireTime(nextScheduled)}
                    {pendingSends.length > 1 && <span className="opacity-70">+{pendingSends.length - 1}</span>}
                  </span>
                </Tooltip>
              )}
              {checklistTotal > 0 && (
                <ChecklistProgress completed={checklistCompleted} total={checklistTotal} />
              )}
            </div>
          </div>
        )}
      </div>

      {/* Tooltip - rendered in portal */}
      {showTooltip && card.description && typeof document !== 'undefined' && createPortal(
        <div
          className={`fixed z-[100] w-64 animate-in fade-in duration-200 ${tooltipFlipped ? 'slide-in-from-right-1' : 'slide-in-from-left-1'}`}
          style={{ top: tooltipPos.top, left: tooltipPos.left }}
        >
          <div className="rounded-lg border border-line bg-surface-1 p-3 shadow-(--shadow-overlay)">
            <p className="whitespace-pre-wrap text-[13px] leading-5 text-ink-2">
              {card.description.length > 200
                ? card.description.slice(0, 200) + '...'
                : card.description}
            </p>
          </div>
          {/* Arrow */}
          <div className={`absolute top-3 h-2 w-2 rotate-45 ${tooltipFlipped ? '-right-1 border-t border-r' : '-left-1 border-b border-l'} border-line bg-surface-1`} />
        </div>,
        document.body
      )}
    </>
  );
}
