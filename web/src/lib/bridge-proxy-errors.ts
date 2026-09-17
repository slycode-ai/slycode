/**
 * Bridge proxy failure shaping (card #0363).
 *
 * When the bridge is not listening (starting, restarting, crashed), every
 * proxied call fails with `TypeError: fetch failed` whose `cause` carries the
 * socket error. The proxy used to console.log the whole error object — a
 * 15-line stack dump per browser retry — and answer 502. Now: one short line,
 * and a 503 + Retry-After so clients can tell "bridge unavailable, retry" from
 * a real upstream error.
 */

export const BRIDGE_UNAVAILABLE_CODE = 'BRIDGE_UNAVAILABLE';
export const BRIDGE_RETRY_AFTER_S = 2;

/** One-line description of a failed bridge fetch, e.g. "ECONNREFUSED 127.0.0.1:7592". */
export function describeBridgeFetchError(err: unknown): string {
  const cause = (err as { cause?: unknown } | null)?.cause as
    | { code?: string; address?: string; port?: number; message?: string }
    | undefined;
  if (cause?.code) {
    const where = cause.address && cause.port ? ` ${cause.address}:${cause.port}` : '';
    return `${cause.code}${where}`;
  }
  if (cause?.message) return cause.message;
  if (err instanceof Error) return err.message;
  return String(err);
}

export interface BridgeUnavailablePayload {
  status: 503;
  headers: Record<string, string>;
  body: { error: string; code: typeof BRIDGE_UNAVAILABLE_CODE; retryAfterMs: number; detail: string };
}

export function bridgeUnavailablePayload(err: unknown): BridgeUnavailablePayload {
  return {
    status: 503,
    headers: { 'Retry-After': String(BRIDGE_RETRY_AFTER_S), 'Cache-Control': 'no-store' },
    body: {
      error: 'Bridge unavailable',
      code: BRIDGE_UNAVAILABLE_CODE,
      retryAfterMs: BRIDGE_RETRY_AFTER_S * 1000,
      detail: describeBridgeFetchError(err),
    },
  };
}

/**
 * Client side: does this proxy response mean "the bridge is not reachable"
 * (as opposed to "the bridge answered and said no")? 502/504 kept for older
 * proxies and gateways in front of web.
 */
export function isBridgeUnavailableStatus(status: number): boolean {
  return status === 503 || status === 502 || status === 504;
}
