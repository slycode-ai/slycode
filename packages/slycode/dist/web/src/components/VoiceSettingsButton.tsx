'use client';

import { useVoice } from '@/contexts/VoiceContext';

/**
 * Phone-only way into Voice Settings outside a card (#0376). Desktop opens
 * them from the floating voice widget, which a keyboard shortcut brings up;
 * phones have no shortcut, so without this the settings (and the voice
 * picker, design and clone) were only reachable inside an open card.
 * FloatingVoiceWidget shows them as a bottom sheet.
 */
export function VoiceSettingsButton({ className = '' }: { className?: string }) {
  const voice = useVoice();
  return (
    <button
      type="button"
      onClick={() => voice.setShowSettings(true)}
      aria-label="Voice settings"
      className={`flex min-h-11 min-w-11 items-center justify-center rounded-lg p-2 text-ink-3 transition-colors hover:bg-surface-3 hover:text-ink-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 sm:hidden ${className}`}
    >
      <svg aria-hidden="true" className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v3m-4 0h8m-4-7a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
      </svg>
    </button>
  );
}
