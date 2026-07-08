/**
 * Atlas refresh kickoff (feature 076) — shared by the /api/atlas/refresh
 * route (run-now button) and the scheduler's nightly atlas scan.
 *
 * Start-or-resume the project's dedicated Atlas terminal session
 * ({sessionKey}:{provider}:atlas) and verified-submit the skill-loading
 * refresh prompt. The agent does the analysis; the sly-atlas CLI enforces
 * the artifact contract.
 */

import { promises as fs } from 'fs';
import path from 'path';
import { atlasPath } from './store';
import type { AtlasConfig } from './schema';
import { getSlycodeRoot, getBridgeUrl } from '@/lib/paths';
import { computeSessionKey } from '@/lib/session-keys';
import { loadRegistry } from '@/lib/registry';

export const DEFAULT_ATLAS_CONFIG: AtlasConfig = {
  enabled: false,
  schedule: '0 3 * * *',
  provider: null,
  model: null,
  last_run: null,
};

export async function readAtlasConfig(projectRoot: string): Promise<AtlasConfig> {
  try {
    const raw = JSON.parse(await fs.readFile(atlasPath(projectRoot, 'config.json'), 'utf-8'));
    return { ...DEFAULT_ATLAS_CONFIG, ...raw };
  } catch {
    return { ...DEFAULT_ATLAS_CONFIG };
  }
}

export async function writeAtlasConfig(projectRoot: string, config: AtlasConfig): Promise<void> {
  await fs.mkdir(atlasPath(projectRoot), { recursive: true });
  const file = atlasPath(projectRoot, 'config.json');
  const tmp = file + `.tmp-${process.pid}`;
  await fs.writeFile(tmp, JSON.stringify(config, null, 2) + '\n', 'utf-8');
  await fs.rename(tmp, file);
}

export async function kickoffAtlasRefresh(
  projectId: string,
  projectRoot: string,
  trigger: 'manual' | 'scheduled',
): Promise<{ ok: true; sessionName: string } | { ok: false; error: string }> {
  // Resolve provider + model: atlas config override → global default
  // (feature 073, INCLUDING its model) → provider CLI default.
  const config = await readAtlasConfig(projectRoot);
  let provider = config.provider ?? null;
  let model: string | undefined = config.model ?? undefined;
  let skipPermissions = true;
  try {
    const providersRaw = JSON.parse(
      await fs.readFile(path.join(getSlycodeRoot(), 'data', 'providers.json'), 'utf-8'),
    );
    const global = providersRaw?.defaults?.global ?? {};
    if (!provider) {
      provider = global.provider ?? null;
      // Following the global default provider → its default model rides along
      // unless the atlas config pinned one.
      if (!model && typeof global.model === 'string') model = global.model;
    }
    if (typeof global.skipPermissions === 'boolean') skipPermissions = global.skipPermissions;
  } catch { /* fall through to defaults */ }
  provider = provider || 'claude';

  // Session identity: {sessionKey}:{provider}:atlas (session-keys convention).
  const registry = await loadRegistry();
  const regProject = registry.projects.find(p => p.id === projectId);
  const sessionKey = regProject?.sessionKey ?? computeSessionKey(projectRoot);
  const sessionName = `${sessionKey}:${provider}:atlas`;

  const hasAtlas = await fs.access(atlasPath(projectRoot, 'atlas.json')).then(() => true, () => false);
  // Timestamp in the injected prompt (server-local time, [DD-MM-YYYY HH:mm:ss]
  // like the sly-actions convention) so terminal scrollback shows at a glance
  // WHICH run this was — e.g. "last night's 3am" vs a manual click.
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const stamp = `${pad(now.getDate())}-${pad(now.getMonth() + 1)}-${now.getFullYear()} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
  const prompt = [
    `=== ATLAS REFRESH · ${trigger === 'scheduled' ? 'SCHEDULED (nightly)' : 'MANUAL'} · [${stamp}] ===`,
    `Load the atlas skill now (read .claude/skills/atlas/SKILL.md — or the store copy at store/skills/atlas/SKILL.md in the SlyCode master repo) and follow it exactly.`,
    hasAtlas
      ? `An atlas exists. Run the incremental refresh: \`sly-atlas status --json\` to list stale areas, re-analyze ONLY those, and write each updated node via \`sly-atlas write-node\`.`
      : `No atlas exists yet. Run the FIRST SCAN: explore the codebase, propose 4-8 top-level areas via \`sly-atlas propose-areas\`, then write a node for each area via \`sly-atlas write-node\`.`,
    `All writes are schema-validated by the CLI — on rejection, fix the JSON and retry. Do not edit documentation/atlas/ files directly.`,
  ].join('\n');

  try {
    const res = await fetch(`${getBridgeUrl()}/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: sessionName,
        provider,
        ...(model ? { model } : {}),
        skipPermissions,
        cwd: projectRoot,
        prompt,
        fresh: false, // resume atlas session context when it exists
        verifyDelivery: true,
      }),
      signal: AbortSignal.timeout(90_000),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      return { ok: false, error: `bridge ${res.status}: ${detail.slice(0, 300)}` };
    }
    const data = await res.json();
    if (data.delivery && data.delivery.outcome !== 'delivered') {
      return { ok: false, error: `delivery ${data.delivery.outcome}: ${data.delivery.reason ?? 'unknown'}` };
    }
    config.last_run = new Date().toISOString();
    await writeAtlasConfig(projectRoot, config);
    return { ok: true, sessionName };
  } catch (e) {
    return { ok: false, error: String((e as Error).message ?? e) };
  }
}
