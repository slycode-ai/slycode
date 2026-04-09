import express from 'express';
import { createServer } from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { SessionManager } from './session-manager.js';
import { setupWebSocket } from './websocket.js';
import { createApiRouter } from './api.js';
import { ResponseStore } from './response-store.js';
import type { BridgeRuntimeConfig } from './types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load runtime config
function loadRuntimeConfig(): BridgeRuntimeConfig {
  const configPath = process.env.SLYCODE_HOME
    ? path.resolve(process.env.SLYCODE_HOME, 'bridge-config.json')
    : path.join(__dirname, '..', 'bridge-config.json');
  const defaultConfig: BridgeRuntimeConfig = {
    allowedCommands: ['claude', 'codex', 'gemini', 'bash'],
    cors: { origins: ['http://localhost:3003'] },
  };

  try {
    const configData = fs.readFileSync(configPath, 'utf-8');
    const config = JSON.parse(configData) as BridgeRuntimeConfig;
    console.log(`Loaded config: ${config.allowedCommands.length} allowed commands, ${config.cors.origins.length} CORS origins`);
    return config;
  } catch (err) {
    console.warn('Could not load bridge-config.json, using defaults:', (err as Error).message);
    return defaultConfig;
  }
}

const PORT = parseInt(process.env.PORT || process.env.BRIDGE_PORT || '3004', 10);
const HOST = process.env.BRIDGE_HOST || 'localhost';

function validateDataPaths(): void {
  const root = process.env.SLYCODE_HOME
    ? path.resolve(process.env.SLYCODE_HOME)
    : path.join(__dirname, '..', '..');
  const mode = process.env.SLYCODE_HOME ? 'deployed' : 'dev';
  console.log(`[bridge] Workspace root: ${root} (${mode} mode)`);

  const providersPath = path.join(root, 'data', 'providers.json');
  if (!fs.existsSync(providersPath)) {
    console.warn(`[bridge] WARNING: data/providers.json not found at ${providersPath} — provider features will not work`);
  }
}

async function main() {
  validateDataPaths();

  const app = express();
  app.use(express.json());

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
    res.header('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') {
      return res.sendStatus(200);
    }
    next();
  });

  // Initialize session manager with runtime config
  const sessionManager = new SessionManager({
    port: PORT,
    host: HOST,
  }, runtimeConfig);
  await sessionManager.init();

  // Initialize response store for cross-card prompt protocol
  const responseStore = new ResponseStore();
  responseStore.start();
  sessionManager.setResponseStore(responseStore);

  // API routes
  app.use('/api', createApiRouter(sessionManager, responseStore));

  // Also mount at root for convenience
  app.use('/', createApiRouter(sessionManager, responseStore));

  // Track server start time for uptime calculation
  const startTime = Date.now();

  // Health check - enhanced for reconnection support
  app.get('/health', (req, res) => {
    const sessions = sessionManager.getAllSessions();
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

  // Create HTTP server for both Express and WebSocket
  const server = createServer(app);

  // Setup WebSocket
  setupWebSocket(server, sessionManager);

  server.listen(PORT, HOST, () => {
    console.log(`PTY Bridge Server running on http://${HOST}:${PORT}`);
    console.log(`WebSocket endpoint: ws://${HOST}:${PORT}/sessions/:name/terminal`);
  });

  // Graceful shutdown handler
  const shutdown = async (signal: string) => {
    console.log(`\nReceived ${signal}, shutting down...`);

    // Stop accepting new connections
    server.close();

    // Shutdown session manager (kills PTYs, saves state)
    responseStore.stop();
    await sessionManager.shutdown();

    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch(console.error);
