'use client';

import { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react';

const GAP_PX = 8; // Tailwind gap-2 = 0.5rem = 8px

const useIsomorphicLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect;

/**
 * Dynamically calculates how many action buttons fit in the footer bar
 * before overflowing the rest into a dropdown menu.
 *
 * Uses a hidden measurement container + ResizeObserver for accurate,
 * responsive calculation without visual flicker.
 */
export function useActionOverflow(actionsKey: string, isActive: boolean) {
  const footerRef = useRef<HTMLDivElement>(null);
  const rightControlsRef = useRef<HTMLDivElement>(null);
  const measurerRef = useRef<HTMLDivElement>(null);
  const [visibleCount, setVisibleCount] = useState(Number.MAX_SAFE_INTEGER);

  const recalculate = useCallback(() => {
    const measurer = measurerRef.current;
    const footer = footerRef.current;
    const rightControls = rightControlsRef.current;
    if (!measurer || !footer || !rightControls) return;

    const children = Array.from(measurer.children) as HTMLElement[];
    if (children.length < 2) {
      setVisibleCount(0);
      return;
    }

    // Last child in measurer is the overflow trigger, rest are action buttons
    const overflowWidth = children[children.length - 1].offsetWidth;
    const buttonWidths = children.slice(0, -1).map(el => el.offsetWidth);

    // Available width for action buttons
    const cs = getComputedStyle(footer);
    const footerInner = footer.clientWidth
      - parseFloat(cs.paddingLeft)
      - parseFloat(cs.paddingRight);
    const rightWidth = rightControls.offsetWidth;
    // Footer layout: [buttons...] [overflow?] gap [spacer] gap [rightControls]
    // 2 structural gaps always present (actions↔spacer, spacer↔rightControls)
    const available = footerInner - rightWidth - 2 * GAP_PX;

    // Pass 1: do all buttons fit without overflow trigger?
    let cumulative = 0;
    for (let i = 0; i < buttonWidths.length; i++) {
      if (i > 0) cumulative += GAP_PX;
      cumulative += buttonWidths[i];
    }
    if (cumulative <= available) {
      setVisibleCount(buttonWidths.length);
      return;
    }

    // Pass 2: reserve overflow trigger width, find largest fitting prefix
    const availableWithOverflow = available - overflowWidth - GAP_PX;
    cumulative = 0;
    let count = 0;
    for (let i = 0; i < buttonWidths.length; i++) {
      const needed = buttonWidths[i] + (i > 0 ? GAP_PX : 0);
      if (cumulative + needed > availableWithOverflow) break;
      cumulative += needed;
      count++;
    }
    setVisibleCount(count);
  }, []);

  // Set up ResizeObserver and run initial measurement before paint
  useIsomorphicLayoutEffect(() => {
    const footer = footerRef.current;
    const rightControls = rightControlsRef.current;
    if (!footer || !isActive) return;

    // Synchronous initial measurement prevents flash
    recalculate();

    const ro = new ResizeObserver(() => recalculate());
    ro.observe(footer);
    if (rightControls) ro.observe(rightControls);

    return () => ro.disconnect();
  }, [actionsKey, isActive, recalculate]);

  return { visibleCount, footerRef, rightControlsRef, measurerRef };
}
