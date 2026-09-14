'use client';

/**
 * LastReplyControl — replay the last spoken reply for a terminal's card from
 * the terminal header (feature 086 follow-up, 2026-09-14).
 *
 * The bridge keeps the last few delivered clips per card (see
 * bridge/src/clip-store.ts), so this survives a page refresh. The control only
 * renders when a clip exists; hover shows the transcript through the shared
 * Tooltip; click fetches that clip's bytes and plays them in this tab through
 * the same consent path as the bubble's Play/Replay (gate bypassed).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import Tooltip from './Tooltip';
import { useVoice } from '@/contexts/VoiceContext';
import { clipListRefreshKey } from '@/lib/speaker-playback-gate';

interface ClipSummary {
  clipId: string;
  text: string;
  at: number;
  source?: { label?: string };
}

interface Props {
  bridgeUrl: string;
  sessionName: string;
}

export function LastReplyControl({ bridgeUrl, sessionName }: Props) {
  const { speaker } = useVoice();
  const [latest, setLatest] = useState<ClipSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const aliveRef = useRef(true);

  const refresh = useCallback(async (reason: string) => {
    try {
      const res = await fetch(`${bridgeUrl}/sessions/${encodeURIComponent(sessionName)}/clips`, { cache: 'no-store' });
      if (!res.ok) {
        // 404 here means the bridge is running code without the /clips route (restart needed).
        console.debug(`[speaker] clips HTTP ${res.status} for ${sessionName}`);
        return;
      }
      const data = (await res.json()) as { clips?: ClipSummary[] };
      if (!aliveRef.current) return;
      const count = data.clips?.length ?? 0;
      console.debug(`[speaker] clips ${count} (reason=${reason}) for ${sessionName}${count ? ` (latest ${data.clips![0].clipId.slice(0, 8)} "${data.clips![0].text.slice(0, 40)}")` : ' — memory-only store: a clip must be delivered after the bridge started'}`);
      setLatest(data.clips?.[0] ?? null);
    } catch (err) {
      console.debug(`[speaker] clips fetch failed for ${sessionName}: ${(err as Error)?.message}`);
    }
  }, [bridgeUrl, sessionName]);

  // On mount, then LIVE: every clip event on the bridge audio stream bumps
  // speaker.clipSeq (relayed to follower tabs), and permission / caption
  // changes are folded into the same key — one small GET each, no polling.
  useEffect(() => {
    aliveRef.current = true;
    void refresh('mount');
    return () => { aliveRef.current = false; };
  }, [refresh]);
  const refreshKey = clipListRefreshKey({
    clipSeq: speaker.clipSeq,
    revision: speaker.revision,
    enabled: speaker.enabled,
    replayableClipId: speaker.replayableClipId,
    captionClipId: speaker.caption?.clipId ?? null,
  });
  const lastKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (lastKeyRef.current === null) { lastKeyRef.current = refreshKey; return; } // mount already fetched
    if (lastKeyRef.current === refreshKey) return;
    lastKeyRef.current = refreshKey;
    void refresh(`delivery-or-state (clipSeq=${speaker.clipSeq})`);
  }, [refresh, refreshKey, speaker.clipSeq]);

  const play = useCallback(async () => {
    if (!latest || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${bridgeUrl}/sessions/${encodeURIComponent(sessionName)}/clips/${encodeURIComponent(latest.clipId)}`, { cache: 'no-store' });
      if (!res.ok) {
        setError(res.status === 404 ? 'That reply is no longer kept.' : `Could not load the reply (HTTP ${res.status}).`);
        if (res.status === 404) setLatest(null);
        return;
      }
      const clip = (await res.json()) as { clipId: string; revision?: number; text: string; mime?: string; dataBase64: string; source?: { label?: string } };
      speaker.playClip({ ...clip, sourceLabel: clip.source?.label ?? latest.source?.label ?? '' });
    } catch {
      setError('Could not reach the bridge.');
    } finally {
      if (aliveRef.current) setBusy(false);
    }
  }, [bridgeUrl, busy, latest, sessionName, speaker]);

  if (!latest) return null;

  const isPlayingThis = speaker.playing && speaker.caption?.clipId === latest.clipId;
  const tip = error
    ? error
    : `${isPlayingThis ? 'Playing' : 'Replay last reply'}\n“${latest.text}”`;

  return (
    <Tooltip content={tip} placement="bottom">
      <button
        type="button"
        onClick={play}
        disabled={busy}
        aria-label={isPlayingThis ? 'Playing the last spoken reply' : 'Replay the last spoken reply'}
        className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs font-medium transition-all disabled:opacity-50 ${
          isPlayingThis
            ? 'border-neon-blue-400/40 bg-neon-blue-400/15 text-neon-blue-400'
            : error
              ? 'border-amber-400/40 bg-amber-400/10 text-amber-400/90'
              : 'border-void-500/25 bg-void-700/50 text-void-400 hover:border-neon-blue-400/30 hover:bg-neon-blue-400/10 hover:text-neon-blue-400'
        }`}
      >
        <svg className={`h-3 w-3 ${isPlayingThis ? 'motion-safe:animate-pulse' : ''}`} fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <polygon points="5,3 19,12 5,21" />
        </svg>
        <span className="hidden sm:inline">Replay</span>
      </button>
    </Tooltip>
  );
}
