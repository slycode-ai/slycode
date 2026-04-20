import type { BridgeSessionInfo, BridgeCreateSessionRequest, Channel, InstructionFileCheck } from './types.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEBUG_LOG = path.join(__dirname, '..', '..', 'messaging-debug.log');

function debugLog(msg: string): void {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  fs.appendFileSync(DEBUG_LOG, line);
  console.log(msg);
}

const BRIDGE_DOWN_MSG = 'Bridge is not running. Start it with: cd bridge && npm run dev';

function isFetchError(err: unknown): boolean {
  const msg = (err as Error).message?.toLowerCase() || '';
  return msg.includes('econnrefused') || msg.includes('fetch failed') || msg.includes('enotfound');
}

export class BridgeClient {
  private baseUrl: string;

  constructor(bridgeUrl: string) {
    this.baseUrl = bridgeUrl.replace(/\/$/, '');
  }

  async getSession(name: string): Promise<BridgeSessionInfo | null> {
    try {
      const res = await fetch(`${this.baseUrl}/sessions/${encodeURIComponent(name)}`);
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`Bridge error: ${res.status}`);
      return await res.json() as BridgeSessionInfo;
    } catch (err) {
      if (isFetchError(err)) throw new Error(BRIDGE_DOWN_MSG);
      throw err;
    }
  }

  async listSessions(): Promise<BridgeSessionInfo[]> {
    try {
      const res = await fetch(`${this.baseUrl}/sessions`);
      if (!res.ok) throw new Error(`Bridge error: ${res.status}`);
      const data = await res.json() as { sessions: BridgeSessionInfo[] } | BridgeSessionInfo[];
      return Array.isArray(data) ? data : data.sessions || [];
    } catch (err) {
      if (isFetchError(err)) throw new Error(BRIDGE_DOWN_MSG);
      throw err;
    }
  }

  async getProjectSessions(projectId: string): Promise<BridgeSessionInfo[]> {
    const all = await this.listSessions();
    const prefix = `${projectId}:`;
    return all.filter(s => s.name.startsWith(prefix));
  }

  /** Get card IDs with currently active sessions (isActive from /stats). */
  async getActiveCardSessions(projectIds: string[]): Promise<Set<string>> {
    const cardPattern = /^([^:]+):(?:[^:]+:)?card:(.+)$/;
    const projectSet = new Set(projectIds);
    const result = new Set<string>();

    try {
      const res = await fetch(`${this.baseUrl}/stats`, { signal: AbortSignal.timeout(2000) });
      if (!res.ok) return result;

      const stats = await res.json() as {
        sessions: Array<{ name: string; isActive: boolean }>;
      };

      for (const session of stats.sessions) {
        if (!session.isActive) continue;
        const match = session.name.match(cardPattern);
        if (match && projectSet.has(match[1])) {
          result.add(match[2]);
        }
      }
    } catch {
      // Bridge down — return empty set
    }

    return result;
  }

  /** Get lastActive timestamps for card sessions (from /sessions, includes stopped). */
  async getCardSessionRecency(projectIds: string[]): Promise<Map<string, string>> {
    const cardPattern = /^([^:]+):(?:[^:]+:)?card:(.+)$/;
    const projectSet = new Set(projectIds);
    const result = new Map<string, string>();

    try {
      const sessions = await this.listSessions();
      for (const session of sessions) {
        if (!session.lastActive) continue;
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
    } catch {
      // Bridge down — return empty map
    }

    return result;
  }

  async createSession(request: BridgeCreateSessionRequest): Promise<BridgeSessionInfo> {
    try {
      const res = await fetch(`${this.baseUrl}/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      });

      if (!res.ok) {
        const error = await res.json() as { error: string };
        throw new Error(`Failed to create session: ${error.error}`);
      }

      return await res.json() as BridgeSessionInfo;
    } catch (err) {
      if (isFetchError(err)) throw new Error(BRIDGE_DOWN_MSG);
      throw err;
    }
  }

  async sendInput(name: string, data: string): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/sessions/${encodeURIComponent(name)}/input`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data }),
      });

      if (res.status === 404) return false;
      if (!res.ok) throw new Error(`Bridge error: ${res.status}`);
      return true;
    } catch (err) {
      if (isFetchError(err)) throw new Error(BRIDGE_DOWN_MSG);
      throw err;
    }
  }

  async sendImage(name: string, filePath: string, cwd?: string): Promise<{ filename: string }> {
    const fs = await import('fs');
    const path = await import('path');
    const fileBuffer = fs.readFileSync(filePath);
    const ext = path.extname(filePath).slice(1) || 'jpg';
    const mimeMap: Record<string, string> = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp' };
    const mimeType = mimeMap[ext] || 'image/jpeg';

    const formData = new FormData();
    formData.append('image', new Blob([fileBuffer], { type: mimeType }), `photo.${ext}`);
    if (cwd) {
      formData.append('cwd', cwd);
    }

    try {
      const res = await fetch(`${this.baseUrl}/sessions/${encodeURIComponent(name)}/image`, {
        method: 'POST',
        body: formData,
      });

      if (res.status === 404) throw new Error('Session not found');
      if (!res.ok) {
        const err = await res.json() as { error: string };
        throw new Error(err.error || `Bridge error: ${res.status}`);
      }

      return await res.json() as { filename: string };
    } catch (err) {
      if (isFetchError(err)) throw new Error(BRIDGE_DOWN_MSG);
      throw err;
    }
  }

  async stopSession(name: string): Promise<{ stopped: boolean; reason?: string }> {
    try {
      const res = await fetch(`${this.baseUrl}/sessions/${encodeURIComponent(name)}/stop`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });

      if (res.status === 404) {
        return { stopped: false, reason: 'not_found' };
      }
      if (!res.ok) throw new Error(`Bridge error: ${res.status}`);

      return await res.json() as { stopped: boolean; reason?: string };
    } catch (err) {
      if (isFetchError(err)) throw new Error(BRIDGE_DOWN_MSG);
      throw err;
    }
  }

  async getGitStatus(cwd: string): Promise<{ branch: string | null; uncommitted: number } | null> {
    try {
      const res = await fetch(`${this.baseUrl}/git-status?cwd=${encodeURIComponent(cwd)}`);
      if (!res.ok) return null;
      return await res.json() as { branch: string | null; uncommitted: number };
    } catch {
      return null;
    }
  }

  async checkInstructionFile(provider: string, cwd: string): Promise<InstructionFileCheck> {
    try {
      const res = await fetch(
        `${this.baseUrl}/check-instruction-file?provider=${provider}&cwd=${encodeURIComponent(cwd)}`,
      );
      if (!res.ok) return { needed: false };
      return await res.json() as InstructionFileCheck;
    } catch {
      return { needed: false };
    }
  }

  async ensureSession(
    sessionName: string,
    cwd: string,
    provider: string = 'claude',
    prompt?: string,
    createInstructionFile?: boolean,
    model?: string,
  ): Promise<{ session: BridgeSessionInfo; permissionMismatch?: boolean }> {
    // Check if session exists and is alive (running or detached)
    const existing = await this.getSession(sessionName);
    if (existing && (existing.status === 'running' || existing.status === 'detached')) {
      // Permission mismatch detection: messaging always needs skip-permissions
      const mismatch = existing.skipPermissions === false;
      return { session: existing, permissionMismatch: mismatch };
    }

    // Create new session — messaging always forces skipPermissions
    const session = await this.createSession({
      name: sessionName,
      cwd,
      prompt,
      provider,
      skipPermissions: true,
      createInstructionFile,
      model: model || undefined,
    });

    debugLog(`[ensureSession] Session created: resumed=${session.resumed}, hasPrompt=${!!prompt}`);

    return { session };
  }

  async sendMessage(
    sessionName: string,
    cwd: string,
    message: string,
    provider: string = 'claude',
    createInstructionFile?: boolean,
    model?: string,
  ): Promise<{ permissionMismatch?: boolean }> {
    // Check if session is already active
    const existing = await this.getSession(sessionName);
    const isActive = existing && (existing.status === 'running' || existing.status === 'detached');

    if (!isActive) {
      // New or stopped session — pass message as initial prompt
      debugLog(`[sendMessage] Session ${sessionName} not active (status: ${existing?.status ?? 'not found'}), creating/resuming`);
      const result = await this.ensureSession(sessionName, cwd, provider, message, createInstructionFile, model);
      return { permissionMismatch: result.permissionMismatch };
    }

    // Permission mismatch detection for existing sessions
    if (existing!.skipPermissions === false) {
      return { permissionMismatch: true };
    }

    // Active session — send via input with bracketed paste markers.
    // Without markers, ConPTY on Windows processes each chunk separately
    // instead of buffering the entire input as a single paste operation.
    debugLog(`[sendMessage] Sending to ${sessionName} (status: ${existing!.status}, clients: ${existing!.connectedClients})`);
    const textSent = await this.sendInput(sessionName, `\x1b[200~${message}\x1b[201~`);
    if (!textSent) {
      throw new Error(`Failed to send input to session ${sessionName}`);
    }

    // Wait briefly, then send carriage return to submit
    const submitDelay = parseInt(process.env.PROMPT_SUBMIT_DELAY_MS || '600', 10);
    await new Promise(resolve => setTimeout(resolve, submitDelay));
    const crSent = await this.sendInput(sessionName, '\r');
    if (!crSent) {
      debugLog(`[sendMessage] FAILED to send CR to ${sessionName} — message typed but not submitted`);
    }

    // Double-submit: send a second Enter to catch swallowed keystrokes
    if (process.env.PROMPT_DOUBLE_SUBMIT === 'true') {
      const doubleDelay = parseInt(process.env.PROMPT_DOUBLE_SUBMIT_DELAY_MS || '300', 10);
      await new Promise(resolve => setTimeout(resolve, doubleDelay));
      const cr2Sent = await this.sendInput(sessionName, '\r');
      debugLog(`[sendMessage] Double-submit: cr2=${cr2Sent}`);
    }

    debugLog(`[sendMessage] Done: text=${textSent}, cr=${crSent}`);
    return {};
  }

  async restartSession(sessionName: string, cwd: string, provider: string, prompt?: string, model?: string): Promise<BridgeSessionInfo> {
    // Kill existing session (DELETE with ?action=stop actually terminates the PTY)
    try {
      const res = await fetch(`${this.baseUrl}/sessions/${encodeURIComponent(sessionName)}?action=stop`, {
        method: 'DELETE',
      });
      if (res.ok) {
        debugLog(`[restartSession] Stopped session: ${sessionName}`);
      }
    } catch {
      debugLog(`[restartSession] Stop failed (may already be stopped)`);
    }
    // Wait for clean shutdown
    await new Promise(resolve => setTimeout(resolve, 1500));
    // Recreate session with skip-permissions — NOT fresh, so it resumes with history
    return this.createSession({
      name: sessionName,
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
  async watchActivity(sessionName: string, channel: Channel): Promise<void> {
    // Initial typing indicator
    await channel.sendTyping();

    // Wait a moment for the CLI to start processing
    await new Promise(resolve => setTimeout(resolve, 2000));

    let consecutiveIdle = 0;
    const maxIdle = 1; // Stop after 1 idle poll (~3 seconds of no output)

    while (consecutiveIdle < maxIdle) {
      try {
        const res = await fetch(`${this.baseUrl}/stats`);
        if (!res.ok) break;

        const stats = await res.json() as {
          sessions: Array<{ name: string; isActive: boolean }>;
        };

        const session = stats.sessions.find(s => s.name === sessionName);
        if (!session) break;

        if (session.isActive) {
          consecutiveIdle = 0;
          await channel.sendTyping();
        } else {
          consecutiveIdle++;
        }
      } catch {
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
  startActivityMonitor(
    getSessionName: () => string,
    channel: Channel,
  ): void {
    const POLL_INTERVAL = 4000;

    setInterval(async () => {
      try {
        if (!channel.isReady()) return;

        const sessionName = getSessionName();
        const res = await fetch(`${this.baseUrl}/stats`);
        if (!res.ok) return;

        const stats = await res.json() as {
          sessions: Array<{ name: string; isActive: boolean }>;
        };

        const session = stats.sessions.find(s => s.name === sessionName);
        if (session?.isActive) {
          await channel.sendTyping();
        }
      } catch {
        // Bridge down or network error — silently skip
      }
    }, POLL_INTERVAL);
  }
}
