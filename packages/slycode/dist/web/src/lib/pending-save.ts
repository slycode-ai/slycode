/**
 * Flushable debounce for a single "save the latest value" writer.
 *
 * Used by ProjectKanban for the 2 s kanban save debounce (card #0357).
 * The board keeps editing the in-memory stages immediately; the write to
 * disk trails by `delayMs` of quiet. Anything that hands the card to an
 * agent (Sly Action, session start) must call `flush()` first so the agent's
 * own `sly-kanban show` reads the same card the modal shows.
 *
 * Guarantees:
 *  - `schedule(v)` replaces any pending value and re-arms the timer.
 *  - `flush()` cancels the timer and settles only once the queue is drained:
 *    it joins any in-flight write, then runs whatever is pending, and repeats
 *    until nothing is pending and nothing is in flight. It resolves with the
 *    LAST write's result (a joined write that failed counts — a flush never
 *    reports true on the back of a failed save it merely observed). With
 *    nothing to do it resolves true.
 *  - Re-scheduling the exact value currently being written is a no-op, so a
 *    flush followed by React re-arming the same state cannot double-save.
 *  - Writes never overlap: a value scheduled during a write runs after it.
 */
export interface PendingSave<T> {
  schedule(value: T): void;
  cancel(): void;
  flush(): Promise<boolean>;
  isPending(): boolean;
  isWriting(): boolean;
}

export function createPendingSave<T>(
  run: (value: T) => Promise<boolean>,
  delayMs: number,
): PendingSave<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: { value: T } | null = null;
  let inFlight: Promise<boolean> | null = null;
  let inFlightValue: { value: T } | null = null;

  const clearTimer = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  };

  // Start writing the pending value. Caller guarantees nothing is in flight.
  const runPending = (): Promise<boolean> => {
    const next = pending as { value: T };
    pending = null;
    inFlightValue = next;
    inFlight = Promise.resolve()
      .then(() => run(next.value))
      .catch(() => false)
      .then((ok) => {
        inFlight = null;
        inFlightValue = null;
        return ok;
      });
    return inFlight;
  };

  // Timer path: write the pending value once the current write (if any) settles.
  const drainFromTimer = (): void => {
    if (inFlight) {
      void inFlight.then(drainFromTimer);
      return;
    }
    if (pending) void runPending();
  };

  // Flush path: settle only when the whole queue is drained.
  const drainAll = async (): Promise<boolean> => {
    let result = true;
    while (inFlight || pending) {
      if (inFlight) result = await inFlight; // joined write — its failure is ours
      if (!inFlight && pending) result = await runPending();
    }
    return result;
  };

  return {
    schedule(value: T) {
      if (inFlightValue && inFlightValue.value === value) return; // already being written
      pending = { value };
      clearTimer();
      timer = setTimeout(() => {
        timer = null;
        drainFromTimer();
      }, delayMs);
    },
    cancel() {
      clearTimer();
      pending = null;
    },
    flush() {
      clearTimer();
      return drainAll();
    },
    isPending: () => pending !== null,
    isWriting: () => inFlight !== null,
  };
}
