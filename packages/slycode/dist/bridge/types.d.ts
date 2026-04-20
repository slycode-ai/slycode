import type { IPty } from 'node-pty';
import type { WebSocket } from 'ws';
import type { Response } from 'express';
import type { Terminal as HeadlessTerminal } from '@xterm/headless';
import type { SerializeAddon } from '@xterm/addon-serialize';
export type SessionStatus = 'running' | 'stopped' | 'detached' | 'creating';
export interface TerminalDimensions {
    cols: number;
    rows: number;
}
export interface Session {
    name: string;
    group: string;
    command: string;
    args: string[];
    cwd: string;
    provider: string;
    skipPermissions: boolean;
    model?: string;
    status: SessionStatus;
    pid: number | null;
    connectedClients: number;
    claudeSessionId: string | null;
    createdAt: string;
    lastActive: string;
    lastOutputAt: string;
    activityStartedAt: string;
    idleTimeout: number | null;
    pty: IPty | null;
    clients: Set<WebSocket>;
    sseClients: Set<Response>;
    headlessTerminal: HeadlessTerminal | null;
    serializeAddon: SerializeAddon | null;
    terminalDimensions: TerminalDimensions;
    claudeBeforeFiles?: string[];
    claudeDir?: string;
    guidRetryAttempted?: boolean;
    guidDetectionCancelled?: boolean;
    lastClientDisconnect?: string;
    exitResolver?: () => void;
    pendingPrompt?: string;
    pendingPromptTimer?: ReturnType<typeof setTimeout>;
    exitCode?: number;
    exitedAt?: string;
    exitOutput?: string;
    stoppedByUser?: boolean;
    lastActivityState?: boolean;
    lastOutputSnippet?: string;
    lastOutputRawHex?: string;
    lastOutputDataLength?: number;
    activityTransitions: ActivityTransition[];
}
export interface ActivityTransition {
    timestamp: string;
    became: 'active' | 'inactive';
    lastOutputAt: string;
    activityStartedAt: string;
    outputAgeMs: number;
    triggerSnippet: string;
    triggerRawHex: string;
    triggerDataLength: number;
}
export interface CreateSessionRequest {
    name: string;
    command?: string;
    provider?: string;
    skipPermissions?: boolean;
    model?: string;
    cwd?: string;
    fresh?: boolean;
    idleTimeout?: number;
    prompt?: string;
    createInstructionFile?: boolean;
}
export interface SessionInfo {
    name: string;
    group: string;
    status: SessionStatus;
    pid: number | null;
    connectedClients: number;
    hasHistory: boolean;
    resumed: boolean;
    lastActive: string;
    lastOutputAt?: string;
    claudeSessionId?: string | null;
    provider?: string;
    skipPermissions?: boolean;
    model?: string;
    exitCode?: number;
    exitedAt?: string;
    createdAt?: string;
}
export interface PersistedSession {
    claudeSessionId: string | null;
    cwd: string;
    createdAt: string;
    lastActive: string;
    provider?: string;
    skipPermissions?: boolean;
    model?: string;
    exitCode?: number;
    exitedAt?: string;
    exitOutput?: string;
}
export interface PersistedState {
    sessions: Record<string, PersistedSession>;
}
export interface BridgeConfig {
    port: number;
    host: string;
    sessionFile: string;
    defaultIdleTimeout: number;
    maxSessions: number;
}
export interface BridgeRuntimeConfig {
    allowedCommands: string[];
    cors: {
        origins: string[];
    };
}
export interface WsInputMessage {
    type: 'input';
    data: string;
}
export interface WsResizeMessage {
    type: 'resize';
    cols: number;
    rows: number;
}
export interface WsSignalMessage {
    type: 'signal';
    signal: string;
}
export type WsClientMessage = WsInputMessage | WsResizeMessage | WsSignalMessage | string;
export interface WsOutputMessage {
    type: 'output';
    data: string;
}
export interface WsExitMessage {
    type: 'exit';
    code: number;
    output?: string;
}
export interface WsErrorMessage {
    type: 'error';
    message: string;
}
export type WsServerMessage = WsOutputMessage | WsExitMessage | WsErrorMessage;
export interface SessionActivity {
    name: string;
    status: SessionStatus;
    lastOutputAt: string | null;
    isActive: boolean;
    activityStartedAt?: string;
    lastOutputSnippet?: string;
}
export interface BridgeStats {
    bridgeTerminals: number;
    connectedClients: number;
    activelyWorking: number;
    sessions: SessionActivity[];
}
export interface SubmitRequest {
    prompt: string;
    bracketedPaste?: boolean;
    force?: boolean;
    callingSession?: string;
}
export interface SubmitResult {
    success: boolean;
    sessionStatus: SessionStatus;
    isActive: boolean;
    error?: string;
    locked?: boolean;
    busy?: boolean;
}
export interface SnapshotResult {
    content: string;
    lines: number;
    lastOutputAt: string;
}
export interface ResponseEntry {
    responseId: string;
    callingSession: string;
    targetSession: string;
    data?: string;
    status: 'pending' | 'received' | 'expired';
    createdAt: number;
    callerTimedOut?: boolean;
}
export interface RegisterResponseRequest {
    responseId: string;
    callingSession: string;
    targetSession: string;
}
export interface DeliverResponseRequest {
    data: string;
}
