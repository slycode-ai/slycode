import type { Channel, TelegramChannelConfig, InlineButton } from '../types.js';
export declare class TelegramChannel implements Channel {
    readonly name = "Telegram";
    private bot;
    private botToken;
    private authorizedUserId;
    private chatId;
    private textHandler?;
    private voiceHandler?;
    private photoHandler?;
    private voiceSelectHandler?;
    private callbackHandlers;
    private persistentKeyboard;
    private pendingVoiceList;
    private photoBuffer;
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
    /** Return reply_markup for the persistent keyboard, or empty object if none set. */
    private keyboardMarkup;
    sendTyping(): Promise<void>;
    sendChatAction(action: string): Promise<void>;
    sendVoiceList(voices: {
        id: string;
        name: string;
        description: string;
    }[]): Promise<void>;
    onVoiceSelect(handler: (voiceId: string, voiceName: string) => void): void;
    isReady(): boolean;
    private setChatId;
    private isAuthorized;
    /** Send a message via Telegram API using JSON (avoids form-urlencoded escaping bugs). */
    private apiSendMessage;
    private splitMessage;
}
