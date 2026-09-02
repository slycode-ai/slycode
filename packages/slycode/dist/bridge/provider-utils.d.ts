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
    requiresId?: boolean;
}
/** How the bridge drives this provider (feature 085). Default: pty-scrape. */
export type ProviderTransport = 'pty-scrape' | 'opencode-api';
export interface ProviderColor {
    hex: string;
    tailwind: {
        bg: string;
        text: string;
    };
}
export interface ProviderPrompt {
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
    sessionIdFlag?: string;
    prompt: ProviderPrompt;
    instructionFile?: string;
    altInstructionFile?: string;
    instructionFallbacks?: string[];
    model?: {
        flag: string;
        available: Array<{
            id: string;
            label: string;
            description?: string;
        }>;
        refreshCommand?: string[];
    };
    transport?: ProviderTransport;
    color?: ProviderColor;
    agentIdentity?: string;
    idPattern?: string;
    auth?: {
        check: string[];
    };
    extraArgs?: string[];
    detect?: {
        files?: string[];
        dirs?: string[];
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
        global: ProviderDefault;
        projects?: Record<string, ProviderDefault>;
    };
}
/**
 * Load providers.json from data/ directory (with caching)
 */
export declare function loadProviders(): Promise<ProvidersData>;
/**
 * Get a specific provider config by id. Falls back to treating the id as a command name.
 */
export declare function getProvider(providerId: string): Promise<ProviderConfig | null>;
export interface BuildArgsOptions {
    provider: ProviderConfig;
    skipPermissions: boolean;
    resume: boolean;
    sessionId?: string | null;
    assignSessionId?: string;
    prompt?: string;
    model?: string;
}
/**
 * Build the command and args array for a provider session.
 * Returns { command, args } since Codex resume changes the base command.
 */
export declare function buildProviderCommand(opts: BuildArgsOptions): {
    command: string;
    args: string[];
};
/**
 * Check if a provider supports GUID-based session detection (like Claude)
 */
export declare function supportsSessionDetection(provider: ProviderConfig): boolean;
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
export type InstructionFilePrefs = Record<string, Record<string, boolean>>;
export declare function instructionFilePrefsPath(): string;
export declare function readInstructionFilePrefs(): Promise<InstructionFilePrefs>;
export declare function isInstructionFileSuppressed(providerId: string, cwd: string): Promise<boolean>;
/**
 * Per-machine provider disable list (feature 085 stretch): the web UI's
 * Provider Config modal writes data/provider-prefs.json; the bridge refuses
 * to spawn a disabled provider. Read fresh (no cache) — the file changes at
 * runtime and a spawn is not a hot path.
 */
export declare function isProviderDisabled(providerId: string): Promise<boolean>;
export declare function setInstructionFileSuppressed(providerId: string, cwd: string, suppressed: boolean): Promise<void>;
/**
 * Check if a provider's instruction file exists in the given directory.
 * Detection order:
 * 1. Primary file exists (e.g. CLAUDE.md for Claude, GEMINI.md for Gemini) → no action
 * 2. Alt file exists (e.g. CODEX.md for Codex, AGENTS.md for Gemini) → offer to copy it to primary
 * 3. Any other instruction file exists → offer to copy it
 * 4. No instruction files at all → no action (nothing to copy from)
 */
export declare function checkInstructionFile(providerId: string, cwd: string): Promise<InstructionFileCheck>;
/**
 * Create a missing instruction file by copying from a sibling.
 * Never throws — logs warnings on failure so sessions aren't blocked.
 */
export declare function ensureInstructionFile(providerId: string, cwd: string): Promise<{
    created: boolean;
    targetFile?: string;
    copiedFrom?: string;
}>;
