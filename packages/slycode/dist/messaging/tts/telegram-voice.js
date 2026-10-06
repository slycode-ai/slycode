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
import { PROVIDER_LABELS } from './provider.js';
import { VoiceLookupError, VoicesUnavailableError } from './errors.js';
const LIST_MAX = 8;
export function createVoiceCommands(deps) {
    const { channel, tts, state } = deps;
    const staleText = () => `The TTS provider changed while that was running (it is now ${PROVIDER_LABELS[tts.active().id]}). Run /voice again.`;
    const unchanged = (provider, revision) => tts.active().id === provider && tts.revision() === revision;
    async function showList(candidates, heading, provider, revision) {
        const shown = candidates.slice(0, LIST_MAX);
        if (channel.sendVoiceList) {
            await channel.sendText(heading);
            // Stamped with the provider and revision captured before the lookup, so
            // a button pressed after a switch is refused by onSelect.
            await channel.sendVoiceList(shown.map(v => ({
                id: v.voice_id,
                name: v.name,
                description: [v.category, v.labels?.accent].filter(Boolean).join(', '),
                // Designed voices keep kind + expiry through the button (fix loop).
                ...(v.category === 'custom' ? { kind: 'custom' } : {}),
                ...(v.expiresAt ? { expiresAt: v.expiresAt } : {}),
            })), { provider, revision });
        }
        else {
            const list = shown.map((v, i) => `${i + 1}. *${v.name}* (${v.category}) - \`${v.voice_id}\``).join('\n');
            await channel.sendText(`${heading}\n\n${list}\n\nSend /voice <id> to select one.`);
        }
    }
    async function onCommand(args) {
        let provider;
        try {
            provider = tts.requireActive();
        }
        catch (err) {
            await channel.sendText(err.message);
            return;
        }
        // Captured before any await (see the module comment).
        const revision = tts.revision();
        const query = args.trim();
        if (!query) {
            const voice = state.getVoice(provider.id);
            const fallback = provider.envDefaultVoice() ?? provider.builtinDefaultVoice();
            const warnings = tts.health().warnings.length ? `\n\n⚠️ ${tts.health().warnings.join('\n⚠️ ')}` : '';
            await channel.sendText((voice
                ? `Provider: ${provider.label}\nCurrent voice: *${voice.name}*`
                : `Provider: ${provider.label}\nUsing the default voice${fallback ? ` (${fallback.name})` : ''}.`)
                + `\n\nUsage:\n/voice <name or id> - search and select\n/voice reset - use default${warnings}`);
            return;
        }
        if (query === 'reset') {
            state.clearVoice(provider.id);
            await channel.sendText('Voice reset to default.');
            return;
        }
        try {
            await channel.sendTyping();
            const chosen = await provider.resolveVoiceValue(query);
            if (!unchanged(provider.id, revision)) {
                await channel.sendText(staleText());
                return;
            }
            state.setVoice(chosen.id, chosen.name, provider.id, { kind: chosen.kind, expiresAt: chosen.expiresAt });
            await channel.sendTextRaw(`Voice set to ${chosen.name}\nID: ${chosen.id}`);
        }
        catch (err) {
            if (err instanceof VoiceLookupError) {
                if (err.candidates.length === 0) {
                    await channel.sendText(`No voices found for "${query}".`);
                    return;
                }
                const heading = err.code === 'voice_ambiguous'
                    ? `"${query}" matches ${err.candidates.length} voices; pick one:`
                    : `No voice named exactly "${query}". Closest matches:`;
                await showList(err.candidates, heading, provider.id, revision);
                return;
            }
            if (err instanceof VoicesUnavailableError) {
                await channel.sendText(`Voice search is unavailable right now: ${err.message}`);
                return;
            }
            await channel.sendText(`Error searching voices: ${err.message}`);
        }
    }
    async function onSelect(voiceId, voiceName, pick) {
        // Refuse stale picks: an older list, or one made before a provider
        // switch, must never write its voice into the active provider's slot.
        const active = tts.active();
        if (pick.stale || pick.provider !== active.id || pick.revision !== tts.revision()) {
            await channel.sendText(`That voice list is out of date (the provider is now ${PROVIDER_LABELS[active.id]}). Run /voice again.`);
            return;
        }
        state.setVoice(voiceId, voiceName, active.id, { kind: pick.kind, expiresAt: pick.expiresAt });
        await channel.sendTextRaw(`Voice set to ${voiceName}\nID: ${voiceId}`);
    }
    return { onCommand, onSelect };
}
//# sourceMappingURL=telegram-voice.js.map