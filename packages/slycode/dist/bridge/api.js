import { Router } from 'express';
import path from 'path';
import multer from 'multer';
import { saveScreenshot } from './screenshot-utils.js';
import { checkInstructionFile } from './provider-utils.js';
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
export function createApiRouter(sessionManager) {
    const router = Router();
    // Create or resume a session
    router.post('/sessions', async (req, res) => {
        try {
            const request = req.body;
            if (!request.name) {
                return res.status(400).json({ error: 'name is required' });
            }
            // Validate session name (alphanumeric, colons, hyphens)
            if (!/^[a-zA-Z0-9:_-]+$/.test(request.name)) {
                return res.status(400).json({ error: 'Invalid session name. Use alphanumeric, colons, hyphens only.' });
            }
            const session = await sessionManager.createSession(request);
            // Return 202 for sessions still being created (idempotent duplicate request)
            const statusCode = session.status === 'creating' ? 202 : 200;
            res.status(statusCode).json(session);
        }
        catch (err) {
            const message = err.message;
            // Return 400 for validation errors (command not allowed, invalid CWD)
            if (message.includes('not allowed') || message.includes('CWD') || message.includes('Maximum sessions')) {
                return res.status(400).json({ error: message });
            }
            console.error('Error creating session:', err);
            res.status(500).json({ error: message || 'Failed to create session' });
        }
    });
    // Get all sessions
    router.get('/sessions', (req, res) => {
        const sessions = sessionManager.getAllSessions();
        res.json({ sessions });
    });
    // Get single session info
    router.get('/sessions/:name', (req, res) => {
        const name = decodeURIComponent(req.params.name);
        const session = sessionManager.getSessionInfo(name);
        res.json(session ?? null);
    });
    // Stop or delete a session
    router.delete('/sessions/:name', async (req, res) => {
        const name = decodeURIComponent(req.params.name);
        const action = req.query.action || 'stop';
        if (action === 'stop') {
            const sessionInfo = await sessionManager.stopSession(name);
            if (!sessionInfo) {
                return res.status(404).json({ error: 'Session not found or not running' });
            }
            // Return the final session state so frontend doesn't need to poll
            res.json({ stopped: true, session: sessionInfo });
        }
        else if (action === 'delete') {
            const deleted = await sessionManager.deleteSession(name);
            if (!deleted) {
                return res.status(404).json({ error: 'Session not found' });
            }
            res.json({ deleted: true });
        }
        else {
            res.status(400).json({ error: 'Unknown action. Use ?action=stop or ?action=delete' });
        }
    });
    // Get group status
    router.get('/groups/:group/status', (req, res) => {
        const group = decodeURIComponent(req.params.group);
        const sessions = sessionManager.getGroupStatus(group);
        res.json({
            group,
            sessions,
        });
    });
    // SSE stream for terminal output
    router.get('/sessions/:name/stream', (req, res) => {
        const name = decodeURIComponent(req.params.name);
        // Set SSE headers
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.setHeader('X-Accel-Buffering', 'no'); // Disable nginx buffering
        res.flushHeaders();
        // Register this response as an SSE client
        const success = sessionManager.addSSEClient(name, res);
        if (!success) {
            res.write(`event: error\ndata: ${JSON.stringify({ message: 'Session not found' })}\n\n`);
            res.end();
            return;
        }
        // Send initial connected message
        res.write(`event: connected\ndata: ${JSON.stringify({ session: name })}\n\n`);
        // Handle client disconnect
        req.on('close', () => {
            sessionManager.removeSSEClient(name, res);
        });
    });
    // Terminal input
    router.post('/sessions/:name/input', (req, res) => {
        const name = decodeURIComponent(req.params.name);
        const { data } = req.body;
        if (typeof data !== 'string') {
            return res.status(400).json({ error: 'data must be a string' });
        }
        const success = sessionManager.writeToSession(name, data);
        if (!success) {
            return res.status(404).json({ error: 'Session not found or not running' });
        }
        res.json({ success: true });
    });
    // Screenshot upload
    router.post('/sessions/:name/image', upload.single('image'), async (req, res) => {
        const name = decodeURIComponent(req.params.name);
        const file = req.file;
        if (!file) {
            return res.status(400).json({ error: 'No image file provided. Send as multipart field "image".' });
        }
        // Resolve CWD: session lookup first, fall back to explicit cwd field
        const cwd = sessionManager.getSessionCwd(name) || req.body?.cwd;
        if (!cwd) {
            return res.status(404).json({ error: 'Session not found and no cwd provided' });
        }
        try {
            const filename = await saveScreenshot(cwd, file.buffer, file.mimetype);
            res.json({ success: true, filename });
        }
        catch (err) {
            console.error('Error saving screenshot:', err);
            res.status(500).json({ error: 'Failed to save screenshot' });
        }
    });
    // Terminal resize
    router.post('/sessions/:name/resize', (req, res) => {
        const name = decodeURIComponent(req.params.name);
        const { cols, rows } = req.body;
        if (typeof cols !== 'number' || typeof rows !== 'number') {
            return res.status(400).json({ error: 'cols and rows must be numbers' });
        }
        // Validate bounds
        if (cols < 10 || cols > 500 || rows < 5 || rows > 200) {
            return res.status(400).json({ error: 'Invalid dimensions. cols must be 10-500, rows must be 5-200' });
        }
        const success = sessionManager.resizeSession(name, cols, rows);
        if (!success) {
            return res.status(404).json({ error: 'Session not found or not running' });
        }
        res.json({ success: true });
    });
    // Quick actions
    router.post('/sessions/:name/action', (req, res) => {
        const name = decodeURIComponent(req.params.name);
        const { action } = req.body;
        let success = false;
        switch (action) {
            case 'compact':
                success = sessionManager.writeToSession(name, '/compact\n');
                break;
            case 'clear':
                success = sessionManager.writeToSession(name, '/clear\n');
                break;
            case 'interrupt':
                success = sessionManager.sendSignal(name, 'SIGINT');
                break;
            default:
                return res.status(400).json({ error: 'Unknown action' });
        }
        if (!success) {
            return res.status(404).json({ error: 'Session not found or not running' });
        }
        res.json({ success: true, action });
    });
    // Relink session — re-detect session ID from most recent session file
    router.post('/sessions/:name/relink', async (req, res) => {
        const name = decodeURIComponent(req.params.name);
        try {
            const result = await sessionManager.relinkSession(name);
            res.json(result);
        }
        catch (err) {
            const message = err.message;
            if (message.includes('not found') || message.includes('No session files')) {
                return res.status(404).json({ error: message });
            }
            console.error('Error relinking session:', err);
            res.status(500).json({ error: 'Failed to relink session' });
        }
    });
    // Stop (send Escape) to an active session
    router.post('/sessions/:name/stop', (req, res) => {
        const name = decodeURIComponent(req.params.name);
        const isActive = sessionManager.isSessionActive(name);
        if (isActive === null) {
            return res.status(404).json({ error: 'Session not found or not running' });
        }
        if (!isActive) {
            return res.json({ stopped: false, reason: 'already_stopped' });
        }
        const success = sessionManager.writeToSession(name, '\x1b');
        if (!success) {
            return res.status(500).json({ error: 'Failed to send escape to session' });
        }
        res.json({ stopped: true });
    });
    // Bridge stats for health monitoring
    router.get('/stats', (req, res) => {
        const stats = sessionManager.getStats();
        res.json(stats);
    });
    // Activity transitions for debugging phantom blips
    router.get('/activity-log/:name', (req, res) => {
        const name = decodeURIComponent(req.params.name);
        const transitions = sessionManager.getActivityLog(name);
        if (transitions === null) {
            return res.status(404).json({ error: 'Session not found' });
        }
        res.json({ session: name, transitions });
    });
    // Check if provider instruction file exists in project directory
    router.get('/check-instruction-file', async (req, res) => {
        const provider = req.query.provider;
        const cwd = req.query.cwd;
        if (!provider || !cwd) {
            return res.status(400).json({ error: 'provider and cwd query params are required' });
        }
        if (!path.isAbsolute(cwd)) {
            return res.status(400).json({ error: 'cwd must be an absolute path' });
        }
        try {
            const result = await checkInstructionFile(provider, cwd);
            res.json(result);
        }
        catch (err) {
            console.error('Error checking instruction file:', err);
            res.status(500).json({ error: 'Failed to check instruction file' });
        }
    });
    // Stop all running sessions (bulk action)
    router.post('/sessions/stop-all', async (req, res) => {
        try {
            const stoppedCount = await sessionManager.stopAllSessions();
            res.json({ success: true, stoppedCount });
        }
        catch (err) {
            console.error('Error stopping all sessions:', err);
            res.status(500).json({ error: 'Failed to stop all sessions' });
        }
    });
    return router;
}
//# sourceMappingURL=api.js.map