'use client';

import type { SpeakerController } from '@/hooks/useSpeakerController';
import Tooltip from './Tooltip';

interface SpeakerToggleProps {
  speaker: SpeakerController;
  /** 'chrome' = the mic/gear button chrome (card modal, floating widget); 'onBlue' = the global panel's blue header bar. */
  variant?: 'chrome' | 'onBlue';
  /** Hide below the sm breakpoint (crowded header while recording). */
  hideOnNarrow?: boolean;
  className?: string;
}

/**
 * Global speaker permission toggle (feature 086).
 *
 * Three states that must never be confused with each other:
 *  - on: lit neon blue (the same light-mode-safe blue the transcribing label uses);
 *  - off: neutral chrome at FULL opacity (off is a choice, not a fault);
 *  - unavailable: dimmed, with the reason on the wrapper, but still clickable
 *    when it is ON so a messaging outage can never trap permission on.
 * Renders neutral until the bridge has reported once (no lit-then-unlit flicker).
 */
export function SpeakerToggle({ speaker, variant = 'chrome', hideOnNarrow = false, className = '' }: SpeakerToggleProps) {
  const known = speaker.enabled !== null;
  const on = speaker.enabled === true;
  const unavailable = known && !speaker.available;
  // OFF is always allowed; ON is blocked only when unavailable.
  const disabled = !known || (unavailable && !on);

  const title = !known
    ? 'Spoken replies: checking…'
    : unavailable
      ? (speaker.availability.reason ?? 'Spoken replies unavailable')
      : on
        ? 'Spoken replies allowed. Click to turn sound off'
        : 'Spoken replies off. Click to allow sound';

  const base = 'rounded-md border p-1.5 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60';
  const chrome = on
    ? 'border-accent/40 bg-accent/15 text-[#2490b5] hover:bg-accent/25 text-accent'
    : 'border-line-strong bg-surface-3 text-ink-3 hover:border-accent/40 hover:bg-accent/10 hover:text-[#2490b5] hover:text-accent';
  const onBlue = on
    ? 'border-white/50 bg-white/25 text-white hover:bg-white/35'
    : 'border-white/25 bg-black/10 text-white/80 hover:bg-white/20 hover:text-white';
  const look = variant === 'onBlue' ? onBlue : chrome;
  const dim = unavailable ? 'opacity-40' : '';
  const cursor = disabled ? 'cursor-not-allowed' : 'cursor-pointer';
  const pulse = on && speaker.playing ? 'motion-safe:animate-pulse' : '';

  return (
    <Tooltip content={title}>
      <span
        className={`${hideOnNarrow ? 'hidden sm:inline-flex' : 'inline-flex'} ${className}`}
      >
        <button
          type="button"
          aria-pressed={on}
          aria-label={title}
          disabled={disabled}
          onMouseDown={(e) => e.preventDefault()} // don't steal focus from a field being dictated into
          onClick={(e) => { e.stopPropagation(); void speaker.setEnabled(!on); }}
          className={`${base} ${look} ${dim} ${cursor} ${pulse}`}
        >
          {on ? (
            // Heroicons outline: speaker-wave
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2} aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M19.114 5.636a9 9 0 0 1 0 12.728M16.463 8.288a5.25 5.25 0 0 1 0 7.424M6.75 8.25l4.72-4.72a.75.75 0 0 1 1.28.53v15.88a.75.75 0 0 1-1.28.53l-4.72-4.72H4.51c-.88 0-1.704-.507-1.938-1.354A9.009 9.009 0 0 1 2.25 12c0-.83.112-1.633.322-2.396C2.806 8.756 3.63 8.25 4.51 8.25H6.75Z" />
            </svg>
          ) : (
            // Heroicons outline: speaker-x-mark
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2} aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M17.25 9.75 19.5 12m0 0 2.25 2.25M19.5 12l2.25-2.25M19.5 12l-2.25 2.25m-10.5-6 4.72-4.72a.75.75 0 0 1 1.28.53v15.88a.75.75 0 0 1-1.28.53l-4.72-4.72H4.51c-.88 0-1.704-.507-1.938-1.354A9.009 9.009 0 0 1 2.25 12c0-.83.112-1.633.322-2.396C2.806 8.756 3.63 8.25 4.51 8.25H6.75Z" />
            </svg>
          )}
        </button>
      </span>
    </Tooltip>
  );
}
