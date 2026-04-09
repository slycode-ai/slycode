import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import express from 'express';
import { TelegramChannel } from './channels/telegram.js';
import { BridgeClient } from './bridge-client.js';
import { StateManager } from './state.js';
import { KanbanClient } from './kanban-client.js';
import { SlyActionFilter } from './sly-action-filter.js';
import { transcribeAudio, validateSttConfig } from './stt.js';
import { textToSpeech, convertToOgg } from './tts.js';
import { searchVoices } from './voices.js';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
// --- Shared Provider Labels ---
const PROVIDER_LABELS = {
    claude: 'Claude Code',
    gemini: 'Gemini CLI',
    codex: 'Codex CLI',
};
const ALL_PROVIDERS = Object.keys(PROVIDER_LABELS);
function getProviderDefault(stage) {
    try {
        const root = process.env.SLYCODE_HOME || path.resolve(__dirname, '..', '..');
        const data = JSON.parse(fs.readFileSync(path.join(root, 'data', 'providers.json'), 'utf-8'));
        const defaults = data.defaults;
        if (stage && defaults.stages[stage]?.provider) {
            return { provider: defaults.stages[stage].provider, model: defaults.stages[stage].model };
        }
        return { provider: defaults.global?.provider || 'claude', model: defaults.global?.model };
    }
    catch {
        return { provider: 'claude' };
    }
}
function getProvidersPath() {
    const root = process.env.SLYCODE_HOME || path.resolve(__dirname, '..', '..');
    return path.join(root, 'data', 'providers.json');
}
async function getProviderModels(providerId) {
    try {
        const data = JSON.parse(fs.readFileSync(getProvidersPath(), 'utf-8'));
        return data.providers[providerId]?.model?.available || [];
    }
    catch {
        return [];
    }
}
function updateGlobalProviderDefault(provider) {
    try {
        const root = process.env.SLYCODE_HOME || path.resolve(__dirname, '..', '..');
        const filePath = path.join(root, 'data', 'providers.json');
        const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        data.defaults.global.provider = provider;
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n');
    }
    catch {
        // Best-effort — don't break on failure
    }
}
/** Resolve provider for a card from bridge sessions. Returns provider string or null. */
async function resolveProviderFromBridge(bridge, projectId, cardId) {
    try {
        const sessions = await bridge.getProjectSessions(projectId);
        const cardPattern = new RegExp(`^${projectId}:([^:]+):card:${cardId}$`);
        const matches = [];
        for (const s of sessions) {
            if (cardPattern.test(s.name)) {
                matches.push(s);
            }
        }
        if (matches.length === 0)
            return null;
        // Pick the most recently active session
        matches.sort((a, b) => (b.lastActive || '').localeCompare(a.lastActive || ''));
        const match = matches[0].name.match(cardPattern);
        return match ? match[1] : null;
    }
    catch {
        return null;
    }
}
/** Resolve provider for a project-level target from bridge sessions. */
async function resolveProjectProviderFromBridge(bridge, projectId) {
    try {
        const sessions = await bridge.getProjectSessions(projectId);
        const projPattern = new RegExp(`^${projectId}:([^:]+):global$`);
        const matches = [];
        for (const s of sessions) {
            if (projPattern.test(s.name)) {
                matches.push(s);
            }
        }
        if (matches.length === 0)
            return null;
        matches.sort((a, b) => (b.lastActive || '').localeCompare(a.lastActive || ''));
        const match = matches[0].name.match(projPattern);
        return match ? match[1] : null;
    }
    catch {
        return null;
    }
}
/** Check if the current provider was derived from bridge (has a session) vs default. */
async function hasExplicitSession(bridge, state) {
    const target = state.getTarget();
    if (target.type === 'card' && target.projectId && target.cardId) {
        const resolved = await resolveProviderFromBridge(bridge, target.projectId, target.cardId);
        return resolved !== null;
    }
    if (target.type === 'project' && target.projectId) {
        const resolved = await resolveProjectProviderFromBridge(bridge, target.projectId);
        return resolved !== null;
    }
    return false;
}
// Capture port/bridge env vars set by sly-start.sh BEFORE dotenv loads .env
// (dotenv won't override existing vars, but we need to be explicit about service config)
const preloadEnv = {
    BRIDGE_URL: process.env.BRIDGE_URL,
    MESSAGING_SERVICE_PORT: process.env.MESSAGING_SERVICE_PORT,
};
// Load .env from repo root (for API keys/tokens only — ports come from env or defaults)
dotenv.config({ path: path.join(__dirname, '..', '..', '.env') });
// Restore pre-dotenv values: if sly-start.sh didn't set them, clear dotenv's injection
// so dev defaults (3005, bridge probing) take effect
if (!preloadEnv.BRIDGE_URL)
    delete process.env.BRIDGE_URL;
if (!preloadEnv.MESSAGING_SERVICE_PORT)
    delete process.env.MESSAGING_SERVICE_PORT;
// Detect bridge by probing known ports (dev=3004, prod=7592).
// sly-start.sh exports BRIDGE_URL for prod; in dev mode we fall back to probing.
async function detectBridgeUrl() {
    const explicitUrl = process.env.BRIDGE_URL;
    const devUrl = 'http://localhost:3004';
    const prodUrl = 'http://localhost:7592';
    // If sly-start.sh set BRIDGE_URL, trust it but verify with fallback
    const candidates = explicitUrl
        ? [explicitUrl, explicitUrl === prodUrl ? devUrl : prodUrl]
        : [devUrl, prodUrl];
    for (const url of candidates) {
        try {
            const res = await fetch(`${url}/health`, { signal: AbortSignal.timeout(1000) });
            if (res.ok) {
                if (url !== candidates[0]) {
                    console.log(`Bridge not found at ${candidates[0]}, using ${url}`);
                }
                return url;
            }
        }
        catch {
            // not reachable, try next
        }
    }
    // Nothing reachable — return first candidate, let BridgeClient surface the error later
    return candidates[0];
}
function loadConfig(bridgeUrl) {
    return {
        service: {
            servicePort: parseInt(process.env.PORT || process.env.MESSAGING_SERVICE_PORT || '3005', 10),
            bridgeUrl,
        },
        voice: {
            sttBackend: (['openai', 'local', 'aws-transcribe'].includes(process.env.STT_BACKEND || '') ? process.env.STT_BACKEND : 'openai'),
            openaiApiKey: process.env.OPENAI_API_KEY || '',
            whisperCliPath: process.env.WHISPER_CLI_PATH || '',
            whisperModelPath: process.env.WHISPER_MODEL_PATH || '',
            awsTranscribeRegion: process.env.AWS_TRANSCRIBE_REGION || '',
            awsTranscribeLanguage: process.env.AWS_TRANSCRIBE_LANGUAGE || 'en-AU',
            awsTranscribeS3Bucket: process.env.AWS_TRANSCRIBE_S3_BUCKET || '',
            elevenlabsApiKey: process.env.ELEVENLABS_API_KEY || '',
            elevenlabsVoiceId: process.env.ELEVENLABS_VOICE_ID || '',
            elevenlabsSpeed: parseFloat(process.env.ELEVENLABS_SPEED || '1.0'),
        },
    };
}
function createChannel(state) {
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    const userId = process.env.TELEGRAM_USER_ID;
    if (botToken && userId) {
        return new TelegramChannel({
            botToken,
            authorizedUserId: parseInt(userId, 10),
            chatId: state.getChatId() ?? undefined,
            onChatIdChanged: (chatId) => state.setChatId(chatId),
        });
    }
    return null;
}
async function logConfigStatus(channel, voiceConfig, bridgeUrl) {
    console.log('Messaging service starting...');
    console.log(`  Telegram: ${channel ? 'configured' : 'not configured — set TELEGRAM_BOT_TOKEN and TELEGRAM_USER_ID in .env'}`);
    if (voiceConfig.sttBackend === 'local') {
        const sttValid = !(await validateSttConfig({ backend: 'local', openaiApiKey: '', whisperCliPath: voiceConfig.whisperCliPath, whisperModelPath: voiceConfig.whisperModelPath, awsTranscribeRegion: '', awsTranscribeLanguage: '', awsTranscribeS3Bucket: '' }));
        console.log(`  STT (local whisper.cpp): ${sttValid ? 'configured' : 'not configured — check WHISPER_CLI_PATH and WHISPER_MODEL_PATH'}`);
    }
    else if (voiceConfig.sttBackend === 'aws-transcribe') {
        console.log(`  STT (AWS Transcribe): configured — region: ${voiceConfig.awsTranscribeRegion || 'default'}, language: ${voiceConfig.awsTranscribeLanguage}, bucket: ${voiceConfig.awsTranscribeS3Bucket}`);
    }
    else {
        console.log(`  STT (OpenAI): ${voiceConfig.openaiApiKey ? 'configured' : 'not configured — voice transcription unavailable'}`);
    }
    console.log(`  TTS (ElevenLabs): ${voiceConfig.elevenlabsApiKey ? 'configured' : 'not configured — voice replies unavailable'}`);
    console.log(`  Bridge URL: ${bridgeUrl}`);
}
// --- Breadcrumb Helpers ---
async function getBreadcrumb(target, state, kanban, bridge) {
    let crumb;
    switch (target.type) {
        case 'global':
            crumb = '📍 Global Terminal';
            break;
        case 'project': {
            const project = state.getSelectedProject();
            crumb = `📍 ${project?.name || target.projectId} · Project Terminal`;
            break;
        }
        case 'card': {
            const project = state.getSelectedProject();
            const cardInfo = target.cardId && target.projectId
                ? kanban.getCard(target.projectId, target.cardId)
                : null;
            const stage = cardInfo?.stage || target.stage || '?';
            const title = cardInfo?.card.title || target.cardId || '?';
            const truncTitle = title.length > 55 ? title.slice(0, 52) + '...' : title;
            crumb = `📍 ${project?.name || target.projectId} · ${stage} · ${truncTitle}`;
            break;
        }
    }
    // Append git branch info if available
    try {
        const cwd = state.getSessionCwd();
        const git = await bridge.getGitStatus(cwd);
        if (git?.branch) {
            const uncommittedSuffix = git.uncommitted > 0 ? ` (${git.uncommitted} uncommitted)` : '';
            crumb += `\nBranch: ${git.branch}${uncommittedSuffix}`;
        }
    }
    catch {
        // Silent — branch info is best-effort
    }
    return crumb;
}
function truncate(text, max) {
    return text.length > max ? text.slice(0, max - 3) + '...' : text;
}
function latestDate(...dates) {
    let best = '';
    for (const d of dates) {
        if (d && d > best)
            best = d;
    }
    return best;
}
// --- /switch Rendering ---
async function renderSwitchView(channel, state, bridge, kanban) {
    const target = state.getTarget();
    const breadcrumb = await getBreadcrumb(target, state, kanban, bridge);
    if (target.type === 'global') {
        // Global level: show projects list
        const projects = state.getProjects();
        const buttons = projects.map(p => [{
                label: p.name,
                callbackData: `sw_proj_${p.id}`,
            }]);
        await channel.sendInlineKeyboard(breadcrumb, buttons);
        return;
    }
    // Project or Card level: show navigation + lanes
    const projectId = target.projectId;
    const stages = kanban.getAllStages();
    const navRow = [
        { label: 'Global', callbackData: 'sw_global' },
        { label: 'Projects', callbackData: 'sw_projects' },
    ];
    if (target.type === 'card') {
        navRow.push({ label: 'Project', callbackData: `sw_proj_${projectId}` });
    }
    const laneButtons = [];
    for (const stage of stages) {
        const cards = kanban.getCardsByStage(projectId, stage);
        const label = cards.length > 0 ? `${stage} (${cards.length})` : stage;
        laneButtons.push([{ label, callbackData: `sw_lane_${stage}` }]);
    }
    // Add automations virtual lane
    const autoCards = kanban.getAutomationCards(projectId);
    if (autoCards.length > 0) {
        laneButtons.push([{ label: `⚙ automations (${autoCards.length})`, callbackData: 'sw_lane_automations' }]);
    }
    await channel.sendInlineKeyboard(breadcrumb, [navRow, ...laneButtons]);
}
async function renderLaneDrilldown(channel, state, bridge, kanban, stage, offset = 0) {
    const target = state.getTarget();
    const projectId = target.projectId;
    if (!projectId) {
        await channel.sendText('No project selected.');
        return;
    }
    const project = state.getSelectedProject();
    const breadcrumb = `📍 ${project?.name || projectId} · ${stage}`;
    const cards = stage === 'automations'
        ? kanban.getAutomationCards(projectId)
        : kanban.getCardsByStage(projectId, stage);
    const maxCards = 8;
    const page = cards.slice(offset, offset + maxCards);
    const buttons = [
        [{ label: '← Back', callbackData: 'sw_back' }],
    ];
    if (page.length === 0) {
        await channel.sendInlineKeyboard(`${breadcrumb}\n\nNo cards in this lane.`, buttons);
        return;
    }
    for (const card of page) {
        buttons.push([{
                label: truncate(card.title, 35),
                callbackData: `sw_card_${card.id}`,
            }]);
    }
    if (offset + maxCards < cards.length) {
        buttons.push([{ label: 'More...', callbackData: `sw_more_${offset + maxCards}` }]);
    }
    await channel.sendInlineKeyboard(breadcrumb, buttons);
}
// --- Session Lifecycle ---
async function handleSessionLifecycle(channel, state, bridge, kanban, actionFilter) {
    const target = ensureStage(state.getTarget(), kanban, state);
    const sessionName = state.getSessionName();
    const breadcrumb = await getBreadcrumb(target, state, kanban, bridge);
    // Build provider line with model
    const currentProvider = state.getSelectedProvider();
    const providerLabel = PROVIDER_LABELS[currentProvider] || currentProvider;
    const explicit = await hasExplicitSession(bridge, state);
    const currentModel = state.getSelectedModel();
    const modelLabel = currentModel
        ? (await getProviderModels(currentProvider)).find(m => m.id === currentModel)?.label || currentModel
        : null;
    const providerLine = `Provider: ${providerLabel}${modelLabel ? ` · ${modelLabel}` : ''}${explicit ? '' : ' (default)'}`;
    let session;
    try {
        session = await bridge.getSession(sessionName);
    }
    catch (err) {
        await channel.sendText(`${breadcrumb}\n${providerLine}\n\n${err.message}`);
        return;
    }
    const terminalClass = actionFilter.getTerminalClass(target);
    if (session && (session.status === 'running' || session.status === 'detached')) {
        // Active session — connected
        await channel.sendText(`${breadcrumb} — Connected\n${providerLine}`);
        return;
    }
    // Stopped or no session — offer startup commands
    const cardType = getCardType(target, kanban);
    const commands = actionFilter.filterActions(terminalClass, 'startup', cardType);
    const buttons = actionsToButtons(commands);
    const label = session?.status === 'stopped' ? 'Session paused' : 'No session';
    const text = `${breadcrumb}\n${providerLine}\n\n${label}. Start with a command or message:`;
    if (buttons.length > 0) {
        await channel.sendInlineKeyboard(text, buttons);
    }
    else {
        await channel.sendText(text);
    }
}
function getCardType(target, kanban) {
    if (target.type !== 'card' || !target.projectId || !target.cardId)
        return undefined;
    const info = kanban.getCard(target.projectId, target.cardId);
    return info?.card.type;
}
/** Ensure the target has the current stage from kanban (cards can move between lanes). */
function ensureStage(target, kanban, state) {
    if (target.type === 'card' && target.projectId && target.cardId) {
        const info = kanban.getCard(target.projectId, target.cardId);
        if (info?.stage && info.stage !== target.stage) {
            target.stage = info.stage;
            state.selectCard(target.projectId, target.cardId, info.stage);
        }
    }
    return target;
}
function actionsToButtons(commands) {
    return Object.entries(commands).map(([key, cmd]) => [{
            label: cmd.label,
            callbackData: `qc_${key}`,
        }]);
}
// --- Quick Command Execution ---
async function executeQuickCommand(commandKey, channel, state, bridge, kanban, actionFilter) {
    const file = actionFilter.loadActions();
    const cmd = file.commands[commandKey];
    if (!cmd) {
        await channel.sendText(`Unknown command: ${commandKey}`);
        return;
    }
    const target = state.getTarget();
    const sessionName = state.getSessionName();
    const cwd = state.getSessionCwd();
    const provider = state.getSelectedProvider();
    // Build template context
    const project = state.getSelectedProject();
    const cardInfo = target.type === 'card' && target.projectId && target.cardId
        ? kanban.getCard(target.projectId, target.cardId)
        : null;
    const resolved = actionFilter.buildFullPrompt(cmd.prompt, {
        card: cardInfo?.card,
        project: project || undefined,
        stage: cardInfo?.stage || target.stage,
        projectPath: project?.path,
    });
    // Wrap with channel header so the terminal session knows to reply via messaging
    const formatted = `[${channel.name}] ${resolved} (${buildFooter(state)})`;
    try {
        await channel.sendTyping();
        // Check if session is already active
        const existing = await bridge.getSession(sessionName);
        const isActive = existing && (existing.status === 'running' || existing.status === 'detached');
        if (isActive) {
            // Permission mismatch check
            if (existing.skipPermissions === false) {
                await channel.sendInlineKeyboard('⚠️ This session was started without skip-permissions, which is required for messaging.\n\nRestart the session with permissions skipped?', [[
                        { label: 'Restart session', callbackData: 'perm_restart' },
                        { label: 'Cancel', callbackData: 'perm_cancel' },
                    ]]);
                return;
            }
            // Active session — inject via sendInput
            await bridge.sendInput(sessionName, formatted);
            await new Promise(resolve => setTimeout(resolve, 500));
            await bridge.sendInput(sessionName, '\r');
        }
        else {
            // Pre-flight: check instruction file before creating a new session
            const proceed = await checkInstructionFilePreFlight(channel, state, bridge, sessionName, cwd, provider, formatted);
            if (!proceed)
                return;
            // New or stopped session — pass prompt to session creation
            await bridge.ensureSession(sessionName, cwd, provider, formatted, undefined, state.getSelectedModel() || undefined);
        }
        await channel.sendText(`Sent: ${cmd.label}`);
        bridge.watchActivity(sessionName, channel).catch(() => { });
    }
    catch (err) {
        await channel.sendText(`Error: ${err.message}`);
    }
}
// --- Contextual Keyboard ---
function updateKeyboard(channel, _state) {
    channel.setPersistentKeyboard([['/switch', '/search'], ['/provider', '/status'], ['/voice', '/tone'], ['/mode', '/sly']]);
}
// --- Message Footer ---
function buildFooter(state) {
    const parts = ['Reply using /messaging'];
    const mode = state.getResponseMode();
    parts.push(`Mode: ${mode}`);
    const tone = state.getVoiceTone();
    if (tone && mode !== 'text') {
        parts.push(`Tone: ${tone}`);
    }
    return parts.join(' | ');
}
/**
 * Pre-flight check: if a new session would be created and the provider's
 * instruction file is missing, prompt the user with inline buttons.
 * Returns true if the caller should proceed normally, false if we're waiting
 * for user confirmation (the ifc_ callback will handle delivery).
 */
async function checkInstructionFilePreFlight(channel, state, bridge, sessionName, cwd, provider, originalMessage) {
    // Only check when a new session would be created
    const existing = await bridge.getSession(sessionName);
    const isActive = existing && (existing.status === 'running' || existing.status === 'detached');
    if (isActive)
        return true;
    const check = await bridge.checkInstructionFile(provider, cwd);
    if (!check.needed)
        return true;
    // Store pending state and show confirmation
    state.setPendingInstructionFileConfirm({
        provider,
        cwd,
        sessionName,
        targetFile: check.targetFile,
        copySource: check.copySource,
        originalMessage,
        model: state.getSelectedModel() || undefined,
    });
    await channel.sendInlineKeyboard(`⚠️ ${check.targetFile} is missing in this project.\n\nCreate from ${check.copySource}?`, [[
            { label: '✅ Yes, create it', callbackData: 'ifc_yes' },
            { label: '❌ No, skip', callbackData: 'ifc_no' },
        ]]);
    return false;
}
// --- Main Setup ---
function setupChannel(channel, bridge, state, kanban, actionFilter, voiceConfig) {
    // Track current lane drilldown for back navigation
    let currentDrilldownStage = null;
    // --- /start ---
    channel.onCommand('start', async () => {
        await channel.sendText(`SlyCode Messaging (${channel.name})\n\n` +
            'Commands:\n' +
            '/switch - Navigate terminals (global, project, card)\n' +
            '/search - Search cards (or quick access to active/recent)\n' +
            '/provider - Select AI provider (Claude/Gemini/Codex)\n' +
            '/model - Select model for current provider\n' +
            '/sly - Sly Actions for active session\n' +
            '/global - Switch to global terminal\n' +
            '/project - Switch to project terminal (from card)\n' +
            '/status - Show current target and provider\n' +
            '/voice - Search and swap TTS voices\n' +
            '/mode - Set response mode (text/voice/both)\n' +
            '/tone - Set voice tone/style\n\n' +
            'Send any text message to forward it to the active session.\n' +
            'Send a voice note to transcribe and forward it.');
    });
    // --- /switch ---
    channel.onCommand('switch', async () => {
        currentDrilldownStage = null;
        await renderSwitchView(channel, state, bridge, kanban);
    });
    // --- /search (and quick-access helper) ---
    // Reusable quick-access view: shows active + recent cards for given project scope.
    // Used by /search (no query) and after project selection in /switch.
    async function renderQuickAccess(projectIds) {
        const isGlobal = projectIds.length > 1;
        const projectMap = new Map(state.getProjects().map(p => [p.id, p.name]));
        function buttonLabel(cardTitle, cardProjectId, isAutomation) {
            const prefix = isAutomation ? '⚙ ' : '';
            if (!isGlobal)
                return prefix + truncate(cardTitle, isAutomation ? 38 : 40);
            const projName = truncate(projectMap.get(cardProjectId) || cardProjectId, 12);
            const title = truncate(cardTitle, isAutomation ? 23 : 25);
            return `${prefix}${projName} · ${title}`;
        }
        function cardCallback(cardId, cardProjectId) {
            if (!isGlobal)
                return `sw_card_${cardId}`;
            return `sw_card_${cardId}|${cardProjectId}`;
        }
        let activeCardIds;
        let sessionRecency;
        try {
            [activeCardIds, sessionRecency] = await Promise.all([
                bridge.getActiveCardSessions(projectIds),
                bridge.getCardSessionRecency(projectIds),
            ]);
        }
        catch {
            activeCardIds = new Set();
            sessionRecency = new Map();
        }
        const allCards = kanban.getAllCards(projectIds);
        const activeCards = allCards.filter(c => activeCardIds.has(c.card.id));
        const recentCards = allCards
            .filter(c => !activeCardIds.has(c.card.id))
            .map(c => {
            const lastTouched = latestDate(c.card.updated_at, c.card.created_at, sessionRecency.get(c.card.id));
            return { ...c, lastTouched };
        })
            .sort((a, b) => {
            const cmp = b.lastTouched.localeCompare(a.lastTouched);
            if (cmp !== 0)
                return cmp;
            return (b.card.created_at || '').localeCompare(a.card.created_at || '');
        });
        const maxTotal = 5;
        const activeSlice = activeCards.slice(0, maxTotal);
        const recentSlots = maxTotal - activeSlice.length;
        const recentSlice = recentCards.slice(0, recentSlots);
        if (activeSlice.length === 0 && recentSlice.length === 0) {
            await channel.sendText('No recent cards. Use /switch to navigate.');
            return;
        }
        let header = '';
        const buttons = [];
        if (activeSlice.length > 0) {
            header += '⚡ Currently active';
            for (const c of activeSlice) {
                buttons.push([{
                        label: buttonLabel(c.card.title, c.projectId, !!c.card.automation),
                        callbackData: cardCallback(c.card.id, c.projectId),
                    }]);
            }
        }
        if (recentSlice.length > 0) {
            if (header)
                header += '\n\n';
            header += '🕐 Recent';
            for (const c of recentSlice) {
                buttons.push([{
                        label: buttonLabel(c.card.title, c.projectId, !!c.card.automation),
                        callbackData: cardCallback(c.card.id, c.projectId),
                    }]);
            }
        }
        await channel.sendInlineKeyboard(header, buttons);
    }
    channel.onCommand('search', async (args) => {
        const target = state.getTarget();
        const projectId = target.projectId;
        const isGlobal = !projectId;
        const projectIds = isGlobal
            ? state.getProjects().map(p => p.id)
            : [projectId];
        const query = args.trim();
        if (query) {
            const projectMap = new Map(state.getProjects().map(p => [p.id, p.name]));
            const results = kanban.searchCards(projectIds, query);
            if (results.length === 0) {
                await channel.sendText(`No cards found for '${query}'.`);
                return;
            }
            const buttons = results.map(r => [{
                    label: isGlobal
                        ? `${truncate(projectMap.get(r.projectId) || r.projectId, 12)} · ${truncate(r.card.title, r.card.automation ? 23 : 25)}`
                        : (r.card.automation ? '⚙ ' : '') + truncate(r.card.title, r.card.automation ? 38 : 40),
                    callbackData: isGlobal ? `sw_card_${r.card.id}|${r.projectId}` : `sw_card_${r.card.id}`,
                }]);
            await channel.sendInlineKeyboard(`🔍 Results for '${query}':`, buttons);
        }
        else {
            await renderQuickAccess(projectIds);
        }
    });
    // --- /sly (sly actions) ---
    channel.onCommand('sly', async () => {
        const target = ensureStage(state.getTarget(), kanban, state);
        const terminalClass = actionFilter.getTerminalClass(target);
        const cardType = getCardType(target, kanban);
        const breadcrumb = await getBreadcrumb(target, state, kanban, bridge);
        const commands = actionFilter.filterActions(terminalClass, undefined, cardType);
        console.log(`[SLY] target: ${JSON.stringify(target)}, class: ${terminalClass}, cardType: ${cardType}, actions: ${Object.keys(commands).join(', ')}`);
        const buttons = actionsToButtons(commands);
        if (buttons.length === 0) {
            await channel.sendText(`${breadcrumb}\n\nNo sly actions available.`);
            return;
        }
        await channel.sendInlineKeyboard(`${breadcrumb}\n\nSly Actions:`, buttons);
    });
    // --- /global ---
    channel.onCommand('global', async () => {
        state.selectGlobal();
        state.setSelectedProvider(getProviderDefault().provider);
        updateKeyboard(channel, state);
        await handleSessionLifecycle(channel, state, bridge, kanban, actionFilter);
    });
    // --- /project (go up to project terminal from card) ---
    channel.onCommand('project', async () => {
        const target = state.getTarget();
        if (target.projectId) {
            state.selectProject(target.projectId);
            const projProvider = await resolveProjectProviderFromBridge(bridge, target.projectId);
            state.setSelectedProvider(projProvider || getProviderDefault().provider);
            updateKeyboard(channel, state);
            await handleSessionLifecycle(channel, state, bridge, kanban, actionFilter);
        }
        else {
            await channel.sendText('No project selected. Use /switch first.');
        }
    });
    // --- /provider ---
    channel.onCommand('provider', async () => {
        const current = state.getSelectedProvider();
        const currentLabel = PROVIDER_LABELS[current] || current;
        const buttons = ALL_PROVIDERS.map(p => [{
                label: (p === current ? '● ' : '') + PROVIDER_LABELS[p],
                callbackData: `cfg_${p}`,
            }]);
        await channel.sendInlineKeyboard(`Provider: *${currentLabel}*`, buttons);
    });
    // --- /model ---
    channel.onCommand('model', async () => {
        const provider = state.getSelectedProvider();
        const currentModel = state.getSelectedModel();
        const models = await getProviderModels(provider);
        if (!models.length) {
            await channel.sendText(`No models configured for ${PROVIDER_LABELS[provider] || provider}`);
            return;
        }
        const currentLabel = currentModel
            ? models.find(m => m.id === currentModel)?.label || currentModel
            : 'Default';
        const buttons = [
            [{ label: '🔄 Default', callbackData: 'mdl_' }],
            ...models.filter(m => m.id !== currentModel).map(m => [{
                    label: m.label,
                    callbackData: `mdl_${m.id}`,
                }]),
        ];
        await channel.sendInlineKeyboard(`Model: *${currentLabel}* (${PROVIDER_LABELS[provider] || provider})`, buttons);
    });
    // --- /status ---
    channel.onCommand('status', async () => {
        const target = state.getTarget();
        const voice = state.getVoice();
        const mode = state.getResponseMode();
        const tone = state.getVoiceTone();
        const provider = state.getSelectedProvider();
        const explicit = await hasExplicitSession(bridge, state);
        const providerSuffix = explicit ? '' : ' (default)';
        let status = '';
        // Build a richer status depending on navigation level
        if (target.type === 'global') {
            status += '📍 Global Terminal\n';
        }
        else if (target.type === 'project') {
            const project = state.getSelectedProject();
            status += `📍 ${project?.name || target.projectId} · Project Terminal\n`;
        }
        else if (target.type === 'card') {
            const project = state.getSelectedProject();
            const cardInfo = target.cardId && target.projectId
                ? kanban.getCard(target.projectId, target.cardId)
                : null;
            const card = cardInfo?.card;
            const stage = cardInfo?.stage || target.stage || '?';
            status += `📍 ${project?.name || target.projectId} · ${stage}\n`;
            status += `\n📋 ${card?.title || target.cardId || '?'}\n`;
            if (card) {
                if (card.priority)
                    status += `Priority: ${card.priority}\n`;
                if (card.created_at)
                    status += `Created: ${card.created_at.slice(0, 10)}\n`;
                if (card.updated_at && card.updated_at !== card.created_at) {
                    status += `Updated: ${card.updated_at.slice(0, 10)}\n`;
                }
            }
            // Check session status via bridge
            if (target.projectId && target.cardId) {
                try {
                    const sessions = await bridge.getProjectSessions(target.projectId);
                    const cardSession = sessions.find(s => s.name.includes(`card:${target.cardId}`));
                    if (cardSession) {
                        const sessionStatus = cardSession.status === 'running'
                            ? '🟢 Running'
                            : cardSession.status === 'detached'
                                ? '🔵 Detached'
                                : '⚪ Stopped';
                        status += `Session: ${sessionStatus}\n`;
                    }
                }
                catch { }
            }
        }
        // Git branch info
        try {
            const cwd = state.getSessionCwd();
            const git = await bridge.getGitStatus(cwd);
            if (git?.branch) {
                const uncommittedSuffix = git.uncommitted > 0 ? ` (${git.uncommitted} uncommitted)` : '';
                status += `Branch: ${git.branch}${uncommittedSuffix}\n`;
            }
        }
        catch {
            // Silent — branch info is best-effort
        }
        const currentModel = state.getSelectedModel();
        const modelLabel = currentModel
            ? (await getProviderModels(provider)).find(m => m.id === currentModel)?.label || currentModel
            : null;
        status += `\nProvider: ${PROVIDER_LABELS[provider] || provider}${modelLabel ? ` · ${modelLabel}` : ''}${providerSuffix}`;
        status += `\nMode: ${mode}`;
        if (tone)
            status += `\nTone: ${tone}`;
        status += `\nVoice: ${voice ? voice.name : 'default'}`;
        await channel.sendTextRaw(status);
    });
    // --- /voice ---
    channel.onCommand('voice', async (args) => {
        if (!voiceConfig.elevenlabsApiKey) {
            await channel.sendText('ElevenLabs not configured (API key missing).');
            return;
        }
        const query = args.trim();
        if (!query) {
            const voice = state.getVoice();
            await channel.sendText(voice
                ? `Current voice: *${voice.name}*\n\nUsage:\n/voice <name> - search and select\n/voice reset - use default`
                : `Using default voice.\n\nUsage:\n/voice <name> - search and select\n/voice reset - use default`);
            return;
        }
        if (query === 'reset') {
            state.clearVoice();
            await channel.sendText('Voice reset to default.');
            return;
        }
        try {
            await channel.sendTyping();
            const voices = await searchVoices(voiceConfig.elevenlabsApiKey, query);
            if (voices.length === 0) {
                await channel.sendText(`No voices found for "${query}".`);
                return;
            }
            const exactMatch = voices.find(v => v.name.toLowerCase() === query.toLowerCase());
            if (exactMatch) {
                state.setVoice(exactMatch.voice_id, exactMatch.name);
                await channel.sendTextRaw(`Voice set to ${exactMatch.name}\nID: ${exactMatch.voice_id}`);
                return;
            }
            if (channel.sendVoiceList) {
                await channel.sendVoiceList(voices.slice(0, 8).map(v => ({
                    id: v.voice_id,
                    name: v.name,
                    description: v.category,
                })));
            }
            else {
                const list = voices.slice(0, 8).map((v, i) => `${i + 1}. *${v.name}* (${v.category})`).join('\n');
                await channel.sendText(`Found ${voices.length} voice(s):\n\n${list}\n\nSay the exact name to select.`);
            }
        }
        catch (err) {
            await channel.sendText(`Error searching voices: ${err.message}`);
        }
    });
    // --- Voice Selection ---
    if (channel.onVoiceSelect) {
        channel.onVoiceSelect(async (voiceId, voiceName) => {
            state.setVoice(voiceId, voiceName);
            await channel.sendTextRaw(`Voice set to ${voiceName}\nID: ${voiceId}`);
        });
    }
    // --- /mode ---
    channel.onCommand('mode', async () => {
        const current = state.getResponseMode();
        await channel.sendInlineKeyboard(`Response mode: *${current}*\n\nSelect mode:`, [
            [
                { label: '📝 Text', callbackData: 'mode_text' },
                { label: '🔊 Voice', callbackData: 'mode_voice' },
                { label: '📝+🔊 Both', callbackData: 'mode_both' },
            ],
        ]);
    });
    // --- /tone ---
    channel.onCommand('tone', async (args) => {
        const input = args.trim();
        if (!input) {
            const current = state.getVoiceTone();
            const header = current
                ? `Current tone: *${current}*\n\nSelect a preset or type /tone <description>:`
                : `No tone set.\n\nSelect a preset or type /tone <description>:`;
            await channel.sendInlineKeyboard(header, [
                [
                    { label: 'Casual', callbackData: 'tone_casual' },
                    { label: 'Professional', callbackData: 'tone_professional' },
                ],
                [
                    { label: 'Short & ominous', callbackData: 'tone_short_ominous' },
                    { label: 'Excited', callbackData: 'tone_excited' },
                ],
                [
                    { label: 'Deadpan', callbackData: 'tone_deadpan' },
                    { label: 'Clear', callbackData: 'tone_clear' },
                ],
            ]);
            return;
        }
        if (input === 'clear') {
            state.setVoiceTone(null);
            await channel.sendText('Voice tone cleared.');
            return;
        }
        state.setVoiceTone(input);
        await channel.sendText(`Voice tone set to: ${input}`);
    });
    // --- Mode Callbacks (mode_ prefix) ---
    channel.onCallback('mode_', async (data) => {
        const mode = data.replace('mode_', '');
        if (!['text', 'voice', 'both'].includes(mode))
            return;
        state.setResponseMode(mode);
        const labels = { text: '📝 Text only', voice: '🔊 Voice only', both: '📝+🔊 Text + Voice' };
        await channel.sendText(`Response mode set to: ${labels[mode]}`);
    });
    // --- Tone Callbacks (tone_ prefix) ---
    channel.onCallback('tone_', async (data) => {
        const presetKey = data.replace('tone_', '');
        if (presetKey === 'clear') {
            state.setVoiceTone(null);
            await channel.sendText('Voice tone cleared.');
            return;
        }
        const presets = {
            casual: 'casual and conversational',
            professional: 'professional and concise',
            short_ominous: 'short ominous updates',
            excited: 'excited and energetic',
            deadpan: 'deadpan and dry',
        };
        const tone = presets[presetKey];
        if (!tone)
            return;
        state.setVoiceTone(tone);
        await channel.sendText(`Voice tone set to: ${tone}`);
    });
    // --- Configure Callbacks (cfg_ prefix) ---
    channel.onCallback('cfg_', async (data) => {
        const provider = data.replace('cfg_', '');
        if (!ALL_PROVIDERS.includes(provider))
            return;
        // If the current target was using an inherited default (no bridge session),
        // also update the global default in providers.json
        const explicit = await hasExplicitSession(bridge, state);
        state.setSelectedProvider(provider); // Also resets model to ''
        if (!explicit) {
            updateGlobalProviderDefault(provider);
        }
        // Pre-fill model from stage default if applicable
        const target = state.getTarget();
        const stageDefault = getProviderDefault(target.stage);
        if (stageDefault.model && stageDefault.provider === provider) {
            state.setSelectedModel(stageDefault.model);
        }
        // Show model options if available
        const models = await getProviderModels(provider);
        if (models.length > 0) {
            const buttons = [
                [{ label: '🔄 Default', callbackData: 'mdl_' }],
                ...models.map(m => [{ label: m.label, callbackData: `mdl_${m.id}` }]),
            ];
            await channel.sendInlineKeyboard(`Provider set to: *${PROVIDER_LABELS[provider]}*\nSelect model:`, buttons);
        }
        else {
            await channel.sendText(`Provider set to: ${PROVIDER_LABELS[provider]}`);
        }
    });
    // --- Model Selection Callbacks (mdl_ prefix) ---
    channel.onCallback('mdl_', async (data) => {
        const modelId = data.replace('mdl_', ''); // '' for Default
        state.setSelectedModel(modelId);
        if (modelId) {
            const models = await getProviderModels(state.getSelectedProvider());
            const label = models.find(m => m.id === modelId)?.label || modelId;
            await channel.sendText(`Model set to: ${label}`);
        }
        else {
            await channel.sendText('Model set to: Default');
        }
    });
    // --- Instruction File Confirm Callbacks (ifc_ prefix) ---
    channel.onCallback('ifc_', async (data) => {
        const pending = state.getPendingInstructionFileConfirm();
        if (!pending)
            return;
        const approved = data === 'ifc_yes';
        state.clearPendingInstructionFileConfirm();
        if (approved) {
            await channel.sendText(`Creating ${pending.targetFile}...`);
        }
        try {
            await channel.sendTyping();
            const result = await bridge.sendMessage(pending.sessionName, pending.cwd, pending.originalMessage, pending.provider, approved, pending.model || undefined);
            if (result.permissionMismatch) {
                await channel.sendInlineKeyboard('⚠️ This session was started without skip-permissions, which is required for messaging.\n\nRestart the session with permissions skipped?', [[
                        { label: 'Restart session', callbackData: 'perm_restart' },
                        { label: 'Cancel', callbackData: 'perm_cancel' },
                    ]]);
                return;
            }
            bridge.watchActivity(pending.sessionName, channel).catch(() => { });
        }
        catch (err) {
            await channel.sendText(`Error: ${err.message}`);
        }
    });
    // --- Permission Mismatch Callbacks (perm_ prefix) ---
    channel.onCallback('perm_', async (data) => {
        if (data === 'perm_restart') {
            const sessionName = state.getSessionName();
            const cwd = state.getSessionCwd();
            const provider = state.getSelectedProvider();
            try {
                // Check if someone is connected via web UI
                const existing = await bridge.getSession(sessionName);
                if (existing && existing.connectedClients > 0) {
                    await channel.sendText('⚠️ Terminal is open in the web UI. Disconnecting and restarting...');
                }
                await channel.sendTyping();
                await bridge.restartSession(sessionName, cwd, provider, undefined, state.getSelectedModel() || undefined);
                await channel.sendText('Session restarted with skip-permissions. Send your message again.');
            }
            catch (err) {
                await channel.sendText(`Error restarting: ${err.message}`);
            }
        }
        else if (data === 'perm_cancel') {
            await channel.sendText('Cancelled. Session left as-is.');
        }
    });
    // --- Switch Callbacks (sw_ prefix) ---
    channel.onCallback('sw_', async (data) => {
        if (data === 'sw_global') {
            state.selectGlobal();
            state.setSelectedProvider(getProviderDefault().provider);
            currentDrilldownStage = null;
            updateKeyboard(channel, state);
            await handleSessionLifecycle(channel, state, bridge, kanban, actionFilter);
            return;
        }
        if (data === 'sw_projects') {
            // Show global view (project list)
            currentDrilldownStage = null;
            const projects = state.getProjects();
            const buttons = projects.map(p => [{
                    label: p.name,
                    callbackData: `sw_proj_${p.id}`,
                }]);
            await channel.sendInlineKeyboard('📍 Select a project:', buttons);
            return;
        }
        if (data.startsWith('sw_proj_')) {
            const projectId = data.replace('sw_proj_', '');
            state.selectProject(projectId);
            // Resolve provider: bridge session > global default
            const projBridgeProvider = await resolveProjectProviderFromBridge(bridge, projectId);
            state.setSelectedProvider(projBridgeProvider || getProviderDefault().provider);
            currentDrilldownStage = null;
            kanban.updateProjects(state.getProjects());
            updateKeyboard(channel, state);
            await handleSessionLifecycle(channel, state, bridge, kanban, actionFilter);
            // Follow up with quick-access card list so user can jump straight to a card
            await renderQuickAccess([projectId]);
            return;
        }
        if (data.startsWith('sw_lane_')) {
            const stage = data.replace('sw_lane_', '');
            currentDrilldownStage = stage;
            await renderLaneDrilldown(channel, state, bridge, kanban, stage);
            return;
        }
        if (data.startsWith('sw_card_')) {
            const payload = data.replace('sw_card_', '');
            // Format: cardId or cardId|projectId (the latter from mismatch switch buttons)
            const [cardId, explicitProjectId] = payload.split('|');
            const projectId = explicitProjectId || state.getTarget().projectId;
            if (!projectId) {
                await channel.sendText('No project selected.');
                return;
            }
            // If switching to a different project, select it first
            if (explicitProjectId && explicitProjectId !== state.getTarget().projectId) {
                state.selectProject(explicitProjectId);
                kanban.updateProjects(state.getProjects());
            }
            // Look up card to get its stage
            const cardInfo = kanban.getCard(projectId, cardId);
            const cardStage = cardInfo?.stage;
            state.selectCard(projectId, cardId, cardStage);
            // Resolve provider: bridge session > stage default > global default
            const bridgeProvider = await resolveProviderFromBridge(bridge, projectId, cardId);
            const stageDefault = getProviderDefault(cardStage);
            state.setSelectedProvider(bridgeProvider || stageDefault.provider);
            // Resolve model: bridge session > stage default > Default
            const sessionName = state.getSessionName();
            try {
                const session = await bridge.getSession(sessionName);
                if (session?.model) {
                    state.setSelectedModel(session.model);
                }
                else if (stageDefault.model && (stageDefault.provider === state.getSelectedProvider())) {
                    state.setSelectedModel(stageDefault.model);
                }
            }
            catch {
                if (stageDefault.model && (stageDefault.provider === state.getSelectedProvider())) {
                    state.setSelectedModel(stageDefault.model);
                }
            }
            currentDrilldownStage = null;
            updateKeyboard(channel, state);
            await handleSessionLifecycle(channel, state, bridge, kanban, actionFilter);
            return;
        }
        if (data === 'sw_back') {
            currentDrilldownStage = null;
            await renderSwitchView(channel, state, bridge, kanban);
            return;
        }
        if (data.startsWith('sw_more_')) {
            const offset = parseInt(data.replace('sw_more_', ''), 10);
            if (currentDrilldownStage) {
                await renderLaneDrilldown(channel, state, bridge, kanban, currentDrilldownStage, offset);
            }
            return;
        }
    });
    // --- Quick Command Callbacks (qc_ prefix) ---
    channel.onCallback('qc_', async (data) => {
        const commandKey = data.replace('qc_', '');
        await executeQuickCommand(commandKey, channel, state, bridge, kanban, actionFilter);
    });
    // --- Text Messages ---
    channel.onText(async (text) => {
        // Intercept "stop" command — exact match, case-insensitive
        if (text.trim().toLowerCase() === 'stop') {
            const target = state.getTarget();
            if (!target) {
                await channel.sendText('No active session to interrupt.');
                return;
            }
            try {
                const sessionName = state.getSessionName();
                const result = await bridge.stopSession(sessionName);
                if (result.stopped) {
                    await channel.sendText('Interrupted active session.');
                }
                else {
                    await channel.sendText('Already stopped.');
                }
            }
            catch (err) {
                await channel.sendText(`Error: ${err.message}`);
            }
            return;
        }
        const sessionName = state.getSessionName();
        const cwd = state.getSessionCwd();
        const provider = state.getSelectedProvider();
        const formatted = `[${channel.name}] ${text} (${buildFooter(state)})`;
        try {
            // Pre-flight: check instruction file before creating a new session
            const proceed = await checkInstructionFilePreFlight(channel, state, bridge, sessionName, cwd, provider, formatted);
            if (!proceed)
                return;
            await channel.sendTyping();
            const result = await bridge.sendMessage(sessionName, cwd, formatted, provider, undefined, state.getSelectedModel() || undefined);
            if (result.permissionMismatch) {
                await channel.sendInlineKeyboard('⚠️ This session was started without skip-permissions, which is required for messaging.\n\nRestart the session with permissions skipped?', [[
                        { label: 'Restart session', callbackData: 'perm_restart' },
                        { label: 'Cancel', callbackData: 'perm_cancel' },
                    ]]);
                return;
            }
            bridge.watchActivity(sessionName, channel).catch(() => { });
        }
        catch (err) {
            await channel.sendText(`Error: ${err.message}`);
        }
    });
    // --- Voice Messages ---
    channel.onVoice(async (filePath) => {
        const sttConfig = {
            backend: voiceConfig.sttBackend,
            openaiApiKey: voiceConfig.openaiApiKey,
            whisperCliPath: voiceConfig.whisperCliPath,
            whisperModelPath: voiceConfig.whisperModelPath,
            awsTranscribeRegion: voiceConfig.awsTranscribeRegion,
            awsTranscribeLanguage: voiceConfig.awsTranscribeLanguage,
            awsTranscribeS3Bucket: voiceConfig.awsTranscribeS3Bucket,
        };
        const sttError = await validateSttConfig(sttConfig);
        if (sttError) {
            await channel.sendText(`Voice transcription not configured: ${sttError}`);
            return;
        }
        const sessionName = state.getSessionName();
        const cwd = state.getSessionCwd();
        const provider = state.getSelectedProvider();
        try {
            await channel.sendChatAction('record_voice');
            const transcription = await transcribeAudio(filePath, sttConfig);
            const formatted = `[${channel.name}/Voice] ${transcription} (${buildFooter(state)})`;
            // Pre-flight: check instruction file before creating a new session
            const proceed = await checkInstructionFilePreFlight(channel, state, bridge, sessionName, cwd, provider, formatted);
            if (!proceed)
                return;
            await channel.sendTyping();
            const result = await bridge.sendMessage(sessionName, cwd, formatted, provider, undefined, state.getSelectedModel() || undefined);
            if (result.permissionMismatch) {
                await channel.sendInlineKeyboard('⚠️ This session was started without skip-permissions, which is required for messaging.\n\nRestart the session with permissions skipped?', [[
                        { label: 'Restart session', callbackData: 'perm_restart' },
                        { label: 'Cancel', callbackData: 'perm_cancel' },
                    ]]);
                return;
            }
            bridge.watchActivity(sessionName, channel).catch(() => { });
        }
        catch (err) {
            await channel.sendText(`Error: ${err.message}`);
        }
    });
    // --- Photo Messages ---
    channel.onPhoto(async (photos) => {
        const sessionName = state.getSessionName();
        const cwd = state.getSessionCwd();
        const provider = state.getSelectedProvider();
        try {
            await channel.sendTyping();
            // Upload all images to bridge
            const filenames = [];
            for (const photo of photos) {
                const { filename } = await bridge.sendImage(sessionName, photo.filePath, cwd);
                filenames.push(filename);
            }
            // Build screenshot references (one per line)
            const screenshotRefs = filenames.map(f => `[Screenshot: screenshots/${f}]`).join('\n');
            // Use caption from first photo that has one
            const caption = photos.find(p => p.caption)?.caption;
            let message;
            if (caption) {
                message = `[${channel.name}] ${caption}\n${screenshotRefs} (${buildFooter(state)})`;
            }
            else {
                message = `[${channel.name}] ${screenshotRefs} (${buildFooter(state)})`;
            }
            // Pre-flight: check instruction file before creating a new session
            const proceed = await checkInstructionFilePreFlight(channel, state, bridge, sessionName, cwd, provider, message);
            if (!proceed)
                return;
            const result = await bridge.sendMessage(sessionName, cwd, message, provider, undefined, state.getSelectedModel() || undefined);
            if (result.permissionMismatch) {
                await channel.sendInlineKeyboard('⚠️ This session was started without skip-permissions, which is required for messaging.\n\nRestart the session with permissions skipped?', [[
                        { label: 'Restart session', callbackData: 'perm_restart' },
                        { label: 'Cancel', callbackData: 'perm_cancel' },
                    ]]);
                return;
            }
            bridge.watchActivity(sessionName, channel).catch(() => { });
        }
        catch (err) {
            await channel.sendText(`Error: ${err.message}`);
        }
    });
}
async function main() {
    const bridgeUrl = await detectBridgeUrl();
    const { service: serviceConfig, voice: voiceConfig } = loadConfig(bridgeUrl);
    const state = new StateManager();
    const channel = createChannel(state);
    await logConfigStatus(channel, voiceConfig, serviceConfig.bridgeUrl);
    const bridge = new BridgeClient(serviceConfig.bridgeUrl);
    const kanban = new KanbanClient(state.getProjects());
    const actionFilter = new SlyActionFilter();
    console.log(`Projects loaded: ${state.getProjects().length}`);
    if (channel) {
        // Wire up the channel with core logic
        setupChannel(channel, bridge, state, kanban, actionFilter, voiceConfig);
        // Start the channel
        await channel.start();
        // Queue context-aware persistent keyboard — sent on first user interaction
        updateKeyboard(channel, state);
        // Background typing indicator — sends typing when targeted session is active
        bridge.startActivityMonitor(() => state.getSessionName(), channel);
    }
    else {
        console.log('No channel configured — HTTP server will start but messaging is unavailable.');
    }
    // --- Session Mismatch Detection ---
    /** Parse a session name into a friendly label for the switch button. */
    function getSessionLabel(sessionName) {
        // Format: projectId:provider:card:cardId or projectId:provider:global or global:provider:global
        const parts = sessionName.split(':');
        if (parts[0] === 'global')
            return 'Global Terminal';
        const projectId = parts[0];
        const project = state.getProjects().find(p => p.id === projectId);
        const projectName = project?.name || projectId;
        if (parts.includes('card') && parts.length >= 4) {
            const cardId = parts[parts.length - 1];
            const cardInfo = projectId ? kanban.getCard(projectId, cardId) : null;
            const cardTitle = cardInfo?.card.title || cardId;
            const truncTitle = cardTitle.length > 50 ? cardTitle.slice(0, 47) + '...' : cardTitle;
            return truncTitle;
        }
        return `${projectName} Terminal`;
    }
    /** Build callback data for switching to a session's target. */
    function getSessionSwitchCallback(sessionName) {
        const parts = sessionName.split(':');
        if (parts[0] === 'global')
            return 'sw_global';
        const projectId = parts[0];
        if (parts.includes('card') && parts.length >= 4) {
            const cardId = parts[parts.length - 1];
            return `sw_card_${cardId}|${projectId}`;
        }
        return `sw_proj_${projectId}`;
    }
    // --- HTTP Server for Outbound Messages (called by CLI) ---
    const noChannelError = 'Messaging is not configured. Telegram bot token and user ID are not set. Tell the user they can configure messaging in .env or remove the messaging skill from this project.';
    const app = express();
    app.use(express.json());
    app.post('/send', async (req, res) => {
        try {
            const { message, session } = req.body;
            if (!message)
                return res.status(400).json({ error: 'message is required' });
            if (!channel)
                return res.status(400).json({ error: noChannelError });
            if (!channel.isReady())
                return res.status(400).json({ error: 'No active chat. Send a message from the channel first.' });
            const currentSession = state.getSessionName();
            const isMismatch = session && session !== currentSession;
            if (isMismatch) {
                const label = getSessionLabel(session);
                const switchCb = getSessionSwitchCallback(session);
                const header = `📍 ${label}`;
                if (switchCb) {
                    await channel.sendInlineKeyboard(`${header}\n${message}`, [[{ label: 'Switch to Card', callbackData: switchCb }]]);
                }
                else {
                    await channel.sendTextRaw(`${header}\n${message}`);
                }
            }
            else {
                await channel.sendTextRaw(message);
            }
            res.json({ success: true });
        }
        catch (err) {
            res.status(500).json({ error: err.message });
        }
    });
    app.post('/voice', async (req, res) => {
        try {
            const { message, session } = req.body;
            if (!message)
                return res.status(400).json({ error: 'message is required' });
            if (!channel)
                return res.status(400).json({ error: noChannelError });
            if (!voiceConfig.elevenlabsApiKey) {
                return res.status(400).json({ error: 'Voice messaging (TTS) is not configured. ElevenLabs API key is missing. Tell the user to set ELEVENLABS_API_KEY in .env, or use text mode instead.' });
            }
            if (!channel.isReady())
                return res.status(400).json({ error: 'No active chat. Send a message from the channel first.' });
            const currentSession = state.getSessionName();
            const isMismatch = session && session !== currentSession;
            // For voice mismatch, send a text header + switch button before the audio
            if (isMismatch) {
                const label = getSessionLabel(session);
                const switchCb = getSessionSwitchCallback(session);
                if (switchCb) {
                    await channel.sendInlineKeyboard(`📍 ${label}`, [[{ label: 'Switch to Card', callbackData: switchCb }]]);
                }
                else {
                    await channel.sendTextRaw(`📍 ${label}`);
                }
            }
            await channel.sendChatAction('upload_voice');
            const runtimeVoice = state.getVoice();
            const mp3Buffer = await textToSpeech(message, voiceConfig, runtimeVoice?.id);
            let audioBuffer;
            try {
                audioBuffer = await convertToOgg(mp3Buffer);
            }
            catch {
                audioBuffer = mp3Buffer;
            }
            await channel.sendVoice(audioBuffer);
            res.json({ success: true });
        }
        catch (err) {
            res.status(500).json({ error: err.message });
        }
    });
    app.get('/health', (_, res) => {
        res.json({
            status: 'ok',
            channel: channel?.name || null,
            ready: channel?.isReady() || false,
        });
    });
    const listenHost = process.env.HOST || 'localhost';
    app.listen(serviceConfig.servicePort, listenHost, () => {
        console.log(`HTTP server listening on ${listenHost}:${serviceConfig.servicePort}`);
    });
    // Graceful shutdown
    const shutdown = () => {
        console.log('\nShutting down...');
        if (channel)
            channel.stop();
        process.exit(0);
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
}
main().catch((err) => {
    console.error('Fatal error:', err);
    process.exit(1);
});
//# sourceMappingURL=index.js.map