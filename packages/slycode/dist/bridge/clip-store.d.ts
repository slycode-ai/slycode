/**
 * Recent spoken clips per source (feature 086 follow-up, 2026-09-14).
 *
 * A played clip used to live only in one browser tab's memory, so a refresh
 * lost it. The bridge already fans clips out; it now also remembers the last
 * few per card so the card header's "replay last reply" control can fetch
 * them after a refresh.
 *
 * Retention rule: the last 3 clips per source (card, or a project's global /
 * atlas terminal), for 24 h, capped at 2 MB per source and 50 MB overall,
 * in bridge memory only — cleared when the source's session is deleted
 * (dismissed) and on bridge restart. Pure and clock-injectable for tests.
 */
import type { ClipEvent } from './speaker.js';
export interface ClipStorePolicy {
    perSource: number;
    ttlMs: number;
    perSourceBytes: number;
    totalBytes: number;
}
export declare const DEFAULT_CLIP_POLICY: ClipStorePolicy;
export interface StoredClip extends ClipEvent {
    /** ms epoch when the clip was delivered. */
    at: number;
    /** Encoded size (base64 length) used for the byte caps. */
    bytes: number;
}
export interface ClipSummary {
    clipId: string;
    text: string;
    revision: number;
    source: ClipEvent['source'];
    at: number;
    bytes: number;
}
/** Provider-less source key: every provider tab of a card shares its recent clips. */
export declare function clipSourceKey(sessionName: string): string;
export declare class ClipStore {
    private readonly bySource;
    private readonly policy;
    private readonly now;
    constructor(policy?: Partial<ClipStorePolicy>, now?: () => number);
    remember(sourceKey: string, clip: ClipEvent): void;
    list(sourceKey: string): ClipSummary[];
    get(sourceKey: string, clipId: string): StoredClip | null;
    latest(sourceKey: string): StoredClip | null;
    forget(sourceKey: string): number;
    totalBytes(): number;
    sources(): string[];
    private expire;
    private enforce;
}
