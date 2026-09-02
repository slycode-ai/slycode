/**
 * Refreshed model lists (feature 085, model Refresh).
 *
 * Providers that declare `model.refreshCommand` (OpenCode) enumerate models
 * on demand. The result is per-machine data (it depends on which accounts
 * are connected here), so it does NOT live in data/providers.json — that file
 * is registry config, guarded for parity with the shipped template and
 * replaced wholesale by `slycode update`. It lives in
 * data/provider-models.json (gitignored) and is merged into the provider's
 * `model.available` when /api/providers is read.
 */
import fs from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import { getSlycodeRoot } from './paths';
import { atomicWriteFile } from './atomic-write';

export interface ModelEntry { id: string; label: string; description?: string }

export interface RefreshedModels {
  refreshedAt: string;
  /** Every model the provider listed, in its own order. */
  models: ModelEntry[];
  /** Model ids used before on this machine, most recent first. */
  recent: string[];
}

export type ProviderModelsFile = Record<string, RefreshedModels>;

export function providerModelsPath(root = getSlycodeRoot()): string {
  return path.join(root, 'data', 'provider-models.json');
}

export function readProviderModels(root = getSlycodeRoot()): ProviderModelsFile {
  try {
    const parsed = JSON.parse(fs.readFileSync(providerModelsPath(root), 'utf-8'));
    return parsed && typeof parsed === 'object' ? parsed as ProviderModelsFile : {};
  } catch {
    return {};
  }
}

export async function writeProviderModels(data: ProviderModelsFile, root = getSlycodeRoot()): Promise<void> {
  await atomicWriteFile(providerModelsPath(root), JSON.stringify(data, null, 2) + '\n');
}

/** `opencode models` prints one `provider/model` per line; ignore anything else. */
export function parseModelList(stdout: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of stdout.split(/\r?\n/)) {
    const line = raw.trim();
    if (!/^[a-z0-9][a-z0-9._-]*\/[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(line)) continue;
    if (!seen.has(line)) { seen.add(line); out.push(line); }
  }
  return out;
}

/**
 * Recently used models from `opencode db "select model … order by time_updated desc"`.
 * The column is JSON text like {"id":"gpt-5.6-sol","providerID":"openai",…};
 * tolerate table chrome / headers around it. Output preserves first-seen order.
 */
export function parseRecentModels(stdout: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const re = /\{[^{}]*"id"\s*:\s*"([^"]+)"[^{}]*"providerID"\s*:\s*"([^"]+)"[^{}]*\}|\{[^{}]*"providerID"\s*:\s*"([^"]+)"[^{}]*"id"\s*:\s*"([^"]+)"[^{}]*\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(stdout)) !== null) {
    const id = m[1] ?? m[4];
    const prov = m[2] ?? m[3];
    if (!id || !prov) continue;
    const key = `${prov}/${id}`;
    if (!seen.has(key)) { seen.add(key); out.push(key); }
  }
  return out;
}

/** Build the picker list: recently used first (in recency order), then the rest in provider order. */
export function buildModelEntries(models: string[], recent: string[]): ModelEntry[] {
  const all = new Set(models);
  const recentKnown = recent.filter(r => all.has(r));
  const rest = models.filter(m => !recentKnown.includes(m));
  const entry = (id: string, used: boolean): ModelEntry => {
    const [prov, ...restId] = id.split('/');
    return { id, label: restId.join('/') || id, description: `${prov}${used ? ' · used before' : ''}` };
  };
  return [...recentKnown.map(id => entry(id, true)), ...rest.map(id => entry(id, false))];
}

/** Overlay refreshed lists onto a providers.json document (non-destructive copy). */
export function mergeRefreshedModels<T extends { providers?: Record<string, { model?: { available?: ModelEntry[]; [k: string]: unknown }; [k: string]: unknown }> }>(
  data: T,
  refreshed: ProviderModelsFile,
): T {
  if (!data?.providers) return data;
  const providers: Record<string, unknown> = { ...data.providers };
  for (const [id, r] of Object.entries(refreshed)) {
    const p = data.providers[id];
    if (!p || !r?.models?.length) continue;
    providers[id] = {
      ...p,
      model: {
        ...(p.model ?? { flag: '-m' }),
        available: buildModelEntries(r.models.map(m => m.id), r.recent ?? []),
        refreshedAt: r.refreshedAt,
      },
    };
  }
  return { ...data, providers };
}

function run(argv: string[], cwd: string, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(argv[0], argv.slice(1), { cwd, timeout: timeoutMs, windowsHide: true, maxBuffer: 8 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) reject(new Error(`${argv[0]} failed: ${(stderr || err.message).toString().trim().slice(0, 300)}`));
      else resolve(stdout.toString());
    });
  });
}

/**
 * Run the provider's refresh (and optional recent-usage) commands and persist
 * the result. Returns the merged entries for the picker.
 */
export async function refreshProviderModels(
  providerId: string,
  cfg: { refreshCommand?: string[]; recentCommand?: string[] },
  root = getSlycodeRoot(),
  timeoutMs = 40_000,
): Promise<RefreshedModels> {
  if (!cfg.refreshCommand?.length) throw new Error(`Provider '${providerId}' has no model refresh command`);
  const [listOut, recentOut] = await Promise.all([
    run(cfg.refreshCommand, root, timeoutMs),
    cfg.recentCommand?.length ? run(cfg.recentCommand, root, timeoutMs).catch(() => '') : Promise.resolve(''),
  ]);
  const models = parseModelList(listOut);
  if (models.length === 0) throw new Error(`'${cfg.refreshCommand.join(' ')}' listed no models — is a provider connected? (run 'opencode auth login')`);
  const recent = parseRecentModels(recentOut);
  const result: RefreshedModels = {
    refreshedAt: new Date().toISOString(),
    models: models.map(id => ({ id, label: id.split('/').slice(1).join('/') || id })),
    recent,
  };
  const file = readProviderModels(root);
  file[providerId] = result;
  await writeProviderModels(file, root);
  return result;
}
