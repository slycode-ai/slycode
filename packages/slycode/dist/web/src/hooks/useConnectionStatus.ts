'use client';

import { useState, useEffect, useCallback } from 'react';
import { connectionManager, type ConnectionStatus } from '@/lib/connection-manager';

export interface ConnectionStatusInfo {
  status: ConnectionStatus;
  isConnected: boolean;
  isReconnecting: boolean;
  isDisconnected: boolean;
  reconnectAll: (immediate?: boolean) => void;
}

/**
 * React hook for subscribing to connection status changes
 *
 * @returns Current connection status and helper flags
 */
export function useConnectionStatus(): ConnectionStatusInfo {
  const [status, setStatus] = useState<ConnectionStatus>(() => connectionManager.status);

  useEffect(() => {
    // Subscribe to status changes
    const unsubscribe = connectionManager.subscribe(setStatus);
    return unsubscribe;
  }, []);

  const reconnectAll = useCallback((immediate = false) => {
    connectionManager.reconnectAll(immediate);
  }, []);

  return {
    status,
    isConnected: status === 'connected',
    isReconnecting: status === 'reconnecting',
    isDisconnected: status === 'disconnected',
    reconnectAll,
  };
}
