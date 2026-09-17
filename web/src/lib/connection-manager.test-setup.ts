/**
 * Test-only browser fakes for connection-manager.test.ts. The manager builds a
 * browser singleton at import time, so these globals must exist BEFORE that
 * module is evaluated — the test imports this file first (import order is
 * evaluation order). Not part of the app bundle: nothing under app/ imports it.
 */

// ---- fake browser -----------------------------------------------------------

export class FakeEventSource {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 2;
  static instances: FakeEventSource[] = [];
  readyState = FakeEventSource.CONNECTING;
  onopen: ((ev: unknown) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: unknown) => void) | null = null;
  private listeners = new Map<string, Array<(ev: unknown) => void>>();
  constructor(public url: string) { FakeEventSource.instances.push(this); }
  addEventListener(name: string, fn: (ev: unknown) => void) {
    const arr = this.listeners.get(name) ?? [];
    arr.push(fn);
    this.listeners.set(name, arr);
  }
  close() { this.readyState = FakeEventSource.CLOSED; }
  // test helpers
  open() { this.readyState = FakeEventSource.OPEN; this.onopen?.({}); }
  /** Browser lost the socket and is retrying on its own. */
  nativeReconnect() { this.readyState = FakeEventSource.CONNECTING; this.onerror?.({}); }
  fail() { this.readyState = FakeEventSource.CLOSED; this.onerror?.({}); }
  emit(name: string, data: string) { for (const fn of this.listeners.get(name) ?? []) fn({ data }); }
}

export const clock = { t: 1_000_000 };
export const realDateNow = Date.now;
Date.now = () => clock.t;

// Timers the singleton creates at import must not keep the process alive.
const realSetInterval = globalThis.setInterval;
(globalThis as unknown as { setInterval: unknown }).setInterval = ((fn: () => void, ms: number) => {
  const t = realSetInterval(fn, ms);
  (t as { unref?: () => void }).unref?.();
  return t;
}) as typeof setInterval;

const listeners: Record<string, Array<() => void>> = {};
const g = globalThis as unknown as Record<string, unknown>;
g.window = { addEventListener: (n: string, fn: () => void) => { (listeners[n] ??= []).push(fn); } };
g.document = { visibilityState: 'visible', addEventListener: (n: string, fn: () => void) => { (listeners[n] ??= []).push(fn); } };
g.localStorage = { getItem: () => null };
g.EventSource = FakeEventSource;

