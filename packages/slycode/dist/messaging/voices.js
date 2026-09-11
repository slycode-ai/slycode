/**
 * ElevenLabs voice search and listing
 *
 * Searches both personal voices (/v2/voices) and the shared
 * community library (/v1/shared-voices), deduplicating by voice_id.
 */
/** Thrown by searchVoicesStrict when ElevenLabs cannot be reached or errors. */
export class VoicesUnavailableError extends Error {
    constructor(message) {
        super(message);
        this.name = 'VoicesUnavailableError';
    }
}
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
 * Like searchVoices but an upstream failure (network, non-2xx) THROWS
 * VoicesUnavailableError instead of degrading to an empty list, so callers
 * that need to distinguish "no such voice" from "could not ask" (the project
 * voice setter, feature 086) never report an outage as "not found".
 */
export async function searchVoicesStrict(apiKey, query) {
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
export async function searchVoices(apiKey, query) {
    const headers = { 'xi-api-key': apiKey };
    // Search personal/saved voices
    const personalParams = new URLSearchParams({ page_size: '10' });
    if (query)
        personalParams.set('search', query);
    const personalPromise = fetch(`https://api.elevenlabs.io/v2/voices?${personalParams}`, { headers })
        .then(async (res) => {
        if (!res.ok)
            return [];
        const data = await res.json();
        return (data.voices || []).map((v) => ({
            voice_id: v.voice_id,
            name: v.name,
            category: v.category || 'personal',
            description: v.description || '',
            labels: v.labels || {},
        }));
    })
        .catch(() => []);
    // Search shared/community voice library
    const sharedParams = new URLSearchParams({ page_size: '10' });
    if (query)
        sharedParams.set('search', query);
    const sharedPromise = fetch(`https://api.elevenlabs.io/v1/shared-voices?${sharedParams}`, { headers })
        .then(async (res) => {
        if (!res.ok)
            return [];
        const data = await res.json();
        return (data.voices || []).map((v) => ({
            voice_id: v.voice_id,
            name: v.name,
            category: v.category || 'community',
            description: v.description || '',
            labels: v.labels || {},
        }));
    })
        .catch(() => []);
    const [personal, shared] = await Promise.all([personalPromise, sharedPromise]);
    // Merge: personal first, then shared (deduplicate by voice_id)
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
//# sourceMappingURL=voices.js.map