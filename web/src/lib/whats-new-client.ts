/**
 * Browser side of the What's new splash (feature #0379). The splash itself is
 * owned by WhatsNewGate (mounted once in app/layout.tsx); other components
 * talk to it through two window events instead of shared React state, because
 * the layout and the pages don't share a provider.
 */
import type { WhatsNewEntry } from './whats-new';

export interface WhatsNewStatus {
  installed: string | null;
  /** Unseen releases with content, newest first: the splash pages on load. */
  pages: WhatsNewEntry[];
  /** Every release with content at or below installed, newest first: the footer reopen. */
  history: WhatsNewEntry[];
  latest: WhatsNewEntry | null;
  unseen: boolean;
  /** ?whatsnew= / ?whatsnew-from= authoring preview pages; null when not asked. */
  preview: WhatsNewEntry[] | null;
}

/** Authoring preview read from the page URL: ?whatsnew=<v> and/or ?whatsnew-from=<v>. */
export interface WhatsNewPreview {
  version: string | null;
  from: string | null;
}

export function previewFromSearch(search: string): WhatsNewPreview | null {
  const q = new URLSearchParams(search);
  const version = q.get('whatsnew');
  const from = q.get('whatsnew-from');
  return version || from ? { version, from } : null;
}

/** Fired by anything that wants the splash reopened (the dashboard footer). */
export const WHATS_NEW_OPEN_EVENT = 'slycode:whats-new-open';
/** Fired by the gate once the current release has been dismissed. */
export const WHATS_NEW_SEEN_EVENT = 'slycode:whats-new-seen';

export function openWhatsNew(): void {
  window.dispatchEvent(new Event(WHATS_NEW_OPEN_EVENT));
}

let statusPromise: Promise<WhatsNewStatus | null> | null = null;

/**
 * GET /api/whats-new. The plain status is fetched once per page load and
 * shared (gate + footer); a preview request always goes to the server.
 * Null when signed out or on any error: the splash simply doesn't show.
 */
export function fetchWhatsNew(preview?: WhatsNewPreview | null): Promise<WhatsNewStatus | null> {
  const load = () => {
    const q = new URLSearchParams();
    if (preview?.version) q.set('preview', preview.version);
    if (preview?.from) q.set('previewFrom', preview.from);
    const qs = q.toString();
    return fetch(`/api/whats-new${qs ? `?${qs}` : ''}`)
      .then(r => (r.ok ? (r.json() as Promise<WhatsNewStatus>) : null))
      .catch(() => null);
  };
  if (preview) return load();
  statusPromise ??= load();
  return statusPromise;
}

export function markWhatsNewSeen(): void {
  if (statusPromise) statusPromise = statusPromise.then(s => (s ? { ...s, unseen: false, pages: [] } : s));
  window.dispatchEvent(new Event(WHATS_NEW_SEEN_EVENT));
  fetch('/api/whats-new/seen', { method: 'POST' }).catch(() => { /* shows again next load; harmless */ });
}
