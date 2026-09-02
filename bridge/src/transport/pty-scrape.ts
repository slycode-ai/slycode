/**
 * pty-scrape transport (feature 085) — the pre-seam behaviour for Claude,
 * Codex and Gemini, unchanged:
 *
 *  - identity: bridge-assigned `--session-id` when the provider declares
 *    `sessionIdFlag` (feature 081), else transcript-file detection after
 *    launch (features 080/081) via claude-utils
 *  - delivery: the snapshot-classifier ladder in SessionManager
 *    (`performVerifiedDelivery`, feature 070), reached through hooks
 *  - recovery: transcript-file candidate listing via claude-utils
 */
import { randomUUID } from 'crypto';
import {
  getProviderSessionDir,
  listProviderSessionFiles,
  listProviderSessionCandidates,
} from '../claude-utils.js';
import { supportsSessionDetection } from '../provider-utils.js';
import type { ProviderConfig } from '../provider-utils.js';
import type { DeliveryResult, Session } from '../types.js';
import type { SessionTransport, SpawnPlan, SpawnPlanInput, TransportHooks, SessionCandidate } from './types.js';

export class PtyScrapeTransport implements SessionTransport {
  readonly id = 'pty-scrape' as const;

  async planSpawn(input: SpawnPlanInput): Promise<SpawnPlan> {
    const { providerConfig, providerId, cwd, resume } = input;

    // Deterministic session-id assignment (feature 081): MUST be a fresh
    // UUID per spawn attempt — Claude hard-errors on a --session-id that
    // already exists.
    const assignedSessionId = (!resume && providerConfig.sessionIdFlag) ? randomUUID() : null;

    // Capture existing session files before spawn so detection can diff —
    // skipped entirely when the id was assigned (081) or when resuming.
    let sessionDir: string | null = null;
    let beforeFiles: string[] = [];
    const detectable = supportsSessionDetection(providerConfig);
    if (detectable && !resume && !assignedSessionId) {
      sessionDir = getProviderSessionDir(providerId, cwd);
      if (sessionDir) beforeFiles = await listProviderSessionFiles(providerId, sessionDir);
    }

    return {
      extraArgs: [],
      env: {},
      assignedSessionId,
      assignedIdUnverified: !!assignedSessionId,
      sessionDir,
      beforeFiles,
      armDetection: detectable && !resume && !assignedSessionId && !!sessionDir,
    };
  }

  async afterSpawn(session: Session, plan: SpawnPlan, hooks: TransportHooks): Promise<void> {
    if (plan.armDetection && !session.claudeSessionId) {
      hooks.startDetection(session.name, session.provider, plan.beforeFiles);
    }
  }

  deliver(session: Session, prompt: string, hooks: TransportHooks): Promise<DeliveryResult> {
    return hooks.performVerifiedDelivery(session.name, prompt);
  }

  supportsDetection(providerConfig: ProviderConfig, cwd: string): boolean {
    return supportsSessionDetection(providerConfig) && !!getProviderSessionDir(providerConfig.id, cwd);
  }

  listCandidates(providerId: string, cwd: string, excludeFiles?: string[]): Promise<SessionCandidate[]> {
    // Transcript files only — the session record carries nothing extra here.
    return listProviderSessionCandidates(providerId, cwd, excludeFiles);
  }

  async onStop(): Promise<void> {
    // Nothing to tear down: the PTY is the only resource.
  }
}
