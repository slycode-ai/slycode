import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface ProviderPermissions {
  flag: string;
  label: string;
  default: boolean;
}

export interface ProviderResume {
  supported: boolean;
  type: 'flag' | 'subcommand';
  flag?: string;
  subcommand?: string;
  lastFlag?: string;
  detectSession: boolean;
  sessionDir?: string;
  // When true the resume flag is never emitted without an id (no "resume
  // latest" semantics — e.g. OpenCode's --session, where the bare form is a
  // usage error and --continue is project-scoped, not cwd-scoped).
  requiresId?: boolean;
}

/** How the bridge drives this provider (feature 085). Default: pty-scrape. */
export type ProviderTransport = 'pty-scrape' | 'opencode-api';

export interface ProviderColor {
  hex: string;
  tailwind: { bg: string; text: string };
}

export interface ProviderPrompt {
  // 'transport' = the initial prompt is never put on argv; the session's
  // transport delivers it after spawn (opencode-api, feature 085).
  type: 'positional' | 'flag' | 'transport';
  interactive?: string;
  nonInteractive?: string;
}

export interface ProviderConfig {
  id: string;
  displayName: string;
  command: string;
  install: string;
  permissions: ProviderPermissions;
  resume: ProviderResume;
  // CLI flag to assign a bridge-generated session id at fresh spawn (feature
  // 081). Present = attribution is definitional and detection never arms for
  // that spawn; absent = provider falls back to file detection. Removing the
  // field from providers.json is the rollback path.
  sessionIdFlag?: string;
  prompt: ProviderPrompt;
  instructionFile?: string;
  altInstructionFile?: string;
  // Sibling instruction files this provider reads natively when its own is
  // absent (OpenCode: AGENTS.md → CLAUDE.md). Makes the missing-file prompt
  // informative rather than alarming (feature 085).
  instructionFallbacks?: string[];
  model?: {
    flag: string;
    available: Array<{ id: string; label: string; description?: string }>;
    // Command that enumerates models on demand (feature 085 model Refresh).
    refreshCommand?: string[];
  };
  // ---- Registry-driven enumeration fields (feature 085 sweep) ----
  transport?: ProviderTransport;
  // Badge/pill colour. Web falls back to a neutral colour when absent.
  color?: ProviderColor;
  // Identity string agents use in `sly-kanban notes add --agent "<identity>"`.
  agentIdentity?: string;
  // Regex source validating this provider's conversation ids (manual link).
  // Absent = the historical UUID-ish pattern.
  idPattern?: string;
  // Pre-flight credential check command (argv). Absent = no check.
  auth?: { check: string[] };
  // Extra argv appended to every fresh spawn (transport may add more).
  extraArgs?: string[];
  // Project markers that mean "this project uses this provider" (badges).
  detect?: { files?: string[]; dirs?: string[] };
}

export interface ProviderDefault {
  provider: string;
  skipPermissions: boolean;
  model?: string;
}

export interface ProvidersData {
  providers: Record<string, ProviderConfig>;
  // Per-project defaults keyed by registry project id, with `global` as the
  // last-set fallback for projects that never set their own (feature 073
  // follow-up). Legacy `stages` keys are ignored.
  defaults: {
    global: ProviderDefault;
    projects?: Record<string, ProviderDefault>;
  };
}

let cachedProviders: ProvidersData | null = null;
let cacheTime = 0;
const CACHE_TTL = 30_000; // 30 seconds

/**
 * Load providers.json from data/ directory (with caching)
 */
export async function loadProviders(): Promise<ProvidersData> {
  const now = Date.now();
  if (cachedProviders && (now - cacheTime) < CACHE_TTL) {
    return cachedProviders;
  }

  const workspaceRoot = process.env.SLYCODE_HOME
    ? path.resolve(process.env.SLYCODE_HOME)
    : path.join(__dirname, '..', '..');
  const providersPath = path.join(workspaceRoot, 'data', 'providers.json');
  const data = await fs.readFile(providersPath, 'utf-8');
  cachedProviders = JSON.parse(data);
  cacheTime = now;
  return cachedProviders!;
}

/**
 * Get a specific provider config by id. Falls back to treating the id as a command name.
 */
export async function getProvider(providerId: string): Promise<ProviderConfig | null> {
  const data = await loadProviders();
  return data.providers[providerId] || null;
}

export interface BuildArgsOptions {
  provider: ProviderConfig;
  skipPermissions: boolean;
  resume: boolean;
  sessionId?: string | null; // For Claude GUID-based resume
  assignSessionId?: string;  // Bridge-generated id for FRESH spawns (feature 081); requires provider.sessionIdFlag
  prompt?: string;
  model?: string;            // Model id to pass via provider's model flag
}

/**
 * Build the command and args array for a provider session.
 * Returns { command, args } since Codex resume changes the base command.
 */
export function buildProviderCommand(opts: BuildArgsOptions): { command: string; args: string[] } {
  const { provider, skipPermissions, resume, sessionId, assignSessionId, prompt, model } = opts;
  const args: string[] = [];
  let command = provider.command;

  // Handle Codex-style subcommand resume (command becomes "codex resume")
  if (resume && provider.resume.supported && provider.resume.type === 'subcommand') {
    // For subcommand-based resume, the subcommand goes as first arg
    args.push(provider.resume.subcommand!);
    if (sessionId) {
      args.push(sessionId);
    } else {
      // No specific session ID — use --last
      args.push(provider.resume.lastFlag!);
    }
    // Permission flags still apply
    if (skipPermissions) {
      args.push(provider.permissions.flag);
    }
    // Codex resume accepts a positional [PROMPT] argument
    if (prompt) {
      args.push(prompt);
    }
    return { command, args };
  }

  // Permission flag
  if (skipPermissions) {
    args.push(provider.permissions.flag);
  }

  // Model flag — only for fresh sessions (resume reconnects to existing model)
  if (!resume && model && provider.model?.flag) {
    args.push(provider.model.flag, model);
  }

  // Resume flag (Claude/Gemini style)
  if (resume && provider.resume.supported && provider.resume.type === 'flag') {
    if (sessionId) {
      args.push(provider.resume.flag!, sessionId);
    } else if (!provider.resume.requiresId) {
      // No GUID — just pass the flag (Gemini resumes latest)
      args.push(provider.resume.flag!);
    }
    // requiresId + no id: fall through to a fresh spawn (never "resume latest")
  }

  // Assigned session id — FRESH spawns only (feature 081). Claude hard-errors
  // when the id already exists, so callers must generate a new UUID per spawn
  // attempt, never reuse a persisted one.
  if (!resume && assignSessionId && provider.sessionIdFlag) {
    args.push(provider.sessionIdFlag, assignSessionId);
  }

  // Initial prompt (Claude accepts prompt alongside --resume; Codex handled by early return above)
  if (prompt) {
    if (provider.prompt.type === 'positional') {
      args.push(prompt);
    } else if (provider.prompt.type === 'flag') {
      // Use interactive flag for sessions (keeps REPL open)
      args.push(provider.prompt.interactive!, prompt);
    }
  }

  return { command, args };
}

/**
 * Check if a provider supports GUID-based session detection (like Claude)
 */
export function supportsSessionDetection(provider: ProviderConfig): boolean {
  return provider.resume.detectSession === true;
}

// Priority order for finding a copy source when instruction file is missing
const INSTRUCTION_FILE_PRIORITY = ['CLAUDE.md', 'AGENTS.md', 'CODEX.md', 'GEMINI.md'];

export interface InstructionFileCheck {
  needed: boolean;
  targetFile?: string;
  copySource?: string;
  /** The provider reads `copySource` natively — creating `targetFile` is optional (feature 085). */
  nativelyReads?: boolean;
  /** One plain sentence for the prompt UI, when nativelyReads. */
  note?: string;
  /** The user asked not to be prompted for this project + provider. */
  suppressed?: boolean;
}

// ---- "Don't ask again" preferences (feature 085) -------------------------
// Workspace file keyed by project cwd → provider → true. Small, human-readable,
// never touched by the build or `slycode update`.

export type InstructionFilePrefs = Record<string, Record<string, boolean>>;

export function instructionFilePrefsPath(): string {
  if (process.env.SLYCODE_INSTRUCTION_PREFS_PATH) return process.env.SLYCODE_INSTRUCTION_PREFS_PATH;
  const workspaceRoot = process.env.SLYCODE_HOME
    ? path.resolve(process.env.SLYCODE_HOME)
    : path.join(__dirname, '..', '..');
  return path.join(workspaceRoot, 'data', 'instruction-file-prefs.json');
}

export async function readInstructionFilePrefs(): Promise<InstructionFilePrefs> {
  try {
    const parsed = JSON.parse(await fs.readFile(instructionFilePrefsPath(), 'utf-8'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function normalizeCwdKey(cwd: string): string {
  const resolved = path.resolve(cwd);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

export async function isInstructionFileSuppressed(providerId: string, cwd: string): Promise<boolean> {
  const prefs = await readInstructionFilePrefs();
  return prefs[normalizeCwdKey(cwd)]?.[providerId] === true;
}

/**
 * Per-machine provider disable list (feature 085 stretch): the web UI's
 * Provider Config modal writes data/provider-prefs.json; the bridge refuses
 * to spawn a disabled provider. Read fresh (no cache) — the file changes at
 * runtime and a spawn is not a hot path.
 */
export async function isProviderDisabled(providerId: string): Promise<boolean> {
  try {
    const workspaceRoot = process.env.SLYCODE_HOME
      ? path.resolve(process.env.SLYCODE_HOME)
      : path.join(__dirname, '..', '..');
    const raw = await fs.readFile(path.join(workspaceRoot, 'data', 'provider-prefs.json'), 'utf-8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed?.disabled) && parsed.disabled.includes(providerId);
  } catch {
    return false;
  }
}

export async function setInstructionFileSuppressed(providerId: string, cwd: string, suppressed: boolean): Promise<void> {
  const prefs = await readInstructionFilePrefs();
  const key = normalizeCwdKey(cwd);
  if (suppressed) {
    prefs[key] = { ...(prefs[key] ?? {}), [providerId]: true };
  } else if (prefs[key]) {
    delete prefs[key][providerId];
    if (Object.keys(prefs[key]).length === 0) delete prefs[key];
  }
  const target = instructionFilePrefsPath();
  await fs.mkdir(path.dirname(target), { recursive: true });
  const tmp = `${target}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(prefs, null, 2) + '\n', 'utf-8');
  await fs.rename(tmp, target);
}

/**
 * Check if a provider's instruction file exists in the given directory.
 * Detection order:
 * 1. Primary file exists (e.g. CLAUDE.md for Claude, GEMINI.md for Gemini) → no action
 * 2. Alt file exists (e.g. CODEX.md for Codex, AGENTS.md for Gemini) → offer to copy it to primary
 * 3. Any other instruction file exists → offer to copy it
 * 4. No instruction files at all → no action (nothing to copy from)
 */
export async function checkInstructionFile(providerId: string, cwd: string): Promise<InstructionFileCheck> {
  const provider = await getProvider(providerId);
  if (!provider?.instructionFile) {
    return { needed: false };
  }

  const targetFile = provider.instructionFile;

  // 1. Primary file exists — no action needed
  try {
    await fs.access(path.join(cwd, targetFile));
    return { needed: false };
  } catch { /* not found, continue */ }

  // 1b. The user asked not to be prompted for this project + provider
  if (await isInstructionFileSuppressed(providerId, cwd)) {
    return { needed: false, suppressed: true, targetFile };
  }

  // Decorate a copy offer with what the provider does on its own (feature 085):
  // if it reads the sibling natively, say so and mark the copy optional.
  const offer = (copySource: string): InstructionFileCheck => {
    const nativelyReads = (provider.instructionFallbacks ?? []).includes(copySource);
    if (!nativelyReads) return { needed: true, targetFile, copySource };
    const shortName = provider.displayName.replace(/ (Code|CLI)$/, '');
    return {
      needed: true,
      targetFile,
      copySource,
      nativelyReads: true,
      note: `${shortName} reads ${copySource} on its own when ${targetFile} is absent, so this is optional.`,
    };
  };

  // 2. Alt file exists — offer to copy it to the primary filename
  if (provider.altInstructionFile) {
    try {
      await fs.access(path.join(cwd, provider.altInstructionFile));
      return offer(provider.altInstructionFile);
    } catch { /* not found, continue */ }
  }

  // 3. Scan for any existing instruction file in priority order
  for (const candidate of INSTRUCTION_FILE_PRIORITY) {
    if (candidate === targetFile) continue; // skip the one we're trying to create
    try {
      await fs.access(path.join(cwd, candidate));
      return offer(candidate);
    } catch { /* not found, try next */ }
  }

  // 4. No instruction files at all — nothing to copy from
  return { needed: false };
}

/**
 * Create a missing instruction file by copying from a sibling.
 * Never throws — logs warnings on failure so sessions aren't blocked.
 */
export async function ensureInstructionFile(providerId: string, cwd: string): Promise<{ created: boolean; targetFile?: string; copiedFrom?: string }> {
  try {
    const check = await checkInstructionFile(providerId, cwd);
    if (!check.needed || !check.targetFile || !check.copySource) {
      return { created: false };
    }

    const src = path.join(cwd, check.copySource);
    const dest = path.join(cwd, check.targetFile);
    // Refuse symlink sources — copyFile dereferences them, which would pull
    // the link target's content into the workspace (card #0326).
    if ((await fs.lstat(src)).isSymbolicLink()) {
      console.warn(`[instruction-file] Skipping symlink source ${src}`);
      return { created: false };
    }
    await fs.copyFile(src, dest);
    console.log(`[instruction-file] Created ${check.targetFile} from ${check.copySource} in ${cwd}`);
    return { created: true, targetFile: check.targetFile, copiedFrom: check.copySource };
  } catch (err) {
    console.warn(`[instruction-file] Failed to create instruction file in ${cwd}:`, err);
    return { created: false };
  }
}
