import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import type { AppState, NavigationTarget, PendingInstructionFileConfirm, Project, ResponseMode, TargetType } from './types.js';
import { computeSessionKey, resolveCanonicalProjectId } from './session-keys.js';

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

export class StateManager {
  private state: AppState;
  private voiceId: string | null = null;
  private voiceName: string | null = null;
  private responseMode: ResponseMode = 'text';
  private voiceTone: string | null = null;
  private selectedProvider: string = 'claude';
  private selectedModel: string = '';  // '' = Default (no flag)
  private providerOverrides: Record<string, string> = {};  // per-target provider overrides (sticky)
  // Per-project voice/mode/tone overrides. Keyed by project.id. The top-level
  // voiceId/responseMode/voiceTone fields above act as the inheritance source
  // ("most-recently-set value") for any project that has no entry here.
  private targetPrefs: Record<string, {
    voice?: { id: string; name: string };
    responseMode?: ResponseMode;
    voiceTone?: string;
  }> = {};
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
      fs.writeFileSync(getStateFile(), JSON.stringify({
        targetType: this.state.targetType,
        selectedProjectId: this.state.selectedProjectId,
        selectedCardId: this.state.selectedCardId,
        selectedCardStage: this.state.selectedCardStage,
        voiceId: this.voiceId,
        voiceName: this.voiceName,
        responseMode: this.responseMode,
        voiceTone: this.voiceTone,
        selectedProvider: this.selectedProvider,
        selectedModel: this.selectedModel,
        providerOverrides: this.providerOverrides,
        targetPrefs: this.targetPrefs,
        chatId: this.chatId,
      }, null, 2));
    } catch (err) {
      console.warn('Could not save state:', (err as Error).message);
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

  private prefsFor(projectId: string): { voice?: { id: string; name: string }; responseMode?: ResponseMode; voiceTone?: string } | undefined {
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

  // --- Voice ---

  getVoice(): { id: string; name: string } | null {
    const projectId = this.getCurrentProjectId();
    if (projectId) {
      const v = this.prefsFor(projectId)?.voice;
      if (v) return { id: v.id, name: v.name || v.id };
    }
    if (!this.voiceId) return null;
    return { id: this.voiceId, name: this.voiceName || this.voiceId };
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
  getVoiceForSession(session: string | undefined): { id: string; name: string } | null {
    const projectId = this.projectIdFromSession(session);
    if (projectId) {
      const v = this.prefsFor(projectId)?.voice;
      if (v) return { id: v.id, name: v.name || v.id };
      if (this.voiceId) return { id: this.voiceId, name: this.voiceName || this.voiceId };
      return null;
    }
    return this.getVoice();
  }

  /**
   * Resolve a project's default voice for a programmatic caller (e.g. the
   * /tts/generate endpoint). Prefers an explicit projectId, then the caller's
   * session. Unlike getVoiceForSession, this does NOT fall back to the ambient
   * Telegram target — when no project context resolves it returns null so the
   * caller falls through to the env default. Both projectId and session may
   * be a canonical id, sessionKey, or alias.
   */
  resolveContextVoice(opts: { projectId?: string; session?: string }): { id: string; name: string } | null {
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
    if (!pid) return null;
    const v = this.prefsFor(pid)?.voice;
    if (v) return { id: v.id, name: v.name || v.id };
    if (this.voiceId) return { id: this.voiceId, name: this.voiceName || this.voiceId };
    return null;
  }

  setVoice(id: string, name: string): void {
    const projectId = this.getCurrentProjectId();
    if (projectId) {
      this.writePref(projectId, 'voice', { id, name });
    }
    // Mirror to top-level as the most-recently-set value (applies at global
    // target too, and serves as the inheritance source for new projects).
    this.voiceId = id;
    this.voiceName = name;
    this.saveState();
  }

  clearVoice(): void {
    const projectId = this.getCurrentProjectId();
    if (projectId) {
      // Clear only the project's override; preserve top-level "most-recent"
      // so other projects without their own entry still inherit it.
      this.clearPref(projectId, 'voice');
    } else {
      this.voiceId = null;
      this.voiceName = null;
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
