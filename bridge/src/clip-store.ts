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
import { parseSessionName } from './session-name.js';

export interface ClipStorePolicy {
  perSource: number;
  ttlMs: number;
  perSourceBytes: number;
  totalBytes: number;
}

export const DEFAULT_CLIP_POLICY: ClipStorePolicy = {
  perSource: parseInt(process.env.SPEAK_KEEP_PER_CARD || '3', 10),
  ttlMs: parseInt(process.env.SPEAK_KEEP_TTL_MS || String(24 * 60 * 60 * 1000), 10),
  perSourceBytes: 2 * 1024 * 1024,
  totalBytes: 50 * 1024 * 1024,
};

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
export function clipSourceKey(sessionName: string): string {
  const p = parseSessionName(sessionName);
  switch (p.kind) {
    case 'card': return `${p.projectKey}:card:${p.cardId}`;
    case 'atlas': return `${p.projectKey}:atlas`;
    case 'global':
    case 'action': return `${p.projectKey}:global`;
    default: return sessionName;
  }
}

export class ClipStore {
  private readonly bySource = new Map<string, StoredClip[]>();
  private readonly policy: ClipStorePolicy;
  private readonly now: () => number;

  constructor(policy: Partial<ClipStorePolicy> = {}, now: () => number = Date.now) {
    this.policy = { ...DEFAULT_CLIP_POLICY, ...policy };
    this.now = now;
  }

  remember(sourceKey: string, clip: ClipEvent): void {
    const list = (this.bySource.get(sourceKey) ?? []).filter((c) => c.clipId !== clip.clipId);
    list.push({ ...clip, at: this.now(), bytes: clip.dataBase64.length });
    this.bySource.set(sourceKey, list);
    this.enforce(sourceKey);
  }

  list(sourceKey: string): ClipSummary[] {
    this.expire(sourceKey);
    return (this.bySource.get(sourceKey) ?? [])
      .map(({ clipId, text, revision, source, at, bytes }) => ({ clipId, text, revision, source, at, bytes }))
      .sort((a, b) => b.at - a.at);
  }

  get(sourceKey: string, clipId: string): StoredClip | null {
    this.expire(sourceKey);
    return (this.bySource.get(sourceKey) ?? []).find((c) => c.clipId === clipId) ?? null;
  }

  latest(sourceKey: string): StoredClip | null {
    this.expire(sourceKey);
    const list = this.bySource.get(sourceKey) ?? [];
    return list.length ? list[list.length - 1] : null;
  }

  forget(sourceKey: string): number {
    const n = this.bySource.get(sourceKey)?.length ?? 0;
    this.bySource.delete(sourceKey);
    return n;
  }

  totalBytes(): number {
    let sum = 0;
    for (const list of this.bySource.values()) for (const c of list) sum += c.bytes;
    return sum;
  }

  sources(): string[] {
    return [...this.bySource.keys()];
  }

  private expire(sourceKey: string): void {
    const list = this.bySource.get(sourceKey);
    if (!list) return;
    const cutoff = this.now() - this.policy.ttlMs;
    const kept = list.filter((c) => c.at >= cutoff);
    if (kept.length === 0) this.bySource.delete(sourceKey);
    else if (kept.length !== list.length) this.bySource.set(sourceKey, kept);
  }

  private enforce(sourceKey: string): void {
    this.expire(sourceKey);
    const list = this.bySource.get(sourceKey);
    if (!list) return;
    // Per-source count and bytes: drop oldest first.
    while (list.length > this.policy.perSource) list.shift();
    while (list.length > 1 && list.reduce((s, c) => s + c.bytes, 0) > this.policy.perSourceBytes) list.shift();
    if (list.length === 0) this.bySource.delete(sourceKey);
    // Global bytes: evict the oldest clip across all sources until under cap.
    while (this.totalBytes() > this.policy.totalBytes) {
      let oldestKey: string | null = null;
      let oldestAt = Infinity;
      for (const [key, l] of this.bySource) {
        if (l.length && l[0].at < oldestAt) { oldestAt = l[0].at; oldestKey = key; }
      }
      if (!oldestKey) break;
      const l = this.bySource.get(oldestKey)!;
      l.shift();
      if (l.length === 0) this.bySource.delete(oldestKey);
    }
  }
}
