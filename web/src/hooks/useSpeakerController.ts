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
import { PlaybackGate, unlockAutoplay, planManualPlay, describePlayError, describeMediaError, computeProgress, base64ToArrayBuffer, PROGRESS_IDLE, type PlaybackProgress } from '@/lib/speaker-playback-gate';

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
  /** Why the last play attempt failed; shown in the bubble under the Play button. */
  playError: string | null;
  /** The clip on screen already finished and can be replayed (▶ Replay). */
  replayableClipId: string | null;
  /** Hairline progress from the audio element's own clock (fraction 1 once ended). */
  progress: PlaybackProgress;
  /** Increments on every clip event from the bridge stream (any card) and on speaker-state events; relayed to sibling tabs. */
  clipSeq: number;
  caption: RelayCaption | null;
  queueLength: number;
  /** "Play reply" — acquires playback in THIS tab and plays THAT clip, bypassing the autoplay gate. */
  playNow: () => void;
  /** Play a clip whose bytes the caller already has (card-header replay of a bridge-kept clip). */
  playClip: (clip: { clipId: string; revision?: number; text: string; sourceLabel?: string; mime?: string; dataBase64: string }) => void;
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
  const [playError, setPlayError] = useState<string | null>(null);
  const [replayableClipId, setReplayableClipId] = useState<string | null>(null);
  const [progress, setProgress] = useState<PlaybackProgress>(PROGRESS_IDLE);
  const progressRef = useRef<PlaybackProgress>(PROGRESS_IDLE);
  const [clipSeq, setClipSeq] = useState(0);
  const clipSeqRef = useRef(0);
  // Authoritative clip lengths from decodeAudioData, by clip id (bounded).
  const decodedDurationsRef = useRef<Map<string, number>>(new Map());
  const decodeInFlightRef = useRef<Map<string, Promise<number | null>>>(new Map());
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
  const playErrorRef = useRef<string | null>(null);
  // The most recently finished clip, kept (bytes included) so the bubble's
  // Replay can play it again without a second paid render.
  const lastPlayedRef = useRef<QueuedClip | null>(null);
  // A follower clicked Play: after claiming holdership, play the first matching
  // clip that arrives (handover / stream) immediately, gate bypassed.
  const pendingManualRef = useRef<{ clipId: string | null; at: number; timer: ReturnType<typeof setTimeout> | null } | null>(null);
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
      playError: playErrorRef.current,
      replayableClipId: lastPlayedRef.current?.clipId ?? null,
      progress: progressRef.current,
      clipSeq: clipSeqRef.current,
    };
    h.publishState(state);
  }, []);

  const setPlayingBoth = useCallback((v: boolean) => {
    playingRef.current = v;
    holderRef.current?.setPlaying(v);
    setPlaying(v);
  }, []);
  const setBlockedBoth = useCallback((v: boolean) => { blockedRef.current = v; setBlocked(v); }, []);
  const setPlayErrorBoth = useCallback((v: string | null) => { playErrorRef.current = v; setPlayError(v); }, []);
  // Delivery counter: the footer Replay control refetches the bridge's kept
  // clips on every bump, so it appears live without reopening the card.
  const bumpClipSeq = useCallback(() => {
    clipSeqRef.current += 1;
    setClipSeq(clipSeqRef.current);
  }, []);

  const setProgressBoth = useCallback((v: PlaybackProgress) => {
    const prev = progressRef.current;
    if (prev.fraction === v.fraction && prev.indeterminate === v.indeterminate && prev.complete === v.complete) return;
    progressRef.current = v;
    setProgress(v);
  }, []);

  // Decode once per clip for the exact length. The <audio> element's duration
  // for an MP3 without a Xing/Info header is a bitrate ESTIMATE and was seen
  // over-reporting (bar at ~40% when the audio was already over).
  const decodeDuration = useCallback((clip: QueuedClip): Promise<number | null> => {
    const cached = decodedDurationsRef.current.get(clip.clipId);
    if (cached !== undefined) return Promise.resolve(cached);
    const inflight = decodeInFlightRef.current.get(clip.clipId);
    if (inflight) return inflight;
    const p = (async () => {
      try {
        if (typeof window === 'undefined') return null;
        const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!Ctx) return null;
        if (!audioCtxRef.current) audioCtxRef.current = new Ctx();
        const buf = await audioCtxRef.current.decodeAudioData(base64ToArrayBuffer(clip.dataBase64));
        const secs = buf.duration;
        if (!Number.isFinite(secs) || secs <= 0) return null;
        decodedDurationsRef.current.set(clip.clipId, secs);
        while (decodedDurationsRef.current.size > 12) {
          const oldest = decodedDurationsRef.current.keys().next().value;
          if (oldest === undefined) break;
          decodedDurationsRef.current.delete(oldest);
        }
        return secs;
      } catch (err) {
        console.warn('[speaker] decodeAudioData failed for', clip.clipId, (err as Error)?.message);
        return null;
      } finally {
        decodeInFlightRef.current.delete(clip.clipId);
      }
    })();
    decodeInFlightRef.current.set(clip.clipId, p);
    return p;
  }, []);
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
    setProgressBoth(PROGRESS_IDLE);
  }, [setPlayingBoth, setProgressBoth]);

  const flushQueue = useCallback(() => {
    queueRef.current = [];
    syncQueueLength();
    if (gapTimerRef.current) { clearTimeout(gapTimerRef.current); gapTimerRef.current = null; }
  }, [syncQueueLength]);

  const playNextRef = useRef<() => void>(() => {});
  const startClipRef = useRef<(clip: QueuedClip, manual: boolean) => void>(() => {});

  // Load (if needed) and play one clip. `manual` = a deliberate user click:
  // any rejection is SHOWN (never a silent no-op) and the clip stays current
  // so the user can try again. Auto path: NotAllowedError → blocked (the Play
  // button is the remedy); any other failure is surfaced and the clip is
  // skipped so the queue keeps moving.
  const startClip = useCallback((clip: QueuedClip, manual: boolean) => {
    const el = getAudio();
    if (!el) { setPlayErrorBoth('Audio is not available in this environment.'); publish(); return; }
    const wanted = `data:${clip.mime || 'audio/mpeg'};base64,${clip.dataBase64}`;
    if (currentRef.current?.clipId !== clip.clipId || el.getAttribute('src') !== wanted) {
      currentRef.current = clip;
      el.src = wanted;
    }
    setCaptionBoth({ clipId: clip.clipId, text: clip.text, sourceLabel: clip.sourceLabel, at: Date.now() });
    // Progress: every handler below is bound to THIS clip id and ignores events
    // that arrive after another clip took over the element (replay, handover).
    // The authoritative length comes from decodeAudioData; the element's own
    // duration is only the fallback until the decode resolves.
    const clipId = clip.clipId;
    const isCurrent = () => currentRef.current?.clipId === clipId;
    let finished = false;
    const decodedNow = decodedDurationsRef.current.get(clipId) ?? null;
    setProgressBoth(computeProgress({ currentTime: 0, duration: el.duration, ended: false, decodedDuration: decodedNow }));
    let lastLogAt = 0;
    const finish = () => {
      if (finished) return;
      finished = true;
      setProgressBoth({ fraction: 1, indeterminate: false, complete: true });
      holderRef.current?.markSeen(clipId);
      if (isCurrent()) currentRef.current = null;
      lastPlayedRef.current = clip;
      setReplayableClipId(clipId);
      setPlayingBoth(false);
      setBlockedBoth(false);
      publish();
      gapTimerRef.current = setTimeout(() => {
        gapTimerRef.current = null;
        playNextRef.current();
      }, GAP_MS);
    };
    const tick = () => {
      if (!isCurrent() || finished) return;
      const decoded = decodedDurationsRef.current.get(clipId) ?? null;
      const p = computeProgress({ currentTime: el.currentTime, duration: el.duration, ended: el.ended, decodedDuration: decoded });
      setProgressBoth(p);
      publish();
      const now = Date.now();
      if (now - lastLogAt > 1000 || p.complete) {
        lastLogAt = now;
        console.debug(`[speaker] progress clip=${clipId} dur=${decoded === null ? 'n/a' : decoded.toFixed(2)}s elDur=${Number.isFinite(el.duration) ? el.duration.toFixed(2) : String(el.duration)}s t=${el.currentTime.toFixed(2)} fraction=${p.fraction === null ? 'n/a' : p.fraction.toFixed(3)}`);
      }
      // The clock reached the DECODED end but the element has not fired 'ended'
      // (its estimated duration runs longer than the audio): finish here.
      if (p.complete && !el.ended) {
        try { el.pause(); } catch { /* ignore */ }
        finish();
      }
    };
    el.onloadedmetadata = tick;
    el.ondurationchange = tick;
    el.ontimeupdate = tick;
    el.onended = () => {
      if (currentRef.current && !isCurrent()) return; // a later clip owns the element now
      finish();
    };
    void decodeDuration(clip).then((secs) => {
      if (secs !== null && isCurrent() && !finished) tick();
    });
    el.onerror = () => {
      if (!isCurrent() || finished) return;
      const me = el.error;
      const text = describeMediaError(me?.code, me?.message);
      console.warn('[speaker] audio element error', clip.clipId, me?.code, me?.message);
      holderRef.current?.markSeen(clip.clipId);
      currentRef.current = null;
      setPlayingBoth(false);
      setBlockedBoth(false);
      setPlayErrorBoth(text);
      publish();
      if (!manual) playNextRef.current();
    };
    el.play()
      .then(() => {
        setBlockedBoth(false);
        setPlayErrorBoth(null);
        setPlayingBoth(true);
        publish();
      })
      .catch((err: unknown) => {
        const d = describePlayError(err);
        console.warn('[speaker] play() rejected', clip.clipId, manual ? 'manual' : 'auto', (err as { name?: string })?.name, (err as { message?: string })?.message);
        setPlayingBoth(false);
        if (d.autoplayBlocked) {
          // Keep the clip current; the Play button (a user gesture) is the fix.
          setBlockedBoth(true);
          setPlayErrorBoth(manual ? d.text : null);
        } else if (manual) {
          // Show why; keep the clip so a retry is possible.
          setBlockedBoth(true);
          setPlayErrorBoth(d.text);
        } else {
          // Auto path, real failure: surface it and move on.
          holderRef.current?.markSeen(clip.clipId);
          currentRef.current = null;
          setBlockedBoth(false);
          setPlayErrorBoth(d.text);
          publish();
          playNextRef.current();
          return;
        }
        publish();
      });
  }, [decodeDuration, getAudio, publish, setBlockedBoth, setCaptionBoth, setPlayErrorBoth, setPlayingBoth, setProgressBoth]);
  startClipRef.current = startClip;

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
    startClipRef.current(clip, false);
  }, [syncQueueLength]);
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
    // A follower clicked Play and then became holder: the clip it wanted has
    // just arrived (handover or stream). Play it now, gate bypassed — the
    // click was consent and we are still inside the browser's activation window.
    const pm = pendingManualRef.current;
    if (pm && (pm.clipId === null || pm.clipId === clip.clipId) && Date.now() - pm.at < 10_000) {
      if (pm.timer) clearTimeout(pm.timer);
      pendingManualRef.current = null;
      const idx = queueRef.current.findIndex((c) => c.clipId === clip.clipId);
      if (idx >= 0) queueRef.current.splice(idx, 1);
      syncQueueLength();
      startClipRef.current(clip, true);
      return;
    }
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
      setPlayErrorBoth(null);
      setCaptionBoth(null);
    }
    // Relay ON as well as OFF so every open tab's toggle converges.
    publish();
    // A fresh snapshot may release clips that were waiting on the gate.
    if (!revoked) playNextRef.current();
  }, [flushQueue, publish, setAvailabilityBoth, setBlockedBoth, setCaptionBoth, setPlayErrorBoth, stopCurrent]);

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
      startClipRef.current(currentRef.current, false);
    } else {
      playNextRef.current();
    }
  }, [publish, setPlayingBoth]);

  // ---- commands (executed by the holder) ----
  const runCommand = useCallback((command: HolderCommand, clipId?: string) => {
    switch (command) {
      case 'play': {
        manualPlayRef.current(clipId ?? null);
        break;
      }
      case 'dismiss': {
        if (currentRef.current) {
          holderRef.current?.markSeen(currentRef.current.clipId);
          stopCurrent();
        }
        setBlockedBoth(false);
        setPlayErrorBoth(null);
        setProgressBoth(PROGRESS_IDLE);
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
  }, [publish, setBlockedBoth, setCaptionBoth, setPlayErrorBoth, setProgressBoth, stopCurrent]);

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
        bumpClipSeq();
        publish();
      },
      clip: (event: MessageEvent) => {
        // Count the delivery BEFORE gating/queueing: the bridge has already
        // remembered this clip, so listeners can refetch right away.
        bumpClipSeq();
        publish();
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
  }, [applySpeakerState, bumpClipSeq, closeStream, enqueue, publish]);

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
      onCommand: (command, clipId) => runCommand(command, clipId),
      onRecordingChange: (active) => applyRecording(active),
      onSyncRequest: () => publish(),
      onState: (state) => {
        enabledRef.current = state.enabled;
        revisionRef.current = state.revision;
        setEnabledState(state.enabled);
        setRevision(state.revision);
        setPlaying(state.playing);
        setBlocked(state.blocked);
        if (state.playError !== undefined) setPlayError(state.playError);
        if (state.replayableClipId !== undefined) setReplayableClipId(state.replayableClipId);
        if (typeof state.clipSeq === 'number' && state.clipSeq !== clipSeqRef.current) { clipSeqRef.current = state.clipSeq; setClipSeq(state.clipSeq); }
        if (state.progress) { const p = { fraction: state.progress.fraction, indeterminate: state.progress.indeterminate, complete: state.progress.complete ?? state.progress.fraction === 1 }; progressRef.current = p; setProgress(p); }
        setCaption(state.caption);
        setQueueLength(state.queueLength);
        if (state.availability) setAvailabilityBoth(state.availability);
      },
      getHandoverPayload: () => {
        const pending = currentRef.current && !playingRef.current ? [currentRef.current] : [];
        return { queue: [...pending, ...queueRef.current], lastPlayed: lastPlayedRef.current };
      },
      onHandoverPayload: (payload) => {
        // Accept the legacy array shape as well as { queue, lastPlayed }.
        const queue: QueuedClip[] = Array.isArray(payload)
          ? (payload as QueuedClip[])
          : Array.isArray((payload as { queue?: unknown })?.queue) ? (payload as { queue: QueuedClip[] }).queue : [];
        const last = !Array.isArray(payload) ? ((payload as { lastPlayed?: QueuedClip | null })?.lastPlayed ?? null) : null;
        if (last && !lastPlayedRef.current) {
          lastPlayedRef.current = last;
          setReplayableClipId(last.clipId);
        }
        for (const c of queue) enqueue({ ...c, receivedAt: Date.now() });
        // A follower clicked Replay, took over, and the finished clip has just
        // arrived with the handover: play it now (the click was consent).
        const pm = pendingManualRef.current;
        if (pm && last && pm.clipId === last.clipId && Date.now() - pm.at < 10_000) {
          if (pm.timer) clearTimeout(pm.timer);
          pendingManualRef.current = null;
          startClipRef.current(last, true);
        }
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
  // Deliberate Play: bypass the autoplay gate for THAT clip. Holder → play the
  // current/queued clip now. Follower → claim holdership; the clip arrives via
  // the old holder's handover (or the stream) and `enqueue` plays it at once.
  const manualPlayRef = useRef<(clipId: string | null) => void>(() => {});
  const manualPlay = useCallback((clipId: string | null) => {
    const plan = planManualPlay({
      isHolder: isHolderRef.current,
      current: currentRef.current,
      queue: queueRef.current,
      captionClipId: clipId ?? captionRef.current?.clipId ?? null,
      lastPlayed: lastPlayedRef.current,
    });
    switch (plan.action) {
      case 'play-current':
        startClipRef.current(currentRef.current!, true);
        return;
      case 'replay-last':
        if (gapTimerRef.current) { clearTimeout(gapTimerRef.current); gapTimerRef.current = null; }
        startClipRef.current(lastPlayedRef.current!, true);
        return;
      case 'play-queued': {
        const [clip] = queueRef.current.splice(plan.index, 1);
        syncQueueLength();
        if (gapTimerRef.current) { clearTimeout(gapTimerRef.current); gapTimerRef.current = null; }
        if (clip) startClipRef.current(clip, true);
        return;
      }
      case 'claim-and-wait':
        return; // handled by playNow (needs the holder instance)
      case 'nothing':
        setBlockedBoth(false);
        setPlayErrorBoth(plan.reason);
        publish();
        return;
    }
  }, [publish, setBlockedBoth, setPlayErrorBoth, syncQueueLength]);
  manualPlayRef.current = manualPlay;

  const playNow = useCallback(() => {
    unlockAudio();
    setPlayErrorBoth(null);
    const h = holderRef.current;
    if (!h) { setPlayErrorBoth('Audio player not ready yet. Try again.'); return; }
    const wantedClipId = captionRef.current?.clipId ?? caption?.clipId ?? null;
    if (h.isHolder) {
      manualPlay(wantedClipId);
      return;
    }
    // Follower: take over playback in THIS tab (the click is the user gesture),
    // then play the clip as soon as the old holder hands it over.
    const prev = pendingManualRef.current;
    if (prev?.timer) clearTimeout(prev.timer);
    const entry = { clipId: wantedClipId, at: Date.now(), timer: null as ReturnType<typeof setTimeout> | null };
    entry.timer = setTimeout(() => {
      if (pendingManualRef.current !== entry) return;
      pendingManualRef.current = null;
      // Nothing arrived: maybe the clip already played elsewhere or expired.
      const plan = planManualPlay({ isHolder: isHolderRef.current, current: currentRef.current, queue: queueRef.current, captionClipId: wantedClipId, lastPlayed: lastPlayedRef.current });
      if (plan.action === 'play-current' || plan.action === 'play-queued' || plan.action === 'replay-last') { manualPlayRef.current(wantedClipId); return; }
      setBlocked(false);
      setPlayErrorBoth('Could not take over that reply from the other tab. Click Play reply again.');
    }, 3000);
    pendingManualRef.current = entry;
    h.claimNow();
    // claimNow may have made us holder synchronously with a handover already
    // applied; if the clip is here, play it right away.
    if (isHolderRef.current) {
      const plan = planManualPlay({ isHolder: true, current: currentRef.current, queue: queueRef.current, captionClipId: wantedClipId, lastPlayed: lastPlayedRef.current });
      if (plan.action === 'play-current' || plan.action === 'play-queued' || plan.action === 'replay-last') {
        if (entry.timer) clearTimeout(entry.timer);
        pendingManualRef.current = null;
        manualPlay(wantedClipId);
      }
    }
  }, [caption, manualPlay, setPlayErrorBoth, unlockAudio]);
  const playClip = useCallback((c: { clipId: string; revision?: number; text: string; sourceLabel?: string; mime?: string; dataBase64: string }) => {
    unlockAudio();
    setPlayErrorBoth(null);
    const h = holderRef.current;
    if (!h) { setPlayErrorBoth('Audio player not ready yet. Try again.'); return; }
    // The bytes are local, so take over playback here and play at once — a
    // click is consent; the gate is for auto-play only.
    if (!h.isHolder) h.claimNow();
    if (gapTimerRef.current) { clearTimeout(gapTimerRef.current); gapTimerRef.current = null; }
    const clip: QueuedClip = {
      clipId: c.clipId,
      revision: c.revision ?? revisionRef.current,
      text: c.text,
      sourceLabel: c.sourceLabel ?? '',
      mime: c.mime || 'audio/mpeg',
      dataBase64: c.dataBase64,
      expiresAt: null,
      receivedAt: Date.now(),
    };
    startClipRef.current(clip, true);
  }, [setPlayErrorBoth, unlockAudio]);
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
    playing, blocked, playError, replayableClipId, progress, clipSeq, caption, queueLength,
    playNow, playClip, dismiss, pausePlayback, resumePlayback,
    notice, dismissNotice,
  }), [enabled, revision, subscribers, availability, available, toggleError, setEnabled, refresh, playing, blocked, playError, replayableClipId, progress, clipSeq, caption, queueLength, playNow, playClip, dismiss, pausePlayback, resumePlayback, notice, dismissNotice]);
}
