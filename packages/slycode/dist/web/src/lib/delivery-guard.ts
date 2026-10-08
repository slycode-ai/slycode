/**
 * Last-moment delivery guard (card #0381, Codex fix loop 2) — type only.
 *
 * Automatic fires (scheduled automations, scheduled card sends, the atlas
 * nightly) pass one of these down to the code that talks to the bridge; it is
 * called IMMEDIATELY before every delivery POST and every retry (after all
 * awaited probes/setup reads). `ok: false` means "the project is no longer
 * allowed to fire": the caller sends nothing and reports a held outcome —
 * the claim is restored, timers/last_run stay untouched, no failure recorded.
 * Manual actions never pass a guard.
 */
export type GuardVerdict = { ok: true } | { ok: false; reason: string };
export type DeliveryGuard = () => Promise<GuardVerdict>;
