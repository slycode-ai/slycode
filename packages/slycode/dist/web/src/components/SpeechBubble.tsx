'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useVoice } from '@/contexts/VoiceContext';

const AUTO_HIDE_MS = 12_000;
const NOTICE_HIDE_MS = 9_000;

/**
 * SpeechBubble — the page-level caption for spoken replies (feature 086).
 *
 * Bottom-left of the screen, in every tab of the app. Shows who is speaking
 * and the words, a "Play reply" action when the browser blocked autoplay, the
 * queue depth, and an X that stops the current clip in this browser without
 * touching the global permission. The same bubble carries the one-line
 * "Sound is enabled" notice after the toggle is switched on.
 *
 * Deliberately quiet: one hairline that fills while the clip plays is the
 * only motion, and it answers a real event.
 */
export function SpeechBubble() {
  const voice = useVoice();
  const speaker = voice.speaker;
  const mode = voice.settings.voice.speechBubbleMode;
  const [mounted, setMounted] = useState(false);
  const [hiddenCaptionId, setHiddenCaptionId] = useState<string | null>(null);
  const [noticeHidden, setNoticeHidden] = useState<number | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => { setMounted(true); }, []);

  const caption = speaker.caption;
  const showCaption = !!caption && hiddenCaptionId !== caption.clipId;

  // Auto-hide: starts when playback for this caption ends (or when it arrives blocked
  // and stays blocked — the Play button must not vanish under the user).
  useEffect(() => {
    if (hideTimer.current) { clearTimeout(hideTimer.current); hideTimer.current = null; }
    if (!caption || mode !== 'auto-hide') return;
    if (speaker.playing || speaker.blocked) return;
    const id = caption.clipId;
    hideTimer.current = setTimeout(() => setHiddenCaptionId(id), AUTO_HIDE_MS);
    return () => { if (hideTimer.current) clearTimeout(hideTimer.current); };
  }, [caption, mode, speaker.playing, speaker.blocked]);

  // Notice auto-hides regardless of mode; it is confirmation, not content.
  const notice = speaker.notice;
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNoticeHidden(notice.id), NOTICE_HIDE_MS);
    return () => clearTimeout(t);
  }, [notice]);
  const showNotice = !!notice && noticeHidden !== notice.id;

  if (!mounted) return null;
  if (!showCaption && !showNotice) return null;

  return createPortal(
    <div className="pointer-events-none fixed bottom-4 left-4 z-[55] flex max-w-[min(360px,calc(100vw-2rem))] flex-col gap-2">
      {showNotice && notice && (
        <div
          role="status"
          className="pointer-events-auto flex items-start gap-3 rounded-lg border border-neon-blue-400/40 bg-void-50/95 px-3.5 py-2.5 text-sm text-void-700 shadow-(--shadow-card) backdrop-blur-sm dark:border-neon-blue-400/25 dark:bg-void-900/95 dark:text-void-200"
        >
          <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-[#2490b5] dark:bg-neon-blue-400" aria-hidden="true" />
          <p className="min-w-0 flex-1 leading-snug">{notice.text}</p>
          <button
            type="button"
            onClick={speaker.dismissNotice}
            className="-mr-1 -mt-0.5 rounded p-1 text-void-400 hover:bg-void-200/60 hover:text-void-700 dark:hover:bg-void-700/60 dark:hover:text-void-200"
            aria-label="Dismiss"
          >
            <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>
      )}

      {showCaption && caption && (
        <div
          role="status"
          aria-live="polite"
          className="pointer-events-auto relative rounded-lg border border-void-300/70 bg-void-50/95 px-3.5 pb-3 pt-2.5 text-void-800 shadow-(--shadow-card) backdrop-blur-sm dark:border-void-600 dark:bg-void-900/95 dark:text-void-100"
        >
          {/* Bubble tail — the one detail that says "speech", not "toast" */}
          <span
            aria-hidden="true"
            className="absolute -bottom-1.5 left-5 h-3 w-3 rotate-45 border-b border-r border-void-300/70 bg-void-50/95 dark:border-void-600 dark:bg-void-900/95"
          />

          <div className="flex items-start gap-2.5">
            <span
              aria-hidden="true"
              className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${speaker.playing ? 'bg-[#2490b5] motion-safe:animate-pulse dark:bg-neon-blue-400' : 'bg-void-400 dark:bg-void-500'}`}
            />
            <div className="min-w-0 flex-1">
              <div className="truncate font-mono text-[11px] leading-4 text-void-500 dark:text-void-400" title={caption.sourceLabel}>
                {caption.sourceLabel || 'Spoken reply'}
              </div>
              <p className="mt-0.5 text-sm leading-snug">{caption.text}</p>
              {(speaker.blocked || speaker.queueLength > 0) && (
                <div className="mt-2 flex items-center justify-between gap-3">
                  {speaker.blocked ? (
                    <button
                      type="button"
                      onClick={speaker.playNow}
                      className="inline-flex items-center gap-1.5 rounded-md border border-amber-400/40 bg-amber-400/10 px-2 py-1 text-xs font-medium text-amber-700 hover:bg-amber-400/20 dark:text-amber-300"
                    >
                      <svg className="h-3 w-3" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true"><polygon points="5,3 19,12 5,21" /></svg>
                      Play reply
                    </button>
                  ) : <span />}
                  {speaker.queueLength > 0 && (
                    <span className="text-xs tabular-nums text-void-500 dark:text-void-400">+{speaker.queueLength} queued</span>
                  )}
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={() => { setHiddenCaptionId(caption.clipId); speaker.dismiss(); }}
              className="-mr-1 -mt-0.5 rounded p-1 text-void-400 hover:bg-void-200/60 hover:text-void-700 dark:hover:bg-void-700/60 dark:hover:text-void-200"
              aria-label={speaker.playing ? 'Stop and dismiss' : 'Dismiss'}
              title={speaker.playing ? 'Stop this reply (sound stays allowed)' : 'Dismiss'}
            >
              <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
          </div>

          {/* Playing hairline */}
          {speaker.playing && (
            <span aria-hidden="true" className="absolute inset-x-3 bottom-1 h-px overflow-hidden rounded bg-void-300/60 dark:bg-void-700">
              <span className="speech-bubble-progress block h-full bg-[#2490b5] dark:bg-neon-blue-400" />
            </span>
          )}
        </div>
      )}
    </div>,
    document.body,
  );
}
