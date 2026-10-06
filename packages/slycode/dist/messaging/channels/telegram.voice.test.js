import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { TelegramChannel } from './telegram.js';
const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });
async function uploadOf(format) {
    let captured;
    globalThis.fetch = (async (url, init) => {
        const voice = (init?.body).get('voice');
        captured = { method: String(url).split('/').pop(), name: voice.name, type: voice.type };
        return new Response(JSON.stringify({ ok: true, result: { message_id: 42 } }));
    });
    const channel = new TelegramChannel({ botToken: 'T', authorizedUserId: 1, chatId: 99 });
    const { messageId } = format ? await channel.sendVoice(Buffer.from([1, 2, 3]), format) : await channel.sendVoice(Buffer.from([1, 2, 3]));
    assert.equal(messageId, 42);
    return captured;
}
test('voice uploads default to OGG/Opus, exactly as before', async () => {
    assert.deepEqual(await uploadOf(), { method: 'sendVoice', name: 'voice.ogg', type: 'audio/ogg' });
    assert.deepEqual(await uploadOf('ogg'), { method: 'sendVoice', name: 'voice.ogg', type: 'audio/ogg' });
});
test('the MP3 fallback is labelled as MP3, not as voice.ogg (feature 087)', async () => {
    assert.deepEqual(await uploadOf('mp3'), { method: 'sendVoice', name: 'voice.mp3', type: 'audio/mpeg' });
});
test('voice-list buttons are bound to their list: a newer list or a pre-087 button is stale (feature 087)', async () => {
    globalThis.fetch = (async () => new Response(JSON.stringify({ ok: true, result: { message_id: 7 } })));
    const channel = new TelegramChannel({ botToken: 'T', authorizedUserId: 1, chatId: 99 });
    const picks = [];
    channel.onVoiceSelect((id, name, pick) => { picks.push({ id, name, pick }); });
    const press = (data) => channel
        .handleCallbackQuery({ id: 'q', from: { id: 1 }, data, message: { chat: { id: 99 }, message_id: 5 } });
    await channel.sendVoiceList([{ id: 'el-1', name: 'Laura', description: 'premade' }], { provider: 'elevenlabs', revision: 3 });
    await press('voice_1_0');
    assert.deepEqual(picks.at(-1), { id: 'el-1', name: 'Laura', pick: { provider: 'elevenlabs', revision: 3, stale: false } });
    await channel.sendVoiceList([{ id: 'kore', name: 'Kore', description: 'studio' }], { provider: 'gemini', revision: 4 });
    await press('voice_1_0');
    assert.equal(picks.at(-1).pick.stale, true, 'a button from the previous list is stale');
    await press('voice_0');
    assert.equal(picks.at(-1).pick.stale, true, 'a pre-087 button is stale');
    await press('voice_2_0');
    assert.deepEqual(picks.at(-1), { id: 'kore', name: 'Kore', pick: { provider: 'gemini', revision: 4, stale: false } });
});
test('a designed voice\'s kind and expiry ride through the button to the pick (fix loop)', async () => {
    globalThis.fetch = (async () => new Response(JSON.stringify({ ok: true, result: { message_id: 7 } })));
    const channel = new TelegramChannel({ botToken: 'T', authorizedUserId: 1, chatId: 99 });
    const picks = [];
    channel.onVoiceSelect((id, _name, pick) => { picks.push({ id, pick }); });
    await channel.sendVoiceList([
        { id: 'voice_ab12', name: 'Astronomer', description: 'custom', kind: 'custom', expiresAt: '2027-10-01T00:00:00Z' },
        { id: 'kore', name: 'Kore', description: 'studio' },
    ], { provider: 'gemini', revision: 2 });
    const press = (data) => channel
        .handleCallbackQuery({ id: 'q', from: { id: 1 }, data, message: { chat: { id: 99 }, message_id: 5 } });
    await press('voice_1_0');
    assert.deepEqual(picks.at(-1), { id: 'voice_ab12', pick: { provider: 'gemini', revision: 2, stale: false, kind: 'custom', expiresAt: '2027-10-01T00:00:00Z' } });
    await press('voice_1_1');
    assert.deepEqual(picks.at(-1), { id: 'kore', pick: { provider: 'gemini', revision: 2, stale: false } });
});
//# sourceMappingURL=telegram.voice.test.js.map