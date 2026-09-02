/**
 * Transport resolution (feature 085): providers.json `transport` picks the
 * implementation; absent = pty-scrape (every pre-085 provider).
 */
import type { ProviderConfig, ProviderTransport } from '../provider-utils.js';
import { PtyScrapeTransport } from './pty-scrape.js';
import { OpenCodeApiTransport } from './opencode-api.js';
import type { SessionTransport } from './types.js';

const instances = new Map<ProviderTransport, SessionTransport>();

export function getTransportById(id: ProviderTransport | undefined): SessionTransport {
  const key: ProviderTransport = id ?? 'pty-scrape';
  let t = instances.get(key);
  if (!t) {
    switch (key) {
      case 'pty-scrape':
        t = new PtyScrapeTransport();
        break;
      case 'opencode-api':
        t = new OpenCodeApiTransport();
        break;
      default:
        // Unknown/unimplemented transport id: fall back loudly to pty-scrape so
        // a typo in providers.json degrades to the known path, not a crash.
        console.warn(`[transport] Unknown transport '${key}' — falling back to pty-scrape`);
        t = new PtyScrapeTransport();
    }
    instances.set(key, t);
  }
  return t;
}

export function getTransport(providerConfig: ProviderConfig | null | undefined): SessionTransport {
  return getTransportById(providerConfig?.transport);
}

export type { SessionTransport, SpawnPlan, SpawnPlanInput, TransportHooks, SessionCandidate, SessionLike } from './types.js';
