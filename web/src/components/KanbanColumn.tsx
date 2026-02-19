'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import type { KanbanCard, KanbanStage } from '@/lib/types';
import { KanbanCardItem } from './KanbanCardItem';

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
  onCardClick: (card: KanbanCard) => void;
  onCardContextMenu?: (card: KanbanCard, e: React.MouseEvent) => void;
  onMoveCard: (cardId: string, newStage: KanbanStage, insertIndex?: number) => void;
  onAddCardClick?: () => void;
}

const colorClasses: Record<string, { header: string; headerText: string; count: string; border: string; texture: string }> = {
  zinc: {
    header: 'bg-void-200 dark:bg-void-700 shadow-[inset_0_2px_6px_rgba(100,100,110,0.2),inset_0_-1px_3px_rgba(100,100,110,0.12)] dark:shadow-[inset_0_2px_6px_rgba(30,30,40,0.5),inset_0_-1px_3px_rgba(30,30,40,0.35),inset_0_1px_0_rgba(255,255,255,0.06)]',
    headerText: 'text-void-500 dark:text-void-200',
    count: 'bg-void-300/80 text-void-500 dark:bg-void-600 dark:text-void-200',
    border: 'border-b-[3px] border-void-400 dark:border-void-400',
    texture: 'lane-texture',
  },
  purple: {
    header: 'bg-neon-blue-100/80 dark:from-neon-blue-900/60 dark:to-neon-blue-950/40 dark:bg-gradient-to-r shadow-[inset_0_2px_6px_rgba(0,120,180,0.18),inset_0_-1px_3px_rgba(0,120,180,0.1)] dark:shadow-[inset_0_2px_6px_rgba(0,60,100,0.55),inset_0_-1px_3px_rgba(0,60,100,0.35),inset_0_1px_0_rgba(0,191,255,0.06)]',
    headerText: 'text-void-600 dark:text-neon-blue-300',
    count: 'bg-neon-blue-200/60 text-void-600 dark:bg-neon-blue-800/60 dark:text-neon-blue-200',
    border: 'border-b-[3px] border-neon-blue-400/70 dark:border-neon-blue-400/70',
    texture: 'lane-texture',
  },
  blue: {
    header: 'bg-neon-blue-100 dark:from-neon-blue-800/50 dark:to-neon-blue-900/40 dark:bg-gradient-to-r shadow-[inset_0_2px_6px_rgba(0,100,160,0.2),inset_0_-1px_3px_rgba(0,100,160,0.12)] dark:shadow-[inset_0_2px_6px_rgba(0,50,90,0.55),inset_0_-1px_3px_rgba(0,50,90,0.35),inset_0_1px_0_rgba(0,191,255,0.06)]',
    headerText: 'text-void-600 dark:text-neon-blue-200',
    count: 'bg-neon-blue-200/60 text-void-600 dark:bg-neon-blue-700/60 dark:text-neon-blue-100',
    border: 'border-b-[3px] border-neon-blue-500/60 dark:border-neon-blue-400/70',
    texture: 'lane-texture',
  },
  yellow: {
    header: 'bg-[#ff6a33]/10 dark:from-[#ff6a33]/15 dark:to-[#ff6a33]/5 dark:bg-gradient-to-r shadow-[inset_0_2px_6px_rgba(180,60,0,0.15),inset_0_-1px_3px_rgba(180,60,0,0.08)] dark:shadow-[inset_0_2px_6px_rgba(100,30,0,0.5),inset_0_-1px_3px_rgba(100,30,0,0.3),inset_0_1px_0_rgba(255,106,51,0.06)]',
    headerText: 'text-void-600 dark:text-[#ff8a60]',
    count: 'bg-[#ff6a33]/12 text-void-600 dark:bg-[#ff6a33]/20 dark:text-[#ffc0a0]',
    border: 'border-b-[3px] border-[#ff6a33]/50 dark:border-[#ff6a33]/60',
    texture: 'lane-texture',
  },
  green: {
    header: 'bg-green-100/80 dark:from-green-900/50 dark:to-green-950/30 dark:bg-gradient-to-r shadow-[inset_0_2px_6px_rgba(0,100,50,0.18),inset_0_-1px_3px_rgba(0,100,50,0.1)] dark:shadow-[inset_0_2px_6px_rgba(0,50,25,0.55),inset_0_-1px_3px_rgba(0,50,25,0.35),inset_0_1px_0_rgba(34,197,94,0.06)]',
    headerText: 'text-void-600 dark:text-green-300',
    count: 'bg-green-200/60 text-void-600 dark:bg-green-800/50 dark:text-green-200',
    border: 'border-b-[3px] border-green-500/60 dark:border-green-400/60',
    texture: 'lane-texture',
  },
};

// Auto-scroll configuration
const SCROLL_THRESHOLD = 60; // pixels from edge to trigger scroll
const SCROLL_SPEED = 8; // pixels per frame

export function KanbanColumn({ stage, cards, cardSessions, activeCards, onCardClick, onCardContextMenu, onMoveCard, onAddCardClick }: KanbanColumnProps) {
  const colors = colorClasses[stage.color] || colorClasses.zinc;
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const scrollAnimationRef = useRef<number | null>(null);
  const lastMouseYRef = useRef<number>(0);
  const isScrollingRef = useRef<boolean>(false);

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

  return (
    <div
      className="flex min-w-[85vw] sm:min-w-72 max-w-[85vw] sm:max-w-96 flex-1 flex-shrink-0 snap-start flex-col rounded-lg border-2 border-t-[rgba(140,170,220,0.55)] border-l-[rgba(140,170,220,0.55)] border-b-[rgba(80,110,180,0.45)] border-r-[rgba(80,110,180,0.45)] bg-[#d8e1f0] shadow-[0_1px_3px_rgba(0,0,0,0.25),inset_0_3px_6px_-2px_rgba(255,255,255,0.6),inset_3px_0_6px_-2px_rgba(255,255,255,0.4),inset_0_-3px_6px_-2px_rgba(60,90,160,0.2),inset_-3px_0_6px_-2px_rgba(60,90,160,0.15)] dark:border-2 dark:border-void-700 dark:bg-void-850 dark:shadow-[0_1px_3px_rgba(0,0,0,0.6)]"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Column Header */}
      <div className={`light-clean grain depth-glow flex items-center justify-between rounded-t-lg px-3 py-2.5 ${colors.header} ${colors.border}`}>
        <h3 className={`font-semibold drop-shadow-[0_1px_2px_rgba(0,0,0,0.4)] dark:drop-shadow-[0_2px_3px_rgba(0,0,0,0.7)] ${colors.headerText}`}>
          {stage.label}
        </h3>
        <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${colors.count}`}>
          {cards.length}
        </span>
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
            className="rounded-lg border-2 border-dashed border-void-200 p-4 text-center text-sm text-void-400 dark:border-void-700 dark:text-void-600"
            onDragOver={handleDragOver}
            onDrop={handleEmptyDrop}
          >
            Drop here
          </div>
        ) : (
          <>
            {cards.map((card, index) => (
              <div key={card.id}>
                {/* Drop indicator before card */}
                {dropIndex === index && (
                  <div className="mb-2 h-1 rounded-full bg-neon-blue-400 transition-all" />
                )}
                <div
                  onDragOver={(e) => handleCardDragOver(e, index)}
                >
                  <KanbanCardItem
                    card={card}
                    sessionStatus={cardSessions.get(card.id) || 'none'}
                    isActivelyWorking={activeCards.has(card.id)}
                    stage={stage.id}
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
              <div className="mt-2 h-1 rounded-full bg-neon-blue-400 transition-all" />
            )}
          </>
        )}
      </div>

      {/* Add Card Button - pinned to bottom, outside scroll area */}
      {onAddCardClick && (
        <div className="p-2 pt-0">
          <button
            onClick={onAddCardClick}
            className="flex w-full items-center justify-center gap-1 rounded-lg border-2 border-dashed border-void-200 py-2 text-sm text-void-400 transition-colors hover:border-neon-blue-400/30 hover:text-neon-blue-400 dark:border-void-700 dark:text-void-500 dark:hover:border-neon-blue-400/30 dark:hover:text-neon-blue-400"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Add Card
          </button>
        </div>
      )}
    </div>
  );
}
