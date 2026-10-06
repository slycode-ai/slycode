'use client';

import { useRef, useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { VoiceControlBar } from './VoiceControlBar';
import { VoiceSettingsPopover } from './VoiceSettingsPopover';
import { VoiceErrorPopup } from './VoiceErrorPopup';
import { SpeakerToggle } from './SpeakerToggle';
import { usePathname } from 'next/navigation';
import { useVoice } from '@/contexts/VoiceContext';
import { projectIdFromPath } from '@/lib/voice-picker-view';
import { VOICE_SHEET_QUERY } from '@/lib/visible-viewport';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { useVisibleViewport } from '@/hooks/useVisibleViewport';
import { VoiceSheet } from './VoiceSheet';

/**
 * Floating voice widget — shown when no modal claims voice control.
 * Renders via portal to document.body at fixed bottom-right position.
 */
export function FloatingVoiceWidget() {
  const voice = useVoice();
  const anchorRef = useRef<HTMLDivElement>(null);
  const settingsClosedAtRef = useRef(0);
  const [mounted, setMounted] = useState(false);
  // The project page in view, if any, so the voice picker opens on it.
  const projectId = projectIdFromPath(usePathname());
  // Phones get Voice Settings as a bottom sheet (#0376); desktop keeps the popover.
  const sheetLayout = useMediaQuery(VOICE_SHEET_QUERY);
  const view = useVisibleViewport();

  useEffect(() => { setMounted(true); }, []);

  // Don't render if a modal has claimed voice control
  if (voice.currentClaimantId !== null) return null;
  if (!mounted) return null;

  const isActive = voice.voiceState !== 'idle' && voice.voiceState !== 'disabled';

  // Only show when actively recording/paused/transcribing — shortcuts trigger recording,
  // then the widget appears with timer and controls. Stays hidden when idle.
  if (!isActive && !voice.showSettings) return null;

  const closeSettings = () => { settingsClosedAtRef.current = Date.now(); voice.setShowSettings(false); };
  const settingsPopover = (sheet: boolean) => (
    <VoiceSettingsPopover
      settings={voice.settings.voice}
      onSave={(patch) => voice.updateSettings({ voice: patch })}
      onClose={closeSettings}
      speaker={voice.speaker}
      saveError={voice.settingsSaveError}
      projectId={projectId}
      variant={sheet ? 'sheet' : 'popover'}
    />
  );

  // Opened from the phone voice button (VoiceSettingsButton) with nothing recording: just the sheet.
  if (sheetLayout && !isActive) {
    return <VoiceSheet variant="bottom" label="Voice Settings" onClose={closeSettings}>{settingsPopover(true)}</VoiceSheet>;
  }

  return createPortal(
    <div
      className="fixed bottom-4 right-4 z-50 animate-in fade-in slide-in-from-bottom-2 duration-200 rounded-xl border border-line border-l-[3px] border-l-danger bg-surface-1 px-3 py-2 shadow-(--shadow-overlay)"
      ref={anchorRef}
    >
      <VoiceControlBar
        voiceState={voice.voiceState}
        elapsedSeconds={voice.elapsedSeconds}
        disabled={false}
        error={voice.error}
        onRecord={voice.startRecording}
        onPause={voice.pauseRecording}
        onResume={voice.resumeRecording}
        onClear={voice.clearRecording}
        onSubmit={voice.submitRecording}
        onRetry={voice.retryTranscription}
        onOpenSettings={() => {
          if (Date.now() - settingsClosedAtRef.current < 200) return;
          voice.setShowSettings(!voice.showSettings);
        }}
        beforeSettings={<SpeakerToggle speaker={voice.speaker} />}
      />

      {/* Settings: a bottom sheet on phones; otherwise anchored to the bottom,
          capped to the visible room above it (#0369, #0376). */}
      {voice.showSettings && (sheetLayout ? (
        <VoiceSheet variant="bottom" label="Voice Settings" onClose={closeSettings}>{settingsPopover(true)}</VoiceSheet>
      ) : (
        <div style={{ position: 'fixed', bottom: 60, right: 16, zIndex: 9999, ['--voice-popover-max-h' as string]: view ? `${Math.max(0, view.top + view.height - 72)}px` : 'calc(100dvh - 72px)' }}>
          {settingsPopover(false)}
        </div>
      ))}

      {/* Error popup */}
      {voice.voiceState === 'error' && voice.error && (
        <div style={{ position: 'fixed', bottom: 60, right: 16, zIndex: 9999 }}>
          <VoiceErrorPopup
            error={voice.error}
            hasRecording={voice.hasRecording}
            onRetry={() => voice.retryTranscription()}
            onClear={() => voice.clearRecording()}
            onClose={() => voice.clearRecording()}
          />
        </div>
      )}
    </div>,
    document.body,
  );
}
