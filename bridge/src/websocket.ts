import { WebSocketServer, WebSocket } from 'ws';
import type { Server } from 'http';
import type { SessionManager } from './session-manager.js';
import type { WsClientMessage } from './types.js';

// Heartbeat configuration
const PING_INTERVAL = 30 * 1000; // 30 seconds
const PONG_TIMEOUT = 60 * 1000;  // 60 seconds - close if no pong received

interface ExtendedWebSocket extends WebSocket {
  isAlive: boolean;
  pingInterval?: NodeJS.Timeout;
  sessionName?: string;
}

export function setupWebSocket(server: Server, sessionManager: SessionManager): WebSocketServer {
  const wss = new WebSocketServer({ server });

  wss.on('connection', (ws: ExtendedWebSocket, req) => {
    // Extract session name from URL: /sessions/:name/terminal
    const url = new URL(req.url || '', `http://${req.headers.host}`);
    const match = url.pathname.match(/^\/sessions\/([^/]+)\/terminal$/);

    if (!match) {
      ws.send(JSON.stringify({ type: 'error', message: 'Invalid WebSocket path' }));
      ws.close();
      return;
    }

    const sessionName = decodeURIComponent(match[1]);

    // Add client to session
    if (!sessionManager.addClient(sessionName, ws)) {
      ws.send(JSON.stringify({ type: 'error', message: 'Session not found or not running' }));
      ws.close();
      return;
    }

    // Setup heartbeat
    ws.isAlive = true;
    ws.sessionName = sessionName;

    ws.on('pong', () => {
      ws.isAlive = true;
    });

    // Start ping interval
    ws.pingInterval = setInterval(() => {
      if (!ws.isAlive) {
        clearInterval(ws.pingInterval);
        ws.terminate();
        return;
      }
      ws.isAlive = false;
      ws.ping();
    }, PING_INTERVAL);

    ws.on('message', (data) => {
      try {
        const message = data.toString();

        // Try to parse as JSON first
        try {
          const parsed: WsClientMessage = JSON.parse(message);

          if (typeof parsed === 'object' && parsed !== null) {
            switch (parsed.type) {
              case 'input':
                sessionManager.writeToSession(sessionName, parsed.data);
                break;
              case 'resize':
                sessionManager.resizeSession(sessionName, parsed.cols, parsed.rows);
                break;
              case 'signal':
                sessionManager.sendSignal(sessionName, parsed.signal);
                break;
            }
          }
        } catch {
          // Not JSON - treat as raw input
          sessionManager.writeToSession(sessionName, message);
        }
      } catch (err) {
        console.error('WebSocket message error:', err);
      }
    });

    ws.on('close', () => {
      if (ws.pingInterval) {
        clearInterval(ws.pingInterval);
      }
      sessionManager.removeClient(sessionName, ws);
    });

    ws.on('error', (err) => {
      console.error('WebSocket error:', err);
      if (ws.pingInterval) {
        clearInterval(ws.pingInterval);
      }
      sessionManager.removeClient(sessionName, ws);
    });
  });

  return wss;
}
