import fs from 'fs';
import path from 'path';
import os from 'os';
// --- TelegramChannel ---
export class TelegramChannel {
    name = 'Telegram';
    botToken;
    authorizedUserId;
    chatId = null;
    onChatIdChanged;
    textHandler;
    voiceHandler;
    photoHandler;
    voiceSelectHandler;
    callbackHandlers = new Map();
    commandHandlers = new Map();
    persistentKeyboard = null;
    pendingVoiceList = [];
    // Photo album batching
    photoBuffer = new Map();
    // Polling state
    polling = false;
    pollOffset = 0;
    pollAbort = null;
    constructor(config) {
        this.authorizedUserId = config.authorizedUserId;
        this.botToken = config.botToken;
        if (config.chatId)
            this.chatId = config.chatId;
        if (config.onChatIdChanged)
            this.onChatIdChanged = config.onChatIdChanged;
    }
    async start() {
        this.polling = true;
        this.pollLoop();
        console.log(`[${this.name}] Channel started (long polling)`);
    }
    stop() {
        this.polling = false;
        // Cancel any in-flight getUpdates request
        if (this.pollAbort) {
            this.pollAbort.abort();
            this.pollAbort = null;
        }
        // Clear any pending photo album timers
        for (const [, group] of this.photoBuffer) {
            clearTimeout(group.timer);
        }
        this.photoBuffer.clear();
        console.log(`[${this.name}] Channel stopped`);
    }
    onText(handler) {
        this.textHandler = handler;
    }
    onVoice(handler) {
        this.voiceHandler = handler;
    }
    onPhoto(handler) {
        this.photoHandler = handler;
    }
    onCommand(command, handler) {
        this.commandHandlers.set(command, handler);
    }
    onCallback(prefix, handler) {
        this.callbackHandlers.set(prefix, handler);
    }
    async sendText(text) {
        if (!this.chatId)
            throw new Error('No active chat. Send a message from Telegram first.');
        const chunks = this.splitMessage(text);
        for (let i = 0; i < chunks.length; i++) {
            const opts = { parse_mode: 'Markdown', ...this.keyboardMarkup() };
            try {
                await this.apiSendMessage(this.chatId, chunks[i], opts);
            }
            catch {
                // Markdown parse failed — retry without formatting
                await this.apiSendMessage(this.chatId, chunks[i], this.keyboardMarkup());
            }
        }
    }
    async sendTextRaw(text) {
        if (!this.chatId)
            throw new Error('No active chat. Send a message from Telegram first.');
        const chunks = this.splitMessage(text);
        for (const chunk of chunks) {
            await this.apiSendMessage(this.chatId, chunk, this.keyboardMarkup());
        }
    }
    async sendVoice(audio) {
        if (!this.chatId)
            throw new Error('No active chat. Send a message from Telegram first.');
        const messageId = await this.apiSendMultipart('sendVoice', 'voice', this.chatId, audio, {
            mime: 'audio/ogg',
            filename: 'voice.ogg',
            reply_markup: this.keyboardMarkup().reply_markup,
        });
        return { messageId };
    }
    async sendMedia(req) {
        if (!this.chatId)
            throw new Error('No active chat. Send a message from Telegram first.');
        const buf = await fs.promises.readFile(req.filePath);
        const filename = path.basename(req.filePath);
        const map = {
            voice: { method: 'sendVoice', field: 'voice', mime: 'audio/ogg' },
            audio: { method: 'sendAudio', field: 'audio', mime: this.guessAudioMime(filename) },
            video: { method: 'sendVideo', field: 'video', mime: this.guessVideoMime(filename) },
            document: { method: 'sendDocument', field: 'document', mime: 'application/octet-stream' },
        };
        const m = map[req.kind];
        const messageId = await this.apiSendMultipart(m.method, m.field, this.chatId, buf, {
            mime: m.mime,
            filename,
            caption: req.caption,
            reply_markup: this.keyboardMarkup().reply_markup,
        });
        return { messageId };
    }
    guessAudioMime(filename) {
        const ext = filename.toLowerCase().slice(filename.lastIndexOf('.'));
        if (ext === '.mp3')
            return 'audio/mpeg';
        if (ext === '.m4a')
            return 'audio/mp4';
        if (ext === '.ogg' || ext === '.opus')
            return 'audio/ogg';
        return 'application/octet-stream';
    }
    guessVideoMime(filename) {
        const ext = filename.toLowerCase().slice(filename.lastIndexOf('.'));
        if (ext === '.mp4')
            return 'video/mp4';
        if (ext === '.mov')
            return 'video/quicktime';
        return 'application/octet-stream';
    }
    async sendInlineKeyboard(text, buttons) {
        if (!this.chatId)
            return;
        const keyboard = buttons.map(row => row.map(btn => ({
            text: btn.label,
            callback_data: btn.callbackData.slice(0, 64),
        })));
        await this.apiSendMessage(this.chatId, text, {
            reply_markup: { inline_keyboard: keyboard },
        });
    }
    async setPersistentKeyboard(buttons) {
        this.persistentKeyboard = buttons;
        console.log(`[Telegram] Keyboard set: ${buttons.flat().join(', ')}`);
    }
    async sendTyping() {
        await this.sendChatAction('typing');
    }
    async sendChatAction(action) {
        if (!this.chatId)
            return;
        try {
            await this.apiCall('sendChatAction', { chat_id: this.chatId, action });
        }
        catch {
            // Ignore chat action failures
        }
    }
    async sendVoiceList(voices) {
        if (!this.chatId)
            return;
        this.pendingVoiceList = voices.map(v => ({ id: v.id, name: v.name }));
        const keyboard = voices.map((v, i) => ([{
                text: `${v.name} (${v.description})`,
                callback_data: `voice_${i}`,
            }]));
        await this.apiSendMessage(this.chatId, 'Select a voice:', {
            reply_markup: { inline_keyboard: keyboard },
        });
    }
    onVoiceSelect(handler) {
        this.voiceSelectHandler = handler;
    }
    isReady() {
        return this.chatId !== null;
    }
    // --- Private: Telegram Bot API methods ---
    /** Generic JSON API call to Telegram Bot API. */
    /**
     * Call the Telegram Bot API.
     *
     * `retries` is opt-in and defaults to 0 — a blanket retry would risk
     * double-sends on non-idempotent methods (sendMessage etc.) if the request
     * succeeded but the response was lost. Only idempotent reads (getFile) pass
     * retries. Retries fire ONLY on network/connect failures (fetch failed /
     * ETIMEDOUT / ECONNRESET), never on a Telegram-level `!ok` (retrying a
     * logical error is pointless). A per-attempt timeout means a stalled connect
     * — the `ETIMEDOUT at internalConnectMultiple` seen when the box's egress to
     * Telegram is degraded — fails fast instead of hanging the poll loop.
     */
    async apiCall(method, body, opts) {
        const retries = opts?.retries ?? 0;
        const timeoutMs = opts?.timeoutMs ?? 20_000;
        let lastErr;
        for (let attempt = 0; attempt <= retries; attempt++) {
            const abort = new AbortController();
            const timer = setTimeout(() => abort.abort(), timeoutMs);
            try {
                const res = await fetch(`https://api.telegram.org/bot${this.botToken}/${method}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(body),
                    signal: abort.signal,
                });
                const data = await res.json();
                // Telegram-level failure — do NOT retry, it won't change.
                if (!data.ok)
                    throw new Error(`Telegram API error (${method}): ${data.description}`);
                return data.result;
            }
            catch (err) {
                lastErr = err;
                // Only network/transport errors are retryable; a Telegram API error
                // (message starts with "Telegram API error") is terminal.
                const retryable = !(err instanceof Error && err.message.startsWith('Telegram API error'));
                if (retryable && attempt < retries) {
                    const backoff = 500 * 2 ** attempt; // 500ms, 1s, 2s
                    console.warn(`[Telegram] ${method} attempt ${attempt + 1}/${retries + 1} failed (${err.message}); retrying in ${backoff}ms`);
                    await new Promise(r => setTimeout(r, backoff));
                    continue;
                }
                throw err;
            }
            finally {
                clearTimeout(timer);
            }
        }
        throw lastErr;
    }
    /** Send a text message via Telegram API. */
    async apiSendMessage(chatId, text, opts) {
        return this.apiCall('sendMessage', { chat_id: chatId, text, ...opts });
    }
    /** Get a file download URL from a file_id. getFile is idempotent → retry it. */
    async apiGetFileLink(fileId) {
        const file = await this.apiCall('getFile', { file_id: fileId }, { retries: 2 });
        return `https://api.telegram.org/file/bot${this.botToken}/${file.file_path}`;
    }
    /**
     * Download a file from Telegram's CDN with retry + per-attempt timeout.
     *
     * Telegram's file servers intermittently drop the TLS connection mid-transfer
     * (observed: `SocketError: other side closed` / ECONNRESET after a partial
     * read). A single fetch with no retry loses the whole message on any blip —
     * and voice notes are hit far more than text because they require a separate
     * ~hundreds-of-KB download rather than arriving inside the getUpdates poll.
     * Retrying a second later almost always succeeds since the drops are transient.
     */
    async downloadFileWithRetry(url, label) {
        const MAX_ATTEMPTS = 3;
        const PER_ATTEMPT_TIMEOUT_MS = 30_000;
        let lastErr;
        for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
            const abort = new AbortController();
            const timer = setTimeout(() => abort.abort(), PER_ATTEMPT_TIMEOUT_MS);
            try {
                const response = await fetch(url, { signal: abort.signal });
                if (!response.ok) {
                    throw new Error(`HTTP ${response.status} ${response.statusText}`);
                }
                return Buffer.from(await response.arrayBuffer());
            }
            catch (err) {
                lastErr = err;
                if (attempt < MAX_ATTEMPTS) {
                    const backoff = 500 * 2 ** (attempt - 1); // 500ms, 1s
                    console.warn(`[Telegram] ${label} download attempt ${attempt}/${MAX_ATTEMPTS} failed (${err.message}); retrying in ${backoff}ms`);
                    await new Promise(r => setTimeout(r, backoff));
                }
            }
            finally {
                clearTimeout(timer);
            }
        }
        throw lastErr;
    }
    /**
     * Shared multipart upload helper for sendVoice/sendAudio/sendVideo/sendDocument.
     * Returns the Telegram `message_id` of the sent message.
     */
    async apiSendMultipart(method, field, chatId, file, opts) {
        const form = new FormData();
        form.append('chat_id', String(chatId));
        form.append(field, new Blob([new Uint8Array(file)], { type: opts.mime }), opts.filename);
        if (opts.caption)
            form.append('caption', opts.caption);
        if (opts.reply_markup)
            form.append('reply_markup', JSON.stringify(opts.reply_markup));
        const res = await fetch(`https://api.telegram.org/bot${this.botToken}/${method}`, {
            method: 'POST',
            body: form,
        });
        const data = await res.json();
        if (!data.ok)
            throw new Error(`Telegram API error (${method}): ${data.description}`);
        return data.result.message_id;
    }
    /** Acknowledge a callback query. */
    async apiAnswerCallbackQuery(callbackQueryId) {
        await this.apiCall('answerCallbackQuery', { callback_query_id: callbackQueryId });
    }
    // --- Private: Polling loop ---
    async pollLoop() {
        let backoff = 1000;
        while (this.polling) {
            try {
                this.pollAbort = new AbortController();
                const url = `https://api.telegram.org/bot${this.botToken}/getUpdates`;
                const res = await fetch(url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        offset: this.pollOffset,
                        timeout: 30,
                        allowed_updates: ['message', 'callback_query'],
                    }),
                    signal: this.pollAbort.signal,
                });
                if (!this.polling)
                    break;
                if (res.status === 409) {
                    console.error(`[Telegram] 409 Conflict — another bot instance is polling. Retrying in 10s...`);
                    await this.sleep(10000);
                    continue;
                }
                const data = await res.json();
                if (!data.ok) {
                    console.error(`[Telegram] getUpdates error: ${data.description}`);
                    await this.sleep(backoff);
                    backoff = Math.min(backoff * 2, 30000);
                    continue;
                }
                // Reset backoff on success
                backoff = 1000;
                for (const update of data.result) {
                    this.pollOffset = update.update_id + 1;
                    try {
                        await this.dispatchUpdate(update);
                    }
                    catch (err) {
                        console.error(`[Telegram] Error handling update ${update.update_id}:`, err);
                    }
                }
            }
            catch (err) {
                if (err.name === 'AbortError')
                    break; // Graceful shutdown
                if (!this.polling)
                    break;
                console.error(`[Telegram] Polling error:`, err.message);
                await this.sleep(backoff);
                backoff = Math.min(backoff * 2, 30000);
            }
        }
    }
    /** Route an update to the appropriate handler. */
    async dispatchUpdate(update) {
        if (update.callback_query) {
            await this.handleCallbackQuery(update.callback_query);
            return;
        }
        if (update.message) {
            await this.handleMessage(update.message);
        }
    }
    /** Handle an incoming message (text, voice, photo, or command). */
    async handleMessage(msg) {
        if (!msg.from || !this.isAuthorized(msg.from.id))
            return;
        this.setChatId(msg.chat.id);
        // Voice message
        if (msg.voice && this.voiceHandler) {
            try {
                const fileLink = await this.apiGetFileLink(msg.voice.file_id);
                const tempPath = path.join(os.tmpdir(), `voice_${Date.now()}.ogg`);
                const buffer = await this.downloadFileWithRetry(fileLink, 'voice');
                fs.writeFileSync(tempPath, buffer);
                this.voiceHandler(tempPath);
            }
            catch (err) {
                console.error('Error downloading voice message:', err);
                await this.sendText(`Error processing voice message: ${err.message}`);
            }
            return;
        }
        // Photo message — batches album photos via media_group_id
        if (msg.photo && msg.photo.length > 0 && this.photoHandler) {
            try {
                const photo = msg.photo[msg.photo.length - 1];
                const fileLink = await this.apiGetFileLink(photo.file_id);
                const tempPath = path.join(os.tmpdir(), `photo_${Date.now()}_${Math.random().toString(36).slice(2, 6)}.jpg`);
                const buffer = await this.downloadFileWithRetry(fileLink, 'photo');
                fs.writeFileSync(tempPath, buffer);
                const entry = { filePath: tempPath, caption: msg.caption || undefined };
                // Capture handler ref for timer callback safety
                const photoHandler = this.photoHandler;
                if (msg.media_group_id) {
                    const groupId = msg.media_group_id;
                    const existing = this.photoBuffer.get(groupId);
                    if (existing) {
                        clearTimeout(existing.timer);
                        existing.photos.push(entry);
                    }
                    else {
                        this.photoBuffer.set(groupId, { photos: [entry], timer: null });
                    }
                    const group = this.photoBuffer.get(groupId);
                    group.timer = setTimeout(() => {
                        this.photoBuffer.delete(groupId);
                        photoHandler(group.photos);
                    }, 2000);
                }
                else {
                    photoHandler([entry]);
                }
            }
            catch (err) {
                console.error('Error downloading photo:', err);
                await this.sendText(`Error processing photo: ${err.message}`);
            }
            return;
        }
        // Command messages
        if (msg.text && msg.text.startsWith('/')) {
            for (const [command, handler] of this.commandHandlers) {
                const regex = new RegExp(`^/${command}(.*)$`);
                const match = msg.text.match(regex);
                if (match) {
                    const args = (match[1] || '').trim();
                    handler(args);
                    return;
                }
            }
        }
        // Plain text messages (non-commands)
        if (msg.text && !msg.text.startsWith('/') && this.textHandler) {
            this.textHandler(msg.text);
        }
    }
    /** Handle a callback query (inline button press). */
    async handleCallbackQuery(query) {
        if (!this.isAuthorized(query.from.id))
            return;
        if (!query.data || !query.message)
            return;
        this.setChatId(query.message.chat.id);
        await this.apiAnswerCallbackQuery(query.id);
        // Voice selection (index-based lookup)
        if (query.data.startsWith('voice_') && this.voiceSelectHandler) {
            const idx = parseInt(query.data.replace('voice_', ''), 10);
            const voice = this.pendingVoiceList[idx];
            if (voice) {
                this.voiceSelectHandler(voice.id, voice.name);
            }
            return;
        }
        // Generic prefix routing
        for (const [prefix, handler] of this.callbackHandlers) {
            if (query.data.startsWith(prefix)) {
                handler(query.data);
                return;
            }
        }
    }
    // --- Private: Utilities ---
    /** Return reply_markup for the persistent keyboard, or empty object if none set. */
    keyboardMarkup() {
        if (!this.persistentKeyboard)
            return {};
        return {
            reply_markup: {
                keyboard: this.persistentKeyboard.map(row => row.map(text => ({ text }))),
                resize_keyboard: true,
                is_persistent: true,
                one_time_keyboard: false,
            },
        };
    }
    setChatId(id) {
        if (this.chatId !== id) {
            this.chatId = id;
            this.onChatIdChanged?.(id);
        }
        else {
            this.chatId = id;
        }
    }
    isAuthorized(userId) {
        return userId === this.authorizedUserId;
    }
    splitMessage(text) {
        const maxLen = 4096;
        const chunks = [];
        let remaining = text;
        while (remaining.length > 0) {
            if (remaining.length <= maxLen) {
                chunks.push(remaining);
                break;
            }
            let splitIdx = remaining.lastIndexOf('\n', maxLen);
            if (splitIdx <= 0)
                splitIdx = maxLen;
            chunks.push(remaining.slice(0, splitIdx));
            remaining = remaining.slice(splitIdx).trimStart();
        }
        return chunks;
    }
    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}
//# sourceMappingURL=telegram.js.map