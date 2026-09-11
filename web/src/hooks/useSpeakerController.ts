'use client';

/**
 * useSpeakerController — the browser side of spoken replies (feature 086).
 *
 * Owns, for this tab:
 *  - the global speaker permission as last reported by the bridge
 *    (enabled / revision) and TTS availability (messaging running, key set);
 *  - the one-player-per-browser election (AudioHolder over BroadcastChannel);
 *  - when this tab is the holder: the app-wide audio SSE stream, the single
 *    <audio> element, a bounded FIFO with a 3 s gap between clips, autoplay
 *    fallback, and dictation pause (recording ownership is browser-wide and
 *    travels through the election, see AudioHolder.setRecording);
 *  - a PlaybackGate: after any handover nothing plays until the NEW stream's
 *    permission snapshot arrives with enabled=true and a matching revision;
 *  - when it is not: the holder's relayed state so the speech bubble and the
 *    toggle still reflect reality, and commands routed to the actual player.
 *
 * Mounted once inside VoiceProvider; consumers use useVoice().speaker.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { connectionManager } from '@/lib/connection-manager';
import {
  AudioHolder,
  createBroadcastHolderChannel,
  newTabId,
  type HolderCommand,
  type RelayCaption,
  type RelayState,
} from '@/lib/audio-holder';
import { PlaybackGate, unlockAutoplay } from '@/lib/speaker-playback-gate';

export interface SpeakerAvailability {
  /** null until the first probe answers */
  messagingRunning: boolean | null;
  tts: boolean | null;
  /** Human reason when spoken replies cannot work right now. */
  reason: string | null;
}

export interface SpeakerNotice {
  id: number;
  text: string;
}

export interface SpeakerController {
  /** null until the bridge has reported (render the toggle neutral). */
  enabled: boolean | null;
  revision: number;
  subscribers: number;
  availability: SpeakerAvailability;
  available: boolean;
  /** Last toggle failure, shown next to the control. */
  toggleError: string | null;
  setEnabled: (next: boolean) => Promise<void>;
  refresh: () => Promise<void>;
  playing: boolean;
  blocked: boolean;
  caption: RelayCaption | null;
  queueLength: number;
  /** "Play reply" — acquires playback in THIS tab and plays. */
  playNow: () => void;
  /** X on the bubble — stops/dismisses the current clip locally; never touches permission. */
  dismiss: () => void;
  pausePlayback: () => void;
  resumePlayback: () => void;
  notice: SpeakerNotice | null;
  dismissNotice: () => void;
}

interface QueuedClip {
  clipId: string;
  revision: number;
  text: string;
  sourceLabel: string;
  mime: string;
  dataBase64: string;
  expiresAt: number | null;
  receivedAt: number;
}

interface SpeakerStatePayload {
  enabled: boolean;
  revision: number;
  subscribers?: number;
  messaging?: { configured?: boolean; tts?: boolean | null };
}

const QUEUE_MAX = 5;
const QUEUE_TTL_MS = 90_000;
const GAP_MS = 3000;
const TOGGLE_ON_NOTICE = 'Sound is enabled. Ask each session you want spoken summaries from, including sessions already open.';

function availabilityReason(a: { messagingRunning: boolean | null; tts: boolean | null }): string | null {
  if (a.messagingRunning === false) return 'Spoken replies unavailable: messaging service is off';
  if (a.tts === false) return 'Spoken replies unavailable: ElevenLabs key not set';
  return null;
}

export function useSpeakerController(): SpeakerController {
  const [enabled, setEnabledState] = useState<boolean | null>(null);
  const [revision, setRevision] = useState(0);
  const [subscribers, setSubscribers] = useState(0);
  const [availability, setAvailability] = useState<SpeakerAvailability>({ messagingRunning: null, tts: null, reason: null });
  const [toggleError, setToggleError] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [caption, setCaption] = useState<RelayCaption | null>(null);
  const [queueLength, setQueueLength] = useState(0);
  const [notice, setNotice] = useState<SpeakerNotice | null>(null);

  const revisionRef = useRef(0);
  const enabledRef = useRef<boolean | null>(null);
  const holderRef = useRef<AudioHolder | null>(null);
  const isHolderRef = useRef(false);
  const connIdRef = useRef<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const queueRef = useRef<QueuedClip[]>([]);
  const currentRef = useRef<QueuedClip | null>(null);
  const gapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const gateRef = useRef<PlaybackGate>(new PlaybackGate());
  const playingRef = useRef(false);
  const blockedRef = useRef(false);
  const captionRef = useRef<RelayCaption | null>(null);
  const availabilityRef = useRef<SpeakerAvailability>({ messagingRunning: null, tts: null, reason: null });
  const noticeSeq = useRef(0);

  const setAvailabilityBoth = useCallback((next: { messagingRunning: boolean | null; tts: boolean | null }) => {
    const value = { ...next, reason: availabilityReason(next) };
    availabilityRef.current = value;
    setAvailability(value);
  }, []);

  // ---- relay state to sibling tabs (holder only) ----
  const publish = useCallback(() => {
    const h = holderRef.current;
    if (!h || !isHolderRef.current) return;
    const state: RelayState = {
      enabled: enabledRef.current,
      revision: revisionRef.current,
      playing: playingRef.current,
      blocked: blockedRef.current,
      caption: captionRef.current,
      queueLength: queueRef.current.length,
      availability: { messagingRunning: availabilityRef.current.messagingRunning, tts: availabilityRef.current.tts },
    };
    h.publishState(state);
  }, []);

  const setPlayingBoth = useCallback((v: boolean) => {
    playingRef.current = v;
    holderRef.current?.setPlaying(v);
    setPlaying(v);
  }, []);
  const setBlockedBoth = useCallback((v: boolean) => { blockedRef.current = v; setBlocked(v); }, []);
  const setCaptionBoth = useCallback((c: RelayCaption | null) => { captionRef.current = c; setCaption(c); }, []);
  const syncQueueLength = useCallback(() => setQueueLength(queueRef.current.length), []);

  // ---- audio element + autoplay unlock ----
  const getAudio = useCallback((): HTMLAudioElement | null => {
    if (typeof window === 'undefined') return null;
    if (!audioRef.current) {
      const el = document.createElement('audio');
      el.preload = 'auto';
      el.setAttribute('data-slycode-speaker', '');
      audioRef.current = el;
    }
    return audioRef.current;
  }, []);

  // Autoplay unlock runs inside the user gesture on a THROWAWAY element plus
  // the AudioContext. It never touches the playback element, so it can never
  // pause a clip that Play-reply (or the queue) just started.
  const unlockAudio = useCallback(() => {
    if (typeof window === 'undefined') return;
    let ctx: AudioContext | null = null;
    try {
      const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (Ctx) {
        if (!audioCtxRef.current) audioCtxRef.current = new Ctx();
        ctx = audioCtxRef.current;
      }
    } catch { ctx = null; }
    unlockAutoplay({
      makeAudio: () => document.createElement('audio'),
      audioContext: ctx,
    });
  }, []);

  // ---- player loop (holder only) ----
  const stopCurrent = useCallback(() => {
    const el = audioRef.current;
    if (el) {
      try { el.pause(); } catch { /* ignore */ }
      el.removeAttribute('src');
      try { el.load(); } catch { /* ignore */ }
    }
    currentRef.current = null;
    setPlayingBoth(false);
  }, [setPlayingBoth]);

  const flushQueue = useCallback(() => {
    queueRef.current = [];
    syncQueueLength();
    if (gapTimerRef.current) { clearTimeout(gapTimerRef.current); gapTimerRef.current = null; }
  }, [syncQueueLength]);

  const playNextRef = useRef<() => void>(() => {});
  const playNext = useCallback(() => {
    if (!isHolderRef.current) return;
    if (playingRef.current || currentRef.current || gapTimerRef.current) return;
    // Drop expired / revoked entries at the head; WAIT (keep queued) until the
    // gate has a fresh enabled snapshot with a matching revision and nobody
    // in this browser is dictating.
    const now = Date.now();
    const gate = gateRef.current;
    while (queueRef.current.length > 0) {
      const head = queueRef.current[0];
      const expired = (head.expiresAt !== null && head.expiresAt < now) || now - head.receivedAt > QUEUE_TTL_MS;
      if (expired || gate.decide(head) === 'drop') { queueRef.current.shift(); continue; }
      break;
    }
    syncQueueLength();
    if (queueRef.current.length > 0 && gate.decide(queueRef.current[0]) !== 'play') return;
    const clip = queueRef.current.shift();
    syncQueueLength();
    if (!clip) return;
    const el = getAudio();
    if (!el) return;
    currentRef.current = clip;
    setCaptionBoth({ clipId: clip.clipId, text: clip.text, sourceLabel: clip.sourceLabel, at: Date.now() });
    el.src = `data:${clip.mime || 'audio/mpeg'};base64,${clip.dataBase64}`;
    el.onended = () => {
      holderRef.current?.markSeen(clip.clipId);
      currentRef.current = null;
      setPlayingBoth(false);
      publish();
      gapTimerRef.current = setTimeout(() => {
        gapTimerRef.current = null;
        playNextRef.current();
      }, GAP_MS);
    };
    el.onerror = () => {
      holderRef.current?.markSeen(clip.clipId);
      currentRef.current = null;
      setPlayingBoth(false);
      publish();
      playNextRef.current();
    };
    el.play()
      .then(() => {
        setBlockedBoth(false);
        setPlayingBoth(true);
        publish();
      })
      .catch(() => {
        // Autoplay blocked: keep the clip current, show "Play reply".
        setBlockedBoth(true);
        setPlayingBoth(false);
        publish();
      });
  }, [getAudio, publish, setBlockedBoth, setCaptionBoth, setPlayingBoth, syncQueueLength]);
  playNextRef.current = playNext;

  const enqueue = useCallback((clip: QueuedClip) => {
    if (!isHolderRef.current) return;
    if (gateRef.current.decide(clip) === 'drop') return; // revoked before it arrived
    if (holderRef.current?.hasSeen(clip.clipId)) return;
    if (queueRef.current.some((c) => c.clipId === clip.clipId) || currentRef.current?.clipId === clip.clipId) return;
    queueRef.current.push(clip);
    while (queueRef.current.length > QUEUE_MAX) queueRef.current.shift();
    syncQueueLength();
    publish();
    playNext();
  }, [playNext, publish, syncQueueLength]);

  // Bridge-sourced state only (stream event or bridge HTTP response) — never
  // relayed state. Every accepted transition is republished to sibling tabs.
  const applySpeakerState = useCallback((payload: SpeakerStatePayload) => {
    const revoked = payload.enabled === false || payload.revision > revisionRef.current;
    revisionRef.current = payload.revision;
    enabledRef.current = payload.enabled;
    setRevision(payload.revision);
    setEnabledState(payload.enabled);
    gateRef.current.applySnapshot({ enabled: payload.enabled, revision: payload.revision });
    if (typeof payload.subscribers === 'number') setSubscribers(payload.subscribers);
    if (payload.messaging) {
      const prev = availabilityRef.current;
      setAvailabilityBoth({
        messagingRunning: payload.messaging.configured === false ? false : prev.messagingRunning,
        tts: typeof payload.messaging.tts === 'boolean' ? payload.messaging.tts : prev.tts,
      });
    }
    if (revoked && isHolderRef.current) {
      // OFF (or any newer revision) is literal: nothing queued survives it.
      if (currentRef.current) stopCurrent();
      flushQueue();
      setBlockedBoth(false);
      setCaptionBoth(null);
    }
    // Relay ON as well as OFF so every open tab's toggle converges.
    publish();
    // A fresh snapshot may release clips that were waiting on the gate.
    if (!revoked) playNextRef.current();
  }, [flushQueue, publish, setAvailabilityBoth, setBlockedBoth, setCaptionBoth, stopCurrent]);

  // ---- dictation pause: browser-wide recording ownership ----
  // Called from AudioHolder.onRecordingChange with the AGGREGATE (this tab or
  // any live peer). Only the holder touches the player; the gate blocks
  // playNext for as long as anyone records, across handovers too.
  const applyRecording = useCallback((active: boolean) => {
    gateRef.current.setRecording(active);
    if (!isHolderRef.current) return;
    const el = audioRef.current;
    if (active) {
      if (el && playingRef.current) { try { el.pause(); } catch { /* ignore */ } setPlayingBoth(false); publish(); }
      return;
    }
    if (el && currentRef.current && !blockedRef.current) {
      el.play().then(() => { setPlayingBoth(true); publish(); }).catch(() => { setBlockedBoth(true); publish(); });
    } else {
      playNextRef.current();
    }
  }, [publish, setBlockedBoth, setPlayingBoth]);

  // ---- commands (executed by the holder) ----
  const runCommand = useCallback((command: HolderCommand) => {
    const el = audioRef.current;
    switch (command) {
      case 'play': {
        if (currentRef.current && el) {
          el.play().then(() => { setBlockedBoth(false); setPlayingBoth(true); publish(); }).catch(() => { setBlockedBoth(true); publish(); });
        } else {
          playNext();
        }
        break;
      }
      case 'dismiss': {
        if (currentRef.current) {
          holderRef.current?.markSeen(currentRef.current.clipId);
          stopCurrent();
        }
        setBlockedBoth(false);
        setCaptionBoth(null);
        publish();
        // Move on after the usual gap so a queued clip still plays.
        if (!gapTimerRef.current) {
          gapTimerRef.current = setTimeout(() => { gapTimerRef.current = null; playNextRef.current(); }, GAP_MS);
        }
        break;
      }
      case 'pause':
      case 'resume': {
        // Legacy relayed commands: treat as the sender's recording flag. The
        // aggregate flows back through AudioHolder.onRecordingChange.
        holderRef.current?.setRecording(command === 'pause');
        break;
      }
    }
  }, [playNext, publish, setBlockedBoth, setCaptionBoth, setPlayingBoth, stopCurrent]);

  // ---- stream (holder only) ----
  const closeStream = useCallback(() => {
    if (connIdRef.current) {
      connectionManager.closeConnection(connIdRef.current);
      connIdRef.current = null;
    }
  }, []);

  const openStream = useCallback(() => {
    closeStream();
    connIdRef.current = connectionManager.createManagedEventSource('/api/bridge/audio/stream', {
      'speaker-state': (event: MessageEvent) => {
        try { applySpeakerState(JSON.parse(event.data) as SpeakerStatePayload); } catch { /* malformed */ }
      },
      clip: (event: MessageEvent) => {
        try {
          const d = JSON.parse(event.data) as {
            clipId: string; revision: number; text: string; mime?: string; dataBase64: string; expiresAt?: number | string | null;
            source?: { label?: string };
          };
          const expiresAt = typeof d.expiresAt === 'number' ? d.expiresAt : typeof d.expiresAt === 'string' ? Date.parse(d.expiresAt) || null : null;
          enqueue({
            clipId: d.clipId,
            revision: d.revision,
            text: d.text ?? '',
            sourceLabel: d.source?.label ?? '',
            mime: d.mime || 'audio/mpeg',
            dataBase64: d.dataBase64,
            expiresAt,
            receivedAt: Date.now(),
          });
        } catch { /* malformed */ }
      },
    });
  }, [applySpeakerState, closeStream, enqueue]);

  // ---- election lifecycle ----
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const holder = new AudioHolder({
      tabId: newTabId(),
      channel: createBroadcastHolderChannel(),
      isVisible: () => document.visibilityState === 'visible',
      onBecomeHolder: () => {
        isHolderRef.current = true;
        // Nothing relayed/queued may play until THIS stream's snapshot lands.
        gateRef.current.invalidate();
        gateRef.current.setRecording(holder.isAnyRecording());
        openStream();
      },
      onLoseHolder: () => {
        isHolderRef.current = false;
        closeStream();
        stopCurrent();
        flushQueue();
        // Keep the caption; the new holder will relay fresh state shortly.
      },
      onCommand: (command) => runCommand(command),
      onRecordingChange: (active) => applyRecording(active),
      onSyncRequest: () => publish(),
      onState: (state) => {
        enabledRef.current = state.enabled;
        revisionRef.current = state.revision;
        setEnabledState(state.enabled);
        setRevision(state.revision);
        setPlaying(state.playing);
        setBlocked(state.blocked);
        setCaption(state.caption);
        setQueueLength(state.queueLength);
        if (state.availability) setAvailabilityBoth(state.availability);
      },
      getHandoverPayload: () => {
        const pending = currentRef.current && !playingRef.current ? [currentRef.current] : [];
        return [...pending, ...queueRef.current];
      },
      onHandoverPayload: (payload) => {
        if (!Array.isArray(payload)) return;
        for (const c of payload as QueuedClip[]) enqueue({ ...c, receivedAt: Date.now() });
      },
    });
    holderRef.current = holder;
    holder.start();
    const beat = setInterval(() => holder.tick(), holder.heartbeatMs);
    const onVis = () => holder.visibilityChanged();
    const onUnload = () => holder.stop();
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('pagehide', onUnload);
    return () => {
      clearInterval(beat);
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('pagehide', onUnload);
      holder.stop();
      holderRef.current = null;
      closeStream();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- bridge + messaging probes (no polling; callers invoke on mount / toggle) ----
  const refresh = useCallback(async () => {
    const [speakerRes, healthRes] = await Promise.allSettled([
      fetch('/api/bridge/speaker', { cache: 'no-store' }),
      fetch('/api/messaging/health', { cache: 'no-store' }),
    ]);
    let messagingRunning: boolean | null = null;
    let tts: boolean | null = null;
    if (healthRes.status === 'fulfilled' && healthRes.value.ok) {
      try {
        const h = (await healthRes.value.json()) as { running?: boolean; tts?: boolean | null };
        messagingRunning = typeof h.running === 'boolean' ? h.running : null;
        tts = typeof h.tts === 'boolean' ? h.tts : null;
      } catch { /* ignore */ }
    }
    if (speakerRes.status === 'fulfilled' && speakerRes.value.ok) {
      try {
        const s = (await speakerRes.value.json()) as SpeakerStatePayload;
        if (typeof s.enabled === 'boolean') {
          enabledRef.current = s.enabled;
          revisionRef.current = Math.max(revisionRef.current, s.revision ?? 0);
          setEnabledState(s.enabled);
          setRevision(revisionRef.current);
          gateRef.current.applySnapshot({ enabled: s.enabled, revision: revisionRef.current });
          if (typeof s.subscribers === 'number') setSubscribers(s.subscribers);
          if (s.messaging && typeof s.messaging.tts === 'boolean' && tts === null) tts = s.messaging.tts;
          if (s.messaging && s.messaging.configured === false) messagingRunning = false;
        }
      } catch { /* ignore */ }
    }
    setAvailabilityBoth({ messagingRunning, tts });
    // Availability is part of the relayed state too (holder only; no-op otherwise).
    publish();
    if (isHolderRef.current) playNextRef.current();
  }, [publish, setAvailabilityBoth]);

  useEffect(() => { void refresh(); }, [refresh]);

  const setEnabled = useCallback(async (next: boolean) => {
    if (next) unlockAudio();
    const prev = enabledRef.current;
    enabledRef.current = next;
    setEnabledState(next);
    setToggleError(null);
    try {
      const res = await fetch('/api/bridge/speaker', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: next }),
      });
      if (!res.ok) {
        let reason = `HTTP ${res.status}`;
        try { reason = (await res.json())?.error || reason; } catch { /* ignore */ }
        throw new Error(reason);
      }
      const s = (await res.json()) as SpeakerStatePayload;
      applySpeakerState(s);
      if (next) setNotice({ id: ++noticeSeq.current, text: TOGGLE_ON_NOTICE });
      void refresh();
    } catch (err) {
      enabledRef.current = prev;
      setEnabledState(prev);
      setToggleError(`Speaker not changed: ${err instanceof Error ? err.message : 'bridge unavailable'}`);
    }
  }, [applySpeakerState, refresh, unlockAudio]);

  // ---- user actions from any tab ----
  const playNow = useCallback(() => {
    unlockAudio();
    const h = holderRef.current;
    if (!h) return;
    if (!h.isHolder) h.claimNow();
    // After claimNow this tab is holder (or already was); the play command runs locally.
    h.sendCommand('play');
  }, [unlockAudio]);
  const dismiss = useCallback(() => { holderRef.current?.sendCommand('dismiss'); if (!isHolderRef.current) setCaption(null); }, []);
  // Dictation in THIS tab: announce recording ownership browser-wide; the
  // holder (now or after any handover) pauses until we announce the end.
  const pausePlayback = useCallback(() => { holderRef.current?.setRecording(true); }, []);
  const resumePlayback = useCallback(() => { holderRef.current?.setRecording(false); }, []);
  const dismissNotice = useCallback(() => setNotice(null), []);

  const available = availability.reason === null;

  return useMemo<SpeakerController>(() => ({
    enabled, revision, subscribers, availability, available, toggleError,
    setEnabled, refresh,
    playing, blocked, caption, queueLength,
    playNow, dismiss, pausePlayback, resumePlayback,
    notice, dismissNotice,
  }), [enabled, revision, subscribers, availability, available, toggleError, setEnabled, refresh, playing, blocked, caption, queueLength, playNow, dismiss, pausePlayback, resumePlayback, notice, dismissNotice]);
}
