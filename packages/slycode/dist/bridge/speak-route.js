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
import fs from 'fs';
import path from 'path';
import { createHash } from 'crypto';
import { getSpeakerAuthority, readVoiceLimits, refusal, } from './speaker.js';
import { getMessagingClient, MessagingError } from './messaging-client.js';
import { parseSessionName, canonicalRateKey, sourceLabel } from './session-name.js';
const CLIP_TTL_MS = 90_000;
const LABEL_CACHE_MS = 30_000;
const labelCache = new Map();
function workspaceRoot() {
    return process.env.SLYCODE_HOME ? path.resolve(process.env.SLYCODE_HOME) : path.join(path.dirname(new URL(import.meta.url).pathname), '..', '..');
}
function readJson(file) {
    try {
        return JSON.parse(fs.readFileSync(file, 'utf-8'));
    }
    catch {
        return null;
    }
}
// Project status (#0381) is deliberately ignored here: sessions in a paused
// project keep running (pausing just pauses), so their speech still needs a
// label. The status rule lives in web/src/lib/project-status.ts (lockstep
// copies in scripts/kanban.js and messaging/src/project-status.ts).
function findProject(projectKey) {
    const reg = readJson(path.join(workspaceRoot(), 'projects', 'registry.json'));
    const projects = Array.isArray(reg) ? reg : reg?.projects;
    if (!Array.isArray(projects))
        return null;
    const key = projectKey.toLowerCase();
    return projects.find(p => p.id?.toLowerCase() === key
        || p.sessionKey?.toLowerCase() === key
        || (p.sessionKeyAliases || []).some(a => a.toLowerCase() === key)
        || (p.path ? path.basename(p.path).toLowerCase() === key : false)) || null;
}
function findCard(projectPath, cardId) {
    const board = readJson(path.join(projectPath, 'documentation', 'kanban.json'));
    if (!board?.stages)
        return null;
    for (const cards of Object.values(board.stages)) {
        if (!Array.isArray(cards))
            continue;
        const hit = cards.find(c => c.id === cardId);
        if (hit)
            return { number: hit.number, title: hit.title };
    }
    return null;
}
/** Resolve card number/title and project display name for the bubble label. */
export function resolveLabelHints(parsed, now = Date.now()) {
    const key = `${parsed.projectKey}|${parsed.cardId ?? ''}`;
    const cached = labelCache.get(key);
    if (cached && now - cached.at < LABEL_CACHE_MS)
        return cached.hints;
    const hints = {};
    try {
        const project = findProject(parsed.projectKey);
        if (project?.name)
            hints.projectName = project.name;
        if (parsed.kind === 'card' && parsed.cardId) {
            const projectPath = project?.path || (parsed.projectKey === path.basename(workspaceRoot()) ? workspaceRoot() : null);
            const card = projectPath ? findCard(projectPath, parsed.cardId) : null;
            if (card?.number !== undefined)
                hints.cardNumber = card.number;
            if (card?.title)
                hints.cardTitle = card.title;
        }
    }
    catch {
        // label is cosmetic; never fail the speak call
    }
    labelCache.set(key, { at: now, hints });
    return hints;
}
const defaultInFlight = new Map();
/** Short digest binding a requestId to its session + text so a reused id with a different payload is refused. */
export function requestFingerprint(sessionName, text) {
    return createHash('sha256').update(sessionName).update('\u0000').update(text).digest('hex').slice(0, 16);
}
function refusalResponse(r) {
    return { status: r.status, body: { ok: false, code: r.code, message: r.message } };
}
const MISMATCH = {
    status: 409,
    body: { ok: false, code: 'request_mismatch', message: 'requestId was already used for a different session or text; generate a new requestId' },
};
/**
 * Idempotency wrapper. A requestId is reserved SYNCHRONOUSLY (before the first
 * await) and bound to session+text, so concurrent transport retries coalesce
 * onto one in-flight render/delivery instead of producing duplicate clips;
 * completed ids replay their recorded outcome; a reused id with a different
 * payload is refused.
 */
export async function orchestrateSpeak(deps, req) {
    const requestId = typeof req.requestId === 'string' && req.requestId.trim() ? req.requestId.trim() : undefined;
    if (!requestId)
        return runSpeak(deps, req, undefined, undefined);
    const fingerprint = requestFingerprint(req.name, typeof req.text === 'string' ? req.text : '');
    const inFlight = deps.inFlight ?? defaultInFlight;
    // 1. Completed earlier → replay (never re-render), unless the payload differs.
    const prior = deps.speaker.getOutcome(requestId);
    if (prior) {
        if (typeof prior.body.fingerprint === 'string' && prior.body.fingerprint !== fingerprint)
            return MISMATCH;
        return { status: prior.status, body: { ...prior.body, replayed: true } };
    }
    // 2. Still running → join it (or refuse a different payload on the same id).
    const running = inFlight.get(requestId);
    if (running) {
        if (running.fingerprint !== fingerprint)
            return MISMATCH;
        const r = await running.promise;
        return { status: r.status, body: { ...r.body, replayed: true } };
    }
    // 3. New → reserve before any await, release when settled.
    const promise = runSpeak(deps, req, requestId, fingerprint).finally(() => { inFlight.delete(requestId); });
    inFlight.set(requestId, { fingerprint, promise });
    return promise;
}
async function runSpeak(deps, req, requestId, fingerprint) {
    const now = deps.now ?? Date.now;
    const record = (resp) => {
        if (requestId) {
            const body = fingerprint ? { ...resp.body, fingerprint } : resp.body;
            deps.speaker.recordOutcome(requestId, resp.status, body);
            return { status: resp.status, body };
        }
        return resp;
    };
    if (typeof req.text !== 'string') {
        return record({ status: 400, body: { ok: false, code: 'bad_request', message: 'body must be { text: string, requestId?: string }' } });
    }
    const resolved = deps.resolveSession(req.name);
    if (!resolved)
        return record(refusalResponse(refusal('no_session')));
    const parsed = parseSessionName(resolved);
    const admitted = deps.speaker.admit({
        sourceName: resolved,
        canonicalKey: canonicalRateKey(resolved),
        text: req.text,
        limits: await deps.readLimits(),
        now: now(),
        requestId,
    });
    if (!admitted.ok)
        return record(refusalResponse(admitted));
    // Paid work happens here. No mutex is held; OFF can land at any time.
    let rendered;
    try {
        rendered = await deps.messaging.render({ text: req.text, session: resolved, format: 'mp3' });
    }
    catch (err) {
        const e = err;
        const code = e instanceof MessagingError ? e.code : 'render_failed';
        const status = e instanceof MessagingError && e.status >= 400 ? e.status : 502;
        return record({ status, body: { ok: false, code, message: `voice service unavailable: ${e.message}` } });
    }
    // Re-check permission + listeners AFTER the render: credit is spent, but a
    // revoked or unheard clip must not play.
    if (!deps.speaker.isRevisionCurrent(admitted.revision)) {
        return record({ status: 409, body: { ok: false, code: 'revoked', message: 'sound was switched off while rendering; the clip was not played (credit already spent)' } });
    }
    if (deps.speaker.subscriberCount() === 0) {
        return record({ status: 409, body: { ok: false, code: 'no_listener_at_delivery', message: 'the last browser disconnected while rendering; the clip was not played' } });
    }
    const hints = (deps.labelHints ?? resolveLabelHints)(parsed);
    const source = {
        label: sourceLabel(parsed, hints),
        projectId: parsed.projectKey,
        cardId: parsed.cardId,
        sessionName: resolved,
        kind: parsed.kind,
    };
    const clip = {
        clipId: admitted.clipId,
        revision: admitted.revision,
        source,
        text: req.text,
        mime: 'audio/mpeg',
        dataBase64: rendered.dataBase64,
        expiresAt: new Date(now() + CLIP_TTL_MS).toISOString(),
    };
    const sent = deps.speaker.deliver(clip);
    if (sent >= 0)
        deps.speaker.rememberClip?.(resolved, clip);
    if (sent < 0) {
        return record({ status: 409, body: { ok: false, code: 'revoked', message: 'sound was switched off while rendering; the clip was not played (credit already spent)' } });
    }
    return record({
        status: 200,
        body: { ok: true, clipId: admitted.clipId, delivered: sent, words: admitted.words, chars: admitted.chars, voiceId: rendered.voiceId, source: source.label },
    });
}
// ---------------------------------------------------------------------------
// Express wiring
// ---------------------------------------------------------------------------
export function createSpeakRouter(sessionManager) {
    const router = Router();
    router.post('/sessions/:name/speak', async (req, res) => {
        const name = decodeURIComponent(req.params.name);
        const deps = {
            speaker: getSpeakerAuthority(),
            messaging: getMessagingClient(),
            resolveSession: (n) => {
                const resolved = sessionManager.resolveSessionName(n);
                return sessionManager.getSessionInfo(resolved) ? resolved : null;
            },
            readLimits: () => readVoiceLimits(),
        };
        try {
            const out = await orchestrateSpeak(deps, { name, text: req.body?.text, requestId: req.body?.requestId });
            res.status(out.status).json(out.body);
        }
        catch (err) {
            res.status(500).json({ ok: false, code: 'internal', message: err.message });
        }
    });
    return router;
}
//# sourceMappingURL=speak-route.js.map