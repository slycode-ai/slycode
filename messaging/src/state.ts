import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import type { AppState, NavigationTarget, PendingInstructionFileConfirm, Project, ResponseMode, TargetType } from './types.js';
import { computeSessionKey, resolveCanonicalProjectId } from './session-keys.js';
import { atomicWriteFileSync } from './atomic-write.js';
import { isTtsProviderId, type TtsProviderId, type VoiceRef } from './tts/provider.js';
import type { VoiceRecipe } from './tts/custom-voices.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function getWorkspaceRoot(): string {
  if (process.env.SLYCODE_HOME) return process.env.SLYCODE_HOME;
  return path.resolve(__dirname, '..', '..');
}

function getStateFile(): string {
  return path.join(getWorkspaceRoot(), 'messaging-state.json');
}

function getRegistryFile(): string {
  return path.join(getWorkspaceRoot(), 'projects', 'registry.json');
}

/** A stored voice. ElevenLabs slots stay {id, name}; other providers may carry kind/expiry. */
export interface StoredVoice {
  id: string;
  name: string;
  kind?: VoiceRef['kind'];
  expiresAt?: string;
}

/** Providers whose voices live in the new per-provider maps (ElevenLabs keeps the legacy fields). */
type MappedProvider = Exclude<TtsProviderId, 'elevenlabs'>;

export class StateManager {
  private state: AppState;
  private voiceId: string | null = null;
  private voiceName: string | null = null;
  private responseMode: ResponseMode = 'text';
  private voiceTone: string | null = null;
  // Global toggle for echoing voice-note transcripts back as threaded replies.
  private voiceEchoEnabled: boolean = true;
  private selectedProvider: string = 'claude';
  private selectedModel: string = '';  // '' = Default (no flag)
  private providerOverrides: Record<string, string> = {};  // per-target provider overrides (sticky)
  // Per-project voice/mode/tone overrides. Keyed by project.id. The top-level
  // voiceId/responseMode/voiceTone fields above act as the inheritance source
  // ("most-recently-set value") for any project that has no entry here.
  //
  // Voices are stored PER PROVIDER (feature 087). The ElevenLabs slot keeps
  // living in the pre-087 fields — top-level voiceId/voiceName and
  // targetPrefs[p].voice — so an older SlyCode build (rollback) reads exactly
  // what it always did and there is never a second copy to drift. Other
  // providers live in `defaultVoices[provider]` and `targetPrefs[p].voices`.
  private targetPrefs: Record<string, {
    voice?: { id: string; name: string };
    voices?: Partial<Record<MappedProvider, StoredVoice>>;
    responseMode?: ResponseMode;
    voiceTone?: string;
  }> = {};
  /** Install-level default voice for non-ElevenLabs providers (ElevenLabs: voiceId/voiceName). */
  private defaultVoices: Partial<Record<MappedProvider, StoredVoice>> = {};
  /** Explicit install-wide TTS provider switch (null = follow TTS_PROVIDER / auto). */
  private ttsProvider: TtsProviderId | null = null;
  /** Increments on every successful provider switch; pickers use it to reject stale picks. */
  private ttsProviderRevision = 0;
  /** Designed-voice recipes by voice id (feature 087 phase 4), kept after delete so a voice can be recreated. */
  private customVoices: Record<string, VoiceRecipe> = {};
  private _pendingInstructionFileConfirm: PendingInstructionFileConfirm | null = null;
  private chatId: number | null = null;

  constructor() {
    this.state = {
      selectedProjectId: null,
      selectedCardId: null,
      selectedCardStage: null,
      targetType: 'global',
      projects: [],
    };
    this.loadProjects();
    this.loadState();
  }

  private loadProjects(): void {
    try {
      const data = JSON.parse(fs.readFileSync(getRegistryFile(), 'utf-8'));
      this.state.projects = data.projects.map((p: any) => ({
        id: p.id,
        name: p.name,
        description: p.description,
        path: p.path || '',
        // Carry sessionKey/aliases forward if the registry has been migrated.
        // If absent, session-keys helpers derive on-the-fly from path.
        sessionKey: p.sessionKey,
        sessionKeyAliases: p.sessionKeyAliases,
      }));
    } catch (err) {
      console.warn('Could not load project registry:', (err as Error).message);
      this.state.projects = [];
    }
  }

  private loadState(): void {
    try {
      const data = JSON.parse(fs.readFileSync(getStateFile(), 'utf-8'));

      // Restore target type
      if (data.targetType && ['global', 'project', 'card'].includes(data.targetType)) {
        this.state.targetType = data.targetType as TargetType;
      }

      // Restore project selection
      if (data.selectedProjectId) {
        const exists = this.state.projects.some(p => p.id === data.selectedProjectId);
        if (exists) {
          this.state.selectedProjectId = data.selectedProjectId;
        } else {
          // Project removed — fall back to global
          this.state.targetType = 'global';
        }
      }

      // Restore card selection (only valid if project is set)
      if (data.selectedCardId && this.state.selectedProjectId) {
        this.state.selectedCardId = data.selectedCardId;
        this.state.selectedCardStage = data.selectedCardStage || null;
      } else if (this.state.targetType === 'card') {
        // Card target but no card ID — fall back to project or global
        this.state.targetType = this.state.selectedProjectId ? 'project' : 'global';
      }

      if (data.voiceId) {
        this.voiceId = data.voiceId;
        this.voiceName = data.voiceName || null;
      }

      if (data.responseMode && ['text', 'voice', 'both'].includes(data.responseMode)) {
        this.responseMode = data.responseMode as ResponseMode;
      }
      if (data.voiceTone) {
        this.voiceTone = data.voiceTone;
      }
      if (typeof data.voiceEchoEnabled === 'boolean') {
        this.voiceEchoEnabled = data.voiceEchoEnabled;
      }
      if (data.selectedProvider) {
        this.selectedProvider = data.selectedProvider;
      }
      if (data.selectedModel) {
        this.selectedModel = data.selectedModel;
      }
      if (data.chatId) {
        this.chatId = data.chatId;
      }
      if (data.providerOverrides && typeof data.providerOverrides === 'object') {
        this.providerOverrides = data.providerOverrides;
      }
      if (data.targetPrefs && typeof data.targetPrefs === 'object') {
        this.targetPrefs = data.targetPrefs;
      }
      if (data.defaultVoices && typeof data.defaultVoices === 'object') {
        for (const [provider, v] of Object.entries(data.defaultVoices as Record<string, StoredVoice>)) {
          if (isTtsProviderId(provider) && provider !== 'elevenlabs' && v && typeof v.id === 'string') {
            this.defaultVoices[provider] = v;
          }
        }
      }
      if (isTtsProviderId(data.ttsProvider)) {
        this.ttsProvider = data.ttsProvider;
      }
      if (typeof data.ttsProviderRevision === 'number' && Number.isFinite(data.ttsProviderRevision)) {
        this.ttsProviderRevision = data.ttsProviderRevision;
      }
      if (data.customVoices && typeof data.customVoices === 'object') {
        for (const [id, r] of Object.entries(data.customVoices as Record<string, VoiceRecipe>)) {
          if (r && r.provider === 'gemini' && typeof r.name === 'string' && typeof r.description === 'string') {
            this.customVoices[id] = r;
          }
        }
      }
    } catch {
      // No persisted state, that's fine
    }
    // Anchor any registry project that doesn't yet have an entry. This locks
    // each project's effective voice/mode/tone to the current top-level value
    // (the "global" pre-upgrade, or the most-recently-set value when a new
    // project later joins the registry). Without this, target=project writes
    // that mirror to top-level would silently change every other project that
    // hadn't been touched yet.
    this.anchorProjectsFromRegistry();
  }

  private saveState(): void {
    try {
      this.writeStateFile();
    } catch (err) {
      console.warn('Could not save state:', (err as Error).message);
    }
  }

  /**
   * Persist and THROW on failure. Used by callers whose HTTP/CLI contract
   * must not report success for an in-memory change that would vanish on
   * restart (project voice setter, feature 086). Existing callers keep the
   * log-only saveState().
   */
  private saveStateStrict(): void {
    this.writeStateFile();
  }

  private writeStateFile(): void {
    {
      atomicWriteFileSync(getStateFile(), JSON.stringify({
        targetType: this.state.targetType,
        selectedProjectId: this.state.selectedProjectId,
        selectedCardId: this.state.selectedCardId,
        selectedCardStage: this.state.selectedCardStage,
        voiceId: this.voiceId,
        voiceName: this.voiceName,
        responseMode: this.responseMode,
        voiceTone: this.voiceTone,
        voiceEchoEnabled: this.voiceEchoEnabled,
        selectedProvider: this.selectedProvider,
        selectedModel: this.selectedModel,
        providerOverrides: this.providerOverrides,
        targetPrefs: this.targetPrefs,
        chatId: this.chatId,
        defaultVoices: this.defaultVoices,
        ttsProvider: this.ttsProvider,
        ttsProviderRevision: this.ttsProviderRevision,
        customVoices: this.customVoices,
      }, null, 2));
    }
  }

  // --- Project Access ---

  getProjects(): Project[] {
    this.reloadProjects();
    return this.state.projects;
  }

  getSelectedProject(): Project | null {
    if (!this.state.selectedProjectId) return null;
    return this.state.projects.find(p => p.id === this.state.selectedProjectId) || null;
  }

  reloadProjects(): void {
    const selectedId = this.state.selectedProjectId;
    this.loadProjects();
    if (selectedId) {
      const exists = this.state.projects.some(p => p.id === selectedId);
      if (!exists) {
        this.state.selectedProjectId = null;
        this.state.selectedCardId = null;
        this.state.targetType = 'global';
        this.saveState();
      }
    }
    // Anchor any newly-registered project so it gets the current most-recent
    // values rather than dynamically tracking top-level forever.
    this.anchorProjectsFromRegistry();
  }

  /**
   * For every project in the registry, ensure targetPrefs has explicit values
   * for any field that's currently missing. Anchors with the current top-level
   * (most-recently-set) value at the moment of anchoring. After this runs, a
   * write to one project's voice/mode/tone no longer leaks to other projects
   * via the top-level mirror.
   */
  private anchorProjectsFromRegistry(): void {
    let mutated = false;
    for (const project of this.state.projects) {
      const entry = this.targetPrefs[project.id] ?? {};
      let changed = false;
      if (entry.voice === undefined && this.voiceId) {
        entry.voice = { id: this.voiceId, name: this.voiceName || this.voiceId };
        changed = true;
      }
      // Same anchoring for every other provider's slot (feature 087).
      for (const [provider, def] of Object.entries(this.defaultVoices) as Array<[MappedProvider, StoredVoice | undefined]>) {
        if (def && entry.voices?.[provider] === undefined) {
          entry.voices = { ...entry.voices, [provider]: { ...def } };
          changed = true;
        }
      }
      if (entry.responseMode === undefined) {
        entry.responseMode = this.responseMode;
        changed = true;
      }
      if (entry.voiceTone === undefined && this.voiceTone !== null) {
        entry.voiceTone = this.voiceTone;
        changed = true;
      }
      if (changed) {
        this.targetPrefs[project.id] = entry;
        mutated = true;
      }
    }
    if (mutated) this.saveState();
  }

  // --- Target Navigation ---

  selectGlobal(): void {
    this.state.targetType = 'global';
    this.state.selectedProjectId = null;
    this.state.selectedCardId = null;
    this.state.selectedCardStage = null;
    this.saveState();
  }

  selectProject(projectId: string): Project | null {
    const project = this.state.projects.find(p => p.id === projectId);
    if (!project) return null;
    this.state.targetType = 'project';
    this.state.selectedProjectId = projectId;
    this.state.selectedCardId = null;
    this.state.selectedCardStage = null;
    this.saveState();
    return project;
  }

  selectCard(projectId: string, cardId: string, stage?: string): Project | null {
    const project = this.state.projects.find(p => p.id === projectId);
    if (!project) return null;
    this.state.targetType = 'card';
    this.state.selectedProjectId = projectId;
    this.state.selectedCardId = cardId;
    this.state.selectedCardStage = stage || null;
    this.saveState();
    return project;
  }

  getTarget(): NavigationTarget {
    switch (this.state.targetType) {
      case 'global':
        return { type: 'global' };
      case 'project':
        return { type: 'project', projectId: this.state.selectedProjectId || undefined };
      case 'card':
        return {
          type: 'card',
          projectId: this.state.selectedProjectId || undefined,
          cardId: this.state.selectedCardId || undefined,
          stage: this.state.selectedCardStage || undefined,
        };
    }
  }

  /**
   * Resolve the canonical sessionKey for the currently-selected project.
   * Reloads the project registry first so a path edit / sessionKey recompute
   * elsewhere is reflected immediately. Falls back to raw projectId when no
   * matching project (preserves old behavior for unmigrated state).
   */
  private currentProjectKey(): string | null {
    const id = this.state.selectedProjectId;
    if (!id) return null;
    this.reloadProjects();
    const proj = this.state.projects.find(p => p.id === id);
    if (!proj) return id;
    return proj.sessionKey ?? computeSessionKey(proj.path) ?? id;
  }

  getSessionName(): string {
    const target = this.getTarget();
    const provider = this.selectedProvider;
    // Use canonical sessionKey for new session names so messaging stays in
    // lockstep with web/CLI. Existing alias-form sessions are reached via
    // alias-aware lookups in BridgeClient/index.ts before falling through
    // to creating under this canonical name.
    const projectKey = this.currentProjectKey() ?? target.projectId;
    switch (target.type) {
      case 'global':
        return `global:${provider}:global`;
      case 'project':
        return `${projectKey}:${provider}:global`;
      case 'card':
        return `${projectKey}:${provider}:card:${target.cardId}`;
    }
  }

  /**
   * Alias session names to try alongside getSessionName(). Returns names built
   * from the project's legacy id form (sessionKeyAliases) so messaging can
   * find pre-migration sessions before falling back to creating new ones
   * under the canonical sessionKey.
   */
  getSessionNameAliases(): string[] {
    const target = this.getTarget();
    if (target.type === 'global') return [];
    const id = this.state.selectedProjectId;
    if (!id) return [];
    // currentProjectKey() reloads projects; doing so here too would double-load.
    const canonical = this.currentProjectKey() ?? id;
    const proj = this.state.projects.find(p => p.id === id);
    if (!proj) return [];
    const rawAliases = proj.sessionKeyAliases ?? (proj.id !== canonical ? [proj.id] : []);
    const provider = this.selectedProvider;
    // Dedupe — historical path edits can stack identical entries into
    // sessionKeyAliases; without dedup each duplicate causes a redundant GET
    // in resolveExistingSession.
    const dedupedAliases = Array.from(new Set(rawAliases.filter(k => k && k !== canonical)));
    return dedupedAliases.map(k =>
      target.type === 'project'
        ? `${k}:${provider}:global`
        : `${k}:${provider}:card:${target.cardId}`,
    );
  }

  /** Get session name in old format (without provider segment) for backward compat lookups. */
  getLegacySessionName(): string {
    const target = this.getTarget();
    const projectKey = this.currentProjectKey() ?? target.projectId;
    switch (target.type) {
      case 'global':
        return 'global:global';
      case 'project':
        return `${projectKey}:global`;
      case 'card':
        return `${projectKey}:card:${target.cardId}`;
    }
  }

  getSessionCwd(): string {
    const target = this.getTarget();
    if (target.type === 'global') {
      return getWorkspaceRoot();
    }
    const project = this.getSelectedProject();
    return project?.path || process.cwd();
  }

  getSelectedCardId(): string | null {
    return this.state.selectedCardId;
  }

  // --- Per-project pref resolution -------------------------------------
  //
  // For target=project|card, writes land in targetPrefs[projectId] and are
  // also mirrored to the top-level field as the "most-recently-set" value.
  // Reads on target=project|card return the per-project override if present,
  // otherwise fall back to the top-level (which gives a brand-new project
  // the most-recently-set value automatically).
  //
  // For target=global, writes only update the top-level; reads only consult
  // the top-level. Clears never mirror — clearing a project's override
  // removes the override, but the top-level "most-recent" remains.

  /** Returns the project id for the active target, or null when at global. */
  private getCurrentProjectId(): string | null {
    const target = this.getTarget();
    if (target.type === 'global') return null;
    return target.projectId ?? null;
  }

  private prefsFor(projectId: string): { voice?: { id: string; name: string }; voices?: Partial<Record<MappedProvider, StoredVoice>>; responseMode?: ResponseMode; voiceTone?: string } | undefined {
    return this.targetPrefs[projectId];
  }

  private writePref<K extends 'voice' | 'responseMode' | 'voiceTone'>(
    projectId: string,
    key: K,
    value: NonNullable<{ voice: { id: string; name: string }; responseMode: ResponseMode; voiceTone: string }[K]>,
  ): void {
    const existing = this.targetPrefs[projectId] ?? {};
    (existing as Record<string, unknown>)[key] = value;
    this.targetPrefs[projectId] = existing;
  }

  private clearPref(projectId: string, key: 'voice' | 'responseMode' | 'voiceTone'): void {
    const existing = this.targetPrefs[projectId];
    if (!existing) return;
    delete (existing as Record<string, unknown>)[key];
    if (Object.keys(existing).length === 0) delete this.targetPrefs[projectId];
  }

  // --- Voice slots (per provider, feature 087) ----------------------------

  private slotFor(projectId: string, provider: TtsProviderId): StoredVoice | undefined {
    const entry = this.prefsFor(projectId);
    if (!entry) return undefined;
    return provider === 'elevenlabs' ? entry.voice : entry.voices?.[provider];
  }

  private writeSlot(projectId: string, provider: TtsProviderId, voice: StoredVoice): void {
    if (provider === 'elevenlabs') {
      // The legacy field stays exactly {id, name}.
      this.writePref(projectId, 'voice', { id: voice.id, name: voice.name || voice.id });
      return;
    }
    const entry = this.targetPrefs[projectId] ?? {};
    entry.voices = { ...entry.voices, [provider]: { ...voice, name: voice.name || voice.id } };
    this.targetPrefs[projectId] = entry;
  }

  private clearSlot(projectId: string, provider: TtsProviderId): void {
    if (provider === 'elevenlabs') {
      this.clearPref(projectId, 'voice');
      return;
    }
    const entry = this.targetPrefs[projectId];
    if (!entry?.voices) return;
    delete entry.voices[provider];
    if (Object.keys(entry.voices).length === 0) delete entry.voices;
    if (Object.keys(entry).length === 0) delete this.targetPrefs[projectId];
  }

  /** Install-level default voice for a provider (the inheritance source). */
  private defaultFor(provider: TtsProviderId): StoredVoice | null {
    if (provider === 'elevenlabs') {
      return this.voiceId ? { id: this.voiceId, name: this.voiceName || this.voiceId } : null;
    }
    const v = this.defaultVoices[provider];
    return v ? { ...v, name: v.name || v.id } : null;
  }

  private setDefault(provider: TtsProviderId, voice: StoredVoice | null): void {
    if (provider === 'elevenlabs') {
      this.voiceId = voice?.id ?? null;
      this.voiceName = voice ? voice.name : null;
      return;
    }
    if (voice) this.defaultVoices[provider] = { ...voice };
    else delete this.defaultVoices[provider];
  }

  private static copy(v: StoredVoice): StoredVoice {
    return { ...v, name: v.name || v.id };
  }

  /** Install-wide provider switch as stored (null = follow TTS_PROVIDER / auto) and its revision. */
  getTtsProviderChoice(): { provider: TtsProviderId | null; revision: number } {
    return { provider: this.ttsProvider, revision: this.ttsProviderRevision };
  }

  /**
   * Switch the install's TTS provider (explicit choice; beats TTS_PROVIDER).
   * Persists strictly and increments the revision, so any picker list made
   * before the switch is recognisably stale. Returns the new revision.
   */
  setTtsProvider(provider: TtsProviderId): number {
    const previous = { provider: this.ttsProvider, revision: this.ttsProviderRevision };
    this.ttsProvider = provider;
    this.ttsProviderRevision += 1;
    try {
      this.saveStateStrict();
    } catch (err) {
      this.ttsProvider = previous.provider;
      this.ttsProviderRevision = previous.revision;
      throw err;
    }
    return this.ttsProviderRevision;
  }

  // --- Designed-voice recipes (feature 087 phase 4) ---

  getVoiceRecipe(id: string): VoiceRecipe | null {
    const r = this.customVoices[id];
    return r ? { ...r } : null;
  }

  listVoiceRecipes(): Array<{ id: string; recipe: VoiceRecipe }> {
    return Object.entries(this.customVoices).map(([id, recipe]) => ({ id, recipe: { ...recipe } }));
  }

  /**
   * Save (or patch) a recipe and persist STRICTLY: `voice design` must not
   * report success for a recipe that would vanish on restart. On a failed
   * write the in-memory map is rolled back and the error rethrown.
   */
  saveVoiceRecipe(id: string, recipe: VoiceRecipe): void {
    this.withRollback(() => { this.customVoices[id] = { ...recipe }; });
  }

  updateVoiceRecipe(id: string, patch: Partial<VoiceRecipe>): void {
    const current = this.customVoices[id];
    if (!current) return;
    this.withRollback(() => { this.customVoices[id] = { ...current, ...patch }; });
  }

  private withRollback(change: () => void): void {
    const before = { ...this.customVoices };
    change();
    try {
      this.saveStateStrict();
    } catch (err) {
      this.customVoices = before;
      throw err;
    }
  }

  /** Install-level default voice for a provider, or null. */
  getDefaultVoice(provider: TtsProviderId): StoredVoice | null {
    return this.defaultFor(provider);
  }

  // --- Voice ---

  getVoice(provider: TtsProviderId = 'elevenlabs'): StoredVoice | null {
    const projectId = this.getCurrentProjectId();
    if (projectId) {
      const v = this.slotFor(projectId, provider);
      if (v) return StateManager.copy(v);
    }
    return this.defaultFor(provider);
  }

  /**
   * Resolve the project id encoded in a session name's first segment
   * (e.g. "claude-master:claude:card:card-123" → "claude-master"). Returns
   * null for the global session or when no project matches. Accepts session
   * keys, aliases, or canonical ids via resolveCanonicalProjectId.
   */
  private projectIdFromSession(session: string | undefined): string | null {
    if (!session) return null;
    const firstSegment = session.split(':')[0];
    if (!firstSegment || firstSegment === 'global') return null;
    return resolveCanonicalProjectId(firstSegment, this.state.projects)?.id ?? null;
  }

  /**
   * Voice resolved for a specific session/caller, independent of which target
   * the Telegram UI is currently pointed at. This is what TTS render paths
   * should use: a claude-master automation must render in claude-master's
   * voice even if the user last navigated to a different project. Falls back
   * to the ambient getVoice() when the session has no resolvable project.
   */
  getVoiceForSession(session: string | undefined, provider: TtsProviderId = 'elevenlabs'): StoredVoice | null {
    return this.resolveSessionSlot(session, provider).voice;
  }

  /** Like getVoiceForSession, but reports where the voice came from (project slot vs install default). */
  resolveSessionSlot(session: string | undefined, provider: TtsProviderId = 'elevenlabs'): { voice: StoredVoice | null; source: 'project' | 'inherited' | null } {
    const projectId = this.projectIdFromSession(session);
    if (projectId) return this.projectSlot(projectId, provider);
    const ambientProject = this.getCurrentProjectId();
    if (ambientProject) {
      const v = this.slotFor(ambientProject, provider);
      if (v) return { voice: StateManager.copy(v), source: 'project' };
    }
    const def = this.defaultFor(provider);
    return { voice: def, source: def ? 'inherited' : null };
  }

  /**
   * Resolve a project's default voice for a programmatic caller (e.g. the
   * /tts/generate endpoint). Prefers an explicit projectId, then the caller's
   * session. Unlike getVoiceForSession, this does NOT fall back to the ambient
   * Telegram target — when no project context resolves it returns null so the
   * caller falls through to the env default. Both projectId and session may
   * be a canonical id, sessionKey, or alias.
   */
  resolveContextVoice(opts: { projectId?: string; session?: string }, provider: TtsProviderId = 'elevenlabs'): StoredVoice | null {
    return this.resolveContextSlot(opts, provider).voice;
  }

  /** Like resolveContextVoice, but reports where the voice came from. */
  resolveContextSlot(opts: { projectId?: string; session?: string }, provider: TtsProviderId = 'elevenlabs'): { voice: StoredVoice | null; source: 'project' | 'inherited' | null } {
    // Reload the registry so a project added/edited after service start
    // (or a registry that was empty at boot) resolves correctly.
    this.reloadProjects();
    let pid: string | null = null;
    if (opts.projectId) {
      pid = resolveCanonicalProjectId(opts.projectId, this.state.projects)?.id ?? null;
    }
    if (!pid && opts.session) {
      pid = this.projectIdFromSession(opts.session);
    }
    if (!pid) return { voice: null, source: null };
    return this.projectSlot(pid, provider);
  }

  private projectSlot(projectId: string, provider: TtsProviderId): { voice: StoredVoice | null; source: 'project' | 'inherited' | null } {
    const v = this.slotFor(projectId, provider);
    if (v) return { voice: StateManager.copy(v), source: 'project' };
    const def = this.defaultFor(provider);
    return { voice: def, source: def ? 'inherited' : null };
  }

  /**
   * Resolve a project id from an explicit id/name/key or from a session name
   * (first segment). Reloads the registry first so projects added after
   * service start resolve. Returns null when nothing matches.
   */
  resolveProjectIdFrom(opts: { projectId?: string; session?: string }): string | null {
    this.reloadProjects();
    if (opts.projectId) {
      return resolveCanonicalProjectId(opts.projectId, this.state.projects)?.id ?? null;
    }
    if (opts.session) return this.projectIdFromSession(opts.session);
    return null;
  }

  // --- Project-explicit voice (feature 086) ---------------------------------
  //
  // Unlike setVoice/clearVoice these take an explicit project id, NEVER touch
  // the top-level mirror (which is the workspace default and the inheritance
  // source for projects without an entry), and persist strictly so a failed
  // write surfaces to the HTTP/CLI caller. All are per provider (feature 087);
  // the default provider is ElevenLabs for pre-087 callers.

  /** Stored = the project's own override; effective = stored → install default (env/built-in is the caller's fallback). */
  getProjectVoice(projectId: string, provider: TtsProviderId = 'elevenlabs'): { stored: StoredVoice | null; effective: StoredVoice | null; source: 'project' | 'inherited' | null } {
    const v = this.slotFor(projectId, provider);
    const stored = v ? StateManager.copy(v) : null;
    if (stored) return { stored, effective: stored, source: 'project' };
    const def = this.defaultFor(provider);
    if (def) return { stored: null, effective: def, source: 'inherited' };
    return { stored: null, effective: null, source: null };
  }

  /** The project's slot for every provider (the switch rewrites none of them). */
  getProjectVoiceSlots(projectId: string): Record<TtsProviderId, { stored: StoredVoice | null; effective: StoredVoice | null; source: 'project' | 'inherited' | null }> {
    return {
      elevenlabs: this.getProjectVoice(projectId, 'elevenlabs'),
      gemini: this.getProjectVoice(projectId, 'gemini'),
    };
  }

  /** Writes the slot of the VOICE's provider (default ElevenLabs). */
  setProjectVoice(projectId: string, voice: StoredVoice & { provider?: TtsProviderId }): void {
    const { provider = 'elevenlabs', ...stored } = voice;
    this.withProjectRollback(projectId, () => this.writeSlot(projectId, provider, stored));
  }

  /**
   * Clear the project's override for one provider. This resets the project to
   * the CURRENT inherited default: anchorProjectsFromRegistry() re-anchors the
   * install default into the entry on the next reload, so "clear" never means
   * "permanently follow the workspace default" nor "force the env voice".
   */
  clearProjectVoice(projectId: string, provider: TtsProviderId = 'elevenlabs'): void {
    this.withProjectRollback(projectId, () => this.clearSlot(projectId, provider));
  }

  /**
   * Apply a change to one project's prefs and persist STRICTLY; when the write
   * fails, put the project's prefs back exactly as they were and rethrow, so
   * memory never claims a voice the file does not have (fix loop, #0369).
   */
  private withProjectRollback(projectId: string, change: () => void): void {
    const had = Object.prototype.hasOwnProperty.call(this.targetPrefs, projectId);
    const before = had ? structuredClone(this.targetPrefs[projectId]) : undefined;
    change();
    try {
      this.saveStateStrict();
    } catch (err) {
      if (had) this.targetPrefs[projectId] = before!;
      else delete this.targetPrefs[projectId];
      throw err;
    }
  }

  /**
   * Set the install default for one provider (web picker, #0376): the voice
   * every project without its own inherits. Strict save with rollback, like
   * setProjectVoice; it touches no project's own slot.
   */
  setInstallDefaultVoice(provider: TtsProviderId, voice: StoredVoice): void {
    const before = this.defaultFor(provider);
    const hadSlot = provider !== 'elevenlabs' && Object.prototype.hasOwnProperty.call(this.defaultVoices, provider);
    this.setDefault(provider, StateManager.copy(voice));
    try {
      this.saveStateStrict();
    } catch (err) {
      if (provider === 'elevenlabs' || hadSlot) this.setDefault(provider, before);
      else this.setDefault(provider, null);
      throw err;
    }
  }

  /** Telegram /voice selection: writes the target project's slot and MIRRORS into the install default. */
  setVoice(id: string, name: string, provider: TtsProviderId = 'elevenlabs', extra: Pick<StoredVoice, 'kind' | 'expiresAt'> = {}): void {
    const projectId = this.getCurrentProjectId();
    // Designed voices keep their kind/expiry so expiry warnings work (phase 4).
    const voice: StoredVoice = { id, name, ...(extra.kind ? { kind: extra.kind } : {}), ...(extra.expiresAt ? { expiresAt: extra.expiresAt } : {}) };
    if (projectId) {
      this.writeSlot(projectId, provider, voice);
    }
    // Mirror to the install default as the most-recently-set value (applies at
    // global target too, and serves as the inheritance source for new projects).
    this.setDefault(provider, voice);
    this.saveState();
  }

  /** Telegram /voice reset: never mirrors. Project/card target clears only that project's slot; global clears the install default. */
  clearVoice(provider: TtsProviderId = 'elevenlabs'): void {
    const projectId = this.getCurrentProjectId();
    if (projectId) {
      // Clear only the project's override; preserve the install default
      // so other projects without their own entry still inherit it.
      this.clearSlot(projectId, provider);
    } else {
      this.setDefault(provider, null);
    }
    this.saveState();
  }

  // --- Response Preferences ---

  getResponseMode(): ResponseMode {
    const projectId = this.getCurrentProjectId();
    if (projectId) {
      const m = this.prefsFor(projectId)?.responseMode;
      if (m) return m;
    }
    return this.responseMode;
  }

  setResponseMode(mode: ResponseMode): void {
    const projectId = this.getCurrentProjectId();
    if (projectId) {
      this.writePref(projectId, 'responseMode', mode);
    }
    this.responseMode = mode;
    this.saveState();
  }

  getVoiceEcho(): boolean {
    return this.voiceEchoEnabled;
  }

  setVoiceEcho(enabled: boolean): void {
    this.voiceEchoEnabled = enabled;
    this.saveState();
  }

  getVoiceTone(): string | null {
    const projectId = this.getCurrentProjectId();
    if (projectId) {
      const t = this.prefsFor(projectId)?.voiceTone;
      if (t !== undefined) return t;
    }
    return this.voiceTone;
  }

  setVoiceTone(tone: string | null): void {
    const projectId = this.getCurrentProjectId();
    if (tone === null) {
      // Clear semantics: at project target, remove only the project's
      // override (top-level "most-recent" stays). At global target, clear
      // the top-level.
      if (projectId) {
        this.clearPref(projectId, 'voiceTone');
      } else {
        this.voiceTone = null;
      }
    } else {
      if (projectId) {
        this.writePref(projectId, 'voiceTone', tone);
      }
      this.voiceTone = tone;
    }
    this.saveState();
  }

  // --- Provider ---

  getSelectedProvider(): string {
    return this.selectedProvider;
  }

  setSelectedProvider(provider: string): void {
    this.selectedProvider = provider;
    this.selectedModel = '';  // Reset model when switching provider
    this.saveState();
  }

  getSelectedModel(): string {
    return this.selectedModel;
  }

  setSelectedModel(model: string): void {
    this.selectedModel = model;
    this.saveState();
  }

  // --- Per-Target Provider Overrides (sticky across navigations) ---

  private getOverrideKey(): string | null {
    const target = this.getTarget();
    switch (target.type) {
      case 'card': return target.projectId && target.cardId ? `card:${target.projectId}:${target.cardId}` : null;
      case 'project': return target.projectId ? `project:${target.projectId}` : null;
      case 'global': return 'global';
    }
  }

  getProviderOverride(): string | null {
    const key = this.getOverrideKey();
    return key ? this.providerOverrides[key] || null : null;
  }

  setProviderOverride(provider: string): void {
    const key = this.getOverrideKey();
    if (!key) return;
    this.providerOverrides[key] = provider;
    this.saveState();
  }

  clearProviderOverride(): void {
    const key = this.getOverrideKey();
    if (!key) return;
    delete this.providerOverrides[key];
    this.saveState();
  }

  // --- Chat ID (persisted across restarts) ---

  getChatId(): number | null {
    return this.chatId;
  }

  setChatId(chatId: number): void {
    this.chatId = chatId;
    this.saveState();
  }

  // --- Pending Instruction File Confirm (ephemeral, not persisted) ---

  getPendingInstructionFileConfirm(): PendingInstructionFileConfirm | null {
    return this._pendingInstructionFileConfirm;
  }

  setPendingInstructionFileConfirm(pending: PendingInstructionFileConfirm): void {
    this._pendingInstructionFileConfirm = pending;
  }

  clearPendingInstructionFileConfirm(): void {
    this._pendingInstructionFileConfirm = null;
  }
}
