import { parseSessionName } from './session-name.js';
export const DEFAULT_CLIP_POLICY = {
    perSource: parseInt(process.env.SPEAK_KEEP_PER_CARD || '3', 10),
    ttlMs: parseInt(process.env.SPEAK_KEEP_TTL_MS || String(24 * 60 * 60 * 1000), 10),
    perSourceBytes: 2 * 1024 * 1024,
    totalBytes: 50 * 1024 * 1024,
};
/** Provider-less source key: every provider tab of a card shares its recent clips. */
export function clipSourceKey(sessionName) {
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
    bySource = new Map();
    policy;
    now;
    constructor(policy = {}, now = Date.now) {
        this.policy = { ...DEFAULT_CLIP_POLICY, ...policy };
        this.now = now;
    }
    remember(sourceKey, clip) {
        const list = (this.bySource.get(sourceKey) ?? []).filter((c) => c.clipId !== clip.clipId);
        list.push({ ...clip, at: this.now(), bytes: clip.dataBase64.length });
        this.bySource.set(sourceKey, list);
        this.enforce(sourceKey);
    }
    list(sourceKey) {
        this.expire(sourceKey);
        return (this.bySource.get(sourceKey) ?? [])
            .map(({ clipId, text, revision, source, at, bytes }) => ({ clipId, text, revision, source, at, bytes }))
            .sort((a, b) => b.at - a.at);
    }
    get(sourceKey, clipId) {
        this.expire(sourceKey);
        return (this.bySource.get(sourceKey) ?? []).find((c) => c.clipId === clipId) ?? null;
    }
    latest(sourceKey) {
        this.expire(sourceKey);
        const list = this.bySource.get(sourceKey) ?? [];
        return list.length ? list[list.length - 1] : null;
    }
    forget(sourceKey) {
        const n = this.bySource.get(sourceKey)?.length ?? 0;
        this.bySource.delete(sourceKey);
        return n;
    }
    totalBytes() {
        let sum = 0;
        for (const list of this.bySource.values())
            for (const c of list)
                sum += c.bytes;
        return sum;
    }
    sources() {
        return [...this.bySource.keys()];
    }
    expire(sourceKey) {
        const list = this.bySource.get(sourceKey);
        if (!list)
            return;
        const cutoff = this.now() - this.policy.ttlMs;
        const kept = list.filter((c) => c.at >= cutoff);
        if (kept.length === 0)
            this.bySource.delete(sourceKey);
        else if (kept.length !== list.length)
            this.bySource.set(sourceKey, kept);
    }
    enforce(sourceKey) {
        this.expire(sourceKey);
        const list = this.bySource.get(sourceKey);
        if (!list)
            return;
        // Per-source count and bytes: drop oldest first.
        while (list.length > this.policy.perSource)
            list.shift();
        while (list.length > 1 && list.reduce((s, c) => s + c.bytes, 0) > this.policy.perSourceBytes)
            list.shift();
        if (list.length === 0)
            this.bySource.delete(sourceKey);
        // Global bytes: evict the oldest clip across all sources until under cap.
        while (this.totalBytes() > this.policy.totalBytes) {
            let oldestKey = null;
            let oldestAt = Infinity;
            for (const [key, l] of this.bySource) {
                if (l.length && l[0].at < oldestAt) {
                    oldestAt = l[0].at;
                    oldestKey = key;
                }
            }
            if (!oldestKey)
                break;
            const l = this.bySource.get(oldestKey);
            l.shift();
            if (l.length === 0)
                this.bySource.delete(oldestKey);
        }
    }
}
//# sourceMappingURL=clip-store.js.map