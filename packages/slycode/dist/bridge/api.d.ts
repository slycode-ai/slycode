import { Router } from 'express';
import type { SessionManager } from './session-manager.js';
import type { ResponseStore } from './response-store.js';
export declare function createApiRouter(sessionManager: SessionManager, responseStore: ResponseStore): Router;
