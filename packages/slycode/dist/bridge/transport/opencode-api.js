/**
 * opencode-api transport (feature 085).
 *
 * The OpenCode TUI embeds an HTTP server: `opencode --port <n>` serves both
 * the terminal UI the user sees in the card and the API the bridge drives.
 * Verified on OpenCode 1.18.25 (design doc, spike 2026-08-30):
 *
 *   identity   POST /session?directory=<cwd> {title}  → ses_… (row exists at once)
 *              POST /tui/select-session {sessionID}     (a fresh TUI is NOT on
 *              the API-created session until told; without this the first
 *              submit creates a second session)
 *   delivery   POST /tui/append-prompt {text} + POST /tui/submit-prompt —
 *              user-visible in the composer; fallback POST /session/{id}/prompt_async
 *   turn state GET /event (SSE): session.status / session.idle / permission.asked /
 *              session.error; idle sessions are ABSENT from GET /session/status
 *   interrupt  POST /session/{id}/abort
 *   resume     argv --session <id> (never bare --continue: project-scoped)
 *   recovery   GET /session on a live port, else `opencode session list --format json`
 *
 * The server is unsecured unless OPENCODE_SERVER_PASSWORD is set — the bridge
 * sets one per spawn and binds to 127.0.0.1.
 */
import fs from 'fs';
import net from 'net';
import os from 'os';
import path from 'path';
import { execFile } from 'child_process';
import { randomBytes } from 'crypto';
export const HEALTH_TIMEOUT_MS = 20_000;
export const HEALTH_POLL_MS = 250;
export const DELIVERY_CONFIRM_TIMEOUT_MS = 4_000;
export const DELIVERY_CONFIRM_POLL_MS = 250;
const CLI_LIST_TIMEOUT_MS = 15_000;
/** Where OpenCode keeps credentials (XDG-style on every platform, incl. Windows). */
export function opencodeAuthPath() {
    const xdg = process.env.XDG_DATA_HOME;
    const base = xdg && path.isAbsolute(xdg) ? xdg : path.join(os.homedir(), '.local', 'share');
    return path.join(base, 'opencode', 'auth.json');
}
/** Cheap pre-flight: a non-empty auth.json means at least one credential exists. */
export function hasOpenCodeCredentials(authPath = opencodeAuthPath()) {
    try {
        const st = fs.statSync(authPath);
        if (!st.isFile() || st.size < 3)
            return false;
        const parsed = JSON.parse(fs.readFileSync(authPath, 'utf-8'));
        return parsed && typeof parsed === 'object' && Object.keys(parsed).length > 0;
    }
    catch {
        return false;
    }
}
export function allocateLoopbackPort() {
    return new Promise((resolve, reject) => {
        const srv = net.createServer();
        srv.once('error', reject);
        srv.listen(0, '127.0.0.1', () => {
            const addr = srv.address();
            const port = typeof addr === 'object' && addr ? addr.port : 0;
            srv.close(() => (port ? resolve(port) : reject(new Error('no port'))));
        });
    });
}
function basicAuth(password) {
    return 'Basic ' + Buffer.from(`opencode:${password}`).toString('base64');
}
/** Parse `opencode session list --format json` / GET /session rows into candidates. */
export function candidatesFromRows(rows, cwdRealpath, excludeIds = []) {
    if (!Array.isArray(rows))
        return [];
    const excluded = new Set(excludeIds);
    const out = [];
    for (const r of rows) {
        const id = typeof r.id === 'string' ? r.id : null;
        if (!id || excluded.has(id))
            continue;
        const dir = typeof r.directory === 'string' ? r.directory : '';
        if (dir && normalizeDir(dir) !== cwdRealpath)
            continue;
        if (r.parentID || r.parent_id)
            continue; // sub-agent sessions
        const time = r.time ?? {};
        const createdRaw = (time.created ?? r.created ?? r.time_created);
        const created = typeof createdRaw === 'number' ? createdRaw : null;
        out.push({ sessionId: id, timestampMs: created });
    }
    // Newest first by creation time (never `updated`: a touched old session must not win)
    out.sort((a, b) => (b.timestampMs ?? 0) - (a.timestampMs ?? 0));
    return out;
}
function normalizeDir(p) {
    let out = p;
    try {
        out = fs.realpathSync(p);
    }
    catch { /* keep literal */ }
    out = path.resolve(out);
    if (process.platform === 'win32')
        out = out.toLowerCase();
    return out;
}
export class OpenCodeApiTransport {
    id = 'opencode-api';
    live = new Map();
    // ---- spawn -------------------------------------------------------------
    async planSpawn(input) {
        if (!hasOpenCodeCredentials()) {
            throw new Error("provider_not_connected: OpenCode has no credentials on this machine — run 'opencode auth login' in a terminal first");
        }
        const port = await allocateLoopbackPort();
        const password = randomBytes(24).toString('base64url');
        const state = { port, password, baseUrl: `http://127.0.0.1:${port}` };
        return {
            extraArgs: ['--port', String(port), '--hostname', '127.0.0.1'],
            env: { OPENCODE_SERVER_PASSWORD: password },
            // Fresh: created over the API in afterSpawn (id known before the first turn).
            // Resume: the id was passed on argv (--session <id>); trust it.
            assignedSessionId: input.resume ? input.storedSessionId : null,
            assignedIdUnverified: false,
            sessionDir: null,
            beforeFiles: [],
            armDetection: false,
            transportState: { ...state, initialPrompt: input.initialPrompt, skipPermissions: input.skipPermissions },
        };
    }
    async afterSpawn(session, plan, hooks) {
        const ts = plan.transportState;
        if (!ts)
            return;
        const live = {
            baseUrl: ts.baseUrl,
            auth: basicAuth(ts.password),
            cwd: session.cwd,
            sessionId: session.claudeSessionId,
            skipPermissions: ts.skipPermissions ?? true,
            status: 'unknown',
            lastIdleAt: null,
            lastError: null,
            abort: null,
        };
        this.live.set(session.name, live);
        const ready = await this.waitForHealth(live, HEALTH_TIMEOUT_MS);
        if (!ready) {
            console.warn(`[opencode-api] ${session.name}: server on ${ts.baseUrl} not ready after ${HEALTH_TIMEOUT_MS}ms — session continues as a plain terminal`);
            if (session.transportState)
                session.transportState.error = 'opencode_server_not_ready';
            return;
        }
        try {
            if (live.sessionId) {
                // Resume: confirm the conversation exists; select it in the TUI.
                const res = await this.api(live, 'GET', `/session/${encodeURIComponent(live.sessionId)}?directory=${encodeURIComponent(session.cwd)}`);
                if (!res.ok) {
                    console.warn(`[opencode-api] ${session.name}: resume_session_missing (${live.sessionId} → ${res.status})`);
                    live.lastError = 'resume_session_missing';
                }
                await this.selectSession(live);
            }
            else {
                const created = await this.api(live, 'POST', `/session?directory=${encodeURIComponent(session.cwd)}`, { title: session.name });
                if (!created.ok)
                    throw new Error(`POST /session → ${created.status}`);
                const body = await created.json();
                if (!body.id)
                    throw new Error('POST /session returned no id');
                live.sessionId = body.id;
                await this.selectSession(live);
                await hooks.claimSessionId(session.name, body.id);
            }
        }
        catch (err) {
            console.warn(`[opencode-api] ${session.name}: session bind failed: ${err.message}`);
            live.lastError = 'session_bind_failed';
        }
        this.startEventStream(session.name, live);
        if (ts.initialPrompt && live.sessionId) {
            const r = await this.deliverInternal(session.name, live, ts.initialPrompt);
            if (r.outcome !== 'delivered') {
                console.warn(`[opencode-api] ${session.name}: initial prompt ${r.outcome}${r.reason ? ` (${r.reason})` : ''}`);
            }
        }
    }
    // ---- delivery ----------------------------------------------------------
    async deliver(session, prompt) {
        const live = this.live.get(session.name);
        if (!live) {
            return this.result('failed', { reason: 'opencode_transport_not_attached', warnings: [] });
        }
        return this.deliverInternal(session.name, live, prompt);
    }
    async deliverInternal(name, live, prompt) {
        const startedAt = Date.now();
        const warnings = [];
        if (!live.sessionId) {
            return this.result('failed', { reason: live.lastError ?? 'opencode_session_unbound', warnings, startedAt });
        }
        const before = await this.userMessageCount(live);
        if (before === null) {
            return this.result('failed', { reason: 'opencode_server_not_ready', warnings, startedAt });
        }
        // Make sure the TUI is on OUR session before using the TUI endpoints —
        // a freshly booted TUI attaches to the server a beat after /global/health
        // answers and opens on its own most-recent session; an append fired in
        // that window lands on the wrong conversation (observed live).
        const selected = await this.selectSession(live);
        if (!selected)
            warnings.push('tui_not_selected');
        // User-visible path: the text appears in the composer, then submits.
        // Every call carries ?directory= — the server scopes TUI routing and
        // session lookups by directory context (verified live: without it the
        // endpoints answer 200 but nothing reaches the TUI).
        const dir = `?directory=${encodeURIComponent(live.cwd)}`;
        let submitted = false;
        if (selected) {
            try {
                const a = await this.api(live, 'POST', `/tui/append-prompt${dir}`, { text: prompt });
                const b = a.ok ? await this.api(live, 'POST', `/tui/submit-prompt${dir}`) : a;
                submitted = a.ok && b.ok;
                if (!submitted)
                    warnings.push(`tui_endpoints_unavailable:${a.status}/${b.status}`);
            }
            catch (err) {
                warnings.push(`tui_endpoints_error:${err.message}`);
            }
        }
        if (!submitted) {
            // Headless fallback (no TUI attached, or TUI endpoints rejected): same
            // session, same verification below.
            const r = await this.api(live, 'POST', `/session/${encodeURIComponent(live.sessionId)}/prompt_async${dir}`, {
                parts: [{ type: 'text', text: prompt }],
            });
            if (!r.ok)
                return this.result('failed', { reason: `prompt_async_http_${r.status}`, warnings, startedAt });
            warnings.push('delivered_via_prompt_async');
        }
        // Confirm: a new user message on THIS session (ground truth, not chrome).
        let polls = 0;
        const confirm = async (timeoutMs) => {
            const deadline = Date.now() + timeoutMs;
            while (Date.now() < deadline) {
                await new Promise(r => setTimeout(r, DELIVERY_CONFIRM_POLL_MS));
                polls++;
                const after = await this.userMessageCount(live);
                if (after !== null && after > before)
                    return true;
            }
            return false;
        };
        if (await confirm(DELIVERY_CONFIRM_TIMEOUT_MS)) {
            live.status = 'busy';
            return this.result('delivered', { warnings, startedAt, polls });
        }
        // TUI path didn't land on OUR session (boot window / wrong selection).
        // prompt_async targets the session id directly and needs no TUI. The
        // fallback only fires when the count provably never moved, so a double
        // delivery would require the TUI message to land after the confirm
        // window on the same session — accepted risk, flagged in warnings.
        if (submitted && live.sessionId) {
            warnings.push('tui_unconfirmed_retry_prompt_async');
            const r = await this.api(live, 'POST', `/session/${encodeURIComponent(live.sessionId)}/prompt_async${dir}`, {
                parts: [{ type: 'text', text: prompt }],
            }).catch(() => null);
            if (r?.ok !== false && await confirm(DELIVERY_CONFIRM_TIMEOUT_MS)) {
                live.status = 'busy';
                return this.result('delivered', { warnings, startedAt, polls });
            }
        }
        return this.result('ambiguous', { reason: 'api_no_user_message_observed', warnings, startedAt, polls });
    }
    result(outcome, o) {
        return {
            outcome,
            verified: true,
            mode: 'api',
            attempts: 1,
            resends: 0,
            warnings: o.warnings,
            reason: o.reason,
            polls: o.polls ? [`api_polls:${o.polls}`] : undefined,
            elapsedMs: o.startedAt ? Date.now() - o.startedAt : undefined,
        };
    }
    // ---- state / recovery --------------------------------------------------
    supportsDetection() {
        // Identity is established over the API; nothing to detect after launch.
        return false;
    }
    async listCandidates(_providerId, cwd, excludeFiles = [], session) {
        const cwdReal = normalizeDir(cwd);
        // 1. A live server for this session answers instantly.
        const ts = session?.transportState;
        const liveByName = session?.name ? this.live.get(session.name) : undefined;
        const probe = liveByName ?? (ts?.baseUrl && ts.password ? { baseUrl: ts.baseUrl, auth: basicAuth(ts.password) } : null);
        if (probe) {
            try {
                const res = await this.api(probe, 'GET', `/session?directory=${encodeURIComponent(cwd)}`, undefined, 3_000);
                if (res.ok)
                    return candidatesFromRows(await res.json(), cwdReal, excludeFiles);
            }
            catch { /* fall through */ }
        }
        // 2. Slow path (user-triggered relink only): the CLI boots bun (~2–9 s).
        return new Promise((resolve) => {
            execFile('opencode', ['session', 'list', '--format', 'json', '-n', '50'], {
                cwd, timeout: CLI_LIST_TIMEOUT_MS, windowsHide: true, maxBuffer: 4 * 1024 * 1024,
            }, (err, stdout) => {
                if (err) {
                    resolve([]);
                    return;
                }
                try {
                    resolve(candidatesFromRows(JSON.parse(stdout), cwdReal, excludeFiles));
                }
                catch {
                    resolve([]);
                }
            });
        });
    }
    async onStop(session) {
        const live = this.live.get(session.name);
        if (!live)
            return;
        live.abort?.abort();
        live.abort = null;
        this.live.delete(session.name);
    }
    /** Turn state as last observed on the event stream (diagnostics / callers). */
    turnState(sessionName) {
        return this.live.get(sessionName)?.status ?? 'unknown';
    }
    /** Abort the running turn via the API (never Ctrl-C: on an empty composer that exits OpenCode). */
    async interrupt(sessionName) {
        const live = this.live.get(sessionName);
        if (!live?.sessionId)
            return false;
        const res = await this.api(live, 'POST', `/session/${encodeURIComponent(live.sessionId)}/abort?directory=${encodeURIComponent(live.cwd)}`).catch(() => null);
        return !!res?.ok;
    }
    // ---- internals ---------------------------------------------------------
    async api(live, method, route, body, timeoutMs = 10_000) {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), timeoutMs);
        try {
            return await fetch(live.baseUrl + route, {
                method,
                headers: { authorization: live.auth, 'content-type': 'application/json' },
                body: body === undefined ? undefined : JSON.stringify(body),
                signal: ctrl.signal,
            });
        }
        finally {
            clearTimeout(timer);
        }
    }
    async waitForHealth(live, timeoutMs) {
        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
            try {
                const res = await this.api(live, 'GET', '/global/health', undefined, 2_000);
                if (res.ok)
                    return true;
            }
            catch { /* not up yet */ }
            await new Promise(r => setTimeout(r, HEALTH_POLL_MS));
        }
        return false;
    }
    /**
     * Point the attached TUI at our session. Retries briefly: the TUI client
     * connects to its embedded server a beat after the server is healthy, and
     * select-session 404s until then. Returns whether the select ever took.
     */
    async selectSession(live, retries = 8, delayMs = 500) {
        if (!live.sessionId)
            return false;
        for (let i = 0; i <= retries; i++) {
            try {
                const res = await this.api(live, 'POST', `/tui/select-session?directory=${encodeURIComponent(live.cwd)}`, { sessionID: live.sessionId });
                if (res.ok)
                    return true;
            }
            catch { /* server briefly unreachable — retry */ }
            if (i < retries)
                await new Promise(r => setTimeout(r, delayMs));
        }
        console.warn(`[opencode-api] select-session never succeeded for ${live.sessionId} (TUI not attached?)`);
        return false;
    }
    async userMessageCount(live) {
        if (!live.sessionId)
            return null;
        try {
            const res = await this.api(live, 'GET', `/session/${encodeURIComponent(live.sessionId)}/message?directory=${encodeURIComponent(live.cwd)}`, undefined, 5_000);
            if (!res.ok)
                return null;
            const rows = await res.json();
            return Array.isArray(rows) ? rows.filter(m => m.info?.role === 'user').length : null;
        }
        catch {
            return null;
        }
    }
    startEventStream(name, live) {
        const ctrl = new AbortController();
        live.abort = ctrl;
        const run = async () => {
            let backoff = 500;
            while (!ctrl.signal.aborted) {
                try {
                    const res = await fetch(`${live.baseUrl}/event?directory=${encodeURIComponent(live.cwd)}`, {
                        headers: { authorization: live.auth, accept: 'text/event-stream' },
                        signal: ctrl.signal,
                    });
                    if (!res.ok || !res.body)
                        throw new Error(`event stream ${res.status}`);
                    backoff = 500;
                    await this.consumeSse(res.body, live, ctrl.signal);
                }
                catch (err) {
                    if (ctrl.signal.aborted)
                        return;
                    if (!/abort/i.test(String(err.message))) {
                        console.warn(`[opencode-api] ${name}: event stream dropped (${err.message}); reconnecting in ${backoff}ms`);
                    }
                    await new Promise(r => setTimeout(r, backoff));
                    backoff = Math.min(backoff * 2, 10_000);
                }
            }
        };
        void run();
    }
    async consumeSse(body, live, signal) {
        const reader = body.getReader();
        const decoder = new TextDecoder();
        let buf = '';
        while (!signal.aborted) {
            const { value, done } = await reader.read();
            if (done)
                return;
            buf += decoder.decode(value, { stream: true });
            let ix;
            while ((ix = buf.indexOf('\n\n')) >= 0) {
                const chunk = buf.slice(0, ix);
                buf = buf.slice(ix + 2);
                for (const line of chunk.split('\n')) {
                    if (!line.startsWith('data:'))
                        continue;
                    try {
                        this.handleEvent(JSON.parse(line.slice(5).trim()), live);
                    }
                    catch { /* ignore malformed */ }
                }
            }
        }
    }
    handleEvent(ev, live) {
        const p = ev.properties ?? {};
        const sid = p.sessionID;
        switch (ev.type) {
            case 'session.status': {
                if (sid !== live.sessionId)
                    return;
                const st = p.status?.type;
                live.status = st === 'busy' || st === 'retry' ? 'busy' : st === 'idle' ? 'idle' : live.status;
                return;
            }
            case 'session.idle':
                if (sid === live.sessionId) {
                    live.status = 'idle';
                    live.lastIdleAt = Date.now();
                }
                return;
            case 'session.error':
                if (sid === live.sessionId)
                    live.lastError = 'session_error';
                return;
            case 'permission.asked':
            case 'permission.v2.asked': {
                if (sid !== live.sessionId)
                    return;
                const id = p.id;
                if (!id)
                    return;
                if (live.skipPermissions) {
                    void this.api(live, 'POST', `/permission/${encodeURIComponent(id)}/reply?directory=${encodeURIComponent(live.cwd)}`, { reply: 'once' }).catch(() => undefined);
                }
                else {
                    console.warn(`[opencode-api] permission pending for ${live.sessionId}: ${String(p.permission ?? '')}`);
                }
                return;
            }
            default:
                return;
        }
    }
}
//# sourceMappingURL=opencode-api.js.map