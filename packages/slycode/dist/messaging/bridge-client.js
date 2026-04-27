import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEBUG_LOG = path.join(__dirname, '..', '..', 'messaging-debug.log');
function debugLog(msg) {
    const line = `[${new Date().toISOString()}] ${msg}\n`;
    fs.appendFileSync(DEBUG_LOG, line);
    console.log(msg);
}
const BRIDGE_DOWN_MSG = 'Bridge is not running. Start it with: cd bridge && npm run dev';
function isFetchError(err) {
    const msg = err.message?.toLowerCase() || '';
    return msg.includes('econnrefused') || msg.includes('fetch failed') || msg.includes('enotfound');
}
export class BridgeClient {
    baseUrl;
    constructor(bridgeUrl) {
        this.baseUrl = bridgeUrl.replace(/\/$/, '');
    }
    async getSession(name) {
        try {
            const res = await fetch(`${this.baseUrl}/sessions/${encodeURIComponent(name)}`);
            if (res.status === 404)
                return null;
            if (!res.ok)
                throw new Error(`Bridge error: ${res.status}`);
            return await res.json();
        }
        catch (err) {
            if (isFetchError(err))
                throw new Error(BRIDGE_DOWN_MSG);
            throw err;
        }
    }
    async listSessions() {
        try {
            const res = await fetch(`${this.baseUrl}/sessions`);
            if (!res.ok)
                throw new Error(`Bridge error: ${res.status}`);
            const data = await res.json();
            return Array.isArray(data) ? data : data.sessions || [];
        }
        catch (err) {
            if (isFetchError(err))
                throw new Error(BRIDGE_DOWN_MSG);
            throw err;
        }
    }
    /**
     * Get sessions for a project, matching the first session-name segment
     * against any of the provided keys. Pass just a projectId for backward
     * compat (matches that single key); pass a key array to support aliases
     * (e.g. canonical sessionKey + legacy project.id form).
     */
    async getProjectSessions(projectIdOrKeys) {
        const all = await this.listSessions();
        const keys = Array.isArray(projectIdOrKeys) ? projectIdOrKeys : [projectIdOrKeys];
        const keySet = new Set(keys.filter(Boolean));
        return all.filter(s => {
            const firstSegment = s.name.split(':')[0];
            return keySet.has(firstSegment);
        });
    }
    /** Get card IDs with currently active sessions (isActive from /stats). */
    async getActiveCardSessions(projectIds) {
        const cardPattern = /^([^:]+):(?:[^:]+:)?card:(.+)$/;
        const projectSet = new Set(projectIds);
        const result = new Set();
        try {
            const res = await fetch(`${this.baseUrl}/stats`, { signal: AbortSignal.timeout(2000) });
            if (!res.ok)
                return result;
            const stats = await res.json();
            for (const session of stats.sessions) {
                if (!session.isActive)
                    continue;
                const match = session.name.match(cardPattern);
                if (match && projectSet.has(match[1])) {
                    result.add(match[2]);
                }
            }
        }
        catch {
            // Bridge down — return empty set
        }
        return result;
    }
    /** Get lastActive timestamps for card sessions (from /sessions, includes stopped). */
    async getCardSessionRecency(projectIds) {
        const cardPattern = /^([^:]+):(?:[^:]+:)?card:(.+)$/;
        const projectSet = new Set(projectIds);
        const result = new Map();
        try {
            const sessions = await this.listSessions();
            for (const session of sessions) {
                if (!session.lastActive)
                    continue;
                const match = session.name.match(cardPattern);
                if (match && projectSet.has(match[1])) {
                    const cardId = match[2];
                    const existing = result.get(cardId);
                    // Keep the most recent lastActive if multiple sessions exist for same card
                    if (!existing || session.lastActive > existing) {
                        result.set(cardId, session.lastActive);
                    }
                }
            }
        }
        catch {
            // Bridge down — return empty map
        }
        return result;
    }
    async createSession(request) {
        try {
            const res = await fetch(`${this.baseUrl}/sessions`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(request),
            });
            if (!res.ok) {
                const error = await res.json();
                throw new Error(`Failed to create session: ${error.error}`);
            }
            return await res.json();
        }
        catch (err) {
            if (isFetchError(err))
                throw new Error(BRIDGE_DOWN_MSG);
            throw err;
        }
    }
    async sendInput(name, data) {
        try {
            const res = await fetch(`${this.baseUrl}/sessions/${encodeURIComponent(name)}/input`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ data }),
            });
            if (res.status === 404)
                return false;
            if (!res.ok)
                throw new Error(`Bridge error: ${res.status}`);
            return true;
        }
        catch (err) {
            if (isFetchError(err))
                throw new Error(BRIDGE_DOWN_MSG);
            throw err;
        }
    }
    async sendImage(name, filePath, cwd, aliases = []) {
        // Resolve to the actual stored name. Image upload requires an exact
        // match; without alias resolution, photos to alias-form sessions 404.
        const resolved = await this.resolveExistingSession(name, aliases);
        const targetName = resolved?.name ?? name;
        const fs = await import('fs');
        const path = await import('path');
        const fileBuffer = fs.readFileSync(filePath);
        const ext = path.extname(filePath).slice(1) || 'jpg';
        const mimeMap = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp' };
        const mimeType = mimeMap[ext] || 'image/jpeg';
        const formData = new FormData();
        formData.append('image', new Blob([fileBuffer], { type: mimeType }), `photo.${ext}`);
        if (cwd) {
            formData.append('cwd', cwd);
        }
        try {
            const res = await fetch(`${this.baseUrl}/sessions/${encodeURIComponent(targetName)}/image`, {
                method: 'POST',
                body: formData,
            });
            if (res.status === 404)
                throw new Error('Session not found');
            if (!res.ok) {
                const err = await res.json();
                throw new Error(err.error || `Bridge error: ${res.status}`);
            }
            return await res.json();
        }
        catch (err) {
            if (isFetchError(err))
                throw new Error(BRIDGE_DOWN_MSG);
            throw err;
        }
    }
    async stopSession(name, aliases = []) {
        // Resolve to the actual stored name so we stop the right session even
        // when it lives under a legacy alias form.
        const resolved = await this.resolveExistingSession(name, aliases);
        const targetName = resolved?.name ?? name;
        try {
            const res = await fetch(`${this.baseUrl}/sessions/${encodeURIComponent(targetName)}/stop`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
            });
            if (res.status === 404) {
                return { stopped: false, reason: 'not_found' };
            }
            if (!res.ok)
                throw new Error(`Bridge error: ${res.status}`);
            return await res.json();
        }
        catch (err) {
            if (isFetchError(err))
                throw new Error(BRIDGE_DOWN_MSG);
            throw err;
        }
    }
    async getGitStatus(cwd) {
        try {
            const res = await fetch(`${this.baseUrl}/git-status?cwd=${encodeURIComponent(cwd)}`);
            if (!res.ok)
                return null;
            return await res.json();
        }
        catch {
            return null;
        }
    }
    async checkInstructionFile(provider, cwd) {
        try {
            const res = await fetch(`${this.baseUrl}/check-instruction-file?provider=${provider}&cwd=${encodeURIComponent(cwd)}`);
            if (!res.ok)
                return { needed: false };
            return await res.json();
        }
        catch {
            return { needed: false };
        }
    }
    /**
     * Try canonical name first, then each alias. Returns whichever exists on
     * the bridge (running, detached, or stopped with persisted state). Returns
     * null when none of the candidates are known to the bridge.
     *
     * Error handling: bridge-down errors abort the whole search (no point
     * trying further candidates against an unreachable bridge). Per-candidate
     * HTTP errors (e.g. transient 5xx on one specific name) log and continue
     * so a single bad response doesn't prevent finding the alias session.
     *
     * Public so callers (stop/restart/sendImage/sendInput) can pre-resolve
     * before performing direct ops, since those endpoints require the exact
     * stored name.
     */
    async resolveExistingSession(canonical, aliases = []) {
        for (const candidate of [canonical, ...aliases]) {
            try {
                const info = await this.getSession(candidate);
                if (info)
                    return { name: candidate, info };
            }
            catch (err) {
                const msg = err?.message || '';
                if (msg === BRIDGE_DOWN_MSG) {
                    // Bridge unreachable — no point trying remaining candidates
                    return null;
                }
                // Per-candidate HTTP error — log and try next alias
                debugLog(`[resolveExistingSession] candidate ${candidate} errored: ${msg}`);
            }
        }
        return null;
    }
    async ensureSession(sessionName, cwd, provider = 'claude', prompt, createInstructionFile, model, aliases = []) {
        // Resolve existing session via alias-aware lookup
        const resolved = await this.resolveExistingSession(sessionName, aliases);
        if (resolved && (resolved.info.status === 'running' || resolved.info.status === 'detached')) {
            const mismatch = resolved.info.skipPermissions === false;
            return { session: resolved.info, permissionMismatch: mismatch };
        }
        // No live session — create. Use the resolved (alias) name if a stopped
        // session with history exists there, so we re-attach instead of creating
        // a canonical duplicate.
        const createName = resolved?.name ?? sessionName;
        const session = await this.createSession({
            name: createName,
            cwd,
            prompt,
            provider,
            skipPermissions: true,
            createInstructionFile,
            model: model || undefined,
        });
        debugLog(`[ensureSession] Session created: name=${createName}, resumed=${session.resumed}, hasPrompt=${!!prompt}`);
        return { session };
    }
    async sendMessage(sessionName, cwd, message, provider = 'claude', createInstructionFile, model, aliases = []) {
        // Resolve via alias-aware lookup so we deliver to an existing alias-form
        // session instead of falling through to create a canonical duplicate.
        const resolved = await this.resolveExistingSession(sessionName, aliases);
        const isActive = resolved && (resolved.info.status === 'running' || resolved.info.status === 'detached');
        if (!isActive) {
            debugLog(`[sendMessage] Session ${sessionName} (aliases tried: ${aliases.length}) not active, creating/resuming`);
            const result = await this.ensureSession(sessionName, cwd, provider, message, createInstructionFile, model, aliases);
            return { permissionMismatch: result.permissionMismatch };
        }
        if (resolved.info.skipPermissions === false) {
            return { permissionMismatch: true };
        }
        const liveName = resolved.name;
        debugLog(`[sendMessage] Sending to ${liveName} (status: ${resolved.info.status}, clients: ${resolved.info.connectedClients})`);
        const textSent = await this.sendInput(liveName, `\x1b[200~${message}\x1b[201~`);
        if (!textSent) {
            throw new Error(`Failed to send input to session ${liveName}`);
        }
        const submitDelay = parseInt(process.env.PROMPT_SUBMIT_DELAY_MS || '600', 10);
        await new Promise(resolve => setTimeout(resolve, submitDelay));
        const crSent = await this.sendInput(liveName, '\r');
        if (!crSent) {
            debugLog(`[sendMessage] FAILED to send CR to ${liveName} — message typed but not submitted`);
        }
        // Double-submit: send a second Enter to catch swallowed keystrokes
        if (process.env.PROMPT_DOUBLE_SUBMIT === 'true') {
            const doubleDelay = parseInt(process.env.PROMPT_DOUBLE_SUBMIT_DELAY_MS || '300', 10);
            await new Promise(resolve => setTimeout(resolve, doubleDelay));
            const cr2Sent = await this.sendInput(liveName, '\r');
            debugLog(`[sendMessage] Double-submit: cr2=${cr2Sent}`);
        }
        debugLog(`[sendMessage] Done: text=${textSent}, cr=${crSent}`);
        return {};
    }
    async restartSession(sessionName, cwd, provider, prompt, model, aliases = []) {
        // Resolve to the live session name. If the user has a permission-mismatch
        // session under an alias, we need to stop and recreate THAT one, not a
        // canonical-named ghost.
        const resolved = await this.resolveExistingSession(sessionName, aliases);
        const targetName = resolved?.name ?? sessionName;
        // Kill existing session (DELETE with ?action=stop actually terminates the PTY)
        try {
            const res = await fetch(`${this.baseUrl}/sessions/${encodeURIComponent(targetName)}?action=stop`, {
                method: 'DELETE',
            });
            if (res.ok) {
                debugLog(`[restartSession] Stopped session: ${targetName}`);
            }
        }
        catch {
            debugLog(`[restartSession] Stop failed (may already be stopped)`);
        }
        // Wait for clean shutdown
        await new Promise(resolve => setTimeout(resolve, 1500));
        // Recreate session with skip-permissions — NOT fresh, so it resumes with history.
        // Use targetName so we re-attach to the same logical session.
        return this.createSession({
            name: targetName,
            cwd,
            prompt,
            provider,
            skipPermissions: true,
            model: model || undefined,
        });
    }
    /**
     * Poll bridge stats and send typing indicators while session is active.
     * Returns when the session stops producing output.
     */
    async watchActivity(sessionName, channel) {
        // Initial typing indicator
        await channel.sendTyping();
        // Wait a moment for the CLI to start processing
        await new Promise(resolve => setTimeout(resolve, 2000));
        let consecutiveIdle = 0;
        const maxIdle = 1; // Stop after 1 idle poll (~3 seconds of no output)
        while (consecutiveIdle < maxIdle) {
            try {
                const res = await fetch(`${this.baseUrl}/stats`);
                if (!res.ok)
                    break;
                const stats = await res.json();
                const session = stats.sessions.find(s => s.name === sessionName);
                if (!session)
                    break;
                if (session.isActive) {
                    consecutiveIdle = 0;
                    await channel.sendTyping();
                }
                else {
                    consecutiveIdle++;
                }
            }
            catch {
                break;
            }
            await new Promise(resolve => setTimeout(resolve, 3000));
        }
    }
    /**
     * Start a persistent background monitor that sends typing indicators
     * whenever the targeted session is actively producing output.
     * Polls every 4 seconds (Telegram typing expires after ~5s).
     */
    startActivityMonitor(getSessionName, channel) {
        const POLL_INTERVAL = 4000;
        setInterval(async () => {
            try {
                if (!channel.isReady())
                    return;
                const sessionName = getSessionName();
                const res = await fetch(`${this.baseUrl}/stats`);
                if (!res.ok)
                    return;
                const stats = await res.json();
                const session = stats.sessions.find(s => s.name === sessionName);
                if (session?.isActive) {
                    await channel.sendTyping();
                }
            }
            catch {
                // Bridge down or network error — silently skip
            }
        }, POLL_INTERVAL);
    }
}
//# sourceMappingURL=bridge-client.js.map