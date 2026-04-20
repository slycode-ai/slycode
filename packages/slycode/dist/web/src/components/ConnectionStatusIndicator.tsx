'use client';

import { useState, useEffect, useRef } from 'react';
import { useConnectionStatus } from '@/hooks/useConnectionStatus';

const TOAST_DEBOUNCE_MS = 2000; // Don't show toast for transient blips shorter than this

interface ConnectionStatusIndicatorProps {
  /** Position of the indicator */
  position?: 'top-right' | 'top-left' | 'bottom-right' | 'bottom-left';
  /** Minimum time to show indicator before transitioning (prevents flashing) */
  minDisplayMs?: number;
}

/**
 * Visual indicator for connection status
 *
 * Shows a subtle toast when reconnecting/disconnected, auto-dismisses when connected.
 * Briefly flashes green on successful reconnection.
 * Debounces disconnect/reconnecting state to suppress transient blips.
 */
export function ConnectionStatusIndicator({
  position = 'top-right',
  minDisplayMs = 1500,
}: ConnectionStatusIndicatorProps) {
  const { status, reconnectAll } = useConnectionStatus();
  const isDisconnected = status === 'disconnected' || status === 'reconnecting';
  const [showingSuccess, setShowingSuccess] = useState(false);
  const [showDisconnect, setShowDisconnect] = useState(false);
  const wasDisconnectedRef = useRef(false);
  const debounceRef = useRef<NodeJS.Timeout | null>(null);
  const successTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Debounce: only show disconnect toast after sustained non-connected state
  useEffect(() => {
    if (isDisconnected) {
      if (!debounceRef.current) {
        debounceRef.current = setTimeout(() => {
          debounceRef.current = null;
          // eslint-disable-next-line react-hooks/set-state-in-effect -- debounce timer callback
          setShowDisconnect(true);
        }, TOAST_DEBOUNCE_MS);
      }
    } else {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
      // eslint-disable-next-line react-hooks/set-state-in-effect -- syncing connection recovery to UI
      setShowDisconnect(false);
    }
    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, [isDisconnected]);

  useEffect(() => {
    if (isDisconnected) {
      wasDisconnectedRef.current = true;
    } else if (status === 'connected' && wasDisconnectedRef.current) {
      wasDisconnectedRef.current = false;

      // Only show success toast if the disconnect was long enough to be visible
      if (showDisconnect) {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- syncing reconnection event to UI state
        setShowingSuccess(true);

        // Clear any previous success timeout before starting a new one
        if (successTimeoutRef.current) {
          clearTimeout(successTimeoutRef.current);
        }
        successTimeoutRef.current = setTimeout(() => {
          setShowingSuccess(false);
          successTimeoutRef.current = null;
        }, minDisplayMs);
      }
    }
    // No cleanup here — successTimeoutRef must survive dep changes.
    // Cleaned up on unmount below.
  }, [status, minDisplayMs, isDisconnected, showDisconnect]);

  // Cleanup success timeout on unmount only
  useEffect(() => {
    return () => {
      if (successTimeoutRef.current) {
        clearTimeout(successTimeoutRef.current);
      }
    };
  }, []);

  const visible = (isDisconnected && showDisconnect) || showingSuccess;

  if (!visible) {
    return null;
  }

  const positionClasses = {
    'top-right': 'top-4 right-4',
    'top-left': 'top-4 left-4',
    'bottom-right': 'bottom-4 right-4',
    'bottom-left': 'bottom-4 left-4',
  };

  // Success state (just reconnected) - disconnected state takes priority
  if (showingSuccess && !isDisconnected) {
    return (
      <div
        className={`fixed ${positionClasses[position]} z-50 flex items-center gap-2 whitespace-nowrap rounded-lg border border-green-500/50 bg-void-50 px-3 py-2 text-sm text-green-700 shadow-(--shadow-card) dark:bg-void-900 dark:text-green-400`}
      >
        <svg
          className="h-4 w-4 flex-shrink-0"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M5 13l4 4L19 7"
          />
        </svg>
        <span>Connected</span>
      </div>
    );
  }

  // Reconnecting state
  if (status === 'reconnecting') {
    return (
      <div
        className={`fixed ${positionClasses[position]} z-50 flex items-center gap-2 whitespace-nowrap rounded-lg border border-neon-blue-400/40 bg-void-50 px-3 py-2 text-sm text-neon-blue-600 shadow-(--shadow-card) dark:bg-void-900 dark:text-neon-blue-400`}
      >
        <svg
          className="h-4 w-4 flex-shrink-0 animate-spin"
          fill="none"
          viewBox="0 0 24 24"
        >
          <circle
            className="opacity-25"
            cx="12"
            cy="12"
            r="10"
            stroke="currentColor"
            strokeWidth="4"
          />
          <path
            className="opacity-75"
            fill="currentColor"
            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
          />
        </svg>
        <span>Reconnecting...</span>
        <button
          onClick={() => reconnectAll(true)}
          className="ml-1 flex-shrink-0 rounded px-1.5 py-0.5 text-xs font-medium hover:bg-neon-blue-400/10 dark:hover:bg-neon-blue-400/10"
        >
          Retry
        </button>
      </div>
    );
  }

  // Disconnected state
  return (
    <div
      className={`fixed ${positionClasses[position]} z-50 flex items-center gap-2 whitespace-nowrap rounded-lg border border-red-500/50 bg-void-50 px-3 py-2 text-sm text-red-700 shadow-(--shadow-card) dark:bg-void-900 dark:text-red-400`}
    >
      <svg
        className="h-4 w-4 flex-shrink-0"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M6 18L18 6M6 6l12 12"
        />
      </svg>
      <span>Connection Lost</span>
      <button
        onClick={() => reconnectAll(true)}
        className="ml-1 flex-shrink-0 rounded bg-red-500/10 px-2 py-0.5 text-xs font-medium hover:bg-red-500/20 dark:bg-red-500/15 dark:hover:bg-red-500/25"
      >
        Reconnect
      </button>
    </div>
  );
}
