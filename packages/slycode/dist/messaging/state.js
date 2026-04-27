import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { computeSessionKey } from './session-keys.js';
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
    selectedProvider = 'claude';
    selectedModel = ''; // '' = Default (no flag)
    providerOverrides = {}; // per-target provider overrides (sticky)
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
        }
        catch {
            // No persisted state, that's fine
        }
    }
    saveState() {
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
                chatId: this.chatId,
            }, null, 2));
        }
        catch (err) {
            console.warn('Could not save state:', err.message);
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
    // --- Voice ---
    getVoice() {
        if (!this.voiceId)
            return null;
        return { id: this.voiceId, name: this.voiceName || this.voiceId };
    }
    setVoice(id, name) {
        this.voiceId = id;
        this.voiceName = name;
        this.saveState();
    }
    clearVoice() {
        this.voiceId = null;
        this.voiceName = null;
        this.saveState();
    }
    // --- Response Preferences ---
    getResponseMode() {
        return this.responseMode;
    }
    setResponseMode(mode) {
        this.responseMode = mode;
        this.saveState();
    }
    getVoiceTone() {
        return this.voiceTone;
    }
    setVoiceTone(tone) {
        this.voiceTone = tone;
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