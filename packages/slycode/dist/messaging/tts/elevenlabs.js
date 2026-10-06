import { toElevenLabsText } from './speech-markup.js';
import { VoiceLookupError } from './errors.js';
import { RenderCancelledError, VoicesUnavailableError } from './errors.js';
export const ELEVENLABS_MODEL_ID = 'eleven_v3';
/** Max concurrent ElevenLabs requests (the plan's hard cap is 3); extra callers queue. */
export const ELEVENLABS_CONCURRENCY = 2;
const VOICE_SETTINGS = { stability: 0.5, similarity_boost: 0.75 };
export class ElevenLabsProvider {
    config;
    fetchImpl;
    id = 'elevenlabs';
    label = 'ElevenLabs';
    model = ELEVENLABS_MODEL_ID;
    /** Single request per render: every SlyCode cap (speak, /voice, generate) is within ElevenLabs' limit. */
    maxRenderChars = Number.POSITIVE_INFINITY;
    concurrency = ELEVENLABS_CONCURRENCY;
    /** Speed goes in the request body (voice_settings.speed). */
    nativeSpeed = true;
    constructor(config, fetchImpl) {
        this.config = config;
        this.fetchImpl = fetchImpl;
    }
    isConfigured() {
        return !!this.config.elevenlabsApiKey;
    }
    envDefaultVoice() {
        return this.config.elevenlabsVoiceId
            ? { provider: 'elevenlabs', id: this.config.elevenlabsVoiceId, name: 'env default' }
            : null;
    }
    builtinDefaultVoice() {
        return null;
    }
    cacheKeyParts() {
        return [ELEVENLABS_MODEL_ID, { ...VOICE_SETTINGS, speed: this.config.elevenlabsSpeed }];
    }
    async render(req) {
        // Resolve fetch at call time so tests can stub globalThis.fetch.
        const doFetch = this.fetchImpl ?? globalThis.fetch;
        const abortError = () => req.signal.reason instanceof Error ? req.signal.reason : new RenderCancelledError();
        if (req.signal.aborted)
            throw abortError();
        let response;
        try {
            response = await doFetch(`https://api.elevenlabs.io/v1/text-to-speech/${req.voiceId}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'xi-api-key': this.config.elevenlabsApiKey,
                    'Accept': 'audio/mpeg',
                },
                body: JSON.stringify({
                    text: toElevenLabsText(req.chunk.script),
                    model_id: ELEVENLABS_MODEL_ID,
                    voice_settings: {
                        stability: VOICE_SETTINGS.stability,
                        similarity_boost: VOICE_SETTINGS.similarity_boost,
                        speed: this.config.elevenlabsSpeed,
                    },
                    output_format: 'mp3_44100_128',
                }),
                signal: req.signal,
            });
        }
        catch (err) {
            if (req.signal.aborted)
                throw abortError();
            throw err;
        }
        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`ElevenLabs API error (${response.status}): ${errorText}`);
        }
        let arrayBuffer;
        try {
            arrayBuffer = await response.arrayBuffer();
        }
        catch (err) {
            if (req.signal.aborted)
                throw abortError();
            throw err;
        }
        return { kind: 'mp3', data: Buffer.from(arrayBuffer) };
    }
    async searchVoices(query, opts = {}) {
        const rows = opts.strict
            ? await searchElevenLabsVoicesStrict(this.config.elevenlabsApiKey, query.text)
            : await searchElevenLabsVoices(this.config.elevenlabsApiKey, query.text);
        return rows.map(v => ({ ...v, provider: 'elevenlabs' }));
    }
    /**
     * What a user typed → a voice. Unchanged from feature 086: a 20-character
     * id is taken as an id (ElevenLabs ids are not re-verified); anything else
     * must match exactly ONE voice name (case-insensitive) in a strict search.
     */
    async resolveVoiceValue(value) {
        const wanted = value.trim();
        if (ELEVENLABS_ID_PATTERN.test(wanted))
            return { provider: 'elevenlabs', id: wanted, name: wanted };
        const candidates = await this.searchVoices({ text: wanted }, { strict: true });
        const exact = candidates.filter(v => v.name.trim().toLowerCase() === wanted.toLowerCase());
        if (exact.length === 1)
            return { provider: 'elevenlabs', id: exact[0].voice_id, name: exact[0].name };
        if (exact.length === 0) {
            throw new VoiceLookupError('voice_not_found', `No voice named exactly '${wanted}'. Use \`sly-messaging voices "${wanted}"\` to list candidates and set by id.`, candidates.slice(0, 10));
        }
        throw new VoiceLookupError('voice_ambiguous', `${exact.length} voices are named '${wanted}'; set by id instead.`, exact);
    }
}
/** ElevenLabs voice ids are 20 alphanumeric characters. */
export const ELEVENLABS_ID_PATTERN = /^[A-Za-z0-9]{20}$/;
async function fetchVoiceList(url, headers, fallbackCategory) {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(8000) });
    if (!res.ok)
        throw new VoicesUnavailableError(`ElevenLabs voices request failed (${res.status}) for ${url}`);
    const data = await res.json();
    return (data.voices || []).map((v) => ({
        voice_id: v.voice_id,
        name: v.name,
        category: v.category || fallbackCategory,
        description: v.description || '',
        labels: v.labels || {},
        // The library's own sample clip; the web picker plays it instead of a paid render.
        ...(typeof v.preview_url === 'string' && /^https:\/\//.test(v.preview_url) ? { preview_url: v.preview_url } : {}),
    }));
}
function mergeVoices(personal, shared) {
    const seen = new Set();
    const merged = [];
    for (const v of [...personal, ...shared]) {
        if (!seen.has(v.voice_id)) {
            seen.add(v.voice_id);
            merged.push(v);
        }
    }
    return merged;
}
/**
 * Like searchElevenLabsVoices but an upstream failure (network, non-2xx)
 * THROWS VoicesUnavailableError instead of degrading to an empty list, so
 * callers that need to distinguish "no such voice" from "could not ask" (the
 * project voice setter, feature 086) never report an outage as "not found".
 */
export async function searchElevenLabsVoicesStrict(apiKey, query) {
    const headers = { 'xi-api-key': apiKey };
    const personalParams = new URLSearchParams({ page_size: '10' });
    const sharedParams = new URLSearchParams({ page_size: '10' });
    if (query) {
        personalParams.set('search', query);
        sharedParams.set('search', query);
    }
    try {
        const [personal, shared] = await Promise.all([
            fetchVoiceList(`https://api.elevenlabs.io/v2/voices?${personalParams}`, headers, 'personal'),
            fetchVoiceList(`https://api.elevenlabs.io/v1/shared-voices?${sharedParams}`, headers, 'community'),
        ]);
        return mergeVoices(personal, shared);
    }
    catch (err) {
        if (err instanceof VoicesUnavailableError)
            throw err;
        throw new VoicesUnavailableError(`ElevenLabs voices unavailable: ${err.message}`);
    }
}
/** Lenient search (Telegram picker): an upstream failure degrades to an empty list. */
export async function searchElevenLabsVoices(apiKey, query) {
    const headers = { 'xi-api-key': apiKey };
    const lenient = (url, fallbackCategory) => fetchVoiceList(url, headers, fallbackCategory).catch(() => []);
    const personalParams = new URLSearchParams({ page_size: '10' });
    const sharedParams = new URLSearchParams({ page_size: '10' });
    if (query) {
        personalParams.set('search', query);
        sharedParams.set('search', query);
    }
    const [personal, shared] = await Promise.all([
        lenient(`https://api.elevenlabs.io/v2/voices?${personalParams}`, 'personal'),
        lenient(`https://api.elevenlabs.io/v1/shared-voices?${sharedParams}`, 'community'),
    ]);
    return mergeVoices(personal, shared);
}
//# sourceMappingURL=elevenlabs.js.map