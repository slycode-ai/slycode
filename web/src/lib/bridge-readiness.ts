/**
 * Bridge readiness for the scheduler (card #0363).
 *
 * Web and the bridge start in parallel on every platform and the bridge only
 * listens after its session reconcile, so on a cold boot web is routinely up
 * seconds before the bridge accepts connections. The scheduler's first tick
 * used to fire due automations into that gap: lastRun was stamped, the bridge
 * call failed with ECONNREFUSED, and the run was consumed.
 *
 * Two helpers, both dependency-injected so they test without sockets:
 *  - probeBridge: one GET /health, true only on a 2xx.
 *  - waitForBridgeReady: bounded poll used before the scheduler's first tick.
 *    Warns periodically while waiting, once more on timeout, then returns
 *    false so the caller proceeds exactly as it did before the gate existed.
 */

export interface ProbeOptions {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export async function probeBridge(bridgeUrl: string, opts: ProbeOptions = {}): Promise<boolean> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const timeoutMs = opts.timeoutMs ?? 2_000;
  try {
    const res = await fetchImpl(`${bridgeUrl}/health`, {
      signal: AbortSignal.timeout(timeoutMs),
      cache: 'no-store',
    });
    return res.ok;
  } catch {
    return false;
  }
}

export interface WaitOptions extends ProbeOptions {
  /** Give up after this long (default 60 s). */
  maxWaitMs?: number;
  /** Poll spacing (default 2 s). */
  intervalMs?: number;
  /** Emit a progress warning at most this often (default 10 s). */
  warnEveryMs?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  warn?: (msg: string) => void;
}

export interface WaitResult {
  ready: boolean;
  attempts: number;
  waitedMs: number;
}

export async function waitForBridgeReady(bridgeUrl: string, opts: WaitOptions = {}): Promise<WaitResult> {
  const maxWaitMs = opts.maxWaitMs ?? 60_000;
  const intervalMs = opts.intervalMs ?? 2_000;
  const warnEveryMs = opts.warnEveryMs ?? 10_000;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>(r => setTimeout(r, ms)));
  const now = opts.now ?? Date.now;
  const warn = opts.warn ?? ((msg: string) => console.warn(msg));

  const startedAt = now();
  let attempts = 0;
  let lastWarnAt = startedAt;
  for (;;) {
    attempts++;
    if (await probeBridge(bridgeUrl, opts)) {
      return { ready: true, attempts, waitedMs: now() - startedAt };
    }
    const waited = now() - startedAt;
    if (waited >= maxWaitMs) {
      warn(`Bridge at ${bridgeUrl} not ready after ${Math.round(waited / 1000)}s (${attempts} probes) — proceeding; due fires wait until it answers /health`);
      return { ready: false, attempts, waitedMs: waited };
    }
    if (now() - lastWarnAt >= warnEveryMs) {
      lastWarnAt = now();
      warn(`Waiting for bridge at ${bridgeUrl} (${Math.round(waited / 1000)}s, ${attempts} probes)`);
    }
    await sleep(Math.min(intervalMs, maxWaitMs - waited));
  }
}
