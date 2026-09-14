'use client';

/**
 * Shared speech-bubble tooltip (#0354).
 *
 * Built from the kanban card's hover bubble in KanbanCardItem: same surface
 * (`border-neon-blue-400/20 bg-void-50 dark:bg-void-850`), same 8px rotated
 * square arrow, same portal + viewport-aware flip. Use it anywhere a `title=`
 * attribute would otherwise act as a tooltip.
 *
 *   <Tooltip content="Refresh board from disk"><button …/></Tooltip>
 *   <Tooltip content={hint} placement="bottom">…</Tooltip>
 *
 * Behaviour:
 *  - wraps ONE element; hover/focus/blur/Escape handlers are merged onto it
 *    (the child's own handlers still run) and its ref is preserved
 *  - preferred `placement` flips to the opposite side when it would overflow
 *    the viewport; the cross axis is clamped and the arrow tracks the anchor
 *  - mouse/pen hover opens after `delay` ms; keyboard focus (`:focus-visible`)
 *    opens immediately; touch never opens it (native behaviour only)
 *  - pointerdown, Escape, scroll and resize close it; no layout shift (portal,
 *    position: fixed); `prefers-reduced-motion` disables the entry animation
 *  - empty `content` renders the child untouched
 *
 * Disabled buttons do not emit pointer events — wrap them in a <span> first.
 */

import {
  cloneElement,
  isValidElement,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactElement,
  type ReactNode,
  type Ref,
} from 'react';
import { createPortal } from 'react-dom';

export type TooltipPlacement = 'top' | 'bottom' | 'left' | 'right';

interface TooltipProps {
  /** Tooltip body. Strings keep their newlines. Falsy → no tooltip. */
  content: ReactNode;
  /** Preferred side; flips when it would overflow the viewport. Default `top`. */
  placement?: TooltipPlacement;
  /** Hover delay in ms (keyboard focus ignores it). Default 350. */
  delay?: number;
  /** Extra classes on the bubble surface (e.g. `max-w-sm`). */
  className?: string;
  children: ReactElement<AnchorProps>;
}

type AnchorProps = {
  ref?: Ref<HTMLElement>;
  onPointerEnter?: (e: React.PointerEvent<HTMLElement>) => void;
  onPointerLeave?: (e: React.PointerEvent<HTMLElement>) => void;
  onPointerDown?: (e: React.PointerEvent<HTMLElement>) => void;
  onFocus?: (e: React.FocusEvent<HTMLElement>) => void;
  onBlur?: (e: React.FocusEvent<HTMLElement>) => void;
  onKeyDown?: (e: React.KeyboardEvent<HTMLElement>) => void;
  'aria-describedby'?: string;
};

const OPPOSITE: Record<TooltipPlacement, TooltipPlacement> = {
  top: 'bottom',
  bottom: 'top',
  left: 'right',
  right: 'left',
};

/** Arrow sits on the edge facing the anchor; border sides follow the bubble's outline. */
const ARROW_CLASS: Record<TooltipPlacement, string> = {
  top: '-bottom-1 border-b border-r',
  bottom: '-top-1 border-t border-l',
  left: '-right-1 border-t border-r',
  right: '-left-1 border-b border-l',
};

/** Forward a node to a child's own ref (callback or object) so wrapping never steals it. */
function assignRef(ref: Ref<HTMLElement> | undefined, node: HTMLElement | null) {
  if (typeof ref === 'function') ref(node);
  else if (ref && typeof ref === 'object') (ref as React.MutableRefObject<HTMLElement | null>).current = node;
}

const GAP = 8; // anchor → bubble edge (arrow lives inside this gap)
const EDGE = 6; // minimum distance from the viewport edge
const ARROW = 8; // arrow square size (h-2 w-2)

interface Layout {
  side: TooltipPlacement;
  top: number;
  left: number;
  /** Arrow offset along the bubble's long axis (px from the bubble's top/left). */
  arrow: number;
}

function computeLayout(anchor: DOMRect, bubble: { width: number; height: number }, preferred: TooltipPlacement): Layout {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const fits = (side: TooltipPlacement) => {
    switch (side) {
      case 'top': return anchor.top - GAP - bubble.height >= EDGE;
      case 'bottom': return anchor.bottom + GAP + bubble.height <= vh - EDGE;
      case 'left': return anchor.left - GAP - bubble.width >= EDGE;
      case 'right': return anchor.right + GAP + bubble.width <= vw - EDGE;
    }
  };
  const side = fits(preferred) ? preferred : fits(OPPOSITE[preferred]) ? OPPOSITE[preferred] : preferred;
  const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), Math.max(lo, hi));

  if (side === 'top' || side === 'bottom') {
    const anchorCx = anchor.left + anchor.width / 2;
    const left = clamp(anchorCx - bubble.width / 2, EDGE, vw - EDGE - bubble.width);
    const top = side === 'top' ? anchor.top - GAP - bubble.height : anchor.bottom + GAP;
    const arrow = clamp(anchorCx - left - ARROW / 2, 10, bubble.width - ARROW - 10);
    return { side, top, left, arrow };
  }
  const anchorCy = anchor.top + anchor.height / 2;
  const top = clamp(anchorCy - bubble.height / 2, EDGE, vh - EDGE - bubble.height);
  const left = side === 'left' ? anchor.left - GAP - bubble.width : anchor.right + GAP;
  const arrow = clamp(anchorCy - top - ARROW / 2, 8, bubble.height - ARROW - 8);
  return { side, top, left, arrow };
}

export default function Tooltip({ content, placement = 'top', delay = 350, className = '', children }: TooltipProps) {
  const id = useId();
  const anchorRef = useRef<HTMLElement | null>(null);
  const bubbleRef = useRef<HTMLDivElement | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [open, setOpen] = useState(false);
  const [layout, setLayout] = useState<Layout | null>(null);

  const hasContent = content !== null && content !== undefined && content !== false && content !== '';

  const cancel = useCallback(() => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);

  const hide = useCallback(() => {
    cancel();
    setOpen(false);
    setLayout(null);
  }, [cancel]);

  const show = useCallback(() => {
    cancel();
    setOpen(true);
  }, [cancel]);

  // Measure once the bubble is in the DOM, then place it. Runs again if the
  // content changes while open (e.g. "Copy path" → "Copied!").
  useLayoutEffect(() => {
    if (!open) return;
    const anchor = anchorRef.current;
    const bubble = bubbleRef.current;
    if (!anchor || !bubble) return;
    const rect = anchor.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) {
      setOpen(false);
      return;
    }
    setLayout(computeLayout(rect, { width: bubble.offsetWidth, height: bubble.offsetHeight }, placement));
  }, [open, placement, content]);

  // Anything that moves the anchor or signals intent closes the tooltip.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') hide();
    };
    window.addEventListener('scroll', hide, true);
    window.addEventListener('resize', hide);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('scroll', hide, true);
      window.removeEventListener('resize', hide);
      window.removeEventListener('keydown', onKey);
    };
  }, [open, hide]);

  useEffect(() => cancel, [cancel]);

  const childRef = isValidElement(children) ? children.props.ref : undefined;
  const setRef = useCallback((node: HTMLElement | null) => {
    anchorRef.current = node;
    assignRef(childRef, node);
  }, [childRef]);

  if (!isValidElement(children)) return children;
  if (!hasContent) return children;

  const childProps = children.props;

  // cloneElement only forwards the callback ref to the child; nothing reads `.current` during render.
  // eslint-disable-next-line react-hooks/refs
  const anchor = cloneElement(children, {
    ref: setRef,
    'aria-describedby': open ? [childProps['aria-describedby'], id].filter(Boolean).join(' ') : childProps['aria-describedby'],
    onPointerEnter: (e: React.PointerEvent<HTMLElement>) => {
      childProps.onPointerEnter?.(e);
      if (e.pointerType === 'touch') return;
      cancel();
      timer.current = setTimeout(show, delay);
    },
    onPointerLeave: (e: React.PointerEvent<HTMLElement>) => {
      childProps.onPointerLeave?.(e);
      hide();
    },
    onPointerDown: (e: React.PointerEvent<HTMLElement>) => {
      childProps.onPointerDown?.(e);
      hide();
    },
    onFocus: (e: React.FocusEvent<HTMLElement>) => {
      childProps.onFocus?.(e);
      // Only keyboard focus gets a tooltip — a mouse click already has hover.
      if (e.currentTarget.matches(':focus-visible')) show();
    },
    onBlur: (e: React.FocusEvent<HTMLElement>) => {
      childProps.onBlur?.(e);
      hide();
    },
    onKeyDown: (e: React.KeyboardEvent<HTMLElement>) => {
      childProps.onKeyDown?.(e);
      if (e.key === 'Escape') hide();
    },
  });

  const side = layout?.side ?? placement;
  const vertical = side === 'top' || side === 'bottom';
  const arrowStyle: CSSProperties = layout
    ? vertical ? { left: layout.arrow } : { top: layout.arrow }
    : {};
  const bubbleStyle: CSSProperties = layout
    ? { top: layout.top, left: layout.left }
    : { top: 0, left: 0, visibility: 'hidden' };

  return (
    <>
      {anchor}
      {open && typeof document !== 'undefined' && createPortal(
        <div
          ref={bubbleRef}
          id={id}
          role="tooltip"
          data-side={side}
          className={`tooltip-bubble pointer-events-none fixed z-[120] max-w-72 ${layout ? 'tooltip-bubble-in' : ''}`}
          style={bubbleStyle}
        >
          <div className={`rounded-lg border border-neon-blue-400/20 bg-void-50 px-2.5 py-1.5 text-xs leading-snug text-void-700 shadow-(--shadow-overlay) dark:bg-void-850 dark:text-void-300 ${typeof content === 'string' ? 'whitespace-pre-wrap' : ''} ${className}`}>
            {content}
          </div>
          {/* Arrow — same rotated square as the card bubble; border sides follow the resolved placement */}
          <div
            className={`absolute h-2 w-2 rotate-45 border-neon-blue-400/20 bg-void-50 dark:bg-void-850 ${ARROW_CLASS[side]}`}
            style={arrowStyle}
          />
        </div>,
        document.body,
      )}
    </>
  );
}
