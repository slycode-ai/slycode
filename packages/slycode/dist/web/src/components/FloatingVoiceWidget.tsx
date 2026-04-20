'use client';

import { useRef, useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { VoiceControlBar } from './VoiceControlBar';
import { VoiceSettingsPopover } from './VoiceSettingsPopover';
import { VoiceErrorPopup } from './VoiceErrorPopup';
import { useVoice } from '@/contexts/VoiceContext';

/**
 * Floating voice widget — shown when no modal claims voice control.
 * Renders via portal to document.body at fixed bottom-right position.
 */
export function FloatingVoiceWidget() {
  const voice = useVoice();
  const anchorRef = useRef<HTMLDivElement>(null);
  const settingsClosedAtRef = useRef(0);
  const [mounted, setMounted] = useState(false);

  useEffect(() => { setMounted(true); }, []);

  // Don't render if a modal has claimed voice control
  if (voice.currentClaimantId !== null) return null;
  if (!mounted) return null;

  const isActive = voice.voiceState !== 'idle' && voice.voiceState !== 'disabled';

  // Only show when actively recording/paused/transcribing — shortcuts trigger recording,
  // then the widget appears with timer and controls. Stays hidden when idle.
  if (!isActive && !voice.showSettings) return null;

  return createPortal(
    <div
      className="fixed bottom-4 right-4 z-50 animate-in fade-in slide-in-from-bottom-2 duration-200 rounded-xl border border-red-400/30 bg-white/95 px-3 py-2 shadow-(--shadow-card) backdrop-blur-sm dark:border-red-400/20 dark:bg-void-800/95"
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
      />

      {/* Settings popover */}
      {voice.showSettings && (
        <div style={{ position: 'fixed', bottom: 60, right: 16, zIndex: 9999 }}>
          <VoiceSettingsPopover
            settings={voice.settings.voice}
            onSave={(patch) => voice.updateSettings({ voice: patch })}
            onClose={() => { settingsClosedAtRef.current = Date.now(); voice.setShowSettings(false); }}
          />
        </div>
      )}

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
