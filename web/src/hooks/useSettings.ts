import { useState, useEffect, useCallback } from 'react';
import type { AppSettings, VoiceSettings } from '@/lib/types';
import { DEFAULT_VOICE_SETTINGS } from '@/lib/types';

const DEFAULT_SETTINGS: AppSettings = {
  voice: DEFAULT_VOICE_SETTINGS,
};

export function useSettings() {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [isLoading, setIsLoading] = useState(true);
  // Last save failure, surfaced by controls that must not fail silently (spoken-reply settings, feature 086).
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/settings')
      .then((res) => res.json())
      .then((data) => {
        setSettings({ ...DEFAULT_SETTINGS, ...data, voice: { ...DEFAULT_VOICE_SETTINGS, ...data?.voice } });
      })
      .catch(() => {
        // Use defaults on error
      })
      .finally(() => setIsLoading(false));
  }, []);

  const updateSettings = useCallback(async (patch: { voice?: Partial<VoiceSettings> }) => {
    try {
      const res = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      if (res.ok) {
        const data = await res.json();
        setSettings({ ...DEFAULT_SETTINGS, ...data, voice: { ...DEFAULT_VOICE_SETTINGS, ...data?.voice } });
        setSaveError(null);
        return data as AppSettings;
      }
      let reason = `HTTP ${res.status}`;
      try { reason = (await res.json())?.error || reason; } catch { /* non-JSON */ }
      setSaveError(`Settings not saved: ${reason}`);
    } catch (err) {
      setSaveError(`Settings not saved: ${err instanceof Error ? err.message : 'request failed'}`);
    }
    return null;
  }, []);

  return { settings, updateSettings, isLoading, saveError };
}
