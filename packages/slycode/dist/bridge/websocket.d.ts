import { WebSocketServer } from 'ws';
import type { Server } from 'http';
import type { SessionManager } from './session-manager.js';
export declare function setupWebSocket(server: Server, sessionManager: SessionManager): WebSocketServer;
