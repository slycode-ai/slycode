/**
 * InputQueue — in-order, single-flight sender for raw terminal input.
 *
 * Why: each keystroke used to fire its own independent POST to
 * /sessions/:name/input. On high-RTT connections multiple POSTs are in flight
 * at once and arrive (or get processed) out of send order, scrambling typed
 * input — worst case submitting Enter before the text it belonged to
 * (feature 071, card-1780299874118).
 *
 * Guarantees:
 * - At most ONE send in flight at a time; items dispatch strictly in enqueue
 *   order (ordering by construction, works through any HTTP proxy).
 * - Coalescing: input enqueued while a send is in flight buffers, and
 *   consecutive 'raw' items flush as a single combined send — bounding
 *   perceived latency at ~2×RTT regardless of typing speed and reducing
 *   request count on exactly the slow links that used to scramble.
 * - 'paste' items NEVER merge with neighbours: the bridge's writeToSession
 *   detects bracketed-paste payloads by their wrapping markers to keep the
 *   markers atomic around the ConPTY chunked path; mixing bytes into the
 *   payload would defeat that detection.
 * - Bounded retry on send failure (default 250ms/750ms), then the failed item
 *   is dropped and the queue continues — survivors keep their order. (Dropping
 *   matches the previous fire-and-forget behavior; before this queue a failed
 *   POST was silently swallowed too.)
 *
 * Transport-agnostic: the owner supplies `send` (and its abort handling).
 * No React/DOM dependencies — unit-testable in isolation.
 */

export type InputKind = 'raw' | 'paste';

export interface InputQueueOptions {
  /** Performs the actual delivery. Reject to trigger retry. */
  send: (data: string) => Promise<unknown>;
  /** Backoff schedule for retries of a failed send. Length = max retries. */
  retryDelaysMs?: number[];
  /** Optional abort signal — when aborted, pending input is dropped. */
  signal?: AbortSignal;
}

interface QueueItem {
  data: string;
  kind: InputKind;
}

const DEFAULT_RETRY_DELAYS_MS = [250, 750];

export class InputQueue {
  private items: QueueItem[] = [];
  private pumping = false;
  private disposed = false;
  private readonly send: (data: string) => Promise<unknown>;
  private readonly retryDelaysMs: number[];

  constructor(options: InputQueueOptions) {
    this.send = options.send;
    this.retryDelaysMs = options.retryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS;
    options.signal?.addEventListener('abort', () => this.dispose(), { once: true });
  }

  /** Queue input for in-order delivery. No-op after dispose. */
  enqueue(data: string, kind: InputKind = 'raw'): void {
    if (this.disposed || data.length === 0) return;
    this.items.push({ data, kind });
    void this.pump();
  }

  /** Drop all pending input and ignore future enqueues. */
  dispose(): void {
    this.disposed = true;
    this.items = [];
  }

  /** Pending item count — exposed for tests/diagnostics. */
  get pendingCount(): number {
    return this.items.length;
  }

  private async pump(): Promise<void> {
    if (this.pumping) return;
    this.pumping = true;
    try {
      while (!this.disposed && this.items.length > 0) {
        const batch = this.takeBatch();
        await this.sendWithRetry(batch);
      }
    } finally {
      this.pumping = false;
    }
  }

  /**
   * Take the next dispatch unit: either one 'paste' item, or ALL consecutive
   * 'raw' items from the head merged into one payload (PTY input is a byte
   * stream, so concatenating raw keystrokes is semantics-preserving).
   */
  private takeBatch(): string {
    const head = this.items[0];
    if (head.kind === 'paste') {
      this.items.shift();
      return head.data;
    }
    let end = 1;
    while (end < this.items.length && this.items[end].kind === 'raw') end++;
    const merged = this.items
      .slice(0, end)
      .map((i) => i.data)
      .join('');
    this.items.splice(0, end);
    return merged;
  }

  private async sendWithRetry(data: string): Promise<void> {
    for (let attempt = 0; ; attempt++) {
      if (this.disposed) return;
      try {
        await this.send(data);
        return;
      } catch {
        if (this.disposed || attempt >= this.retryDelaysMs.length) return; // drop, keep queue alive
        await new Promise((r) => setTimeout(r, this.retryDelaysMs[attempt]));
      }
    }
  }
}
