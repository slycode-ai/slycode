/**
 * Transport resolution (feature 085): providers.json `transport` picks the
 * implementation; absent = pty-scrape (every pre-085 provider).
 */
import type { ProviderConfig, ProviderTransport } from '../provider-utils.js';
import type { SessionTransport } from './types.js';
export declare function getTransportById(id: ProviderTransport | undefined): SessionTransport;
export declare function getTransport(providerConfig: ProviderConfig | null | undefined): SessionTransport;
export type { SessionTransport, SpawnPlan, SpawnPlanInput, TransportHooks, SessionCandidate, SessionLike } from './types.js';
