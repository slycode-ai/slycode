/**
 * TabSync - Cross-tab synchronization via BroadcastChannel
 *
 * Provides instant notifications between same-origin browser tabs.
 * Falls back to no-op when BroadcastChannel is not available.
 */

type TabSyncMessageType = 'kanban-update' | 'kanban-reload';

interface TabSyncMessage {
  type: TabSyncMessageType;
  senderId: string;
  projectId?: string;
  timestamp: number;
}

type TabSyncListener = (message: TabSyncMessage) => void;

const CHANNEL_NAME = 'slycode-tab-sync';

class TabSyncImpl {
  private channel: BroadcastChannel | null = null;
  private senderId: string;
  private listeners = new Set<TabSyncListener>();

  constructor() {
    this.senderId = `tab-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    if (typeof window !== 'undefined' && typeof BroadcastChannel !== 'undefined') {
      try {
        this.channel = new BroadcastChannel(CHANNEL_NAME);
        this.channel.onmessage = (event: MessageEvent<TabSyncMessage>) => {
          // Ignore messages from self
          if (event.data.senderId === this.senderId) return;
          this.listeners.forEach((listener) => listener(event.data));
        };
      } catch {
        // BroadcastChannel not supported — no-op
      }
    }
  }

  broadcast(type: TabSyncMessageType, projectId?: string): void {
    if (!this.channel) return;
    const message: TabSyncMessage = {
      type,
      senderId: this.senderId,
      projectId,
      timestamp: Date.now(),
    };
    try {
      this.channel.postMessage(message);
    } catch {
      // Channel closed or unavailable
    }
  }

  subscribe(listener: TabSyncListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}

export const tabSync = new TabSyncImpl();
export type { TabSyncMessage, TabSyncMessageType };
