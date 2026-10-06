'use client';

/**
 * Phone layout for the voice tools (#0376). Below 640 px or on a touch-first
 * device, Voice Settings opens as a bottom sheet and the voice search /
 * design panel as a full-screen sheet, both sized to the part of the page
 * that can actually be seen (keyboard and toolbars excluded), so nothing a
 * person needs ends up out of reach. Desktop keeps its popover and card.
 *
 * Carries the settings-layer marker, so the Voice Settings outside-click rule
 * ignores taps inside; the backdrop closes the sheet on click (not mousedown,
 * so a tap never falls through to whatever was underneath).
 */

import { createContext, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { VOICE_SETTINGS_LAYER_ATTR } from '@/lib/voice-settings-layer';
import { bottomSheetMaxHeight } from '@/lib/visible-viewport';
import { useVisibleViewport } from '@/hooks/useVisibleViewport';

/**
 * Where a panel's main actions go: a bar pinned below the scrolling body, so
 * they stay visible with the keyboard up. Null when there is no bar
 * (render the actions inline).
 */
export const VoiceActionBarContext = createContext<HTMLElement | null>(null);

export function VoiceSheet({ variant, onClose, labelledBy, label, children }: {
  /** bottom: Voice Settings; full: the search / design panel. */
  variant: 'bottom' | 'full';
  onClose: () => void;
  labelledBy?: string;
  label?: string;
  children: React.ReactNode;
}) {
  const view = useVisibleViewport();
  const dialogRef = useRef<HTMLDivElement>(null);

  // Focus the sheet itself (never a field: that would raise the keyboard),
  // and give focus back to whatever opened it.
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialogRef.current?.focus({ preventScroll: true });
    return () => {
      if (opener && document.contains(opener)) opener.focus({ preventScroll: true });
    };
  }, []);

  if (typeof document === 'undefined') return null;

  const placement: React.CSSProperties = variant === 'full'
    ? (view ? { top: view.top, height: view.height } : {})
    : (view ? { bottom: view.bottomInset, ['--voice-popover-max-h' as string]: `${bottomSheetMaxHeight(view)}px` } : {});

  return createPortal(
    <div {...{ [VOICE_SETTINGS_LAYER_ATTR]: '' }} className="fixed inset-0 z-[10000]">
      <div aria-hidden="true" className="absolute inset-0 bg-black/40 dark:bg-black/60" onClick={onClose} />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        aria-label={labelledBy ? undefined : label}
        tabIndex={-1}
        onKeyDown={(e) => {
          if (e.key === 'Escape') { e.stopPropagation(); onClose(); }
        }}
        style={placement}
        className={variant === 'full'
          ? 'absolute inset-x-0 top-0 flex h-[100dvh] flex-col overflow-hidden bg-surface-1 outline-none'
          : 'absolute inset-x-0 bottom-0 flex justify-center outline-none [--voice-popover-max-h:85dvh]'}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}
