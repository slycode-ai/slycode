'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import dynamic from 'next/dynamic';
import { buildPrompt, renderTemplate, type SlyActionsConfig, type SlyActionItem } from '@/lib/sly-actions';
import { usePolling } from '@/hooks/usePolling';

const MAX_VISIBLE_ACTIONS = 6;

interface ProviderConfig {
  id: string;
  displayName: string;
  command: string;
  permissions: { flag: string; label: string; default: boolean };
  resume: { supported: boolean };
}

interface ProviderDefault {
  provider: string;
  skipPermissions: boolean;
}

interface ProvidersData {
  providers: Record<string, ProviderConfig>;
  defaults: {
    stages: Record<string, ProviderDefault>;
    global: ProviderDefault;
    projects: Record<string, ProviderDefault>;
  };
}

// Dynamic import to avoid SSR issues with xterm
const Terminal = dynamic(
  () => import('./Terminal').then((mod) => mod.Terminal),
  { ssr: false, loading: () => <div className="flex h-full items-center justify-center text-void-500">Loading terminal...</div> }
);

interface SessionInfo {
  name: string;
  status: 'running' | 'stopped' | 'detached';
  pid: number | null;
  connectedClients: number;
  hasHistory: boolean;
  resumed: boolean;
  claudeSessionId?: string | null;
  provider?: string;
  skipPermissions?: boolean;
}

export interface TerminalContext {
  // Pre-rendered context blocks (opt-in via {{cardContext}}, {{projectContext}}, {{globalContext}})
  cardContext?: string;
  projectContext?: string;
  globalContext?: string;
  // Field-level variables for action prompts
  card?: {
    id: string;
    title: string;
    description: string;
    type: string;
    priority: string;
    areas: string[];
    design_ref?: string;
    feature_ref?: string;
  };
  stage?: string;
  project?: { name: string; description?: string };
  projectPath?: string;
}

interface ClaudeTerminalPanelProps {
  sessionName: string;
  cwd: string;
  actionsConfig: SlyActionsConfig;
  actions: SlyActionItem[];
  context: TerminalContext;
  bridgeUrl?: string;
  className?: string;
  // For card-specific command modifications
  cardId?: string;
  cardAreas?: string[];
  // Stage for provider defaults (e.g. "design", "implementation")
  stage?: string;
  // Override initial provider (e.g. from detected existing session)
  initialProvider?: string;
  // Optional stage-colored footer styling (overrides default)
  footerClassName?: string;
  // Optional lane tint color for terminal texture
  tintColor?: string;
  // Voice registry ID — must match the key used with voice.registerTerminal()
  voiceTerminalId?: string;
  // Callbacks
  onSessionChange?: (info: SessionInfo | null) => void;
  onProviderChange?: (provider: string) => void;
  onTerminalReady?: (handle: { sendInput: (data: string) => void } | null) => void;
}

const BRIDGE_API = '/api/bridge';

export function ClaudeTerminalPanel({
  sessionName: baseSessionName,
  cwd,
  actionsConfig,
  actions,
  context,
  bridgeUrl = BRIDGE_API,
  className = '',
  cardId,
  cardAreas = [],
  stage,
  initialProvider,
  footerClassName,
  tintColor,
  voiceTerminalId,
  onSessionChange,
  onProviderChange,
  onTerminalReady,
}: ClaudeTerminalPanelProps) {
  // Provider state
  const [providersData, setProvidersData] = useState<ProvidersData | null>(null);
  const [selectedProvider, setSelectedProvider] = useState(initialProvider || 'claude');
  const [skipPermissions, setSkipPermissions] = useState(true);

  // Terminal state
  const [sessionInfo, setSessionInfo] = useState<SessionInfo | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [showTerminal, setShowTerminal] = useState(false);
  const [terminalKey, setTerminalKey] = useState(0);
  const [isStarting, setIsStarting] = useState(false);
  const [isStopping, setIsStopping] = useState(false);
  const [showCustomPrompt, setShowCustomPrompt] = useState(false);
  const [customPrompt, setCustomPrompt] = useState('');
  const [showActionsMenu, setShowActionsMenu] = useState(false);
  const [showRelinkConfirm, setShowRelinkConfirm] = useState(false);
  const [isRelinking, setIsRelinking] = useState(false);
  const actionsMenuRef = useRef<HTMLDivElement>(null);
  const relinkRef = useRef<HTMLDivElement>(null);
  const terminalHandleRef = useRef<{ focus: () => void; sendInput: (data: string) => void } | null>(null);
  // Screenshot toast state
  const [screenshotToast, setScreenshotToast] = useState<{ filename: string; previewUrl: string; status: 'uploading' | 'done' | 'error'; message?: string } | null>(null);
  const screenshotToastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const imagePasteInProgressRef = useRef(false);
  // Exit output toast state (persists across terminal unmount)
  const [exitToast, setExitToast] = useState<{ code: number; output: string } | null>(null);
  // Spawn error toast — shown when session creation fails (e.g. posix_spawnp failed)
  const [spawnError, setSpawnError] = useState<string | null>(null);

  // Instruction file check state
  const [instructionFileCheck, setInstructionFileCheck] = useState<{ needed: boolean; targetFile?: string; copySource?: string } | null>(null);
  const [createInstructionFile, setCreateInstructionFile] = useState(true);

  // Build session name with provider segment
  const sessionName = baseSessionName.includes(':card:') || baseSessionName.endsWith(':global')
    ? baseSessionName.replace(/:card:/, `:${selectedProvider}:card:`).replace(/:global$/, `:${selectedProvider}:global`)
    : baseSessionName;

  // Use ref for callback to avoid re-creating fetchSessionInfo on every render
  const onSessionChangeRef = useRef(onSessionChange);
  onSessionChangeRef.current = onSessionChange;

  // Track if user manually detached to prevent auto-reconnect
  const [manuallyDetached, setManuallyDetached] = useState(false);

  // Fetch providers on mount
  useEffect(() => {
    fetch('/api/providers')
      .then(res => res.ok ? res.json() : null)
      .then((data: ProvidersData | null) => {
        if (data) {
          setProvidersData(data);
          // Load saved defaults for provider and permissions
          const stageDefault = stage ? data.defaults.stages[stage] : null;
          const def = stageDefault || data.defaults.global;
          if (def) {
            // Only override provider selection if no existing session was detected
            if (!initialProvider) {
              setSelectedProvider(def.provider);
            }
            setSkipPermissions(def.skipPermissions);
          }
        }
      })
      .catch(() => { /* providers.json not available, use defaults */ });
  }, [stage]);

  // Persist provider default to /api/providers (fire-and-forget)
  const saveProviderDefault = useCallback((provider: string, skip: boolean) => {
    const defaultVal = { provider, skipPermissions: skip };
    const defaults = stage
      ? { stages: { [stage]: defaultVal } }
      : { global: defaultVal };
    fetch('/api/providers', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ defaults }),
    }).catch(() => { /* preference save — ignore errors */ });
  }, [stage]);

  const isRunning = sessionInfo?.status === 'running' || sessionInfo?.status === 'detached';
  const hasHistory = sessionInfo?.hasHistory;

  // Check for missing instruction file when provider/cwd changes or session stops
  useEffect(() => {
    if (!cwd || !selectedProvider) return;
    setInstructionFileCheck(null);
    setCreateInstructionFile(true);
    fetch(`${bridgeUrl}/check-instruction-file?provider=${selectedProvider}&cwd=${encodeURIComponent(cwd)}`)
      .then(res => res.ok ? res.json() : null)
      .then(data => { if (data) setInstructionFileCheck(data); })
      .catch(() => { /* ignore — non-critical */ });
  }, [selectedProvider, cwd, bridgeUrl, isRunning]);

  // Fetch session info
  const fetchSessionInfo = useCallback(async (signal?: AbortSignal) => {
    try {
      const res = await fetch(`${bridgeUrl}/sessions/${encodeURIComponent(sessionName)}`, { signal });
      if (res.ok) {
        const data = await res.json();
        setSessionInfo(data);
        onSessionChangeRef.current?.(data);
      }
    } catch {
      // Silently ignore — network errors are expected during sleep/wake
    }
  }, [sessionName, bridgeUrl]);

  usePolling(fetchSessionInfo, 5000);

  // Fetch immediately when session name changes (e.g. provider switch)
  useEffect(() => {
    fetchSessionInfo();
  }, [fetchSessionInfo]);

  // Auto-connect when session is running (but not if manually detached)
  useEffect(() => {
    if (isRunning && !showTerminal && !isConnected && !manuallyDetached) {
      setShowTerminal(true);
      setTerminalKey((k) => k + 1);
    }
  }, [isRunning, showTerminal, isConnected, manuallyDetached]);

  // Reset manual detach flag when session stops
  useEffect(() => {
    if (!isRunning) {
      setManuallyDetached(false);
    }
  }, [isRunning]);

  // Close actions menu on click outside
  useEffect(() => {
    if (!showActionsMenu) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (actionsMenuRef.current && !actionsMenuRef.current.contains(e.target as Node)) {
        setShowActionsMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showActionsMenu]);

  // Close relink confirmation on click outside
  useEffect(() => {
    if (!showRelinkConfirm) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (relinkRef.current && !relinkRef.current.contains(e.target as Node)) {
        setShowRelinkConfirm(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showRelinkConfirm]);

  // Instruction file warning UI (rendered below skip-permissions in both provider selector blocks)
  const instructionFileWarning = instructionFileCheck?.needed ? (
    <div className="flex flex-col items-center gap-1">
      <span className="text-xs text-amber-400">
        ⚠ {instructionFileCheck.targetFile} missing — will copy from {instructionFileCheck.copySource}
      </span>
      <label className="flex items-center gap-1.5 text-xs text-amber-400/80 cursor-pointer">
        <input
          type="checkbox"
          checked={createInstructionFile}
          onChange={(e) => setCreateInstructionFile(e.target.checked)}
          className="rounded border-amber-500/50"
        />
        Create {instructionFileCheck.targetFile}
      </label>
    </div>
  ) : null;

  // Derive startup and toolbar lists from placement
  const startupActions = actions.filter(a => a.placement === 'startup' || a.placement === 'both');
  const toolbarActions = actions.filter(a => a.placement === 'toolbar' || a.placement === 'both');

  const startSession = async (command?: SlyActionItem | { prompt: string } | null, customPromptText?: string) => {
    setIsStarting(true);
    setShowCustomPrompt(false);
    setExitToast(null);
    setSpawnError(null);
    try {
      // Build prompt if action provided — context is opt-in via {{cardContext}} etc.
      let prompt: string | undefined;
      const contextObj = context as Record<string, unknown>;
      if (customPromptText) {
        prompt = buildPrompt(customPromptText, contextObj);
      } else if (command?.prompt) {
        prompt = buildPrompt(command.prompt, contextObj);
      }

      const res = await fetch(`${bridgeUrl}/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: sessionName,
          provider: selectedProvider,
          skipPermissions,
          cwd,
          fresh: !hasHistory,
          prompt,
          createInstructionFile: instructionFileCheck?.needed ? createInstructionFile : undefined,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        setSessionInfo(data);
        onSessionChange?.(data);
        setShowTerminal(true);
        setTerminalKey((k) => k + 1);
        // File was created at session start — clear the warning
        if (instructionFileCheck?.needed && createInstructionFile) {
          setInstructionFileCheck(null);
        }
      } else {
        const body = await res.json().catch(() => ({ error: 'Unknown error' }));
        setSpawnError(body.error || `Failed to start session (HTTP ${res.status})`);
      }
    } catch (err) {
      console.error('Failed to start session:', err);
      setSpawnError('Could not reach the bridge server');
    } finally {
      setIsStarting(false);
      setCustomPrompt('');
    }
  };

  const stopSession = async () => {
    setIsStopping(true);
    try {
      const res = await fetch(`${bridgeUrl}/sessions/${encodeURIComponent(sessionName)}?action=stop`, {
        method: 'DELETE',
      });
      setShowTerminal(false);
      setIsConnected(false);
      if (res.ok) {
        const data = await res.json();
        if (data.session) {
          setSessionInfo(data.session);
          onSessionChange?.(data.session);
        }
      }
    } catch (err) {
      console.error('Failed to stop session:', err);
    } finally {
      setIsStopping(false);
    }
  };

  const relinkSession = async () => {
    setIsRelinking(true);
    try {
      const res = await fetch(`${bridgeUrl}/sessions/${encodeURIComponent(sessionName)}/relink`, {
        method: 'POST',
      });
      if (res.ok) {
        const data = await res.json();
        // Refresh session info to pick up the new ID
        fetchSessionInfo();
        console.log(`Relinked: ${data.previous?.slice(0, 8) || 'none'} -> ${data.sessionId?.slice(0, 8)}`);
      } else {
        const err = await res.json();
        console.error('Relink failed:', err.error);
      }
    } catch (err) {
      console.error('Failed to relink session:', err);
    } finally {
      setIsRelinking(false);
      setShowRelinkConfirm(false);
    }
  };

  const handleConnectionChange = (connected: boolean) => {
    setIsConnected(connected);
    if (connected) {
      fetchSessionInfo();
    }
  };

  const handleSessionExit = (code: number, output?: string) => {
    setShowTerminal(false);
    setIsConnected(false);
    if (output && code !== 0) {
      setExitToast({ code, output });
    }
    fetchSessionInfo();
  };

  // Handle image paste from terminal
  const handleImagePaste = useCallback(async (file: File) => {
    // Guard against double-fire
    if (imagePasteInProgressRef.current) return;
    imagePasteInProgressRef.current = true;

    // Generate thumbnail preview
    const previewUrl = URL.createObjectURL(file);
    const showTime = Date.now();

    // Show uploading toast immediately
    setScreenshotToast({ filename: '', previewUrl, status: 'uploading' });

    try {
      const formData = new FormData();
      formData.append('image', file);

      const res = await fetch(`${bridgeUrl}/sessions/${encodeURIComponent(sessionName)}/image`, {
        method: 'POST',
        body: formData,
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Upload failed' }));
        setScreenshotToast({ filename: '', previewUrl, status: 'error', message: err.error });
        imagePasteInProgressRef.current = false;
        return;
      }

      const { filename } = await res.json();

      // Inject bracketed reference into PTY (insert only, no submit)
      await fetch(`${bridgeUrl}/sessions/${encodeURIComponent(sessionName)}/input`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: `[Screenshot: screenshots/${filename}]` }),
      });

      // Show success toast
      setScreenshotToast({ filename, previewUrl, status: 'done' });
      terminalHandleRef.current?.focus();

      // Keep toast for minimum 2 seconds from when it first appeared
      const elapsed = Date.now() - showTime;
      const remaining = Math.max(2000 - elapsed, 500);

      if (screenshotToastTimerRef.current) clearTimeout(screenshotToastTimerRef.current);
      screenshotToastTimerRef.current = setTimeout(() => {
        setScreenshotToast(null);
        URL.revokeObjectURL(previewUrl);
        imagePasteInProgressRef.current = false;
      }, remaining);
    } catch {
      setScreenshotToast({ filename: '', previewUrl, status: 'error', message: 'Network error' });
      imagePasteInProgressRef.current = false;
    }
  }, [bridgeUrl, sessionName]);

  const connectToSession = () => {
    setShowTerminal(true);
    setTerminalKey((k) => k + 1);
  };

  // Send command to active terminal
  const sendCommand = async (action: { id: string; label: string; command: string; description?: string }, submit: boolean = true) => {
    try {
      let command = action.command;
      // For context-priming, append card areas if available
      if (action.id === 'context' && cardAreas.length > 0) {
        command = `${action.command} ${cardAreas.join(' ')}`;
      }
      // For show-card, append the card ID
      if (action.id === 'show-card' && cardId) {
        command = `${action.command} ${cardId}`;
      }
      setShowActionsMenu(false);
      // Send command text first
      await fetch(`${bridgeUrl}/sessions/${encodeURIComponent(sessionName)}/input`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: command }),
      });
      // Then send Enter separately if submitting
      // Delay before Enter — multi-line pastes trigger bracket paste mode
      // and need time to process before \r can submit
      if (submit) {
        await new Promise(r => setTimeout(r, 600));
        await fetch(`${bridgeUrl}/sessions/${encodeURIComponent(sessionName)}/input`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ data: '\r' }),
        });
      }
      terminalHandleRef.current?.focus();
    } catch (err) {
      console.error('Failed to send command:', err);
    }
  };

  // Toolbar commands — render the prompt with context
  const renderedActiveCommands = toolbarActions.map(cmd => ({
    id: cmd.id,
    label: cmd.label,
    command: renderTemplate(cmd.prompt, context as unknown as Record<string, unknown>),
    description: cmd.description,
  }));

  return (
    <div className={`relative flex h-full flex-col overflow-hidden ${className}`}>
      {/* Terminal area */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-[#222228] dark:bg-[#1a1a1a]">
        {showTerminal && isRunning ? (
          <div className="flex-1 overflow-hidden" data-terminal-id={voiceTerminalId || sessionName}>
            <Terminal
              key={terminalKey}
              sessionName={sessionName}
              bridgeUrl={bridgeUrl}
              tintColor={tintColor}
              onConnectionChange={handleConnectionChange}
              onSessionExit={handleSessionExit}
              onReady={(handle) => { terminalHandleRef.current = handle; handle.focus(); onTerminalReady?.(handle); }}
              onImagePaste={handleImagePaste}
            />
          </div>
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-4 text-void-400">
            {isRunning ? (
              <>
                <div className="text-lg">Session Running</div>
                {sessionInfo?.provider && (
                  <span className="text-xs text-void-500">
                    {providersData?.providers[sessionInfo.provider]?.displayName || sessionInfo.provider}
                  </span>
                )}
                <button
                  onClick={connectToSession}
                  className="rounded-lg border border-neon-blue-400/40 bg-neon-blue-400/15 px-4 py-2 text-sm font-medium text-neon-blue-400 transition-all hover:bg-neon-blue-400/25 hover:shadow-[0_0_12px_rgba(0,191,255,0.3)]"
                >
                  Connect
                </button>
              </>
            ) : showCustomPrompt ? (
              <div className="w-full max-w-md px-4">
                <div className="mb-2 text-sm">Custom prompt:</div>
                <textarea
                  value={customPrompt}
                  onChange={(e) => setCustomPrompt(e.target.value)}
                  placeholder="Describe what you want to do..."
                  rows={4}
                  className="mb-3 w-full rounded border border-void-600 bg-void-800 p-3 text-sm text-void-200 placeholder-void-500 focus:border-neon-blue-400 focus:outline-none"
                  autoFocus
                />
                <div className="flex justify-center gap-2">
                  <button
                    onClick={() => setShowCustomPrompt(false)}
                  className="rounded-lg border border-void-500/40 bg-void-700/50 px-4 py-2 text-sm font-medium text-void-300 transition-all hover:border-void-400/40 hover:bg-void-600/50"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => startSession(null, customPrompt)}
                    disabled={isStarting || !customPrompt.trim()}
                    className="rounded-lg border border-green-400/40 bg-green-400/15 px-4 py-2 text-sm font-medium text-green-400 transition-all hover:bg-green-400/25 hover:shadow-[0_0_12px_rgba(0,230,118,0.3)] disabled:opacity-50"
                  >
                    {isStarting ? 'Starting...' : 'Start'}
                  </button>
                </div>
              </div>
            ) : hasHistory ? (
              <>
                <div className="text-lg">Previous Session Available</div>
                <div className="text-xs text-void-600 font-mono">{cwd}</div>
                <div className="flex flex-wrap justify-center gap-2">
                  <button
                    onClick={() => startSession({ id: 'resume', label: 'Resume', prompt: '' })}
                    disabled={isStarting}
                    className="rounded-lg border border-green-400/40 bg-green-400/15 px-4 py-2 text-sm font-medium text-green-400 transition-all hover:bg-green-400/25 hover:shadow-[0_0_12px_rgba(0,230,118,0.3)] disabled:opacity-50"
                  >
                    {isStarting ? 'Starting...' : 'Resume'}
                  </button>
                  <button
                    onClick={() => {
                      fetch(`${bridgeUrl}/sessions/${encodeURIComponent(sessionName)}?action=delete`, { method: 'DELETE' })
                        .then(() => {
                          setSessionInfo(null);
                          onSessionChange?.(null);
                        })
                        .catch(console.error);
                    }}
                    disabled={isStarting}
                    className="rounded-lg border border-red-400/30 bg-red-400/10 px-4 py-2 text-sm font-medium text-red-400 transition-all hover:bg-red-400/20 hover:shadow-[0_0_12px_rgba(255,59,92,0.3)] disabled:opacity-50"
                  >
                    Reset
                  </button>
                </div>
                <div className="flex flex-wrap justify-center gap-2 mt-2">
                  {startupActions.map((cmd) => (
                    <button
                      key={cmd.id}
                      onClick={() => startSession(cmd)}
                      disabled={isStarting}
                      className="rounded-lg border border-neon-blue-400/30 bg-neon-blue-400/10 px-3 py-1.5 text-xs font-medium text-neon-blue-400 transition-all hover:bg-neon-blue-400/20 hover:shadow-[0_0_8px_rgba(0,191,255,0.2)] disabled:opacity-50"
                    >
                      {cmd.label}
                    </button>
                  ))}
                  <button
                    onClick={() => setShowCustomPrompt(true)}
                    disabled={isStarting}
                    className="rounded-lg border border-void-500/30 bg-void-700/50 px-3 py-1.5 text-xs font-medium text-void-300 transition-all hover:border-neon-blue-400/30 hover:text-neon-blue-400 disabled:opacity-50"
                  >
                    Custom...
                  </button>
                </div>
                {/* Provider selector */}
                {providersData && Object.keys(providersData.providers).length > 1 && (
                  <div className="flex flex-col items-center gap-2 mt-3 pt-3 border-t border-void-700/50">
                    <div className="flex gap-1">
                      {Object.values(providersData.providers).map(p => (
                        <button
                          key={p.id}
                          onClick={() => {
                            setSelectedProvider(p.id);
                            saveProviderDefault(p.id, skipPermissions);
                            onProviderChange?.(p.id);
                          }}
                          className={`rounded-md px-3 py-1 text-xs font-medium transition-all ${
                            selectedProvider === p.id
                              ? 'border border-neon-blue-400/60 bg-neon-blue-400/15 text-neon-blue-400 shadow-[0_0_8px_rgba(0,191,255,0.2)]'
                              : 'border border-void-600 bg-void-800 text-void-400 hover:border-void-500 hover:text-void-300'
                          }`}
                        >
                          {p.displayName}
                        </button>
                      ))}
                    </div>
                    <label className="flex items-center gap-1.5 text-xs text-void-500 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={skipPermissions}
                        onChange={(e) => { setSkipPermissions(e.target.checked); saveProviderDefault(selectedProvider, e.target.checked); }}
                        className="rounded border-void-600"
                      />
                      {providersData.providers[selectedProvider]?.permissions.label || 'Skip permissions'}
                    </label>
                    {instructionFileWarning}
                  </div>
                )}
              </>
            ) : (
              <>
                <div className="text-lg">No Active Session</div>
                <div className="text-xs text-void-600 font-mono">{cwd}</div>
                <div className="flex flex-wrap justify-center gap-2">
                  {startupActions.map((cmd) => (
                    <button
                      key={cmd.id}
                      onClick={() => startSession(cmd)}
                      disabled={isStarting}
                      className="rounded-lg border border-neon-blue-400/40 bg-neon-blue-400/15 px-4 py-2 text-sm font-medium text-neon-blue-400 transition-all hover:bg-neon-blue-400/25 hover:shadow-[0_0_12px_rgba(0,191,255,0.3)] disabled:opacity-50"
                    >
                      {isStarting ? 'Starting...' : cmd.label}
                    </button>
                  ))}
                  <button
                    onClick={() => setShowCustomPrompt(true)}
                    disabled={isStarting}
                    className="rounded-lg border border-void-500/40 bg-void-700/50 px-4 py-2 text-sm font-medium text-void-300 transition-all hover:border-neon-blue-400/30 hover:text-neon-blue-400 disabled:opacity-50"
                  >
                    Custom...
                  </button>
                </div>
                <button
                  onClick={() => startSession()}
                  disabled={isStarting}
                  className="text-sm text-void-500 hover:text-void-300"
                >
                  Start without prompt
                </button>
                {/* Provider selector */}
                {providersData && Object.keys(providersData.providers).length > 1 && (
                  <div className="flex flex-col items-center gap-2 mt-3 pt-3 border-t border-void-700/50">
                    <div className="flex gap-1">
                      {Object.values(providersData.providers).map(p => (
                        <button
                          key={p.id}
                          onClick={() => {
                            setSelectedProvider(p.id);
                            saveProviderDefault(p.id, skipPermissions);
                            onProviderChange?.(p.id);
                          }}
                          className={`rounded-md px-3 py-1 text-xs font-medium transition-all ${
                            selectedProvider === p.id
                              ? 'border border-neon-blue-400/60 bg-neon-blue-400/15 text-neon-blue-400 shadow-[0_0_8px_rgba(0,191,255,0.2)]'
                              : 'border border-void-600 bg-void-800 text-void-400 hover:border-void-500 hover:text-void-300'
                          }`}
                        >
                          {p.displayName}
                        </button>
                      ))}
                    </div>
                    <label className="flex items-center gap-1.5 text-xs text-void-500 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={skipPermissions}
                        onChange={(e) => { setSkipPermissions(e.target.checked); saveProviderDefault(selectedProvider, e.target.checked); }}
                        className="rounded border-void-600"
                      />
                      {providersData.providers[selectedProvider]?.permissions.label || 'Skip permissions'}
                    </label>
                    {instructionFileWarning}
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>

      {/* Screenshot toast */}
      {screenshotToast && (
        <div className="absolute top-3 right-3 z-50 flex items-center gap-2 rounded-lg border border-void-600 bg-void-800/95 px-3 py-2 shadow-(--shadow-overlay) backdrop-blur-sm">
          {/* Thumbnail */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={screenshotToast.previewUrl}
            alt="Screenshot preview"
            className="h-10 w-10 rounded object-cover border border-void-600"
          />
          <div className="flex flex-col gap-0.5">
            {screenshotToast.status === 'uploading' && (
              <div className="flex items-center gap-1.5 text-xs text-neon-blue-400">
                <svg className="h-3 w-3 animate-spin" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Uploading...
              </div>
            )}
            {screenshotToast.status === 'done' && (
              <span className="text-xs text-green-400">
                {screenshotToast.filename}
              </span>
            )}
            {screenshotToast.status === 'error' && (
              <span className="text-xs text-red-400">
                {screenshotToast.message || 'Upload failed'}
              </span>
            )}
          </div>
          <button
            onClick={() => { setScreenshotToast(null); URL.revokeObjectURL(screenshotToast.previewUrl); }}
            className="ml-1 text-void-500 hover:text-void-300"
          >
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}

      {/* Exit output toast — persists after terminal unmounts */}
      {exitToast && (
        <div className="absolute bottom-3 right-3 left-3 z-50 rounded-lg border border-red-500/30 bg-void-800/95 shadow-(--shadow-overlay) backdrop-blur-sm">
          <div className="flex items-start justify-between gap-2 px-3 py-2">
            <div className="flex items-center gap-1.5 text-xs font-medium text-red-400">
              <svg className="h-3.5 w-3.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
              </svg>
              Session exited (code: {exitToast.code})
            </div>
            <button
              onClick={() => setExitToast(null)}
              className="text-void-500 hover:text-void-300 flex-shrink-0"
            >
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          <pre className="max-h-32 overflow-auto px-3 pb-2 text-xs text-void-300 font-mono whitespace-pre-wrap">{exitToast.output}</pre>
        </div>
      )}

      {/* Spawn error toast — shown when session creation fails entirely */}
      {spawnError && (
        <div className="absolute bottom-3 right-3 left-3 z-50 rounded-lg border border-red-500/30 bg-void-800/95 shadow-(--shadow-overlay) backdrop-blur-sm">
          <div className="flex items-start justify-between gap-2 px-3 py-2">
            <div className="flex items-center gap-1.5 text-xs font-medium text-red-400">
              <svg className="h-3.5 w-3.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
              </svg>
              Failed to start session
            </div>
            <button
              onClick={() => setSpawnError(null)}
              className="text-void-500 hover:text-void-300 flex-shrink-0"
            >
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          <pre className="max-h-32 overflow-auto px-3 pb-2 text-xs text-void-300 font-mono whitespace-pre-wrap">{spawnError}</pre>
        </div>
      )}

      {/* Footer controls - only when running */}
      {isRunning && (
        <div className={`flex flex-shrink-0 items-center gap-2 px-3 py-2 ${footerClassName || 'border-t border-void-700 bg-void-800'}`}>
          {/* Active action buttons */}
          {renderedActiveCommands.slice(0, MAX_VISIBLE_ACTIONS).map((action) => (
            <button
              key={action.id}
              onClick={(e) => sendCommand(action, !e.shiftKey)}
              title={action.id === 'context' && cardAreas.length > 0
                ? `${action.description} (${cardAreas.join(', ')}) [Shift+click to insert without submitting]`
                : `${action.description} [Shift+click to insert without submitting]`}
              className="rounded-md border border-neon-blue-400/25 bg-neon-blue-400/10 px-2 py-1 text-xs font-medium text-neon-blue-400 transition-all hover:bg-neon-blue-400/20 hover:border-neon-blue-400/40 hover:shadow-[0_0_8px_rgba(0,191,255,0.15)]"
            >
              {action.label}
            </button>
          ))}
          {/* Overflow menu for additional actions */}
          {renderedActiveCommands.length > MAX_VISIBLE_ACTIONS && (
            <div className="relative" ref={actionsMenuRef}>
              <button
                onClick={() => setShowActionsMenu(!showActionsMenu)}
                className="rounded bg-void-700 px-2 py-1 text-xs font-medium text-void-300 hover:bg-void-600"
              >
                ...
              </button>
              {showActionsMenu && (
                <div className="absolute bottom-full right-0 mb-1 min-w-[120px] rounded-lg border border-void-600 bg-void-800 py-1 shadow-(--shadow-overlay)">
                  {renderedActiveCommands.slice(MAX_VISIBLE_ACTIONS).map((action) => (
                    <button
                      key={action.id}
                      onClick={(e) => sendCommand(action, !e.shiftKey)}
                      className="block w-full px-3 py-1.5 text-left text-xs text-void-300 hover:bg-void-700"
                      title={`${action.description} [Shift+click to insert without submitting]`}
                    >
                      {action.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          {/* Spacer */}
          <div className="flex-1" />
          {/* Provider + Session ID */}
          {sessionInfo?.provider && sessionInfo.provider !== 'claude' && (
            <span className="text-xs text-void-500">
              {providersData?.providers[sessionInfo.provider]?.displayName || sessionInfo.provider}
            </span>
          )}
          {/* Relink button + confirmation */}
          <div className="relative" ref={relinkRef}>
            <button
              onClick={() => setShowRelinkConfirm(true)}
              disabled={isRelinking}
              className="rounded-md border border-void-500/25 bg-void-700/50 px-2 py-1 text-xs font-medium text-void-400 transition-all hover:border-neon-blue-400/30 hover:text-neon-blue-400 hover:bg-neon-blue-400/10 disabled:opacity-50"
              title="Re-detect and link the current session ID"
            >
              {isRelinking ? 'Relinking...' : 'Relink'}
            </button>
            {showRelinkConfirm && (
              <div className="absolute bottom-full right-0 mb-2 w-72 rounded-lg border border-void-600 bg-void-800 p-3 shadow-(--shadow-overlay) z-50">
                <div className="text-xs text-void-300 mb-2">
                  This will link the most recently active session file to this card.
                </div>
                <div className="text-xs text-amber-400/80 mb-3">
                  Make sure you have interacted with this session recently so it has the latest modification time.
                </div>
                <div className="flex justify-end gap-2">
                  <button
                    onClick={() => setShowRelinkConfirm(false)}
                    className="rounded border border-void-600 bg-void-700 px-2 py-1 text-xs text-void-400 hover:text-void-300"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={relinkSession}
                    disabled={isRelinking}
                    className="rounded border border-neon-blue-400/40 bg-neon-blue-400/15 px-2 py-1 text-xs text-neon-blue-400 hover:bg-neon-blue-400/25 disabled:opacity-50"
                  >
                    {isRelinking ? 'Relinking...' : 'Confirm'}
                  </button>
                </div>
              </div>
            )}
          </div>
          {/* Stop button */}
          <button
            onClick={stopSession}
            disabled={isStopping}
            className="flex items-center gap-1 rounded-md border border-red-400/25 bg-red-400/10 px-2 py-1 text-xs font-medium text-red-400 transition-all hover:bg-red-400/20 hover:border-red-400/40 hover:shadow-[0_0_8px_rgba(255,59,92,0.15)] disabled:opacity-50"
          >
            {isStopping && (
              <svg className="h-3 w-3 animate-spin" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            )}
            {isStopping ? 'Stopping' : 'Stop'}
          </button>
        </div>
      )}
    </div>
  );
}
