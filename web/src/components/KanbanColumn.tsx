'use client';

import { useState, useRef, useEffect, useCallback, useSyncExternalStore } from 'react';
import type { KanbanCard, KanbanStage } from '@/lib/types';
import { KanbanCardItem } from './KanbanCardItem';
import Tooltip from './Tooltip';

interface StageConfig {
  id: KanbanStage;
  label: string;
  color: string;
}

type CardSessionStatus = 'running' | 'detached' | 'resumable' | 'none';

interface KanbanColumnProps {
  stage: StageConfig;
  cards: KanbanCard[];
  cardSessions: Map<string, CardSessionStatus>;
  activeCards: Set<string>;
  /** Cards with finished-but-unviewed session output (feature 082). */
  unseenCards: Set<string>;
  onCardClick: (card: KanbanCard) => void;
  onCardContextMenu?: (card: KanbanCard, e: React.MouseEvent) => void;
  onMoveCard: (cardId: string, newStage: KanbanStage, insertIndex?: number) => void;
  onAddCardClick?: () => void;
}

// Stage identity is a 2px rule at the top of the lane (stage hues live in
// globals.css: --st-*). Design and Implementation are deliberately different hues.
const colorClasses: Record<string, { rule: string; texture: string }> = {
  zinc: { rule: 'bg-st-backlog text-st-backlog', texture: 'lane-texture' },
  purple: { rule: 'bg-st-design text-st-design', texture: 'lane-texture' },
  blue: { rule: 'bg-st-impl text-st-impl', texture: 'lane-texture' },
  yellow: { rule: 'bg-st-test text-st-test', texture: 'lane-texture' },
  green: { rule: 'bg-st-done text-st-done', texture: 'lane-texture' },
};

// Auto-scroll configuration
const SCROLL_THRESHOLD = 60; // pixels from edge to trigger scroll
const SCROLL_SPEED = 8; // pixels per frame

// Done-lane tag toggle: global preference, persisted across boards/sessions.
const DONE_TAGS_KEY = 'slycode-done-tags';
const DONE_TAGS_EVENT = 'slycode-done-tags-change';

function subscribeDoneTags(callback: () => void): () => void {
  window.addEventListener('storage', callback);
  window.addEventListener(DONE_TAGS_EVENT, callback);
  return () => {
    window.removeEventListener('storage', callback);
    window.removeEventListener(DONE_TAGS_EVENT, callback);
  };
}

function getDoneTagsSnapshot(): boolean {
  try {
    return localStorage.getItem(DONE_TAGS_KEY) === '1';
  } catch {
    return false;
  }
}

// Server render (and pre-hydration) defaults to OFF — matches the historical
// "tags hidden in Done" behavior, so there's no hydration mismatch.
function getDoneTagsServerSnapshot(): boolean {
  return false;
}

export function KanbanColumn({ stage, cards, cardSessions, activeCards, unseenCards, onCardClick, onCardContextMenu, onMoveCard, onAddCardClick }: KanbanColumnProps) {
  const colors = colorClasses[stage.color] || colorClasses.zinc;
  const isDone = stage.id === 'done';
  const showDoneTags = useSyncExternalStore(subscribeDoneTags, getDoneTagsSnapshot, getDoneTagsServerSnapshot);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const scrollAnimationRef = useRef<number | null>(null);
  const lastMouseYRef = useRef<number>(0);
  const isScrollingRef = useRef<boolean>(false);

  // Done-lane tag toggle: flip the persisted global preference and notify all
  // subscribers (this tab via the custom event, other tabs via 'storage').
  const toggleDoneTags = useCallback(() => {
    const next = getDoneTagsSnapshot() ? '0' : '1';
    try {
      localStorage.setItem(DONE_TAGS_KEY, next);
    } catch {
      /* ignore persistence failure */
    }
    window.dispatchEvent(new Event(DONE_TAGS_EVENT));
  }, []);

  // Shipping moment: flash the Done lane's stage rule when a new card arrives.
  // Imperative class toggle (no state) so it never re-renders the lane.
  const ruleRef = useRef<HTMLDivElement>(null);
  const seenIdsRef = useRef<Set<string> | null>(null);
  useEffect(() => {
    const ids = new Set(cards.map((c) => c.id));
    const seen = seenIdsRef.current;
    seenIdsRef.current = ids;
    if (!isDone || !seen) return;
    const arrived = cards.some((c) => !seen.has(c.id));
    const rule = ruleRef.current;
    if (arrived && rule) {
      rule.classList.remove('lane-flash');
      void rule.offsetWidth; // restart the animation
      rule.classList.add('lane-flash');
    }
  }, [cards, isDone]);

  // Use effect to set up the animation loop
  useEffect(() => {
    const animateScroll = () => {
      const container = scrollContainerRef.current;
      if (!container || !isScrollingRef.current) {
        scrollAnimationRef.current = null;
        return;
      }

      const rect = container.getBoundingClientRect();
      const mouseY = lastMouseYRef.current;

      // Check if mouse is near top or bottom of scroll container
      const distanceFromTop = mouseY - rect.top;
      const distanceFromBottom = rect.bottom - mouseY;

      let scrollAmount = 0;

      if (distanceFromTop < SCROLL_THRESHOLD && distanceFromTop > 0) {
        // Scroll up - faster when closer to edge
        const intensity = 1 - (distanceFromTop / SCROLL_THRESHOLD);
        scrollAmount = -SCROLL_SPEED * intensity;
      } else if (distanceFromBottom < SCROLL_THRESHOLD && distanceFromBottom > 0) {
        // Scroll down - faster when closer to edge
        const intensity = 1 - (distanceFromBottom / SCROLL_THRESHOLD);
        scrollAmount = SCROLL_SPEED * intensity;
      }

      if (scrollAmount !== 0) {
        container.scrollTop += scrollAmount;
      }

      // Continue animation loop while scrolling is active
      scrollAnimationRef.current = requestAnimationFrame(animateScroll);
    };

    // Store the animate function in a ref for access from event handlers
    const startScroll = () => {
      if (!scrollAnimationRef.current) {
        scrollAnimationRef.current = requestAnimationFrame(animateScroll);
      }
    };

    // Expose start function via a custom property on the ref
    if (scrollContainerRef.current) {
      (scrollContainerRef.current as HTMLDivElement & { startScroll?: () => void }).startScroll = startScroll;
    }

    return () => {
      if (scrollAnimationRef.current) {
        cancelAnimationFrame(scrollAnimationRef.current);
        scrollAnimationRef.current = null;
      }
    };
  }, []);

  const startAutoScroll = useCallback(() => {
    isScrollingRef.current = true;
    const container = scrollContainerRef.current as HTMLDivElement & { startScroll?: () => void } | null;
    container?.startScroll?.();
  }, []);

  const stopAutoScroll = useCallback(() => {
    isScrollingRef.current = false;
    if (scrollAnimationRef.current) {
      cancelAnimationFrame(scrollAnimationRef.current);
      scrollAnimationRef.current = null;
    }
  }, []);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    // Update mouse position and trigger auto-scroll
    lastMouseYRef.current = e.clientY;
    startAutoScroll();
  };

  const handleDragLeave = (e: React.DragEvent) => {
    // Only clear if leaving the column entirely
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX;
    const y = e.clientY;
    if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) {
      setDropIndex(null);
      stopAutoScroll();
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    stopAutoScroll();
    const cardId = e.dataTransfer.getData('text/plain');
    if (cardId) {
      onMoveCard(cardId, stage.id, dropIndex ?? undefined);
    }
    setDropIndex(null);
  };

  const handleCardDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    e.stopPropagation();

    // Update mouse position for auto-scroll
    lastMouseYRef.current = e.clientY;
    startAutoScroll();

    // Get the card element's bounding box
    const rect = e.currentTarget.getBoundingClientRect();
    const midY = rect.top + rect.height / 2;

    // Determine if we should insert before or after this card
    const insertBefore = e.clientY < midY;
    const newDropIndex = insertBefore ? index : index + 1;

    setDropIndex(newDropIndex);
  };

  const handleEmptyDrop = (e: React.DragEvent) => {
    e.preventDefault();
    stopAutoScroll();
    const cardId = e.dataTransfer.getData('text/plain');
    if (cardId) {
      onMoveCard(cardId, stage.id, 0);
    }
    setDropIndex(null);
  };

  const workingCount = cards.reduce((n, c) => n + (activeCards.has(c.id) ? 1 : 0), 0);

  return (
    <div
      className={`lane lane-${stage.id} relative flex min-w-[85vw] sm:min-w-72 max-w-[85vw] sm:max-w-96 flex-1 flex-shrink-0 snap-start flex-col rounded-xl border border-line bg-surface-2`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Stage edge: the lane's top edge in its stage hue; the wash (.lane) fades down from it */}
      <div ref={ruleRef} className={`pointer-events-none absolute -inset-x-px -top-px h-[3px] rounded-t-xl ${colors.rule}`} aria-hidden />

      {/* Column Header — fixed height: the lane wash (.lane in globals.css, --lane-head-h) is sized to it */}
      <div className="flex h-11 shrink-0 items-center gap-2 px-3 pt-1">
        <h3 className="text-[13px] font-semibold leading-5 text-ink-1">{stage.label}</h3>
        <span className="lane-count font-mono text-[11px] font-medium tabular-nums">{cards.length}</span>
        <div className="ml-auto flex items-center gap-1">
          {workingCount > 0 && (
            <Tooltip content={`${workingCount} agent${workingCount !== 1 ? 's' : ''} working in this lane`} placement="bottom">
              <span className="flex items-center gap-1.5 rounded bg-live/10 px-1.5 text-[11px] font-medium leading-[18px] text-live-text">
                <span className="live-dot" />
                {workingCount}
              </span>
            </Tooltip>
          )}
          {isDone && (
            <Tooltip content={showDoneTags ? 'Hide tags on Done cards' : 'Show tags on Done cards'} placement="bottom">
              <button
                type="button"
                onClick={toggleDoneTags}
                aria-pressed={showDoneTags}
                className={`rounded px-1.5 text-[11px] leading-[18px] transition-colors ${
                  showDoneTags ? 'bg-surface-3 text-ink-1' : 'text-ink-3 hover:text-ink-1'
                }`}
              >
                Tags
              </button>
            </Tooltip>
          )}
          {onAddCardClick && (
            <Tooltip content={`Add card to ${stage.label}`} placement="bottom">
              <button
                type="button"
                onClick={onAddCardClick}
                aria-label={`Add card to ${stage.label}`}
                className="flex h-6 w-6 items-center justify-center rounded text-ink-3 transition-colors hover:bg-surface-3 hover:text-ink-1"
              >
                <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 5v14m7-7H5" />
                </svg>
              </button>
            </Tooltip>
          )}
        </div>
      </div>

      {/* Cards - with mask fade at bottom */}
      <div
        ref={scrollContainerRef}
        className={`min-h-0 flex-1 space-y-2 overflow-y-auto p-2 pb-8 ${colors.texture}`}
        style={{
          maskImage: 'linear-gradient(to bottom, black calc(100% - 3rem), transparent 100%)',
          WebkitMaskImage: 'linear-gradient(to bottom, black calc(100% - 3rem), transparent 100%)',
        }}
      >
        {cards.length === 0 ? (
          <div
            className="rounded-lg px-4 py-6 text-center text-[13px] leading-5 text-ink-3"
            onDragOver={handleDragOver}
            onDrop={handleEmptyDrop}
          >
            Nothing in {stage.label}.
            <br />
            <span className="text-[12px]">Drag a card here.</span>
          </div>
        ) : (
          <>
            {cards.map((card, index) => (
              <div key={card.id}>
                {/* Drop indicator before card */}
                {dropIndex === index && (
                  <div className="mb-2 h-0.5 rounded-full bg-accent transition-all" />
                )}
                <div
                  onDragOver={(e) => handleCardDragOver(e, index)}
                >
                  <KanbanCardItem
                    card={card}
                    sessionStatus={cardSessions.get(card.id) || 'none'}
                    isActivelyWorking={activeCards.has(card.id)}
                    isUnseen={unseenCards.has(card.id)}
                    stage={stage.id}
                    showTags={isDone && showDoneTags}
                    onClick={() => onCardClick(card)}
                    onContextMenu={onCardContextMenu ? (e) => onCardContextMenu(card, e) : undefined}
                    onDragStart={() => {}}
                    onDragEnd={() => {
                      setDropIndex(null);
                      stopAutoScroll();
                    }}
                  />
                </div>
              </div>
            ))}
            {/* Drop indicator at the end */}
            {dropIndex === cards.length && (
              <div className="mt-2 h-0.5 rounded-full bg-accent transition-all" />
            )}
          </>
        )}
      </div>

      {/* Add card — Backlog only, pinned to the lane bottom where new work starts */}
      {onAddCardClick && stage.id === 'backlog' && (
        <div className="px-2 pb-2">
          <button
            type="button"
            onClick={onAddCardClick}
            className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-line-strong py-2 text-[13px] font-medium text-ink-3 transition-colors hover:border-ink-3 hover:bg-surface-1 hover:text-ink-1"
          >
            <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 5v14m7-7H5" />
            </svg>
            Add card
          </button>
        </div>
      )}
    </div>
  );
}
