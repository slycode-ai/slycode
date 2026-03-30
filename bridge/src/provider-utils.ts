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
}

export interface ProviderPrompt {
  type: 'positional' | 'flag';
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
  prompt: ProviderPrompt;
  instructionFile?: string;
  altInstructionFile?: string;
  model?: {
    flag: string;
    available: Array<{ id: string; label: string; description?: string }>;
  };
}

export interface ProviderDefault {
  provider: string;
  skipPermissions: boolean;
  model?: string;
}

export interface ProvidersData {
  providers: Record<string, ProviderConfig>;
  defaults: {
    stages: Record<string, ProviderDefault>;
    global: ProviderDefault;
    projects: Record<string, ProviderDefault>;
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
  prompt?: string;
  model?: string;            // Model id to pass via provider's model flag
}

/**
 * Build the command and args array for a provider session.
 * Returns { command, args } since Codex resume changes the base command.
 */
export function buildProviderCommand(opts: BuildArgsOptions): { command: string; args: string[] } {
  const { provider, skipPermissions, resume, sessionId, prompt, model } = opts;
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
    } else {
      // No GUID — just pass the flag (Gemini resumes latest)
      args.push(provider.resume.flag!);
    }
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

  // 2. Alt file exists — offer to copy it to the primary filename
  if (provider.altInstructionFile) {
    try {
      await fs.access(path.join(cwd, provider.altInstructionFile));
      return { needed: true, targetFile, copySource: provider.altInstructionFile };
    } catch { /* not found, continue */ }
  }

  // 3. Scan for any existing instruction file in priority order
  for (const candidate of INSTRUCTION_FILE_PRIORITY) {
    if (candidate === targetFile) continue; // skip the one we're trying to create
    try {
      await fs.access(path.join(cwd, candidate));
      return { needed: true, targetFile, copySource: candidate };
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
    await fs.copyFile(src, dest);
    console.log(`[instruction-file] Created ${check.targetFile} from ${check.copySource} in ${cwd}`);
    return { created: true, targetFile: check.targetFile, copiedFrom: check.copySource };
  } catch (err) {
    console.warn(`[instruction-file] Failed to create instruction file in ${cwd}:`, err);
    return { created: false };
  }
}
