import { useState, useEffect, useCallback } from 'react';
import { usePolling } from '@/hooks/usePolling';
import { normalizeActionsConfig, type SlyActionsConfig } from '@/lib/sly-actions';

const DEFAULT_ACTIONS: SlyActionsConfig = {
  version: '4.0',
  commands: {},
  classAssignments: {},
};

/**
 * Hook that fetches and periodically reloads the Sly Actions config.
 * Uses polling instead of SSE to conserve browser connection slots
 * (browsers limit HTTP/1.1 to 6 concurrent connections per origin).
 */
export function useSlyActionsConfig(): SlyActionsConfig {
  const [actionsConfig, setActionsConfig] = useState<SlyActionsConfig>(DEFAULT_ACTIONS);

  // Initial fetch
  useEffect(() => {
    let cancelled = false;
    fetch('/api/sly-actions')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data && !cancelled) setActionsConfig(normalizeActionsConfig(data));
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  // Poll for changes — actions config changes rarely, 30s is fine
  const pollConfig = useCallback(async (signal?: AbortSignal) => {
    try {
      const res = await fetch('/api/sly-actions', { signal });
      if (res.ok) {
        const data = await res.json();
        if (data) setActionsConfig(normalizeActionsConfig(data));
      }
    } catch {
      // Keep current config on error
    }
  }, []);

  usePolling(pollConfig, 30000);

  return actionsConfig;
}

// Backward compatibility alias
export const useCommandsConfig = useSlyActionsConfig;
