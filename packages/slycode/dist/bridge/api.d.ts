import { Router } from 'express';
import type { SessionManager } from './session-manager.js';
export declare function createApiRouter(sessionManager: SessionManager): Router;
