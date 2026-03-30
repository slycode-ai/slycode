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
        available: Array<{
            id: string;
            label: string;
            description?: string;
        }>;
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
}
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
