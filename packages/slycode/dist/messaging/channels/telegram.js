import TelegramBot from 'node-telegram-bot-api';
import fs from 'fs';
import path from 'path';
import os from 'os';
export class TelegramChannel {
    name = 'Telegram';
    bot;
    botToken;
    authorizedUserId;
    chatId = null;
    textHandler;
    voiceHandler;
    photoHandler;
    voiceSelectHandler;
    callbackHandlers = new Map();
    persistentKeyboard = null;
    pendingVoiceList = [];
    // Photo album batching
    photoBuffer = new Map();
    constructor(config) {
        this.authorizedUserId = config.authorizedUserId;
        this.botToken = config.botToken;
        this.bot = new TelegramBot(config.botToken, { polling: true });
    }
    async start() {
        // Set up message listener
        this.bot.on('message', (msg) => {
            if (!msg.from || !this.isAuthorized(msg.from.id))
                return;
            this.setChatId(msg.chat.id);
            // Text messages (non-commands)
            if (msg.text && !msg.text.startsWith('/') && this.textHandler) {
                this.textHandler(msg.text);
            }
        });
        // Voice message listener
        this.bot.on('voice', async (msg) => {
            if (!msg.from || !this.isAuthorized(msg.from.id))
                return;
            if (!msg.voice)
                return;
            this.setChatId(msg.chat.id);
            if (this.voiceHandler) {
                try {
                    const fileLink = await this.bot.getFileLink(msg.voice.file_id);
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
            }
        });
        // Photo message listener — batches album photos via media_group_id
        this.bot.on('photo', async (msg) => {
            if (!msg.from || !this.isAuthorized(msg.from.id))
                return;
            if (!msg.photo || msg.photo.length === 0)
                return;
            this.setChatId(msg.chat.id);
            if (!this.photoHandler)
                return;
            try {
                // Download the photo (largest resolution = last in array)
                const photo = msg.photo[msg.photo.length - 1];
                const fileLink = await this.bot.getFileLink(photo.file_id);
                const tempPath = path.join(os.tmpdir(), `photo_${Date.now()}_${Math.random().toString(36).slice(2, 6)}.jpg`);
                const response = await fetch(fileLink);
                const buffer = Buffer.from(await response.arrayBuffer());
                fs.writeFileSync(tempPath, buffer);
                const entry = { filePath: tempPath, caption: msg.caption || undefined };
                if (msg.media_group_id) {
                    // Album photo — buffer and flush after 2s of no new photos
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
                        this.photoHandler(group.photos);
                    }, 2000);
                }
                else {
                    // Single photo — deliver immediately
                    this.photoHandler([entry]);
                }
            }
            catch (err) {
                console.error('Error downloading photo:', err);
                await this.sendText(`Error processing photo: ${err.message}`);
            }
        });
        // Inline button callbacks — route by prefix
        this.bot.on('callback_query', async (query) => {
            if (!query.from || !this.isAuthorized(query.from.id))
                return;
            if (!query.data || !query.message)
                return;
            this.setChatId(query.message.chat.id);
            await this.bot.answerCallbackQuery(query.id);
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
        });
        console.log(`[${this.name}] Channel started (long polling)`);
    }
    stop() {
        this.bot.stopPolling();
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
        this.bot.onText(new RegExp(`^/${command}(.*)$`), (msg, match) => {
            if (!msg.from || !this.isAuthorized(msg.from.id))
                return;
            this.setChatId(msg.chat.id);
            const args = (match?.[1] || '').trim();
            handler(args);
        });
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
        const opts = this.keyboardMarkup();
        if (opts.reply_markup) {
            // sendVoice via library uses form-urlencoded; reply_markup must be JSON string
            await this.bot.sendVoice(this.chatId, audio, {
                reply_markup: JSON.stringify(opts.reply_markup),
            });
        }
        else {
            await this.bot.sendVoice(this.chatId, audio);
        }
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
    async sendTyping() {
        await this.sendChatAction('typing');
    }
    async sendChatAction(action) {
        if (!this.chatId)
            return;
        try {
            await this.bot.sendChatAction(this.chatId, action);
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
        await this.bot.sendMessage(this.chatId, 'Select a voice:', {
            reply_markup: {
                inline_keyboard: keyboard,
            },
        });
    }
    onVoiceSelect(handler) {
        this.voiceSelectHandler = handler;
    }
    isReady() {
        return this.chatId !== null;
    }
    setChatId(id) {
        this.chatId = id;
    }
    isAuthorized(userId) {
        return userId === this.authorizedUserId;
    }
    /** Send a message via Telegram API using JSON (avoids form-urlencoded escaping bugs). */
    async apiSendMessage(chatId, text, opts) {
        const body = { chat_id: chatId, text, ...opts };
        const res = await fetch(`https://api.telegram.org/bot${this.botToken}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        const data = await res.json();
        if (!data.ok)
            throw new Error(`Telegram API error: ${data.description}`);
        return data.result;
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
}
//# sourceMappingURL=telegram.js.map