import express from 'express';
import { createServer } from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { SessionManager } from './session-manager.js';
import { setupWebSocket } from './websocket.js';
import { createApiRouter } from './api.js';
import { createSpeakRouter } from './speak-route.js';
import { ResponseStore } from './response-store.js';
import { Reaper, resolveReaperPaths } from './reaper.js';
import { loadProviders } from './provider-utils.js';
import { getSpeakerAuthority } from './speaker.js';
import { configureMessagingClient } from './messaging-client.js';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Load runtime config
function loadRuntimeConfig() {
    const configPath = process.env.SLYCODE_HOME
        ? path.resolve(process.env.SLYCODE_HOME, 'bridge-config.json')
        : path.join(__dirname, '..', 'bridge-config.json');
    const defaultConfig = {
        allowedCommands: ['claude', 'codex', 'opencode', 'bash'],
        cors: { origins: ['http://localhost:3003'] },
    };
    try {
        const configData = fs.readFileSync(configPath, 'utf-8');
        const config = JSON.parse(configData);
        console.log(`Loaded config: ${config.allowedCommands.length} allowed commands, ${config.cors.origins.length} CORS origins`);
        return config;
    }
    catch (err) {
        console.warn('Could not load bridge-config.json, using defaults:', err.message);
        return defaultConfig;
    }
}
const PORT = parseInt(process.env.PORT || process.env.BRIDGE_PORT || '3004', 10);
const HOST = process.env.BRIDGE_HOST || 'localhost';
// Messaging service URL for spoken-reply rendering (feature 086). Explicit
// MESSAGING_URL wins; otherwise the workspace's MESSAGING_SERVICE_PORT. Never
// derived from the bridge's own port and never probed across environments.
export const MESSAGING_URL = process.env.MESSAGING_URL
    || (process.env.MESSAGING_SERVICE_PORT ? `http://127.0.0.1:${process.env.MESSAGING_SERVICE_PORT}` : null)
    // Dev mode (no SLYCODE_HOME): messaging's own dev default port, matching its index.ts fallback
    || (process.env.SLYCODE_HOME ? null : 'http://127.0.0.1:3005');
function validateDataPaths() {
    const root = process.env.SLYCODE_HOME
        ? path.resolve(process.env.SLYCODE_HOME)
        : path.join(__dirname, '..', '..');
    const mode = process.env.SLYCODE_HOME ? 'deployed' : 'dev';
    console.log(`[bridge] Workspace root: ${root} (${mode} mode)`);
    console.log(MESSAGING_URL ? `[bridge] Messaging: ${MESSAGING_URL}` : '[bridge] Messaging: not configured — spoken replies (speak) disabled');
    const providersPath = path.join(root, 'data', 'providers.json');
    if (!fs.existsSync(providersPath)) {
        console.warn(`[bridge] WARNING: data/providers.json not found at ${providersPath} — provider features will not work`);
    }
}
async function main() {
    validateDataPaths();
    const app = express();
    // 1 MB matches the CLI-side cap in scripts/kanban.js cmdRespond — kept in
    // sync so a payload that passes the CLI cap won't 413 at the bridge.
    app.use(express.json({ limit: '1mb' }));
    // Load runtime config
    const runtimeConfig = loadRuntimeConfig();
    const corsOrigins = process.env.BRIDGE_CORS_ORIGIN
        ? [process.env.BRIDGE_CORS_ORIGIN]
        : runtimeConfig.cors.origins;
    // CORS - restricted to configured origins
    app.use((req, res, next) => {
        const origin = req.headers.origin;
        if (origin && corsOrigins.includes(origin)) {
            res.header('Access-Control-Allow-Origin', origin);
        }
        res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
        res.header('Access-Control-Allow-Headers', 'Content-Type');
        if (req.method === 'OPTIONS') {
            return res.sendStatus(200);
        }
        next();
    });
    // Bind the port BEFORE init (card #0363). Until `ready` flips, /health
    // answers 503 {status:'starting'} and every other route 503 BRIDGE_STARTING,
    // so callers see "starting, retry" instead of ECONNREFUSED and nothing can
    // touch session state before bridge-sessions.json is loaded. If init fails,
    // main() rejects and the process exits non-zero (see bottom of file) — the
    // port is never left bound in a permanently not-ready state.
    let ready = false;
    const startTime = Date.now();
    let sessionManagerRef = null;
    // Health check - enhanced for reconnection support
    app.get('/health', (req, res) => {
        if (!ready || !sessionManagerRef) {
            res.setHeader('Retry-After', '1');
            return res.status(503).json({ status: 'starting', timestamp: new Date().toISOString() });
        }
        const sessions = sessionManagerRef.getAllSessions();
        const runningCount = sessions.filter((s) => s.status === 'running').length;
        res.json({
            status: 'ok',
            timestamp: new Date().toISOString(),
            uptime: Math.floor((Date.now() - startTime) / 1000),
            sessions: {
                total: sessions.length,
                running: runningCount,
            },
        });
    });
    app.use((req, res, next) => {
        if (ready)
            return next();
        res.setHeader('Retry-After', '1');
        res.status(503).json({ error: 'Bridge starting', code: 'BRIDGE_STARTING' });
    });
    // Create HTTP server for both Express and WebSocket
    const server = createServer(app);
    await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(PORT, HOST, () => {
            server.off('error', reject);
            console.log(`PTY Bridge Server listening on http://${HOST}:${PORT} (initialising…)`);
            resolve();
        });
    });
    // Initialize session manager with runtime config
    const sessionManager = new SessionManager({
        port: PORT,
        host: HOST,
    }, runtimeConfig);
    await sessionManager.init();
    sessionManagerRef = sessionManager;
    // Speaker authority (feature 086): global spoken-reply permission, audio
    // stream subscribers, rate buckets. Loads data/speaker-prefs.json (default off).
    configureMessagingClient(MESSAGING_URL);
    await getSpeakerAuthority().init();
    // Initialize response store for cross-card prompt protocol
    const responseStore = new ResponseStore();
    responseStore.start();
    sessionManager.setResponseStore(responseStore);
    // Orphan provider reaper (feature 078): sweeps /proc for SlyCode-spawned
    // provider processes left behind by dead bridge instances. Linux-only;
    // configured via the optional "reaper" section of bridge-config.json.
    const reaper = new Reaper({
        config: runtimeConfig.reaper,
        getProviderCommands: async () => {
            const data = await loadProviders();
            return new Set(Object.values(data.providers).map(p => p.command));
        },
        getLivePids: () => sessionManager.getLiveSessionPids(),
        getStaleSessionPids: () => sessionManager.getStaleSessionPids(),
        ...resolveReaperPaths(),
    });
    reaper.start();
    // Clear depth tracking when a response is delivered (prevents stale depth poisoning)
    responseStore.onResponseDelivered = (targetSession) => {
        sessionManager.clearPromptChain(targetSession);
    };
    // API routes
    app.use('/api', createApiRouter(sessionManager, responseStore));
    app.use('/api', createSpeakRouter(sessionManager));
    // Also mount at root for convenience
    app.use('/', createApiRouter(sessionManager, responseStore));
    app.use('/', createSpeakRouter(sessionManager));
    // Setup WebSocket (after init — upgrades before this point are refused)
    setupWebSocket(server, sessionManager);
    ready = true;
    console.log(`PTY Bridge Server running on http://${HOST}:${PORT} (ready in ${Date.now() - startTime}ms after bind)`);
    console.log(`WebSocket endpoint: ws://${HOST}:${PORT}/sessions/:name/terminal`);
    // Graceful shutdown handler
    const shutdown = async (signal) => {
        console.log(`\nReceived ${signal}, shutting down...`);
        // Stop accepting new connections
        server.close();
        // Shutdown session manager (kills PTYs, saves state)
        reaper.stop();
        responseStore.stop();
        await sessionManager.shutdown();
        process.exit(0);
    };
    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
}
main().catch((err) => {
    // Exit non-zero so the service manager restarts us. Required now that the
    // port is bound before init: a failed init must not leave a listener that
    // answers 'starting' forever.
    console.error(err);
    process.exit(1);
});
//# sourceMappingURL=index.js.map