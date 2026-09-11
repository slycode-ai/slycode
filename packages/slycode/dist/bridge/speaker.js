/**
 * Speaker authority (feature 086) — the single place that decides whether a
 * spoken terminal reply may be rendered and delivered.
 *
 * Holds: the GLOBAL speaker flag + permission revision (persisted to
 * data/speaker-prefs.json, tmp+rename), the app-wide audio stream subscribers,
 * per-source and global rate buckets, and a bounded idempotency map of
 * request outcomes. Admission is a pure function over injected state so it
 * can be table-tested with a fake clock.
 *
 * Spending boundary (design doc, "Codex round 3"): OFF before dispatch to
 * messaging = no render; OFF after dispatch = delivery cancelled via the
 * revision check, credit already spent. The setEnabled chain is never held
 * across a render call, so OFF never waits on ElevenLabs.
 */
import fs from 'fs/promises';
import path from 'path';
import { randomUUID } from 'crypto';
import { fileURLToPath } from 'url';
import { broadcastSse } from './sse.js';
import { countSpeech, isEmptySpeech, exceedsLimits, resolveLimits } from './speech-limits.js';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
// ---- Exact agent-facing refusal messages (spec 086, Task 3) ---------------
export const REFUSALS = {
    speaker_off: { status: 409, message: () => "sound is off — don't create sound unless asked to again" },
    no_listener: { status: 409, message: () => 'speaker is on but no browser is connected — nobody would hear this; reply in text' },
    too_long: {
        status: 409,
        message: (c = {}) => `spoken summary too long: ${c.words} words / ${c.chars} chars, limit is ${c.maxWords} words / ${c.maxChars} chars; shorten and retry`,
    },
    empty: { status: 409, message: () => 'nothing to speak (only tags or punctuation)' },
    rate_limited: {
        status: 429,
        message: (c = {}) => `spoken summaries budget reached for this session (${c.limit} per ${c.minutes} min); continue in text`,
    },
    tts_unavailable: { status: 503, message: (c = {}) => `voice service unavailable: ${c.reason ?? 'unknown'}` },
    no_session: { status: 404, message: () => 'no registered session (SLYCODE_SESSION missing or unknown); speak only works from a SlyCode terminal' },
};
export function refusal(code, ctx) {
    const r = REFUSALS[code];
    return { ok: false, code, message: r.message(ctx), status: r.status };
}
// ---- Paths ----------------------------------------------------------------
export function speakerPrefsPath() {
    if (process.env.SLYCODE_SPEAKER_PREFS_PATH)
        return process.env.SLYCODE_SPEAKER_PREFS_PATH;
    const workspaceRoot = process.env.SLYCODE_HOME
        ? path.resolve(process.env.SLYCODE_HOME)
        : path.join(__dirname, '..', '..');
    return path.join(workspaceRoot, 'data', 'speaker-prefs.json');
}
function workspaceRoot() {
    return process.env.SLYCODE_HOME
        ? path.resolve(process.env.SLYCODE_HOME)
        : path.join(__dirname, '..', '..');
}
/**
 * Read the word limit the gear popover persists in data/settings.json.
 * Missing file → defaults. Unreadable/invalid JSON → null (admission refuses
 * with tts_unavailable rather than substituting a larger default).
 */
export async function readVoiceLimits(settingsPath = path.join(workspaceRoot(), 'data', 'settings.json')) {
    let raw;
    try {
        raw = await fs.readFile(settingsPath, 'utf-8');
    }
    catch (err) {
        if (err.code === 'ENOENT')
            return resolveLimits({});
        return null;
    }
    try {
        const parsed = JSON.parse(raw);
        const voice = parsed && typeof parsed === 'object' ? parsed.voice : undefined;
        return resolveLimits(voice && typeof voice === 'object' ? voice : {});
    }
    catch {
        return null;
    }
}
function prune(stamps, now, windowMs) {
    const cutoff = now - windowMs;
    let i = 0;
    while (i < stamps.length && stamps[i] <= cutoff)
        i++;
    return i > 0 ? stamps.slice(i) : stamps;
}
/**
 * Decide admission. Mutates `state.buckets` ONLY on success (a refused
 * request never consumes budget). Order: off → listener → limits readable →
 * empty → length → budget.
 */
export function decideAdmission(state, policy, input) {
    const now = input.now ?? Date.now();
    if (!state.enabled)
        return refusal('speaker_off');
    if (state.subscribers <= 0)
        return refusal('no_listener');
    if (!input.limits)
        return refusal('tts_unavailable', { reason: 'spoken-reply limits unreadable (data/settings.json)' });
    if (typeof input.text !== 'string' || isEmptySpeech(input.text))
        return refusal('empty');
    const count = countSpeech(input.text);
    if (exceedsLimits(count, input.limits)) {
        return refusal('too_long', { words: count.words, chars: count.chars, maxWords: input.limits.maxWords, maxChars: input.limits.maxChars });
    }
    const minutes = Math.round(policy.windowMs / 60_000);
    const source = prune(state.buckets.perSource.get(input.canonicalKey) ?? [], now, policy.windowMs);
    if (source.length >= policy.perSourceLimit) {
        state.buckets.perSource.set(input.canonicalKey, source);
        return refusal('rate_limited', { limit: policy.perSourceLimit, minutes });
    }
    const global = prune(state.buckets.global, now, policy.windowMs);
    if (global.length >= policy.globalLimit) {
        state.buckets.global = global;
        state.buckets.perSource.set(input.canonicalKey, source);
        return refusal('rate_limited', { limit: `${policy.globalLimit} across all sessions`, minutes });
    }
    source.push(now);
    global.push(now);
    state.buckets.perSource.set(input.canonicalKey, source);
    state.buckets.global = global;
    return { ok: true, clipId: randomUUID(), revision: state.revision, words: count.words, chars: count.chars };
}
// ---- Authority --------------------------------------------------------------
function envInt(name, fallback) {
    const v = parseInt(process.env[name] || '', 10);
    return Number.isFinite(v) && v > 0 ? v : fallback;
}
export class SpeakerAuthority {
    prefs = { enabled: false, revision: 0 };
    prefsPath;
    policy;
    buckets = { perSource: new Map(), global: [] };
    subscribers = new Map();
    subscriberSet = new Set();
    outcomes = new Map();
    outcomeMaxEntries;
    outcomeTtlMs;
    heartbeatMs;
    maxWritableLength;
    now;
    chain = Promise.resolve();
    heartbeatTimer = null;
    skippedOnce = new WeakSet();
    initialised = false;
    constructor(opts = {}) {
        this.prefsPath = opts.prefsPath ?? speakerPrefsPath();
        this.policy = {
            perSourceLimit: opts.perSourceLimit ?? envInt('SPEAK_PER_SOURCE', 12),
            globalLimit: opts.globalLimit ?? envInt('SPEAK_GLOBAL', 40),
            windowMs: opts.windowMs ?? envInt('SPEAK_WINDOW_MS', 10 * 60_000),
        };
        this.outcomeMaxEntries = opts.outcomeMaxEntries ?? 200;
        this.outcomeTtlMs = opts.outcomeTtlMs ?? 10 * 60_000;
        this.heartbeatMs = opts.heartbeatMs ?? 15_000;
        this.maxWritableLength = opts.maxWritableLength ?? 2 * 1024 * 1024;
        this.now = opts.now ?? Date.now;
    }
    // -- lifecycle --
    async init() {
        if (this.initialised)
            return;
        this.initialised = true;
        try {
            const parsed = JSON.parse(await fs.readFile(this.prefsPath, 'utf-8'));
            if (parsed && typeof parsed === 'object') {
                this.prefs = {
                    enabled: parsed.enabled === true,
                    revision: Number.isFinite(parsed.revision) ? Math.max(0, Math.floor(parsed.revision)) : 0,
                };
            }
        }
        catch {
            // Missing or corrupt prefs: default off, revision 0
            this.prefs = { enabled: false, revision: 0 };
        }
        if (this.heartbeatMs > 0 && !this.heartbeatTimer) {
            this.heartbeatTimer = setInterval(() => this.heartbeat(), this.heartbeatMs);
            this.heartbeatTimer.unref?.();
        }
    }
    stop() {
        if (this.heartbeatTimer) {
            clearInterval(this.heartbeatTimer);
            this.heartbeatTimer = null;
        }
    }
    // -- state --
    getState() {
        return { enabled: this.prefs.enabled, revision: this.prefs.revision, subscribers: this.subscriberSet.size };
    }
    isRevisionCurrent(revision) {
        return this.prefs.enabled && revision === this.prefs.revision;
    }
    /**
     * Idempotent. OFF bumps the revision (invalidating every admitted or
     * queued clip), persists BEFORE resolving, then broadcasts. ON persists and
     * broadcasts without a bump. Serialised so concurrent toggles converge.
     */
    setEnabled(enabled) {
        const run = async () => {
            const wasEnabled = this.prefs.enabled;
            if (enabled === wasEnabled)
                return this.getState();
            const next = enabled
                ? { enabled: true, revision: this.prefs.revision }
                : { enabled: false, revision: this.prefs.revision + 1 };
            await this.persist(next);
            this.prefs = next;
            this.broadcastState();
            return this.getState();
        };
        const result = this.chain.then(run, run);
        this.chain = result.then(() => undefined, () => undefined);
        return result;
    }
    async persist(prefs) {
        await fs.mkdir(path.dirname(this.prefsPath), { recursive: true });
        const tmp = `${this.prefsPath}.${process.pid}.${Math.random().toString(36).slice(2, 8)}.tmp`;
        await fs.writeFile(tmp, JSON.stringify(prefs, null, 2) + '\n', 'utf-8');
        await fs.rename(tmp, this.prefsPath);
    }
    // -- subscribers (app-wide audio stream) --
    addSubscriber(res, id = randomUUID()) {
        this.subscribers.set(id, res);
        this.subscriberSet.add(res);
        return id;
    }
    removeSubscriber(id) {
        const res = this.subscribers.get(id);
        if (res)
            this.subscriberSet.delete(res);
        this.subscribers.delete(id);
    }
    subscriberCount() {
        return this.subscriberSet.size;
    }
    /** Initial snapshot for a freshly connected stream client. */
    stateEvent() {
        return { enabled: this.prefs.enabled, revision: this.prefs.revision };
    }
    broadcastState() {
        const r = broadcastSse(this.subscriberSet, 'speaker-state', this.stateEvent());
        if (r.dead > 0)
            this.reconcileSubscribers();
    }
    heartbeat() {
        if (this.subscriberSet.size === 0)
            return;
        const r = broadcastSse(this.subscriberSet, 'heartbeat', {});
        if (r.dead > 0)
            this.reconcileSubscribers();
    }
    reconcileSubscribers() {
        for (const [id, res] of this.subscribers) {
            if (!this.subscriberSet.has(res))
                this.subscribers.delete(id);
        }
    }
    /**
     * Deliver a rendered clip to every subscriber (byte-budgeted). Returns the
     * number of clients written to, or -1 if the clip's revision is stale
     * (permission was revoked after admission — nothing is sent).
     */
    deliver(clip) {
        if (!this.isRevisionCurrent(clip.revision))
            return -1;
        const r = broadcastSse(this.subscriberSet, 'clip', clip, {
            maxWritableLength: this.maxWritableLength,
            onSkipped: (client) => {
                if (!this.skippedOnce.has(client)) {
                    this.skippedOnce.add(client);
                    console.warn(`[speaker] dropped clip ${clip.clipId} for a slow audio-stream client (socket backlog over budget)`);
                }
            },
        });
        if (r.dead > 0)
            this.reconcileSubscribers();
        return r.sent;
    }
    // -- admission --
    admit(input) {
        const state = {
            enabled: this.prefs.enabled,
            revision: this.prefs.revision,
            subscribers: this.subscriberSet.size,
            buckets: this.buckets,
        };
        return decideAdmission(state, this.policy, { ...input, now: input.now ?? this.now() });
    }
    // -- idempotency outcomes --
    recordOutcome(requestId, status, body) {
        if (!requestId)
            return;
        const now = this.now();
        this.outcomes.set(requestId, { at: now, status, body });
        this.pruneOutcomes(now);
    }
    getOutcome(requestId) {
        if (!requestId)
            return null;
        const o = this.outcomes.get(requestId);
        if (!o)
            return null;
        if (this.now() - o.at > this.outcomeTtlMs) {
            this.outcomes.delete(requestId);
            return null;
        }
        return o;
    }
    pruneOutcomes(now) {
        for (const [id, o] of this.outcomes) {
            if (now - o.at > this.outcomeTtlMs)
                this.outcomes.delete(id);
        }
        while (this.outcomes.size > this.outcomeMaxEntries) {
            const oldest = this.outcomes.keys().next().value;
            if (oldest === undefined)
                break;
            this.outcomes.delete(oldest);
        }
    }
}
// ---- Singleton --------------------------------------------------------------
let instance = null;
export function getSpeakerAuthority() {
    if (!instance)
        instance = new SpeakerAuthority();
    return instance;
}
/** Test seam: replace the process-wide authority. */
export function setSpeakerAuthority(authority) {
    instance = authority;
}
//# sourceMappingURL=speaker.js.map