'use client';

import { useEffect, useRef, useCallback } from 'react';
import { connectionManager } from '@/lib/connection-manager';

/**
 * Network-aware polling hook that integrates with ConnectionManager.
 *
 * Pauses polling when:
 * - ConnectionManager reports disconnected/reconnecting status
 * - Page is hidden (visibility API)
 *
 * Resumes polling immediately when connectivity returns and page is visible.
 * Cancels in-flight requests on unmount via AbortController.
 *
 * @param fetchFn - Async function to call each interval. Receives an AbortSignal
 *                  that callers should pass to their fetch() calls.
 * @param intervalMs - Polling interval in milliseconds.
 * @param options - Optional configuration.
 * @param options.enabled - Whether polling is active (default true). Set false to
 *                          pause externally (e.g. while saving).
 */
export function usePolling(
  fetchFn: (signal: AbortSignal) => Promise<void>,
  intervalMs: number,
  options?: { enabled?: boolean }
): void {
  const enabled = options?.enabled ?? true;
  const fetchFnRef = useRef(fetchFn);

  useEffect(() => {
    fetchFnRef.current = fetchFn;
  }, [fetchFn]);

  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const executeFetch = useCallback(() => {
    // Abort any in-flight request
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    fetchFnRef.current(controller.signal).catch(() => {
      // Silently ignore all errors — aborted requests, network failures, etc.
      // Components handle their own error state internally.
    });
  }, []);

  const clearInterval_ = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  const startInterval = useCallback(() => {
    clearInterval_();
    intervalRef.current = setInterval(executeFetch, intervalMs);
  }, [executeFetch, intervalMs, clearInterval_]);

  useEffect(() => {
    if (!enabled) {
      clearInterval_();
      abortRef.current?.abort();
      return;
    }

    // Track whether we should be polling
    let isActive = true;
    let pageVisible = typeof document !== 'undefined' ? document.visibilityState === 'visible' : true;
    let connected = connectionManager.status === 'connected';

    const shouldPoll = () => pageVisible && connected && isActive;

    const resume = () => {
      if (shouldPoll()) {
        executeFetch(); // Immediate fetch on resume
        startInterval();
      }
    };

    const pause = () => {
      clearInterval_();
      abortRef.current?.abort();
    };

    // Subscribe to ConnectionManager status
    const unsubscribe = connectionManager.subscribe((status) => {
      const wasConnected = connected;
      connected = status === 'connected';
      if (connected && !wasConnected) {
        resume();
      } else if (!connected && wasConnected) {
        pause();
      }
    });

    // Listen for visibility changes
    const handleVisibility = () => {
      const wasVisible = pageVisible;
      pageVisible = document.visibilityState === 'visible';
      if (pageVisible && !wasVisible) {
        resume();
      } else if (!pageVisible && wasVisible) {
        pause();
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);

    // Initial start
    if (shouldPoll()) {
      executeFetch();
      startInterval();
    }

    return () => {
      isActive = false;
      unsubscribe();
      document.removeEventListener('visibilitychange', handleVisibility);
      clearInterval_();
      abortRef.current?.abort();
    };
  }, [enabled, intervalMs, executeFetch, startInterval, clearInterval_]);
}
