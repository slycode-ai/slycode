'use client';

/**
 * useConnectionBudget — is this tab starving for HTTP/1.1 connections?
 * (card #0356, option E)
 *
 * Silent unless the page is on plain HTTP (browsers cap a cleartext origin at
 * 6 concurrent connections; HTTPS negotiates HTTP/2 and has no such cap).
 * On plain HTTP it joins the per-browser tally (ConnectionBudget over a
 * BroadcastChannel), feeds it this tab's live stream picture from the
 * ConnectionManager, and surfaces the verdict. Observes only — it never
 * opens, closes or reconnects anything.
 */

import { useEffect, useState } from 'react';
import { connectionManager } from '@/lib/connection-manager';
import {
  ConnectionBudget,
  classifyProtocol,
  createBroadcastBudgetChannel,
  newBudgetTabId,
  type BudgetVerdict,
} from '@/lib/connection-budget';

export interface ConnectionBudgetState {
  /** True only on plain HTTP — everywhere else the hook is inert. */
  capped: boolean;
  verdict: BudgetVerdict | null;
  /** The configured HTTPS address to offer as the way out, when known. */
  httpsUrl: string | null;
}

const IDLE: ConnectionBudgetState = { capped: false, verdict: null, httpsUrl: null };
const HTTPS_URL_CACHE_KEY = 'slycode-https-url';

/** nextHopProtocol from the navigation + resource timing entries, when the browser exposes them. */
function observedHopProtocols(): string[] {
  try {
    const entries = [
      ...performance.getEntriesByType('navigation'),
      ...performance.getEntriesByType('resource'),
    ] as Array<PerformanceEntry & { nextHopProtocol?: string }>;
    return entries.map((e) => e.nextHopProtocol ?? '').filter(Boolean);
  } catch {
    return [];
  }
}

function cachedHttpsUrl(): string | null {
  try { return localStorage.getItem(HTTPS_URL_CACHE_KEY); } catch { return null; }
}

export function useConnectionBudget(): ConnectionBudgetState {
  const [state, setState] = useState<ConnectionBudgetState>(IDLE);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const protocol = classifyProtocol({
      locationProtocol: window.location.protocol,
      nextHopProtocols: observedHopProtocols(),
    });
    if (protocol !== 'plain-http') return; // h2/h3/https: nothing to watch

    let httpsUrl = cachedHttpsUrl();
    let verdict: BudgetVerdict | null = null;
    let disposed = false;
    const publish = () => {
      if (disposed) return;
      setState({ capped: true, verdict, httpsUrl });
    };

    const budget = new ConnectionBudget({
      tabId: newBudgetTabId(),
      channel: createBroadcastBudgetChannel(),
      onVerdict: (v) => { verdict = v; publish(); },
    });
    const feed = () => budget.setLocal(connectionManager.report());

    budget.start();
    feed();
    const unsubscribe = connectionManager.subscribeReport(feed);
    // The beat re-announces this tab, prunes dead peers, and — because
    // `connectingForMs` grows without any event — is what notices a stream
    // that never opens.
    const beat = setInterval(() => { feed(); budget.tick(); }, budget.heartbeatMs);
    // Presence must survive Chrome's background-tab timer throttling (beats
    // slow to one a minute after 5 min hidden): peers expire only after a
    // multi-minute silence or an explicit goodbye, and a tab re-announces the
    // moment it is visible/focused so the foreground tally is fresh at once.
    // Release on pagehide only — never beforeunload: a cancelled navigation fires
    // it with no pageshow after, and the tally would stay stopped for good.
    const onUnload = () => budget.stop();
    const onShow = () => { budget.start(); feed(); budget.announce(); }; // bfcache restore: start() is idempotent
    const onWake = () => {
      if (document.visibilityState !== 'visible') return;
      feed();
      budget.announce();
    };
    window.addEventListener('pagehide', onUnload);
    window.addEventListener('pageshow', onShow);
    window.addEventListener('focus', onWake);
    document.addEventListener('visibilitychange', onWake);

    // Ask once for the configured HTTPS address. Under real starvation this
    // request may itself be queued, so the answer is cached for the next tab.
    const ac = new AbortController();
    fetch('/api/https-url', { signal: ac.signal, cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { url?: string | null } | null) => {
        if (disposed || !d || typeof d.url !== 'string') return;
        httpsUrl = d.url;
        try { localStorage.setItem(HTTPS_URL_CACHE_KEY, d.url); } catch { /* per-viewer convenience only */ }
        publish();
      })
      .catch(() => { /* unknown address — banner uses generic wording */ });

    return () => {
      disposed = true;
      ac.abort();
      clearInterval(beat);
      window.removeEventListener('pagehide', onUnload);
      window.removeEventListener('pageshow', onShow);
      window.removeEventListener('focus', onWake);
      document.removeEventListener('visibilitychange', onWake);
      unsubscribe();
      budget.stop();
    };
  }, []);

  return state;
}
