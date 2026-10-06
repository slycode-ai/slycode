/**
 * Telegram `/voice` command and voice-list picks (feature 087).
 *
 * Names resolve through `provider.resolveVoiceValue`, the same resolution the
 * CLI and `PUT /projects/:id/voice` use: one exact match sets the voice, an
 * ambiguous name or a near miss shows the candidates as a pick list, never a
 * silent first match. The provider and switch revision are captured before
 * any await and rechecked right before the write, so a provider switch during
 * the lookup can't land a voice in the wrong provider's slot.
 */
import type { Channel, VoicePick } from '../types.js';
import type { StateManager } from '../state.js';
import type { TtsRuntime } from './runtime.js';
type VoiceChannel = Pick<Channel, 'sendText' | 'sendTextRaw' | 'sendTyping' | 'sendVoiceList'>;
type VoiceRuntime = Pick<TtsRuntime, 'requireActive' | 'active' | 'revision' | 'health'>;
type VoiceState = Pick<StateManager, 'getVoice' | 'setVoice' | 'clearVoice'>;
export declare function createVoiceCommands(deps: {
    channel: VoiceChannel;
    tts: VoiceRuntime;
    state: VoiceState;
}): {
    onCommand: (args: string) => Promise<void>;
    onSelect: (voiceId: string, voiceName: string, pick: VoicePick) => Promise<void>;
};
export {};
