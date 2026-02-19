export interface Channel {
    /** Channel identifier (e.g., 'telegram', 'slack', 'teams') */
    readonly name: string;
    /** Start listening for messages */
    start(): Promise<void>;
    /** Stop the channel gracefully */
    stop(): void;
    /** Register handler for incoming text messages */
    onText(handler: (text: string) => void): void;
    /** Register handler for incoming voice messages */
    onVoice(handler: (filePath: string) => void): void;
    /** Register handler for incoming photo messages (batched for albums) */
    onPhoto(handler: (photos: {
        filePath: string;
        caption?: string;
    }[]) => void): void;
    /** Register handler for bot/slash commands */
    onCommand(command: string, handler: (args: string) => void): void;
    /** Send a text message to the user (with formatting/Markdown) */
    sendText(text: string): Promise<void>;
    /** Send a raw text message without formatting (preserves special chars like brackets) */
    sendTextRaw(text: string): Promise<void>;
    /** Send a voice message to the user */
    sendVoice(audio: Buffer): Promise<void>;
    /** Send an inline keyboard with breadcrumb and optional message */
    sendInlineKeyboard(text: string, buttons: InlineButton[][]): Promise<void>;
    /** Set a persistent keyboard at the bottom of the chat */
    setPersistentKeyboard(buttons: string[][]): Promise<void>;
    /** Show a "typing" or "working" indicator to the user */
    sendTyping(): Promise<void>;
    /** Show a specific chat action indicator (e.g., 'record_voice', 'upload_voice', 'typing') */
    sendChatAction(action: string): Promise<void>;
    /** Display a voice list with selection UI (optional) */
    sendVoiceList?(voices: {
        id: string;
        name: string;
        description: string;
    }[]): Promise<void>;
    /** Register handler for voice selection (inline buttons, etc.) */
    onVoiceSelect?(handler: (voiceId: string, voiceName: string) => void): void;
    /** Register a generic callback handler for inline button presses */
    onCallback(prefix: string, handler: (data: string) => void): void;
    /** Whether the channel has an active conversation context */
    isReady(): boolean;
}
export interface InlineButton {
    label: string;
    callbackData: string;
}
export interface TelegramChannelConfig {
    botToken: string;
    authorizedUserId: number;
}
export interface ServiceConfig {
    servicePort: number;
    bridgeUrl: string;
}
export interface VoiceConfig {
    sttBackend: 'openai' | 'local' | 'aws-transcribe';
    openaiApiKey: string;
    whisperCliPath: string;
    whisperModelPath: string;
    awsTranscribeRegion: string;
    awsTranscribeLanguage: string;
    elevenlabsApiKey: string;
    elevenlabsVoiceId: string;
    elevenlabsSpeed: number;
}
export type TargetType = 'global' | 'project' | 'card';
export type ResponseMode = 'text' | 'voice' | 'both';
export interface NavigationTarget {
    type: TargetType;
    projectId?: string;
    cardId?: string;
    stage?: string;
}
export interface Project {
    id: string;
    name: string;
    description: string;
    path: string;
}
export interface AppState {
    selectedProjectId: string | null;
    selectedCardId: string | null;
    selectedCardStage: string | null;
    targetType: TargetType;
    projects: Project[];
}
export interface KanbanCard {
    id: string;
    title: string;
    description: string;
    type: string;
    priority: string;
    order: number;
    areas: string[];
    tags: string[];
    problems: Array<{
        id: string;
        description: string;
        severity: string;
        resolved_at?: string;
    }>;
    checklist: Array<{
        id: string;
        text: string;
        done: boolean;
    }>;
    agentNotes?: Array<{
        id: number;
        text: string;
        timestamp: string;
    }>;
    design_ref?: string;
    feature_ref?: string;
    archived?: boolean;
    automation?: Record<string, unknown>;
    created_at: string;
    updated_at: string;
}
export interface KanbanStages {
    backlog: KanbanCard[];
    design: KanbanCard[];
    implementation: KanbanCard[];
    testing: KanbanCard[];
    done: KanbanCard[];
}
export interface KanbanBoard {
    project_id: string;
    stages: KanbanStages;
    last_updated: string;
}
export interface SlyActionConfig {
    label: string;
    description: string;
    group: string;
    placement: string;
    prompt: string;
    scope: string;
    projects: string[];
    cardTypes?: string[];
}
export interface SlyActionsFile {
    commands: Record<string, SlyActionConfig>;
    classAssignments: Record<string, string[]>;
}
export interface BridgeSessionInfo {
    name: string;
    status: 'running' | 'stopped' | 'detached';
    pid: number | null;
    connectedClients: number;
    hasHistory: boolean;
    resumed: boolean;
    lastActive?: string;
    provider?: string;
    skipPermissions?: boolean;
}
export interface BridgeCreateSessionRequest {
    name: string;
    command?: string;
    cwd?: string;
    fresh?: boolean;
    prompt?: string;
    provider?: string;
    skipPermissions?: boolean;
    createInstructionFile?: boolean;
}
export interface InstructionFileCheck {
    needed: boolean;
    targetFile?: string;
    copySource?: string;
}
export interface PendingInstructionFileConfirm {
    provider: string;
    cwd: string;
    sessionName: string;
    targetFile: string;
    copySource: string;
    originalMessage: string;
}
