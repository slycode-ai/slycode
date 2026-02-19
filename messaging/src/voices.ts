/**
 * ElevenLabs voice search and listing
 *
 * Searches both personal voices (/v2/voices) and the shared
 * community library (/v1/shared-voices), deduplicating by voice_id.
 */

export interface ElevenLabsVoice {
  voice_id: string;
  name: string;
  category: string;
  description: string;
  labels: Record<string, string>;
}

export async function searchVoices(apiKey: string, query?: string): Promise<ElevenLabsVoice[]> {
  const headers = { 'xi-api-key': apiKey };

  // Search personal/saved voices
  const personalParams = new URLSearchParams({ page_size: '10' });
  if (query) personalParams.set('search', query);

  const personalPromise = fetch(`https://api.elevenlabs.io/v2/voices?${personalParams}`, { headers })
    .then(async (res) => {
      if (!res.ok) return [];
      const data = await res.json();
      return (data.voices || []).map((v: any) => ({
        voice_id: v.voice_id,
        name: v.name,
        category: v.category || 'personal',
        description: v.description || '',
        labels: v.labels || {},
      }));
    })
    .catch(() => [] as ElevenLabsVoice[]);

  // Search shared/community voice library
  const sharedParams = new URLSearchParams({ page_size: '10' });
  if (query) sharedParams.set('search', query);

  const sharedPromise = fetch(`https://api.elevenlabs.io/v1/shared-voices?${sharedParams}`, { headers })
    .then(async (res) => {
      if (!res.ok) return [];
      const data = await res.json();
      return (data.voices || []).map((v: any) => ({
        voice_id: v.voice_id,
        name: v.name,
        category: v.category || 'community',
        description: v.description || '',
        labels: v.labels || {},
      }));
    })
    .catch(() => [] as ElevenLabsVoice[]);

  const [personal, shared] = await Promise.all([personalPromise, sharedPromise]);

  // Merge: personal first, then shared (deduplicate by voice_id)
  const seen = new Set<string>();
  const merged: ElevenLabsVoice[] = [];

  for (const v of [...personal, ...shared]) {
    if (!seen.has(v.voice_id)) {
      seen.add(v.voice_id);
      merged.push(v);
    }
  }

  return merged;
}
