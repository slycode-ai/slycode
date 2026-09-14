/**
 * POST /sessions/:name/speak — spoken-reply orchestration (feature 086, spec Task 8).
 *
 * The bridge is the single admission authority: it checks the global speaker
 * flag, connected audio subscribers, length limits and rate budgets BEFORE any
 * paid render; then it asks the messaging service for an MP3 buffer, re-checks
 * the permission revision and subscriber count, and fans the clip out on the
 * app-wide audio stream.
 *
 * Spending boundary (stated honestly): OFF before dispatch = no render and the
 * exact "sound is off" refusal; OFF after dispatch = delivery cancelled but the
 * credit is already spent. The admission mutex is never held across the render
 * call, so OFF never waits on a render.
 *
 * Idempotency: a repeat requestId returns the recorded outcome and never
 * re-renders. A render failure is recorded and NEVER auto-retried.
 */
import { Router } from 'express';
import type { SessionManager } from './session-manager.js';
import { readVoiceLimits, type SpeakerAuthority } from './speaker.js';
import { type MessagingClient } from './messaging-client.js';
import { type ParsedSessionName } from './session-name.js';
interface LabelHints {
    cardNumber?: number | string;
    cardTitle?: string;
    projectName?: string;
}
/** Resolve card number/title and project display name for the bubble label. */
export declare function resolveLabelHints(parsed: ParsedSessionName, now?: number): LabelHints;
export interface SpeakDeps {
    speaker: Pick<SpeakerAuthority, 'admit' | 'deliver' | 'isRevisionCurrent' | 'subscriberCount' | 'recordOutcome' | 'getOutcome'> & Partial<Pick<SpeakerAuthority, 'rememberClip'>>;
    messaging: Pick<MessagingClient, 'render'>;
    /** Returns the registered (resolved) session name or null when unknown. */
    resolveSession: (name: string) => string | null;
    readLimits: () => ReturnType<typeof readVoiceLimits> | Awaited<ReturnType<typeof readVoiceLimits>>;
    labelHints?: (parsed: ParsedSessionName) => LabelHints;
    now?: () => number;
    /** Injectable for tests; defaults to a module-level map shared by all requests. */
    inFlight?: Map<string, InFlightEntry>;
}
export interface SpeakRequest {
    name: string;
    text: unknown;
    requestId?: unknown;
}
export interface SpeakResponse {
    status: number;
    body: Record<string, unknown>;
}
/** In-flight reservation: requestId → (session+payload fingerprint, shared promise). */
export interface InFlightEntry {
    fingerprint: string;
    promise: Promise<SpeakResponse>;
}
/** Short digest binding a requestId to its session + text so a reused id with a different payload is refused. */
export declare function requestFingerprint(sessionName: string, text: string): string;
/**
 * Idempotency wrapper. A requestId is reserved SYNCHRONOUSLY (before the first
 * await) and bound to session+text, so concurrent transport retries coalesce
 * onto one in-flight render/delivery instead of producing duplicate clips;
 * completed ids replay their recorded outcome; a reused id with a different
 * payload is refused.
 */
export declare function orchestrateSpeak(deps: SpeakDeps, req: SpeakRequest): Promise<SpeakResponse>;
export declare function createSpeakRouter(sessionManager: SessionManager): Router;
export {};
