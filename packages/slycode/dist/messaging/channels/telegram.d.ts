import type { Channel, TelegramChannelConfig, InlineButton } from '../types.js';
export declare class TelegramChannel implements Channel {
    readonly name = "Telegram";
    private botToken;
    private authorizedUserId;
    private chatId;
    private onChatIdChanged?;
    private textHandler?;
    private voiceHandler?;
    private photoHandler?;
    private voiceSelectHandler?;
    private callbackHandlers;
    private commandHandlers;
    private persistentKeyboard;
    private pendingVoiceList;
    private photoBuffer;
    private polling;
    private pollOffset;
    private pollAbort;
    constructor(config: TelegramChannelConfig);
    start(): Promise<void>;
    stop(): void;
    onText(handler: (text: string) => void): void;
    onVoice(handler: (filePath: string, messageId?: number) => void): void;
    onPhoto(handler: (photos: {
        filePath: string;
        caption?: string;
    }[]) => void): void;
    onCommand(command: string, handler: (args: string) => void): void;
    onCallback(prefix: string, handler: (data: string) => void): void;
    sendText(text: string): Promise<void>;
    sendTextRaw(text: string): Promise<void>;
    sendReply(text: string, replyToMessageId: number): Promise<void>;
    sendVoice(audio: Buffer): Promise<{
        messageId: number;
    }>;
    sendMedia(req: {
        filePath: string;
        kind: 'voice' | 'audio' | 'video' | 'document';
        caption?: string;
    }): Promise<{
        messageId: number;
    }>;
    private guessAudioMime;
    private guessVideoMime;
    sendInlineKeyboard(text: string, buttons: InlineButton[][]): Promise<void>;
    setPersistentKeyboard(buttons: string[][]): Promise<void>;
    sendTyping(): Promise<void>;
    sendChatAction(action: string): Promise<void>;
    sendVoiceList(voices: {
        id: string;
        name: string;
        description: string;
    }[]): Promise<void>;
    onVoiceSelect(handler: (voiceId: string, voiceName: string) => void): void;
    isReady(): boolean;
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
    private apiCall;
    /** Send a text message via Telegram API. */
    private apiSendMessage;
    /** Get a file download URL from a file_id. getFile is idempotent → retry it. */
    private apiGetFileLink;
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
    private downloadFileWithRetry;
    /**
     * Shared multipart upload helper for sendVoice/sendAudio/sendVideo/sendDocument.
     * Returns the Telegram `message_id` of the sent message.
     */
    private apiSendMultipart;
    /** Acknowledge a callback query. */
    private apiAnswerCallbackQuery;
    private pollLoop;
    /** Route an update to the appropriate handler. */
    private dispatchUpdate;
    /** Handle an incoming message (text, voice, photo, or command). */
    private handleMessage;
    /** Handle a callback query (inline button press). */
    private handleCallbackQuery;
    /** Return reply_markup for the persistent keyboard, or empty object if none set. */
    private keyboardMarkup;
    private setChatId;
    private isAuthorized;
    private splitMessage;
    private sleep;
}
