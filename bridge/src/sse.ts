/**
 * Shared SSE fan-out (feature 086). One place for "write an event to every
 * client, drop the dead ones" — previously copy-pasted for output/exit/resize
 * in session-manager.ts and now also used by the app-wide audio stream.
 */
import type { Response } from 'express';

export interface BroadcastOptions {
  /**
   * Pre-write byte budget: clients whose socket already has more than this
   * many bytes queued are skipped for this event (the event is dropped whole
   * for that client, never truncated). Undefined = no budget check.
   */
  maxWritableLength?: number;
  /** Called once per client that was skipped for budget reasons. */
  onSkipped?: (client: Response) => void;
}

export interface BroadcastResult {
  sent: number;
  dead: number;
  skipped: number;
}

export function formatSseEvent(event: string, payload: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
}

/**
 * Write one event to every client in `clients`. Dead clients (write throws)
 * are removed from the set. Returns counts so callers can update client
 * bookkeeping when `dead > 0`.
 */
export function broadcastSse(
  clients: Set<Response>,
  event: string,
  payload: unknown,
  opts: BroadcastOptions = {},
): BroadcastResult {
  const frame = formatSseEvent(event, payload);
  const dead: Response[] = [];
  let sent = 0;
  let skipped = 0;
  for (const client of clients) {
    if (opts.maxWritableLength !== undefined) {
      const queued = client.socket?.writableLength ?? 0;
      if (queued > opts.maxWritableLength) {
        skipped++;
        opts.onSkipped?.(client);
        continue;
      }
    }
    try {
      client.write(frame);
      sent++;
    } catch {
      dead.push(client);
    }
  }
  for (const client of dead) clients.delete(client);
  return { sent, dead: dead.length, skipped };
}
