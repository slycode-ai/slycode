/**
 * Client-side helper for the bridge's self-verifying prompt submit
 * (feature 070). Wraps POST /sessions/:name/submit-verified and normalizes
 * the typed delivery result.
 *
 * Used by every web "send this prompt and submit it" path (CardModal
 * quick-launch, GlobalClaudePanel prompt push, ClaudeTerminalPanel actions).
 * Raw keystroke paths (terminal typing, Escape, screenshot inserts,
 * paste-only flows) must keep using /input — raw input stays raw.
 */

export interface VerifiedDelivery {
  outcome: 'delivered' | 'failed' | 'ambiguous' | 'blocked';
  reason?: string;
  warnings?: string[];
  attempts?: number;
  resends?: number;
}

/** Human wording for a non-delivered outcome, shown in the terminal-panel toast. */
export function deliveryFailureMessage(d: VerifiedDelivery): string {
  const detail = d.reason ? ` (${d.reason})` : '';
  if (d.outcome === 'blocked') {
    return `The session is blocked by an update/dialog — clear it in the terminal, then resend${detail}`;
  }
  return `Prompt delivery ${d.outcome}${detail} — it may not have been submitted. Check the terminal.`;
}

/**
 * Submit a prompt through the verified flow. Returns the delivery result,
 * or null when the bridge predates feature 070 (no delivery info).
 * Throws on HTTP/network failure.
 */
export async function submitVerified(
  sessionName: string,
  prompt: string,
  apiBase: string = '/api/bridge',
): Promise<VerifiedDelivery | null> {
  const res = await fetch(`${apiBase}/sessions/${encodeURIComponent(sessionName)}/submit-verified`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, force: true }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`submit-verified failed (${res.status}): ${text}`);
  }
  const data = await res.json();
  return (data.delivery as VerifiedDelivery | undefined) ?? null;
}

/**
 * Broadcast a delivery failure so the mounted ClaudeTerminalPanel for the
 * session can show its in-panel toast (terminal notifications live inside
 * the panel by convention).
 */
export function notifyDeliveryFailure(sessionName: string, delivery: VerifiedDelivery): void {
  window.dispatchEvent(new CustomEvent('sly-delivery-failure', {
    detail: { sessionName, message: deliveryFailureMessage(delivery), outcome: delivery.outcome },
  }));
}
