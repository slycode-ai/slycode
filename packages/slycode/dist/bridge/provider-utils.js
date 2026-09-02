import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
let cachedProviders = null;
let cacheTime = 0;
const CACHE_TTL = 30_000; // 30 seconds
/**
 * Load providers.json from data/ directory (with caching)
 */
export async function loadProviders() {
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
    return cachedProviders;
}
/**
 * Get a specific provider config by id. Falls back to treating the id as a command name.
 */
export async function getProvider(providerId) {
    const data = await loadProviders();
    return data.providers[providerId] || null;
}
/**
 * Build the command and args array for a provider session.
 * Returns { command, args } since Codex resume changes the base command.
 */
export function buildProviderCommand(opts) {
    const { provider, skipPermissions, resume, sessionId, assignSessionId, prompt, model } = opts;
    const args = [];
    let command = provider.command;
    // Handle Codex-style subcommand resume (command becomes "codex resume")
    if (resume && provider.resume.supported && provider.resume.type === 'subcommand') {
        // For subcommand-based resume, the subcommand goes as first arg
        args.push(provider.resume.subcommand);
        if (sessionId) {
            args.push(sessionId);
        }
        else {
            // No specific session ID — use --last
            args.push(provider.resume.lastFlag);
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
            args.push(provider.resume.flag, sessionId);
        }
        else if (!provider.resume.requiresId) {
            // No GUID — just pass the flag (Gemini resumes latest)
            args.push(provider.resume.flag);
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
        }
        else if (provider.prompt.type === 'flag') {
            // Use interactive flag for sessions (keeps REPL open)
            args.push(provider.prompt.interactive, prompt);
        }
    }
    return { command, args };
}
/**
 * Check if a provider supports GUID-based session detection (like Claude)
 */
export function supportsSessionDetection(provider) {
    return provider.resume.detectSession === true;
}
// Priority order for finding a copy source when instruction file is missing
const INSTRUCTION_FILE_PRIORITY = ['CLAUDE.md', 'AGENTS.md', 'CODEX.md', 'GEMINI.md'];
export function instructionFilePrefsPath() {
    if (process.env.SLYCODE_INSTRUCTION_PREFS_PATH)
        return process.env.SLYCODE_INSTRUCTION_PREFS_PATH;
    const workspaceRoot = process.env.SLYCODE_HOME
        ? path.resolve(process.env.SLYCODE_HOME)
        : path.join(__dirname, '..', '..');
    return path.join(workspaceRoot, 'data', 'instruction-file-prefs.json');
}
export async function readInstructionFilePrefs() {
    try {
        const parsed = JSON.parse(await fs.readFile(instructionFilePrefsPath(), 'utf-8'));
        return parsed && typeof parsed === 'object' ? parsed : {};
    }
    catch {
        return {};
    }
}
function normalizeCwdKey(cwd) {
    const resolved = path.resolve(cwd);
    return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}
export async function isInstructionFileSuppressed(providerId, cwd) {
    const prefs = await readInstructionFilePrefs();
    return prefs[normalizeCwdKey(cwd)]?.[providerId] === true;
}
/**
 * Per-machine provider disable list (feature 085 stretch): the web UI's
 * Provider Config modal writes data/provider-prefs.json; the bridge refuses
 * to spawn a disabled provider. Read fresh (no cache) — the file changes at
 * runtime and a spawn is not a hot path.
 */
export async function isProviderDisabled(providerId) {
    try {
        const workspaceRoot = process.env.SLYCODE_HOME
            ? path.resolve(process.env.SLYCODE_HOME)
            : path.join(__dirname, '..', '..');
        const raw = await fs.readFile(path.join(workspaceRoot, 'data', 'provider-prefs.json'), 'utf-8');
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed?.disabled) && parsed.disabled.includes(providerId);
    }
    catch {
        return false;
    }
}
export async function setInstructionFileSuppressed(providerId, cwd, suppressed) {
    const prefs = await readInstructionFilePrefs();
    const key = normalizeCwdKey(cwd);
    if (suppressed) {
        prefs[key] = { ...(prefs[key] ?? {}), [providerId]: true };
    }
    else if (prefs[key]) {
        delete prefs[key][providerId];
        if (Object.keys(prefs[key]).length === 0)
            delete prefs[key];
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
export async function checkInstructionFile(providerId, cwd) {
    const provider = await getProvider(providerId);
    if (!provider?.instructionFile) {
        return { needed: false };
    }
    const targetFile = provider.instructionFile;
    // 1. Primary file exists — no action needed
    try {
        await fs.access(path.join(cwd, targetFile));
        return { needed: false };
    }
    catch { /* not found, continue */ }
    // 1b. The user asked not to be prompted for this project + provider
    if (await isInstructionFileSuppressed(providerId, cwd)) {
        return { needed: false, suppressed: true, targetFile };
    }
    // Decorate a copy offer with what the provider does on its own (feature 085):
    // if it reads the sibling natively, say so and mark the copy optional.
    const offer = (copySource) => {
        const nativelyReads = (provider.instructionFallbacks ?? []).includes(copySource);
        if (!nativelyReads)
            return { needed: true, targetFile, copySource };
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
        }
        catch { /* not found, continue */ }
    }
    // 3. Scan for any existing instruction file in priority order
    for (const candidate of INSTRUCTION_FILE_PRIORITY) {
        if (candidate === targetFile)
            continue; // skip the one we're trying to create
        try {
            await fs.access(path.join(cwd, candidate));
            return offer(candidate);
        }
        catch { /* not found, try next */ }
    }
    // 4. No instruction files at all — nothing to copy from
    return { needed: false };
}
/**
 * Create a missing instruction file by copying from a sibling.
 * Never throws — logs warnings on failure so sessions aren't blocked.
 */
export async function ensureInstructionFile(providerId, cwd) {
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
    }
    catch (err) {
        console.warn(`[instruction-file] Failed to create instruction file in ${cwd}:`, err);
        return { created: false };
    }
}
//# sourceMappingURL=provider-utils.js.map