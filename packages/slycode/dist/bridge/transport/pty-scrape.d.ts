import type { ProviderConfig } from '../provider-utils.js';
import type { DeliveryResult, Session } from '../types.js';
import type { SessionTransport, SpawnPlan, SpawnPlanInput, TransportHooks, SessionCandidate } from './types.js';
export declare class PtyScrapeTransport implements SessionTransport {
    readonly id: "pty-scrape";
    planSpawn(input: SpawnPlanInput): Promise<SpawnPlan>;
    afterSpawn(session: Session, plan: SpawnPlan, hooks: TransportHooks): Promise<void>;
    deliver(session: Session, prompt: string, hooks: TransportHooks): Promise<DeliveryResult>;
    supportsDetection(providerConfig: ProviderConfig, cwd: string): boolean;
    listCandidates(providerId: string, cwd: string, excludeFiles?: string[]): Promise<SessionCandidate[]>;
    onStop(): Promise<void>;
}
