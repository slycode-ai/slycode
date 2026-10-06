import type { VoiceConfig } from '../types.js';
import type { AudioFormat, ProviderRenderRequest, SourceAudio, TtsProvider, TtsProviderId, VoiceRef } from './provider.js';
export declare function cfg(over?: Partial<VoiceConfig>): VoiceConfig;
export interface FakeProvider extends TtsProvider {
    renders: ProviderRenderRequest[];
}
export declare function fakeProvider(id: TtsProviderId, over?: Partial<TtsProvider>): FakeProvider;
export interface Harness {
    base: string;
    sent: Array<{
        audio: Buffer;
        format?: string;
    }>;
    archived: string[];
    state: import('../state.js').StateManager;
    tts: import('./runtime.js').TtsRuntime;
    close: () => Promise<void>;
}
/** Build an app with the TTS router mounted, against the current temp SLYCODE_HOME. */
export declare function harness(opts?: {
    config?: VoiceConfig;
    providers?: Partial<Record<TtsProviderId, TtsProvider>>;
    channel?: boolean;
    encode?: (s: SourceAudio, f: AudioFormat) => Promise<Buffer>;
}): Promise<Harness>;
export declare function call(h: Harness, method: string, url: string, body?: unknown): Promise<{
    status: number;
    json: any;
}>;
export declare const decodeB64: (s: string) => string;
export type { VoiceRef };
