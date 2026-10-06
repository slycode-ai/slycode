import { parseL16, parseWav } from './audio-encode.js';
import { RenderCancelledError, TtsProviderError, VoiceLookupError, VoiceUnusableError, VoicesUnavailableError } from './errors.js';
import { RequestLimiter, parseRetryAfterMs } from './rate-limit.js';
import { DEFAULT_CHUNK_CHARS, toGeminiParts } from './speech-markup.js';
import { isCustomVoiceId, unusableVoiceMessage } from './custom-voices.js';
const API = 'https://generativelanguage.googleapis.com/v1beta';
export const GEMINI_DEFAULT_MODEL = 'gemini-3.8-flash-tts';
export const GEMINI_CONCURRENCY = parseInt(process.env.GEMINI_TTS_CONCURRENCY || '3', 10);
export const GEMINI_TTS_RPM = parseInt(process.env.GEMINI_TTS_RPM || '10', 10);
const CATALOGUE_TTL_MS = 24 * 60 * 60 * 1000;
const LOOKUP_TIMEOUT_MS = 10_000;
/** Voice design is synchronous; phase 0 measured 26 s. */
export const DESIGN_TIMEOUT_MS = parseInt(process.env.GEMINI_VOICE_DESIGN_TIMEOUT_MS || '90000', 10);
/** The 30 studio voices with Google's one-word descriptors (offline fallback). */
export const STUDIO_VOICES = [
    ['Zephyr', 'Bright'], ['Puck', 'Upbeat'], ['Charon', 'Informative'], ['Kore', 'Firm'], ['Fenrir', 'Excitable'],
    ['Leda', 'Youthful'], ['Orus', 'Firm'], ['Aoede', 'Breezy'], ['Callirrhoe', 'Easy-going'], ['Autonoe', 'Bright'],
    ['Enceladus', 'Breathy'], ['Iapetus', 'Clear'], ['Umbriel', 'Easy-going'], ['Algieba', 'Smooth'], ['Despina', 'Smooth'],
    ['Erinome', 'Clear'], ['Algenib', 'Gravelly'], ['Rasalgethi', 'Informative'], ['Laomedeia', 'Upbeat'], ['Achernar', 'Soft'],
    ['Alnilam', 'Firm'], ['Schedar', 'Even'], ['Gacrux', 'Mature'], ['Pulcherrima', 'Forward'], ['Achird', 'Friendly'],
    ['Zubenelgenubi', 'Casual'], ['Vindemiatrix', 'Gentle'], ['Sadachbia', 'Lively'], ['Sadaltager', 'Knowledgeable'], ['Sulafat', 'Warm'],
].map(([name, descriptor]) => ({ id: name.toLowerCase(), name, descriptor }));
const STUDIO_BY_ID = new Map(STUDIO_VOICES.map((v) => [v.id, v]));
/**
 * The built-in default voice (owner choice, #0376): library voice Zuri, the
 * closest stock voice to the owner's own. It replaces studio voice Kore.
 * Known offline like the studio voices, so lookups, `voice set Zuri` and
 * switch checks need no catalogue fetch. Rendered on a plain paid key 2026-10-05.
 */
export const BUILTIN_VOICE = {
    id: 'en-us-zuri',
    type: 'prebuilt',
    display_name: 'Zuri',
    language_code: 'en-US',
    accent: 'East Coast',
    gender: 'female',
    persona: 'High-Trust Advisor / Authoritative Advisor (Financial Advisor)',
    description: '33-year-old Financial Advisor from the East Coast. Speaks with an East Coast accent. Voice is natural and clear.',
};
/**
 * Google's clone refusals that need their own message (#0376 live probe,
 * 2026-10-05): a failed consent check came back as HTTP **500** INTERNAL
 * whose debug detail carries "Consent flow failed … The recorded phrase
 * didn't match the text on screen …" (code FINISH_REASON_INPUT_VR_TAKEDOWN),
 * so this reads the whole error, not the status. A location block is
 * Google's usual "User location is not supported" FAILED_PRECONDITION.
 */
export function cloneRefusal(json) {
    const texts = [];
    const collect = (v) => {
        if (typeof v === 'string')
            texts.push(v);
        else if (Array.isArray(v))
            v.forEach(collect);
        else if (v && typeof v === 'object')
            Object.values(v).forEach(collect);
    };
    collect(json);
    const consent = texts.find((t) => /Consent flow failed|FINISH_REASON_INPUT_VR/i.test(t));
    if (consent) {
        // Google's own reason follows the troubleshooting line, e.g. "The recorded phrase didn't match the text on screen."
        const reason = /troubleshooting\.\s*\n([^\n[]+)/.exec(consent)?.[1]?.replace(/\s*Please read the prompt exactly as written\.?/i, '').trim();
        return new TtsProviderError('clone_consent_failed', `Google couldn't confirm the consent recording${reason ? ` (${reason.replace(/\.$/, '')})` : ''}. Record both again in the same quiet room, reading the statement exactly as shown.`, 422);
    }
    if (texts.some((t) => /location is not supported|not available in your (country|region)|unsupported (country|region|location)/i.test(t))) {
        return new TtsProviderError('clone_unavailable_region', "Google doesn't offer voice cloning in this account's region. Designed voices still work.", 403);
    }
    return null;
}
function isBuiltinVoice(value) {
    const v = value.trim().toLowerCase();
    return v === BUILTIN_VOICE.id || v === BUILTIN_VOICE.display_name.toLowerCase();
}
function builtinRef() {
    return { provider: 'gemini', id: BUILTIN_VOICE.id, name: BUILTIN_VOICE.display_name, kind: 'library' };
}
let languageNames = null;
function languageName(code) {
    if (!code)
        return '';
    try {
        languageNames ??= new Intl.DisplayNames(['en'], { type: 'language' });
        return languageNames.of(code) ?? code;
    }
    catch {
        return code;
    }
}
function isCustom(v) {
    return v.id.startsWith('voice_') || v.type === 'prompted' || v.type === 'replicated';
}
function toInfo(v) {
    const studio = STUDIO_BY_ID.get(v.id.toLowerCase());
    const custom = isCustom(v);
    const description = studio ? studio.descriptor : (v.description ?? '').split(/(?<=\.)\s/)[0].slice(0, 120);
    const labels = {};
    if (v.accent)
        labels.accent = v.accent;
    if (v.gender)
        labels.gender = v.gender;
    if (v.language_code)
        labels.language = v.language_code;
    // Custom voices say how they were made, so lists can read "Cloned" or "Designed" (#0376).
    if (custom)
        labels.origin = v.type === 'replicated' ? 'cloned' : 'designed';
    return {
        provider: 'gemini',
        voice_id: studio ? studio.id : v.id,
        name: studio ? studio.name : v.display_name || v.id,
        category: custom ? 'custom' : studio ? 'studio' : 'library',
        description,
        labels,
        ...(v.expire_time ? { expiresAt: v.expire_time } : {}),
    };
}
function studioInfo(s) {
    return { provider: 'gemini', voice_id: s.id, name: s.name, category: 'studio', description: s.descriptor, labels: {} };
}
function refOf(v) {
    return {
        provider: 'gemini', id: v.voice_id, name: v.name,
        kind: v.category === 'custom' ? 'custom' : v.category === 'studio' ? 'prebuilt' : 'library',
        ...(v.expiresAt ? { expiresAt: v.expiresAt } : {}),
    };
}
export class GeminiProvider {
    config;
    id = 'gemini';
    label = 'Gemini';
    model;
    maxRenderChars = DEFAULT_CHUNK_CHARS;
    concurrency = GEMINI_CONCURRENCY;
    /** No speed control in the API: SlyCode time-stretches the PCM (tts/time-stretch.ts). */
    nativeSpeed = false;
    limiter;
    fetchImpl;
    catalogue = null;
    catalogueLoading = null;
    constructor(config, opts = {}) {
        this.config = config;
        this.model = config.geminiTtsModel || GEMINI_DEFAULT_MODEL;
        this.fetchImpl = opts.fetchImpl;
        this.limiter = opts.limiter ?? new RequestLimiter({ limit: GEMINI_TTS_RPM, label: 'Gemini TTS' });
    }
    get doFetch() {
        return this.fetchImpl ?? globalThis.fetch;
    }
    headers() {
        return { 'content-type': 'application/json', 'x-goog-api-key': this.config.geminiApiKey };
    }
    isConfigured() {
        return !!this.config.geminiApiKey;
    }
    envDefaultVoice() {
        const raw = this.config.geminiTtsVoice.trim();
        if (!raw)
            return null;
        if (isBuiltinVoice(raw))
            return builtinRef();
        const studio = STUDIO_BY_ID.get(raw.toLowerCase());
        return studio ? { provider: 'gemini', id: studio.id, name: studio.name, kind: 'prebuilt' } : { provider: 'gemini', id: raw, name: raw };
    }
    builtinDefaultVoice() {
        return builtinRef();
    }
    cacheKeyParts() {
        return ['gemini', this.model];
    }
    // --- render ------------------------------------------------------------------
    async render(req) {
        // Follow the live waiters of a shared render, not the first caller (P2).
        const fallbackDeadline = req.deadlineAt ?? Date.now() + 60_000;
        const deadlineAt = () => req.policy?.deadlineAt() ?? fallbackDeadline;
        const mayRetry = () => (req.policy ? req.policy.retryOn429() : !!req.retryOn429);
        const abortError = () => (req.signal.reason instanceof Error ? req.signal.reason : new RenderCancelledError());
        const parts = toGeminiParts(req.chunk.script).map((p) => ({ text: p.text, ...(p.style ? { speech_metadata: { style: p.style } } : {}) }));
        if (parts.length === 0)
            throw new TtsProviderError('tts_bad_audio', 'nothing speakable to send to Gemini', 400);
        const body = JSON.stringify({
            contents: [{ role: 'user', parts }],
            generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { voice: req.voiceId } } },
        });
        await this.limiter.acquire(this.model, deadlineAt, req.signal);
        for (let attempt = 0;; attempt++) {
            let res;
            try {
                res = await this.doFetch(`${API}/models/${this.model}:generateContent`, { method: 'POST', headers: this.headers(), body, signal: req.signal });
            }
            catch (err) {
                if (req.signal.aborted)
                    throw abortError();
                throw new TtsProviderError('provider_error', `TTS provider (Gemini) could not be reached: ${err.message}`, 502);
            }
            const json = (await res.json().catch(() => ({})));
            if (res.status === 429) {
                const retryMs = parseRetryAfterMs(json);
                this.limiter.noteRejected(this.model, retryMs);
                if (mayRetry() && attempt === 0 && Date.now() + retryMs < deadlineAt()) {
                    await this.limiter.acquire(this.model, deadlineAt, req.signal);
                    continue;
                }
                throw new TtsProviderError('rate_limited', `TTS provider (Gemini) rate limit reached (429); retry in ${Math.ceil(retryMs / 1000)} s.`, 429);
            }
            if (!res.ok)
                throw this.httpError(res.status, json, req.voiceId);
            return this.parseAudio(json);
        }
    }
    httpError(status, json, voiceId) {
        const message = json?.error?.message ?? `HTTP ${status}`;
        if ((status === 404 || /voice.*not found|not found.*voice/i.test(message)) && isCustomVoiceId(voiceId)) {
            // A designed voice that was deleted or expired at Google; the route adds
            // the recipe-aware fix (phase 4).
            const voice = { id: voiceId, name: voiceId };
            return new VoiceUnusableError('missing', voice, unusableVoiceMessage('Gemini', 'missing', voice, false));
        }
        if (status === 404 || /voice.*not found|not found.*voice/i.test(message)) {
            return new TtsProviderError('voice_not_found', `TTS provider (Gemini): voice '${voiceId}' was not found. Pick another with \`sly-messaging voices\` and \`voice set\`.`, 404);
        }
        if (status === 401 || status === 403)
            return new TtsProviderError('forbidden', `TTS provider (Gemini) refused the key (${status}): ${message}`, 502);
        if (status >= 500)
            return new TtsProviderError('provider_error', `TTS provider (Gemini) failed (${status}): ${message}`, 502);
        return new TtsProviderError('bad_request', `TTS provider (Gemini) rejected the request (${status}): ${message}`, 502);
    }
    parseAudio(json) {
        const cand = json?.candidates?.[0];
        if (json?.promptFeedback?.blockReason) {
            throw new TtsProviderError('bad_request', `TTS provider (Gemini) blocked the text: ${json.promptFeedback.blockReason}`, 502);
        }
        const finish = cand?.finishReason;
        const audio = (cand?.content?.parts ?? [])
            .map((p) => p.inlineData)
            .filter((d) => !!d?.data);
        if (finish && finish !== 'STOP') {
            throw new TtsProviderError('tts_truncated', `TTS provider (Gemini) ended early (finishReason ${finish}); the audio would be incomplete.`, 502);
        }
        if (audio.length === 0)
            throw new TtsProviderError('tts_bad_audio', 'TTS provider (Gemini) returned no audio', 502);
        const pcms = audio.map((d) => {
            const buf = Buffer.from(d.data, 'base64');
            const mime = (d.mimeType ?? '').toLowerCase();
            return mime.includes('l16') || mime.includes('pcm') ? parseL16(buf, mime) : parseWav(buf);
        });
        const rate = pcms[0].sampleRate;
        if (pcms.some((p) => p.sampleRate !== rate))
            throw new TtsProviderError('tts_bad_audio', 'TTS provider (Gemini) returned mixed sample rates', 502);
        return { kind: 'pcm', data: Buffer.concat(pcms.map((p) => p.data)), sampleRate: rate, channels: 1 };
    }
    // --- voices -----------------------------------------------------------------
    async listVoices(params) {
        const out = [];
        let token = '';
        for (let page = 0; page < 30; page++) {
            const qs = new URLSearchParams({ ...params, page_size: '200', ...(token ? { page_token: token } : {}) });
            let res;
            try {
                res = await this.doFetch(`${API}/voices?${qs}`, { headers: this.headers(), signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS) });
            }
            catch (err) {
                throw new VoicesUnavailableError(`Gemini voices unavailable: ${err.message}`);
            }
            if (!res.ok)
                throw new VoicesUnavailableError(`Gemini voices request failed (${res.status})`);
            const json = (await res.json());
            out.push(...(json.voices ?? []));
            token = json.nextPageToken ?? json.next_page_token ?? '';
            if (!token)
                break;
        }
        return out;
    }
    /** The prebuilt catalogue, cached for 24 h (background refresh after expiry). */
    async prebuilt() {
        const fresh = this.catalogue && Date.now() - this.catalogue.at < CATALOGUE_TTL_MS;
        if (fresh)
            return this.catalogue.voices;
        if (!this.catalogueLoading) {
            this.catalogueLoading = this.listVoices({ type: 'prebuilt' })
                .then((voices) => { this.catalogue = { at: Date.now(), voices }; return voices; })
                .finally(() => { this.catalogueLoading = null; });
        }
        if (this.catalogue) {
            this.catalogueLoading.catch(() => { }); // stale-while-revalidate
            return this.catalogue.voices;
        }
        return this.catalogueLoading;
    }
    async customVoices() {
        return (await this.listVoices({ type: 'prompted' })).concat(await this.listVoices({ type: 'replicated' }).catch(() => []));
    }
    async searchVoices(query, opts = {}) {
        let prebuilt;
        let custom = [];
        try {
            [prebuilt, custom] = await Promise.all([query.custom ? Promise.resolve([]) : this.prebuilt(), this.customVoices()]);
        }
        catch (err) {
            if (opts.strict)
                throw err;
            // Offline: studio voices and the built-in default still searchable by name/descriptor.
            prebuilt = [...STUDIO_VOICES.map((s) => ({ id: s.id, display_name: s.name, description: s.descriptor, type: 'prebuilt' })), { ...BUILTIN_VOICE }];
        }
        const terms = (query.text ?? '').toLowerCase().split(/\s+/).filter(Boolean);
        const lang = (query.language ?? '').toLowerCase();
        const preferred = (this.config.geminiTtsLanguage || 'en').toLowerCase();
        const rows = [...custom, ...prebuilt]
            .filter((v) => (query.custom ? isCustom(v) : true))
            .filter((v) => !query.gender || (v.gender ?? '').toLowerCase() === query.gender.toLowerCase())
            .filter((v) => !query.accent || (v.accent ?? '').toLowerCase().includes(query.accent.toLowerCase()))
            .filter((v) => !lang || (v.language_code ?? '').toLowerCase() === lang || (v.language_code ?? '').toLowerCase().startsWith(`${lang}-`))
            .filter((v) => {
            if (!terms.length)
                return true;
            const studio = STUDIO_BY_ID.get(v.id.toLowerCase());
            const hay = [v.id, v.display_name, v.description, studio?.descriptor, v.accent, v.persona, v.gender, v.language_code, languageName(v.language_code)]
                .filter(Boolean).join(' ').toLowerCase();
            return terms.every((t) => hay.includes(t));
        });
        const rank = (v) => (isCustom(v) ? 0 : STUDIO_BY_ID.has(v.id.toLowerCase()) ? 1 : (v.language_code ?? '').toLowerCase().startsWith(preferred) ? 2 : 3);
        rows.sort((a, b) => rank(a) - rank(b) || (a.display_name ?? a.id).localeCompare(b.display_name ?? b.id));
        return rows.slice(0, 50).map(toInfo);
    }
    async getVoice(id) {
        const wanted = id.trim();
        const studio = STUDIO_BY_ID.get(wanted.toLowerCase());
        if (studio)
            return studioInfo(studio);
        if (wanted.toLowerCase() === BUILTIN_VOICE.id)
            return toInfo(BUILTIN_VOICE);
        if (wanted.startsWith('voice_')) {
            let res;
            try {
                res = await this.doFetch(`${API}/voices/${encodeURIComponent(wanted)}`, { headers: this.headers(), signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS) });
            }
            catch (err) {
                throw new VoicesUnavailableError(`Gemini voices unavailable: ${err.message}`);
            }
            if (res.status === 404)
                return null;
            if (!res.ok)
                throw new VoicesUnavailableError(`Gemini voice lookup failed (${res.status})`);
            return toInfo((await res.json()));
        }
        const found = (await this.prebuilt()).find((v) => v.id === wanted);
        return found ? toInfo(found) : null;
    }
    // --- designed voices (phase 4) ------------------------------------------------
    /**
     * POST /voices with type 'prompted' (phase 0: synchronous, ~26 s, the voice
     * object at the top level with a WAV sample). Store is required.
     */
    async designVoice(req) {
        return this.createVoice({
            type: 'prompted',
            display_name: req.name,
            ...(req.gender ? { gender: req.gender } : {}),
            ...(req.language ? { language_code: req.language } : {}),
            prompted: { input: req.description },
        }, req.name, 'voice design');
    }
    /**
     * POST /voices with type 'replicated' (#0376): the sample and the consent
     * statement go inline as WAV. Same synchronous shape as design. Google
     * checks the consent speaker matches the sample; a refusal is mapped to
     * clone_consent_failed, a location block to clone_unavailable_region.
     */
    async cloneVoice(req) {
        return this.createVoice({
            type: 'replicated',
            display_name: req.name,
            replicated: {
                source_audio: { mime_type: 'audio/wav', data: req.sample.toString('base64') },
                consent_audio: { mime_type: 'audio/wav', data: req.consent.toString('base64') },
            },
        }, req.name, 'voice cloning');
    }
    /** The shared create call (design and clone). Store is required. */
    async createVoice(voice, name, what) {
        const body = JSON.stringify({ store: true, voice: { model: this.model, ...voice } });
        let res;
        try {
            res = await this.doFetch(`${API}/voices`, { method: 'POST', headers: this.headers(), body, signal: AbortSignal.timeout(DESIGN_TIMEOUT_MS) });
        }
        catch (err) {
            const timedOut = err.name === 'TimeoutError';
            const Label = what === 'voice design' ? 'Gemini voice design' : 'Gemini voice cloning';
            throw new TtsProviderError(timedOut ? 'design_timeout' : 'provider_error', timedOut
                ? `${Label} took longer than ${Math.round(DESIGN_TIMEOUT_MS / 1000)} s. It may still have been created; check \`sly-messaging voices --custom\` before trying again.`
                : `${Label} could not reach Google: ${err.message}`, timedOut ? 504 : 502);
        }
        const json = (await res.json().catch(() => ({})));
        if (!res.ok)
            throw what === 'voice cloning' ? (cloneRefusal(json) ?? this.apiError(res.status, json, what)) : this.apiError(res.status, json, what);
        const v = (json.voice ?? json);
        if (!v?.id)
            throw new TtsProviderError('provider_error', `Gemini ${what} returned no voice id`, 502);
        return {
            id: v.id,
            name: v.display_name || name,
            expiresAt: v.expire_time,
            // Google answers with the resource name (models/…); keep the plain model id.
            model: (v.model || this.model).replace(/^models\//, ''),
            sample: this.decodeSample(v.sample_audio),
        };
    }
    /** DELETE /voices/{id}. True when deleted now; false when Google says it was already gone. */
    async deleteVoice(id) {
        let res;
        try {
            res = await this.doFetch(`${API}/voices/${encodeURIComponent(id)}`, { method: 'DELETE', headers: this.headers(), signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS) });
        }
        catch (err) {
            throw new TtsProviderError('provider_error', `Gemini voice delete could not reach Google: ${err.message}`, 502);
        }
        if (res.status === 404)
            return false;
        if (!res.ok)
            throw this.apiError(res.status, (await res.json().catch(() => ({}))), 'voice delete');
        return true;
    }
    /** The recipe Google still holds for a designed voice (`prompted.input`), or null once it is gone. */
    async remoteRecipe(id) {
        if (!isCustomVoiceId(id))
            return null;
        let res;
        try {
            res = await this.doFetch(`${API}/voices/${encodeURIComponent(id)}`, { headers: this.headers(), signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS) });
        }
        catch (err) {
            throw new VoicesUnavailableError(`Gemini voices unavailable: ${err.message}`);
        }
        if (res.status === 404)
            return null;
        if (!res.ok)
            throw new VoicesUnavailableError(`Gemini voice lookup failed (${res.status})`);
        const v = (await res.json());
        const description = v.prompted?.input?.trim();
        if (!description)
            return null;
        return { name: v.display_name || id, description, gender: v.gender, language: v.language_code, expiresAt: v.expire_time };
    }
    decodeSample(sample) {
        if (!sample?.data)
            return null;
        try {
            const buf = Buffer.from(sample.data, 'base64');
            const mime = (sample.mime_type ?? sample.mimeType ?? '').toLowerCase();
            const pcm = mime.includes('l16') || mime.includes('pcm') ? parseL16(buf, mime) : parseWav(buf);
            return { kind: 'pcm', data: pcm.data, sampleRate: pcm.sampleRate, channels: 1 };
        }
        catch {
            return null; // a bad sample never fails the design: the voice exists either way
        }
    }
    apiError(status, json, what) {
        const message = json?.error?.message ?? `HTTP ${status}`;
        if (status === 429)
            return new TtsProviderError('rate_limited', `Gemini ${what} was rate limited (429): ${message}`, 429);
        if (status === 401 || status === 403)
            return new TtsProviderError('forbidden', `Gemini refused the key for ${what} (${status}): ${message}`, 502);
        if (status >= 500)
            return new TtsProviderError('provider_error', `Gemini ${what} failed (${status}): ${message}`, 502);
        return new TtsProviderError('bad_request', `Gemini rejected the ${what} (${status}): ${message}`, 400);
    }
    /** Built-in default (Zuri) by id or name → exact id (studio ids case-insensitively) → else exact studio/custom name → else not found/ambiguous. */
    async resolveVoiceValue(value) {
        const wanted = value.trim();
        // The built-in default resolves by id or by its name (unique in the library), offline too.
        if (isBuiltinVoice(wanted))
            return refOf(toInfo(BUILTIN_VOICE));
        const byId = await this.getVoice(wanted).catch((err) => {
            if (err instanceof VoicesUnavailableError)
                throw err;
            return null;
        });
        if (byId)
            return refOf(byId);
        const lower = wanted.toLowerCase();
        const studio = STUDIO_VOICES.find((s) => s.name.toLowerCase() === lower);
        if (studio)
            return refOf(studioInfo(studio));
        const custom = (await this.customVoices()).filter((v) => (v.display_name ?? '').toLowerCase() === lower).map(toInfo);
        if (custom.length === 1)
            return refOf(custom[0]);
        if (custom.length > 1)
            throw new VoiceLookupError('voice_ambiguous', `${custom.length} custom voices are named '${wanted}'; set by id instead.`, custom);
        const library = (await this.prebuilt()).filter((v) => (v.display_name ?? '').toLowerCase() === lower).map(toInfo);
        if (library.length) {
            throw new VoiceLookupError('voice_ambiguous', `'${wanted}' is a library voice name used by ${library.length} voices (accents and languages differ); set one by id.`, library.slice(0, 20));
        }
        const candidates = await this.searchVoices({ text: wanted }).catch(() => []);
        throw new VoiceLookupError('voice_not_found', `No Gemini voice '${wanted}'. Use \`sly-messaging voices "${wanted}"\` to list candidates and set by id.`, candidates.slice(0, 10));
    }
}
//# sourceMappingURL=gemini.js.map