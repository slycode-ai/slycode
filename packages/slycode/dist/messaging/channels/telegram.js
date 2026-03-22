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
        await this.apiSendVoice(this.chatId, audio, this.keyboardMarkup());
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
    async apiCall(method, body) {
        const res = await fetch(`https://api.telegram.org/bot${this.botToken}/${method}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        const data = await res.json();
        if (!data.ok)
            throw new Error(`Telegram API error (${method}): ${data.description}`);
        return data.result;
    }
    /** Send a text message via Telegram API. */
    async apiSendMessage(chatId, text, opts) {
        return this.apiCall('sendMessage', { chat_id: chatId, text, ...opts });
    }
    /** Get a file download URL from a file_id. */
    async apiGetFileLink(fileId) {
        const file = await this.apiCall('getFile', { file_id: fileId });
        return `https://api.telegram.org/file/bot${this.botToken}/${file.file_path}`;
    }
    /** Send a voice message (multipart/form-data for binary upload). */
    async apiSendVoice(chatId, audio, opts) {
        const form = new FormData();
        form.append('chat_id', String(chatId));
        form.append('voice', new Blob([new Uint8Array(audio)], { type: 'audio/ogg' }), 'voice.ogg');
        if (opts?.reply_markup) {
            form.append('reply_markup', JSON.stringify(opts.reply_markup));
        }
        const res = await fetch(`https://api.telegram.org/bot${this.botToken}/sendVoice`, {
            method: 'POST',
            body: form,
        });
        const data = await res.json();
        if (!data.ok)
            throw new Error(`Telegram API error (sendVoice): ${data.description}`);
        return data.result;
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
                const response = await fetch(fileLink);
                const buffer = Buffer.from(await response.arrayBuffer());
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
                const response = await fetch(fileLink);
                const buffer = Buffer.from(await response.arrayBuffer());
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