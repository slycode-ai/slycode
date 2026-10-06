import express, { type Router } from 'express';
import type { Channel } from '../types.js';
import type { StateManager } from '../state.js';
import { type AudioFormat, type SourceAudio } from './provider.js';
import type { TtsRuntime } from './runtime.js';
export interface TtsRouteDeps {
    tts: TtsRuntime;
    state: StateManager;
    /** The messaging channel (Telegram), or null when none is configured. */
    channel: () => Channel | null;
    noChannelError: string;
    /** The ambient session name (Telegram target) for callers that pass none. */
    sessionName: () => string;
    contextSlug: (session: string | undefined) => string;
    archive: (buffer: Buffer, ext: '.ogg' | '.mp3', slug: string) => void;
    /** Trailing "switch to card" message after media (Telegram). */
    afterVoiceSent: (session: string | undefined) => Promise<void>;
    workspaceRoot: () => string;
    /** Encoder for design samples (default: encodeSource); injected by tests. */
    encodeSample?: (source: SourceAudio, format: AudioFormat) => Promise<Buffer>;
}
/**
 * Map a render failure to an HTTP response (feature 087): provider errors keep
 * their stable code; deadline → 504; caller hang-up → 499; anything else is a
 * provider failure (502).
 */
export declare function ttsErrorResponse(err: unknown): {
    status: number;
    body: {
        ok: false;
        error: string;
        message: string;
    };
};
/** What a voice preview says: short, neutral, and the same for every voice so clips compare fairly. */
export declare const VOICE_PREVIEW_TEXT = "Hi there. This is how I'll sound when I read your replies aloud.";
/**
 * Routes whose bodies are bigger than the service-wide 16 KB JSON limit.
 * The app's global parser skips these and the route parses its own body.
 * Only the clone upload (two base64 WAVs, about 3 MB) is here (#0376).
 */
export declare const CLONE_PATH = "/voices/clone";
export declare const LARGE_BODY_PATHS: ReadonlySet<string>;
/** The app-wide JSON parser with the large-body routes left to parse their own (#0376). */
export declare function serviceJsonParser(limit?: string): express.RequestHandler;
export declare function createTtsRouter(deps: TtsRouteDeps): Router;
