import type { Response } from 'express';
import { ClipStore, type ClipSummary, type StoredClip } from './clip-store.js';
import { type SpeechLimits } from './speech-limits.js';
import type { SessionKind } from './session-name.js';
export interface SpeakerPrefs {
    enabled: boolean;
    revision: number;
}
export type SpeakRefusalCode = 'speaker_off' | 'no_listener' | 'too_long' | 'empty' | 'rate_limited' | 'tts_unavailable' | 'no_session';
export interface AdmitInput {
    /** Registered session name (for logging / labelling). */
    sourceName: string;
    /** Provider-less rate bucket key (session-name.ts canonicalRateKey). */
    canonicalKey: string;
    text: string;
    /** null = settings unreadable → refuse; caller resolves via readVoiceLimits(). */
    limits: SpeechLimits | null;
    now?: number;
    requestId?: string;
}
export type AdmitResult = {
    ok: true;
    clipId: string;
    revision: number;
    words: number;
    chars: number;
} | {
    ok: false;
    code: SpeakRefusalCode;
    message: string;
    status: number;
};
export interface ClipSource {
    label: string;
    projectId: string;
    cardId?: string;
    sessionName: string;
    kind: SessionKind;
}
export interface ClipEvent {
    clipId: string;
    revision: number;
    source: ClipSource;
    text: string;
    mime: 'audio/mpeg';
    dataBase64: string;
    expiresAt: string;
}
export interface SpeakOutcome {
    at: number;
    status: number;
    body: Record<string, unknown>;
}
export interface SpeakerAuthorityOptions {
    prefsPath?: string;
    perSourceLimit?: number;
    globalLimit?: number;
    windowMs?: number;
    outcomeMaxEntries?: number;
    outcomeTtlMs?: number;
    heartbeatMs?: number;
    /** Byte budget per subscriber socket before a clip is dropped for it. */
    maxWritableLength?: number;
    now?: () => number;
}
export declare const REFUSALS: Record<SpeakRefusalCode, {
    status: number;
    message: (ctx?: Record<string, unknown>) => string;
}>;
export declare function refusal(code: SpeakRefusalCode, ctx?: Record<string, unknown>): AdmitResult;
export declare function speakerPrefsPath(): string;
/**
 * Read the word limit the gear popover persists in data/settings.json.
 * Missing file → defaults. Unreadable/invalid JSON → null (admission refuses
 * with tts_unavailable rather than substituting a larger default).
 */
export declare function readVoiceLimits(settingsPath?: string): Promise<SpeechLimits | null>;
export interface RateBucketState {
    perSource: Map<string, number[]>;
    global: number[];
}
export interface AdmissionState {
    enabled: boolean;
    revision: number;
    subscribers: number;
    buckets: RateBucketState;
}
export interface AdmissionPolicy {
    perSourceLimit: number;
    globalLimit: number;
    windowMs: number;
}
/**
 * Decide admission. Mutates `state.buckets` ONLY on success (a refused
 * request never consumes budget). Order: off → listener → limits readable →
 * empty → length → budget.
 */
export declare function decideAdmission(state: AdmissionState, policy: AdmissionPolicy, input: AdmitInput): AdmitResult;
export declare class SpeakerAuthority {
    private prefs;
    private readonly prefsPath;
    private readonly policy;
    private readonly buckets;
    private readonly subscribers;
    private readonly subscriberSet;
    private readonly outcomes;
    /** Recent delivered clips per source so the card header can replay after a refresh. */
    readonly clips: ClipStore;
    private readonly outcomeMaxEntries;
    private readonly outcomeTtlMs;
    private readonly heartbeatMs;
    private readonly maxWritableLength;
    private readonly now;
    private chain;
    private heartbeatTimer;
    private skippedOnce;
    private initialised;
    constructor(opts?: SpeakerAuthorityOptions);
    init(): Promise<void>;
    stop(): void;
    getState(): SpeakerPrefs & {
        subscribers: number;
    };
    isRevisionCurrent(revision: number): boolean;
    /**
     * Idempotent. OFF bumps the revision (invalidating every admitted or
     * queued clip), persists BEFORE resolving, then broadcasts. ON persists and
     * broadcasts without a bump. Serialised so concurrent toggles converge.
     */
    setEnabled(enabled: boolean): Promise<SpeakerPrefs & {
        subscribers: number;
    }>;
    private persist;
    addSubscriber(res: Response, id?: `${string}-${string}-${string}-${string}-${string}`): string;
    removeSubscriber(id: string): void;
    subscriberCount(): number;
    /** Initial snapshot for a freshly connected stream client. */
    stateEvent(): {
        enabled: boolean;
        revision: number;
    };
    private broadcastState;
    private heartbeat;
    private reconcileSubscribers;
    /**
     * Deliver a rendered clip to every subscriber (byte-budgeted). Returns the
     * number of clients written to, or -1 if the clip's revision is stale
     * (permission was revoked after admission — nothing is sent).
     */
    deliver(clip: ClipEvent): number;
    rememberClip(sessionName: string, clip: ClipEvent): void;
    listClips(sessionName: string): ClipSummary[];
    getClip(sessionName: string, clipId: string): StoredClip | null;
    forgetClips(sessionName: string): number;
    admit(input: AdmitInput): AdmitResult;
    recordOutcome(requestId: string, status: number, body: Record<string, unknown>): void;
    getOutcome(requestId: string): SpeakOutcome | null;
    private pruneOutcomes;
}
export declare function getSpeakerAuthority(): SpeakerAuthority;
/** Test seam: replace the process-wide authority. */
export declare function setSpeakerAuthority(authority: SpeakerAuthority | null): void;
