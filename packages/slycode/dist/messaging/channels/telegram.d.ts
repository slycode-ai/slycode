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
    onVoice(handler: (filePath: string) => void): void;
    onPhoto(handler: (photos: {
        filePath: string;
        caption?: string;
    }[]) => void): void;
    onCommand(command: string, handler: (args: string) => void): void;
    onCallback(prefix: string, handler: (data: string) => void): void;
    sendText(text: string): Promise<void>;
    sendTextRaw(text: string): Promise<void>;
    sendVoice(audio: Buffer): Promise<void>;
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
    private apiCall;
    /** Send a text message via Telegram API. */
    private apiSendMessage;
    /** Get a file download URL from a file_id. */
    private apiGetFileLink;
    /** Send a voice message (multipart/form-data for binary upload). */
    private apiSendVoice;
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
