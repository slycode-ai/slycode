import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { computeSessionKey, resolveCanonicalProjectId } from './session-keys.js';
import { atomicWriteFileSync } from './atomic-write.js';
import { isTtsProviderId } from './tts/provider.js';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
function getWorkspaceRoot() {
    if (process.env.SLYCODE_HOME)
        return process.env.SLYCODE_HOME;
    return path.resolve(__dirname, '..', '..');
}
function getStateFile() {
    return path.join(getWorkspaceRoot(), 'messaging-state.json');
}
function getRegistryFile() {
    return path.join(getWorkspaceRoot(), 'projects', 'registry.json');
}
export class StateManager {
    state;
    voiceId = null;
    voiceName = null;
    responseMode = 'text';
    voiceTone = null;
    // Global toggle for echoing voice-note transcripts back as threaded replies.
    voiceEchoEnabled = true;
    selectedProvider = 'claude';
    selectedModel = ''; // '' = Default (no flag)
    providerOverrides = {}; // per-target provider overrides (sticky)
    // Per-project voice/mode/tone overrides. Keyed by project.id. The top-level
    // voiceId/responseMode/voiceTone fields above act as the inheritance source
    // ("most-recently-set value") for any project that has no entry here.
    //
    // Voices are stored PER PROVIDER (feature 087). The ElevenLabs slot keeps
    // living in the pre-087 fields — top-level voiceId/voiceName and
    // targetPrefs[p].voice — so an older SlyCode build (rollback) reads exactly
    // what it always did and there is never a second copy to drift. Other
    // providers live in `defaultVoices[provider]` and `targetPrefs[p].voices`.
    targetPrefs = {};
    /** Install-level default voice for non-ElevenLabs providers (ElevenLabs: voiceId/voiceName). */
    defaultVoices = {};
    /** Explicit install-wide TTS provider switch (null = follow TTS_PROVIDER / auto). */
    ttsProvider = null;
    /** Increments on every successful provider switch; pickers use it to reject stale picks. */
    ttsProviderRevision = 0;
    /** Designed-voice recipes by voice id (feature 087 phase 4), kept after delete so a voice can be recreated. */
    customVoices = {};
    _pendingInstructionFileConfirm = null;
    chatId = null;
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
    loadProjects() {
        try {
            const data = JSON.parse(fs.readFileSync(getRegistryFile(), 'utf-8'));
            this.state.projects = data.projects.map((p) => ({
                id: p.id,
                name: p.name,
                description: p.description,
                path: p.path || '',
                // Carry sessionKey/aliases forward if the registry has been migrated.
                // If absent, session-keys helpers derive on-the-fly from path.
                sessionKey: p.sessionKey,
                sessionKeyAliases: p.sessionKeyAliases,
            }));
        }
        catch (err) {
            console.warn('Could not load project registry:', err.message);
            this.state.projects = [];
        }
    }
    loadState() {
        try {
            const data = JSON.parse(fs.readFileSync(getStateFile(), 'utf-8'));
            // Restore target type
            if (data.targetType && ['global', 'project', 'card'].includes(data.targetType)) {
                this.state.targetType = data.targetType;
            }
            // Restore project selection
            if (data.selectedProjectId) {
                const exists = this.state.projects.some(p => p.id === data.selectedProjectId);
                if (exists) {
                    this.state.selectedProjectId = data.selectedProjectId;
                }
                else {
                    // Project removed — fall back to global
                    this.state.targetType = 'global';
                }
            }
            // Restore card selection (only valid if project is set)
            if (data.selectedCardId && this.state.selectedProjectId) {
                this.state.selectedCardId = data.selectedCardId;
                this.state.selectedCardStage = data.selectedCardStage || null;
            }
            else if (this.state.targetType === 'card') {
                // Card target but no card ID — fall back to project or global
                this.state.targetType = this.state.selectedProjectId ? 'project' : 'global';
            }
            if (data.voiceId) {
                this.voiceId = data.voiceId;
                this.voiceName = data.voiceName || null;
            }
            if (data.responseMode && ['text', 'voice', 'both'].includes(data.responseMode)) {
                this.responseMode = data.responseMode;
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
                for (const [provider, v] of Object.entries(data.defaultVoices)) {
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
                for (const [id, r] of Object.entries(data.customVoices)) {
                    if (r && r.provider === 'gemini' && typeof r.name === 'string' && typeof r.description === 'string') {
                        this.customVoices[id] = r;
                    }
                }
            }
        }
        catch {
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
    saveState() {
        try {
            this.writeStateFile();
        }
        catch (err) {
            console.warn('Could not save state:', err.message);
        }
    }
    /**
     * Persist and THROW on failure. Used by callers whose HTTP/CLI contract
     * must not report success for an in-memory change that would vanish on
     * restart (project voice setter, feature 086). Existing callers keep the
     * log-only saveState().
     */
    saveStateStrict() {
        this.writeStateFile();
    }
    writeStateFile() {
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
    getProjects() {
        this.reloadProjects();
        return this.state.projects;
    }
    getSelectedProject() {
        if (!this.state.selectedProjectId)
            return null;
        return this.state.projects.find(p => p.id === this.state.selectedProjectId) || null;
    }
    reloadProjects() {
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
    anchorProjectsFromRegistry() {
        let mutated = false;
        for (const project of this.state.projects) {
            const entry = this.targetPrefs[project.id] ?? {};
            let changed = false;
            if (entry.voice === undefined && this.voiceId) {
                entry.voice = { id: this.voiceId, name: this.voiceName || this.voiceId };
                changed = true;
            }
            // Same anchoring for every other provider's slot (feature 087).
            for (const [provider, def] of Object.entries(this.defaultVoices)) {
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
        if (mutated)
            this.saveState();
    }
    // --- Target Navigation ---
    selectGlobal() {
        this.state.targetType = 'global';
        this.state.selectedProjectId = null;
        this.state.selectedCardId = null;
        this.state.selectedCardStage = null;
        this.saveState();
    }
    selectProject(projectId) {
        const project = this.state.projects.find(p => p.id === projectId);
        if (!project)
            return null;
        this.state.targetType = 'project';
        this.state.selectedProjectId = projectId;
        this.state.selectedCardId = null;
        this.state.selectedCardStage = null;
        this.saveState();
        return project;
    }
    selectCard(projectId, cardId, stage) {
        const project = this.state.projects.find(p => p.id === projectId);
        if (!project)
            return null;
        this.state.targetType = 'card';
        this.state.selectedProjectId = projectId;
        this.state.selectedCardId = cardId;
        this.state.selectedCardStage = stage || null;
        this.saveState();
        return project;
    }
    getTarget() {
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
    currentProjectKey() {
        const id = this.state.selectedProjectId;
        if (!id)
            return null;
        this.reloadProjects();
        const proj = this.state.projects.find(p => p.id === id);
        if (!proj)
            return id;
        return proj.sessionKey ?? computeSessionKey(proj.path) ?? id;
    }
    getSessionName() {
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
    getSessionNameAliases() {
        const target = this.getTarget();
        if (target.type === 'global')
            return [];
        const id = this.state.selectedProjectId;
        if (!id)
            return [];
        // currentProjectKey() reloads projects; doing so here too would double-load.
        const canonical = this.currentProjectKey() ?? id;
        const proj = this.state.projects.find(p => p.id === id);
        if (!proj)
            return [];
        const rawAliases = proj.sessionKeyAliases ?? (proj.id !== canonical ? [proj.id] : []);
        const provider = this.selectedProvider;
        // Dedupe — historical path edits can stack identical entries into
        // sessionKeyAliases; without dedup each duplicate causes a redundant GET
        // in resolveExistingSession.
        const dedupedAliases = Array.from(new Set(rawAliases.filter(k => k && k !== canonical)));
        return dedupedAliases.map(k => target.type === 'project'
            ? `${k}:${provider}:global`
            : `${k}:${provider}:card:${target.cardId}`);
    }
    /** Get session name in old format (without provider segment) for backward compat lookups. */
    getLegacySessionName() {
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
    getSessionCwd() {
        const target = this.getTarget();
        if (target.type === 'global') {
            return getWorkspaceRoot();
        }
        const project = this.getSelectedProject();
        return project?.path || process.cwd();
    }
    getSelectedCardId() {
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
    getCurrentProjectId() {
        const target = this.getTarget();
        if (target.type === 'global')
            return null;
        return target.projectId ?? null;
    }
    prefsFor(projectId) {
        return this.targetPrefs[projectId];
    }
    writePref(projectId, key, value) {
        const existing = this.targetPrefs[projectId] ?? {};
        existing[key] = value;
        this.targetPrefs[projectId] = existing;
    }
    clearPref(projectId, key) {
        const existing = this.targetPrefs[projectId];
        if (!existing)
            return;
        delete existing[key];
        if (Object.keys(existing).length === 0)
            delete this.targetPrefs[projectId];
    }
    // --- Voice slots (per provider, feature 087) ----------------------------
    slotFor(projectId, provider) {
        const entry = this.prefsFor(projectId);
        if (!entry)
            return undefined;
        return provider === 'elevenlabs' ? entry.voice : entry.voices?.[provider];
    }
    writeSlot(projectId, provider, voice) {
        if (provider === 'elevenlabs') {
            // The legacy field stays exactly {id, name}.
            this.writePref(projectId, 'voice', { id: voice.id, name: voice.name || voice.id });
            return;
        }
        const entry = this.targetPrefs[projectId] ?? {};
        entry.voices = { ...entry.voices, [provider]: { ...voice, name: voice.name || voice.id } };
        this.targetPrefs[projectId] = entry;
    }
    clearSlot(projectId, provider) {
        if (provider === 'elevenlabs') {
            this.clearPref(projectId, 'voice');
            return;
        }
        const entry = this.targetPrefs[projectId];
        if (!entry?.voices)
            return;
        delete entry.voices[provider];
        if (Object.keys(entry.voices).length === 0)
            delete entry.voices;
        if (Object.keys(entry).length === 0)
            delete this.targetPrefs[projectId];
    }
    /** Install-level default voice for a provider (the inheritance source). */
    defaultFor(provider) {
        if (provider === 'elevenlabs') {
            return this.voiceId ? { id: this.voiceId, name: this.voiceName || this.voiceId } : null;
        }
        const v = this.defaultVoices[provider];
        return v ? { ...v, name: v.name || v.id } : null;
    }
    setDefault(provider, voice) {
        if (provider === 'elevenlabs') {
            this.voiceId = voice?.id ?? null;
            this.voiceName = voice ? voice.name : null;
            return;
        }
        if (voice)
            this.defaultVoices[provider] = { ...voice };
        else
            delete this.defaultVoices[provider];
    }
    static copy(v) {
        return { ...v, name: v.name || v.id };
    }
    /** Install-wide provider switch as stored (null = follow TTS_PROVIDER / auto) and its revision. */
    getTtsProviderChoice() {
        return { provider: this.ttsProvider, revision: this.ttsProviderRevision };
    }
    /**
     * Switch the install's TTS provider (explicit choice; beats TTS_PROVIDER).
     * Persists strictly and increments the revision, so any picker list made
     * before the switch is recognisably stale. Returns the new revision.
     */
    setTtsProvider(provider) {
        const previous = { provider: this.ttsProvider, revision: this.ttsProviderRevision };
        this.ttsProvider = provider;
        this.ttsProviderRevision += 1;
        try {
            this.saveStateStrict();
        }
        catch (err) {
            this.ttsProvider = previous.provider;
            this.ttsProviderRevision = previous.revision;
            throw err;
        }
        return this.ttsProviderRevision;
    }
    // --- Designed-voice recipes (feature 087 phase 4) ---
    getVoiceRecipe(id) {
        const r = this.customVoices[id];
        return r ? { ...r } : null;
    }
    listVoiceRecipes() {
        return Object.entries(this.customVoices).map(([id, recipe]) => ({ id, recipe: { ...recipe } }));
    }
    /**
     * Save (or patch) a recipe and persist STRICTLY: `voice design` must not
     * report success for a recipe that would vanish on restart. On a failed
     * write the in-memory map is rolled back and the error rethrown.
     */
    saveVoiceRecipe(id, recipe) {
        this.withRollback(() => { this.customVoices[id] = { ...recipe }; });
    }
    updateVoiceRecipe(id, patch) {
        const current = this.customVoices[id];
        if (!current)
            return;
        this.withRollback(() => { this.customVoices[id] = { ...current, ...patch }; });
    }
    withRollback(change) {
        const before = { ...this.customVoices };
        change();
        try {
            this.saveStateStrict();
        }
        catch (err) {
            this.customVoices = before;
            throw err;
        }
    }
    /** Install-level default voice for a provider, or null. */
    getDefaultVoice(provider) {
        return this.defaultFor(provider);
    }
    // --- Voice ---
    getVoice(provider = 'elevenlabs') {
        const projectId = this.getCurrentProjectId();
        if (projectId) {
            const v = this.slotFor(projectId, provider);
            if (v)
                return StateManager.copy(v);
        }
        return this.defaultFor(provider);
    }
    /**
     * Resolve the project id encoded in a session name's first segment
     * (e.g. "claude-master:claude:card:card-123" → "claude-master"). Returns
     * null for the global session or when no project matches. Accepts session
     * keys, aliases, or canonical ids via resolveCanonicalProjectId.
     */
    projectIdFromSession(session) {
        if (!session)
            return null;
        const firstSegment = session.split(':')[0];
        if (!firstSegment || firstSegment === 'global')
            return null;
        return resolveCanonicalProjectId(firstSegment, this.state.projects)?.id ?? null;
    }
    /**
     * Voice resolved for a specific session/caller, independent of which target
     * the Telegram UI is currently pointed at. This is what TTS render paths
     * should use: a claude-master automation must render in claude-master's
     * voice even if the user last navigated to a different project. Falls back
     * to the ambient getVoice() when the session has no resolvable project.
     */
    getVoiceForSession(session, provider = 'elevenlabs') {
        return this.resolveSessionSlot(session, provider).voice;
    }
    /** Like getVoiceForSession, but reports where the voice came from (project slot vs install default). */
    resolveSessionSlot(session, provider = 'elevenlabs') {
        const projectId = this.projectIdFromSession(session);
        if (projectId)
            return this.projectSlot(projectId, provider);
        const ambientProject = this.getCurrentProjectId();
        if (ambientProject) {
            const v = this.slotFor(ambientProject, provider);
            if (v)
                return { voice: StateManager.copy(v), source: 'project' };
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
    resolveContextVoice(opts, provider = 'elevenlabs') {
        return this.resolveContextSlot(opts, provider).voice;
    }
    /** Like resolveContextVoice, but reports where the voice came from. */
    resolveContextSlot(opts, provider = 'elevenlabs') {
        // Reload the registry so a project added/edited after service start
        // (or a registry that was empty at boot) resolves correctly.
        this.reloadProjects();
        let pid = null;
        if (opts.projectId) {
            pid = resolveCanonicalProjectId(opts.projectId, this.state.projects)?.id ?? null;
        }
        if (!pid && opts.session) {
            pid = this.projectIdFromSession(opts.session);
        }
        if (!pid)
            return { voice: null, source: null };
        return this.projectSlot(pid, provider);
    }
    projectSlot(projectId, provider) {
        const v = this.slotFor(projectId, provider);
        if (v)
            return { voice: StateManager.copy(v), source: 'project' };
        const def = this.defaultFor(provider);
        return { voice: def, source: def ? 'inherited' : null };
    }
    /**
     * Resolve a project id from an explicit id/name/key or from a session name
     * (first segment). Reloads the registry first so projects added after
     * service start resolve. Returns null when nothing matches.
     */
    resolveProjectIdFrom(opts) {
        this.reloadProjects();
        if (opts.projectId) {
            return resolveCanonicalProjectId(opts.projectId, this.state.projects)?.id ?? null;
        }
        if (opts.session)
            return this.projectIdFromSession(opts.session);
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
    getProjectVoice(projectId, provider = 'elevenlabs') {
        const v = this.slotFor(projectId, provider);
        const stored = v ? StateManager.copy(v) : null;
        if (stored)
            return { stored, effective: stored, source: 'project' };
        const def = this.defaultFor(provider);
        if (def)
            return { stored: null, effective: def, source: 'inherited' };
        return { stored: null, effective: null, source: null };
    }
    /** The project's slot for every provider (the switch rewrites none of them). */
    getProjectVoiceSlots(projectId) {
        return {
            elevenlabs: this.getProjectVoice(projectId, 'elevenlabs'),
            gemini: this.getProjectVoice(projectId, 'gemini'),
        };
    }
    /** Writes the slot of the VOICE's provider (default ElevenLabs). */
    setProjectVoice(projectId, voice) {
        const { provider = 'elevenlabs', ...stored } = voice;
        this.withProjectRollback(projectId, () => this.writeSlot(projectId, provider, stored));
    }
    /**
     * Clear the project's override for one provider. This resets the project to
     * the CURRENT inherited default: anchorProjectsFromRegistry() re-anchors the
     * install default into the entry on the next reload, so "clear" never means
     * "permanently follow the workspace default" nor "force the env voice".
     */
    clearProjectVoice(projectId, provider = 'elevenlabs') {
        this.withProjectRollback(projectId, () => this.clearSlot(projectId, provider));
    }
    /**
     * Apply a change to one project's prefs and persist STRICTLY; when the write
     * fails, put the project's prefs back exactly as they were and rethrow, so
     * memory never claims a voice the file does not have (fix loop, #0369).
     */
    withProjectRollback(projectId, change) {
        const had = Object.prototype.hasOwnProperty.call(this.targetPrefs, projectId);
        const before = had ? structuredClone(this.targetPrefs[projectId]) : undefined;
        change();
        try {
            this.saveStateStrict();
        }
        catch (err) {
            if (had)
                this.targetPrefs[projectId] = before;
            else
                delete this.targetPrefs[projectId];
            throw err;
        }
    }
    /**
     * Set the install default for one provider (web picker, #0376): the voice
     * every project without its own inherits. Strict save with rollback, like
     * setProjectVoice; it touches no project's own slot.
     */
    setInstallDefaultVoice(provider, voice) {
        const before = this.defaultFor(provider);
        const hadSlot = provider !== 'elevenlabs' && Object.prototype.hasOwnProperty.call(this.defaultVoices, provider);
        this.setDefault(provider, StateManager.copy(voice));
        try {
            this.saveStateStrict();
        }
        catch (err) {
            if (provider === 'elevenlabs' || hadSlot)
                this.setDefault(provider, before);
            else
                this.setDefault(provider, null);
            throw err;
        }
    }
    /** Telegram /voice selection: writes the target project's slot and MIRRORS into the install default. */
    setVoice(id, name, provider = 'elevenlabs', extra = {}) {
        const projectId = this.getCurrentProjectId();
        // Designed voices keep their kind/expiry so expiry warnings work (phase 4).
        const voice = { id, name, ...(extra.kind ? { kind: extra.kind } : {}), ...(extra.expiresAt ? { expiresAt: extra.expiresAt } : {}) };
        if (projectId) {
            this.writeSlot(projectId, provider, voice);
        }
        // Mirror to the install default as the most-recently-set value (applies at
        // global target too, and serves as the inheritance source for new projects).
        this.setDefault(provider, voice);
        this.saveState();
    }
    /** Telegram /voice reset: never mirrors. Project/card target clears only that project's slot; global clears the install default. */
    clearVoice(provider = 'elevenlabs') {
        const projectId = this.getCurrentProjectId();
        if (projectId) {
            // Clear only the project's override; preserve the install default
            // so other projects without their own entry still inherit it.
            this.clearSlot(projectId, provider);
        }
        else {
            this.setDefault(provider, null);
        }
        this.saveState();
    }
    // --- Response Preferences ---
    getResponseMode() {
        const projectId = this.getCurrentProjectId();
        if (projectId) {
            const m = this.prefsFor(projectId)?.responseMode;
            if (m)
                return m;
        }
        return this.responseMode;
    }
    setResponseMode(mode) {
        const projectId = this.getCurrentProjectId();
        if (projectId) {
            this.writePref(projectId, 'responseMode', mode);
        }
        this.responseMode = mode;
        this.saveState();
    }
    getVoiceEcho() {
        return this.voiceEchoEnabled;
    }
    setVoiceEcho(enabled) {
        this.voiceEchoEnabled = enabled;
        this.saveState();
    }
    getVoiceTone() {
        const projectId = this.getCurrentProjectId();
        if (projectId) {
            const t = this.prefsFor(projectId)?.voiceTone;
            if (t !== undefined)
                return t;
        }
        return this.voiceTone;
    }
    setVoiceTone(tone) {
        const projectId = this.getCurrentProjectId();
        if (tone === null) {
            // Clear semantics: at project target, remove only the project's
            // override (top-level "most-recent" stays). At global target, clear
            // the top-level.
            if (projectId) {
                this.clearPref(projectId, 'voiceTone');
            }
            else {
                this.voiceTone = null;
            }
        }
        else {
            if (projectId) {
                this.writePref(projectId, 'voiceTone', tone);
            }
            this.voiceTone = tone;
        }
        this.saveState();
    }
    // --- Provider ---
    getSelectedProvider() {
        return this.selectedProvider;
    }
    setSelectedProvider(provider) {
        this.selectedProvider = provider;
        this.selectedModel = ''; // Reset model when switching provider
        this.saveState();
    }
    getSelectedModel() {
        return this.selectedModel;
    }
    setSelectedModel(model) {
        this.selectedModel = model;
        this.saveState();
    }
    // --- Per-Target Provider Overrides (sticky across navigations) ---
    getOverrideKey() {
        const target = this.getTarget();
        switch (target.type) {
            case 'card': return target.projectId && target.cardId ? `card:${target.projectId}:${target.cardId}` : null;
            case 'project': return target.projectId ? `project:${target.projectId}` : null;
            case 'global': return 'global';
        }
    }
    getProviderOverride() {
        const key = this.getOverrideKey();
        return key ? this.providerOverrides[key] || null : null;
    }
    setProviderOverride(provider) {
        const key = this.getOverrideKey();
        if (!key)
            return;
        this.providerOverrides[key] = provider;
        this.saveState();
    }
    clearProviderOverride() {
        const key = this.getOverrideKey();
        if (!key)
            return;
        delete this.providerOverrides[key];
        this.saveState();
    }
    // --- Chat ID (persisted across restarts) ---
    getChatId() {
        return this.chatId;
    }
    setChatId(chatId) {
        this.chatId = chatId;
        this.saveState();
    }
    // --- Pending Instruction File Confirm (ephemeral, not persisted) ---
    getPendingInstructionFileConfirm() {
        return this._pendingInstructionFileConfirm;
    }
    setPendingInstructionFileConfirm(pending) {
        this._pendingInstructionFileConfirm = pending;
    }
    clearPendingInstructionFileConfirm() {
        this._pendingInstructionFileConfirm = null;
    }
}
//# sourceMappingURL=state.js.map