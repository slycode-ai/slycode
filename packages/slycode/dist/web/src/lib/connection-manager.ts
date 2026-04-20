/**
 * ConnectionManager - Centralized connection state and reconnection logic
 *
 * Handles:
 * - Page Visibility API detection for sleep/wake cycles
 * - Exponential backoff with jitter for reconnection attempts
 * - Centralized tracking of all managed EventSource connections
 * - Connection status broadcasting to subscribers
 * - Active health checks via fetch to detect network issues
 */

export type ConnectionStatus = 'connected' | 'reconnecting' | 'disconnected';

// Handler type for named SSE events
export type SSEEventHandler = (event: MessageEvent) => void;

export interface ManagedEventSourceHandlers {
  onOpen?: () => void;
  onError?: (event: Event) => void;
  onMessage?: (event: MessageEvent) => void;
}

// Combined type that allows named event handlers
export type ManagedEventSourceConfig = ManagedEventSourceHandlers & {
  [eventName: string]: SSEEventHandler | (() => void) | ((event: Event) => void) | undefined;
};

interface ManagedConnection {
  url: string;
  handlers: ManagedEventSourceConfig;
  eventSource: EventSource | null;
  retryCount: number;
  retryTimeout: NodeJS.Timeout | null;
  lastConnected: number | null;
  id: string;
}

type StatusListener = (status: ConnectionStatus) => void;

// Backoff configuration
const INITIAL_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 30000;
const JITTER_FACTOR = 0.2; // ±20%
const HEALTH_CHECK_INTERVAL_MS = 20000; // Check connection health every 20s
const HEALTH_CHECK_TIMEOUT_MS = 3000; // Timeout for health check fetch
const STATUS_DOWNGRADE_GRACE_MS = 3000; // Grace period before downgrading from 'connected'

// Diagnostic logging — enabled via localStorage.setItem('cm-debug', '1')
function cmLog(...args: unknown[]): void {
  if (typeof window !== 'undefined' && localStorage.getItem('cm-debug') === '1') {
    console.log(`[CM ${new Date().toISOString().slice(11, 23)}]`, ...args);
  }
}

class ConnectionManagerImpl {
  private connections = new Map<string, ManagedConnection>();
  private statusListeners = new Set<StatusListener>();
  private _status: ConnectionStatus = 'connected';
  private connectionIdCounter = 0;
  private isPageVisible = true;
  private visibilityChangeTime: number | null = null;
  private healthCheckInterval: NodeJS.Timeout | null = null;
  private lastHealthCheckSuccess: number | null = null;
  private consecutiveHealthFailures = 0;
  private statusDowngradeTimeout: NodeJS.Timeout | null = null;

  constructor() {
    // Only run in browser
    if (typeof window !== 'undefined') {
      this.setupVisibilityListener();
      this.setupNetworkListener();
      this.setupHealthCheck();
    }
  }

  private setupVisibilityListener(): void {
    document.addEventListener('visibilitychange', () => {
      const wasVisible = this.isPageVisible;
      this.isPageVisible = document.visibilityState === 'visible';

      if (!wasVisible && this.isPageVisible) {
        // Tab became visible - check if we need to reconnect
        this.visibilityChangeTime = Date.now();
        this.handleTabWake();
      } else if (wasVisible && !this.isPageVisible) {
        // Tab became hidden
        this.visibilityChangeTime = Date.now();
      }
    });
  }

  private setupNetworkListener(): void {
    // Listen for browser online/offline events (unreliable but worth having)
    window.addEventListener('online', () => {
      // Network might be back - do a health check immediately
      this.doHealthCheck();
    });

    window.addEventListener('offline', () => {
      // Network lost - update status
      this.updateStatus('disconnected');
    });
  }

  private setupHealthCheck(): void {
    // Periodically check connection health via actual fetch
    this.healthCheckInterval = setInterval(() => {
      if (!this.isPageVisible) return; // Skip check if tab is hidden
      if (this.connections.size === 0) return; // No connections to check

      // Skip fetch-based health check if any EventSource recently received data.
      // Active SSE connections prove the server is reachable — making a separate
      // fetch wastes a scarce HTTP/1.1 connection slot (browsers limit to 6 per origin).
      if (this.hasRecentlyActiveConnection()) {
        this.consecutiveHealthFailures = 0;
        if (this._status !== 'connected') {
          this.reconnectBroken();
        }
        return;
      }

      this.doHealthCheck();
    }, HEALTH_CHECK_INTERVAL_MS);
  }

  /**
   * Check if any managed connection recently received data.
   * If so, the server is reachable — no need for a separate health check fetch.
   */
  private hasRecentlyActiveConnection(): boolean {
    const now = Date.now();
    for (const conn of this.connections.values()) {
      if (
        conn.eventSource?.readyState === EventSource.OPEN &&
        conn.lastConnected &&
        now - conn.lastConnected < HEALTH_CHECK_INTERVAL_MS * 3
      ) {
        return true;
      }
    }
    return false;
  }

  private async doHealthCheck(): Promise<void> {
    cmLog('HEALTH_CHECK — fetching /api/bridge/health');
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), HEALTH_CHECK_TIMEOUT_MS);

      const response = await fetch('/api/bridge/health', {
        method: 'GET',
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (response.ok) {
        cmLog('HEALTH_CHECK — OK');
        this.consecutiveHealthFailures = 0;
        this.lastHealthCheckSuccess = Date.now();

        if (this._status !== 'connected') {
          this.reconnectBroken();
        }
      } else {
        cmLog(`HEALTH_CHECK — FAIL status=${response.status}`);
        this.handleHealthCheckFailure();
      }
    } catch (err) {
      cmLog(`HEALTH_CHECK — ERROR`, err);
      this.handleHealthCheckFailure();
    }
  }

  private handleHealthCheckFailure(): void {
    this.consecutiveHealthFailures++;
    cmLog(`HEALTH_FAIL — consecutive=${this.consecutiveHealthFailures}`);

    if (this.consecutiveHealthFailures >= 2) {
      if (this._status === 'connected') {
        this.updateStatus('disconnected');
      }
    }
  }

  private handleTabWake(): void {
    cmLog('TAB_WAKE — force-reconnecting all connections');
    this.reconnectAll(true);
  }

  /**
   * Calculate backoff delay with jitter
   */
  private calculateBackoff(retryCount: number): number {
    const exponentialDelay = Math.min(
      INITIAL_BACKOFF_MS * Math.pow(2, retryCount),
      MAX_BACKOFF_MS
    );
    // Add jitter: ±20%
    const jitter = exponentialDelay * JITTER_FACTOR * (Math.random() * 2 - 1);
    return Math.round(exponentialDelay + jitter);
  }

  /**
   * Create a managed EventSource connection
   */
  createManagedEventSource(
    url: string,
    handlers: ManagedEventSourceConfig
  ): string {
    const id = `conn-${++this.connectionIdCounter}`;

    const connection: ManagedConnection = {
      url,
      handlers,
      eventSource: null,
      retryCount: 0,
      retryTimeout: null,
      lastConnected: null,
      id,
    };

    this.connections.set(id, connection);
    this.connect(id);

    return id;
  }

  /**
   * Connect or reconnect a managed connection
   */
  private connect(id: string): void {
    const conn = this.connections.get(id);
    if (!conn) return;

    // Clean up existing connection
    if (conn.eventSource) {
      conn.eventSource.close();
      conn.eventSource = null;
    }

    // Clear any pending retry
    if (conn.retryTimeout) {
      clearTimeout(conn.retryTimeout);
      conn.retryTimeout = null;
    }

    try {
      const eventSource = new EventSource(conn.url);
      conn.eventSource = eventSource;

      eventSource.onopen = () => {
        conn.retryCount = 0;
        conn.lastConnected = Date.now();
        this.consecutiveHealthFailures = 0;
        cmLog(`OPEN ${id} → ${conn.url}`);
        this.updateOverallStatus();
        conn.handlers.onOpen?.();
      };

      eventSource.onerror = (event) => {
        cmLog(`ERROR ${id} → ${conn.url} readyState=${eventSource.readyState} (0=CONNECTING, 1=OPEN, 2=CLOSED)`, event);
        conn.handlers.onError?.(event);

        // Schedule reconnect if connection is closed
        if (eventSource.readyState === EventSource.CLOSED) {
          cmLog(`CLOSED ${id} — scheduling reconnect`);
          this.scheduleReconnect(id);
        }
      };

      eventSource.onmessage = (event) => {
        conn.lastConnected = Date.now();
        conn.handlers.onMessage?.(event);
      };

      // Listen for heartbeat events to keep lastConnected fresh on idle connections
      eventSource.addEventListener('heartbeat', () => {
        conn.lastConnected = Date.now();
        cmLog(`HEARTBEAT ${id} → ${conn.url}`);
      });

      // Attach named event handlers
      Object.entries(conn.handlers).forEach(([name, handler]) => {
        if (name !== 'onOpen' && name !== 'onError' && name !== 'onMessage' && handler) {
          eventSource.addEventListener(name, (event) => {
            conn.lastConnected = Date.now();
            (handler as SSEEventHandler)(event as MessageEvent);
          });
        }
      });
    } catch (error) {
      console.error(`ConnectionManager: Failed to create EventSource for ${conn.url}`, error);
      this.scheduleReconnect(id);
    }
  }

  /**
   * Schedule a reconnection with exponential backoff
   */
  private scheduleReconnect(id: string): void {
    const conn = this.connections.get(id);
    if (!conn) return;

    // Clear any existing timeout
    if (conn.retryTimeout) {
      clearTimeout(conn.retryTimeout);
    }

    const delay = this.calculateBackoff(conn.retryCount);
    conn.retryCount++;

    // Update status based on all connections, not blanket 'reconnecting'
    this.updateOverallStatus();

    conn.retryTimeout = setTimeout(() => {
      conn.retryTimeout = null;
      this.connect(id);
    }, delay);
  }

  /**
   * Force reconnection of a specific connection
   */
  reconnect(id: string, immediate = false): void {
    const conn = this.connections.get(id);
    if (!conn) return;

    if (immediate) {
      conn.retryCount = 0; // Reset backoff on manual reconnect
      this.updateStatus('reconnecting');
      this.connect(id);
    } else {
      this.scheduleReconnect(id);
    }
  }

  /**
   * Reconnect all managed connections
   */
  reconnectAll(immediate = false): void {
    if (this.connections.size > 0) {
      this.updateStatus('reconnecting');
    }
    this.connections.forEach((_, id) => {
      this.reconnect(id, immediate);
    });
  }

  /**
   * Reconnect only broken connections (not OPEN ones).
   * Used after health check recovery to avoid disrupting healthy streams.
   */
  private reconnectBroken(): void {
    let reconnected = false;
    this.connections.forEach((conn, id) => {
      if (conn.eventSource?.readyState !== EventSource.OPEN) {
        reconnected = true;
        this.reconnect(id, true);
      }
    });
    if (!reconnected) {
      // All connections are healthy — just update status
      this.updateOverallStatus();
    }
  }

  /**
   * Close and remove a managed connection
   */
  closeConnection(id: string): void {
    const conn = this.connections.get(id);
    if (!conn) return;

    if (conn.retryTimeout) {
      clearTimeout(conn.retryTimeout);
    }
    if (conn.eventSource) {
      conn.eventSource.close();
    }

    this.connections.delete(id);
    this.updateOverallStatus();
  }

  /**
   * Update overall connection status based on all connections.
   * Uses a grace period before downgrading from 'connected' to absorb
   * transient blips (e.g. page navigation, single connection drop).
   */
  private updateOverallStatus(): void {
    if (this.connections.size === 0) {
      this.updateStatus('connected'); // No connections = default to connected
      this.clearDowngradeTimeout();
      return;
    }

    let openCount = 0;
    let reconnectingCount = 0;

    this.connections.forEach((conn) => {
      if (conn.eventSource?.readyState === EventSource.OPEN) {
        openCount++;
      } else if (conn.retryTimeout || conn.eventSource?.readyState === EventSource.CONNECTING) {
        reconnectingCount++;
      }
    });

    // If at least one connection is open, consider connected
    if (openCount > 0) {
      this.updateStatus('connected');
      this.clearDowngradeTimeout();
    } else if (reconnectingCount > 0) {
      this.scheduleDowngrade('reconnecting');
    } else {
      this.scheduleDowngrade('disconnected');
    }
  }

  /**
   * Schedule a status downgrade with a grace period.
   * If the status recovers within the grace window, the downgrade is cancelled.
   */
  private scheduleDowngrade(target: ConnectionStatus): void {
    // If already at or below target, apply immediately
    if (this._status !== 'connected') {
      this.updateStatus(target);
      return;
    }

    // Already have a pending downgrade — let it run
    if (this.statusDowngradeTimeout) return;

    this.statusDowngradeTimeout = setTimeout(() => {
      this.statusDowngradeTimeout = null;
      // Re-check — status may have recovered during grace period
      this.updateOverallStatus();
    }, STATUS_DOWNGRADE_GRACE_MS);
  }

  private clearDowngradeTimeout(): void {
    if (this.statusDowngradeTimeout) {
      clearTimeout(this.statusDowngradeTimeout);
      this.statusDowngradeTimeout = null;
    }
  }

  private updateStatus(status: ConnectionStatus): void {
    if (this._status !== status) {
      const conns = Array.from(this.connections.values()).map(c => ({
        id: c.id,
        url: c.url.replace(/.*\/api\//, '/api/'),
        readyState: c.eventSource?.readyState,
        lastConnectedAge: c.lastConnected ? Math.round((Date.now() - c.lastConnected) / 1000) + 's' : 'never',
        hasRetryPending: !!c.retryTimeout,
      }));
      cmLog(`STATUS ${this._status} → ${status}`, JSON.stringify(conns, null, 2));
      this._status = status;
      this.statusListeners.forEach((listener) => listener(status));
    }
  }

  /**
   * Subscribe to connection status changes
   */
  subscribe(listener: StatusListener): () => void {
    this.statusListeners.add(listener);
    // Immediately call with current status
    listener(this._status);

    return () => {
      this.statusListeners.delete(listener);
    };
  }

  /**
   * Get current connection status
   */
  get status(): ConnectionStatus {
    return this._status;
  }

  /**
   * Check if page is currently visible
   */
  get pageVisible(): boolean {
    return this.isPageVisible;
  }

  /**
   * Get the number of active connections
   */
  get connectionCount(): number {
    return this.connections.size;
  }
}

// Singleton instance
export const connectionManager = new ConnectionManagerImpl();
