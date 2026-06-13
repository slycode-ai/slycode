'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import dynamic from 'next/dynamic';
import { buildPrompt, renderTemplate, withTimestamp, type SlyActionsConfig, type SlyActionItem } from '@/lib/sly-actions';
import { submitVerified, deliveryFailureMessage, type VerifiedDelivery } from '@/lib/submit-verified';
import { usePolling } from '@/hooks/usePolling';
import { useActionOverflow } from '@/hooks/useActionOverflow';

interface ProviderConfig {
  id: string;
  displayName: string;
  command: string;
  permissions: { flag: string; label: string; default: boolean };
  resume: { supported: boolean };
  model?: {
    flag: string;
    available: Array<{ id: string; label: string; description?: string }>;
  };
}

interface ProviderDefault {
  provider: string;
  skipPermissions: boolean;
  model?: string;
}

interface ProvidersData {
  providers: Record<string, ProviderConfig>;
  // Legacy files may still carry `stages`/`projects` keys — readers ignore them.
  defaults: {
    global: ProviderDefault;
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
  model?: string;
  createdAt?: string;
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
    status?: string;       // normalized text only; empty string when unset
    statusSetAt?: string;  // ISO timestamp; empty string when unset
  };
  stage?: string;
  project?: { name: string; description?: string };
  projectPath?: string;
}

interface ClaudeTerminalPanelProps {
  sessionName: string;
  /**
   * Alternative base session-name prefixes to try when the primary name 404s.
   * Populated by the parent from project.sessionKeyAliases so pre-migration
   * sessions (stored under the legacy project.id form) can still be resolved.
   * Each entry is a base name (without provider segment), same shape as
   * `sessionName`. Provider insertion is applied consistently.
   */
  sessionNameAliases?: string[];
  cwd: string;
  actionsConfig: SlyActionsConfig;
  actions: SlyActionItem[];
  context: TerminalContext;
  bridgeUrl?: string;
  className?: string;
  // For card-specific command modifications
  cardId?: string;
  cardAreas?: string[];
  // Override initial provider (e.g. from detected existing session)
  initialProvider?: string;
  // When true, provider is controlled by parent (pills in CardModal); hide built-in selector
  parentControlsProvider?: boolean;
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
  sessionNameAliases = [],
  cwd,
  actionsConfig,
  actions,
  context,
  bridgeUrl = BRIDGE_API,
  className = '',
  cardId,
  cardAreas = [],
  initialProvider,
  parentControlsProvider,
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

  // Delivery failure toast (feature 070) — shown when a verified prompt
  // submit reports blocked/failed/ambiguous. Also fed by the global
  // 'sly-delivery-failure' event so CardModal/GlobalClaudePanel submit paths
  // surface into the panel (terminal notifications live inside the panel).
  const [deliveryToast, setDeliveryToast] = useState<string | null>(null);

  const sessionInfoRef = useRef(sessionInfo);
  sessionInfoRef.current = sessionInfo;

  // Instruction file check state
  const [instructionFileCheck, setInstructionFileCheck] = useState<{ needed: boolean; targetFile?: string; copySource?: string } | null>(null);
  const [createInstructionFile, setCreateInstructionFile] = useState(true);

  // Build session name with provider segment. Same transform applied to primary
  // and aliases so direct-fetch fallback can try them in order.
  const applyProviderSegment = (base: string): string =>
    base.includes(':card:') || base.endsWith(':global')
      ? base.replace(/:card:/, `:${selectedProvider}:card:`).replace(/:global$/, `:${selectedProvider}:global`)
      : base;
  const sessionName = applyProviderSegment(baseSessionName);
  // Stable key for deps so useCallback doesn't churn when the parent passes a
  // fresh array literal each render.
  const aliasKey = sessionNameAliases.join('|');
  // Full candidate list: primary first, then aliases in order. Deduped.
  const sessionNameCandidates = useMemo(() => {
    const all = [sessionName, ...sessionNameAliases.map(applyProviderSegment)];
    return Array.from(new Set(all));
    // applyProviderSegment closes over selectedProvider; list is recomputed when that changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionName, aliasKey, selectedProvider]);

  // Resolved session name — the first candidate that the bridge actually has.
  // Starts null; set by fetchSessionInfo once we confirm existence. All direct
  // operations (stop, input, image, relink, SSE, delete) use this resolved name
  // so ops land on the legacy-named session if that's where the state lives.
  const [resolvedSessionName, setResolvedSessionName] = useState<string | null>(null);
  // Effective name for operations: resolved if known, else primary.
  const activeSessionName = resolvedSessionName ?? sessionName;

  // Surface delivery failures broadcast by other submit paths (CardModal
  // quick-launch, GlobalClaudePanel) for THIS session as an in-panel toast.
  useEffect(() => {
    const onDeliveryFailure = (e: Event) => {
      const detail = (e as CustomEvent).detail as { sessionName: string; message: string } | undefined;
      if (detail && detail.sessionName === activeSessionName) {
        setDeliveryToast(detail.message);
      }
    };
    window.addEventListener('sly-delivery-failure', onDeliveryFailure);
    return () => window.removeEventListener('sly-delivery-failure', onDeliveryFailure);
  }, [activeSessionName]);

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
          // Seed from the single global default. Provider/permission changes
          // made in this panel are ephemeral — nothing is persisted back.
          const def = data.defaults?.global;
          if (def) {
            // Only override provider selection if no existing session was
            // detected — the session name is keyed on provider, so rewriting
            // the provider under a live session would unlink it.
            if (!initialProvider && !sessionInfoRef.current) {
              setSelectedProvider(def.provider);
            }
            setSkipPermissions(def.skipPermissions);
          }
        }
      })
      .catch(() => { /* providers.json not available, use defaults */ });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync provider from parent when parent controls provider selection (pills in CardModal)
  useEffect(() => {
    if (parentControlsProvider && initialProvider && initialProvider !== selectedProvider) {
      setSelectedProvider(initialProvider);
    }
  }, [parentControlsProvider, initialProvider]);

  // Model to pass on fresh session create: the global default model, and ONLY
  // when the chosen provider is the default provider. A manually-switched
  // provider starts on its own CLI default (no model flag).
  const modelForCreate = (): string | undefined => {
    const def = providersData?.defaults?.global;
    if (def?.model && def.provider === selectedProvider) return def.model;
    return undefined;
  };

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

  // Fetch session info — tries primary sessionName first, then aliases. The
  // first candidate that returns a non-null session wins; resolvedSessionName
  // is updated so subsequent ops (input/stop/image/SSE) use the actual stored
  // name.
  //
  // IMPORTANT: the bridge returns `200 null` (not 404) when a session is
  // missing. Treat null body as "not found" and continue iterating, otherwise
  // we'd never try the alias and existing legacy-id sessions would appear
  // unlinked.
  const fetchSessionInfo = useCallback(async (signal?: AbortSignal) => {
    for (const candidate of sessionNameCandidates) {
      try {
        const res = await fetch(`${bridgeUrl}/sessions/${encodeURIComponent(candidate)}`, { signal });
        if (res.ok) {
          const data = await res.json();
          if (data) {
            setSessionInfo(data);
            setResolvedSessionName(prev => (prev === candidate ? prev : candidate));
            onSessionChangeRef.current?.(data);
            return;
          }
          // 200 with null body — bridge says no such session. Try next alias.
        }
      } catch {
        // Network error — abort. Don't try further candidates; usePolling retries.
        return;
      }
    }
    // None of the candidates existed. Clear sessionInfo and any stale
    // resolution so future fetches start fresh with the primary.
    setSessionInfo(null);
    setResolvedSessionName(null);
    onSessionChangeRef.current?.(null);
  }, [sessionNameCandidates, bridgeUrl]);

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

  // Shared provider selector (eliminates duplication between resume and fresh-start screens).
  // Selections here are ephemeral — the saved default only changes via the
  // top-bar default config (DefaultProviderConfig).
  const renderProviderSelector = () => {
    if (parentControlsProvider) return null;
    if (!providersData || Object.keys(providersData.providers).length <= 1) return null;
    return (
      <div className="flex flex-col items-center gap-2 mt-3 pt-3 border-t border-void-700/50">
        <div className="flex gap-1">
          {Object.values(providersData.providers).map(p => (
            <button
              key={p.id}
              onClick={() => {
                setSelectedProvider(p.id);
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
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-1.5 text-xs text-void-500 cursor-pointer">
            <input
              type="checkbox"
              checked={skipPermissions}
              onChange={(e) => setSkipPermissions(e.target.checked)}
              className="rounded border-void-600"
            />
            {providersData.providers[selectedProvider]?.permissions.label || 'Skip permissions'}
          </label>
        </div>
        {instructionFileWarning}
      </div>
    );
  };

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
        // Free-typed prompt — left unstamped, same as plain Telegram text.
        prompt = buildPrompt(customPromptText, contextObj);
      } else if (command?.prompt) {
        // Sly Action button — prepend the timestamp (slash commands skipped).
        prompt = withTimestamp(buildPrompt(command.prompt, contextObj));
      }

      // For RESUME: use the resolved alias name so the bridge re-attaches to
      // the existing session rather than creating a fresh duplicate under the
      // canonical key. For a truly new session (no resolution), use primary.
      const createName = resolvedSessionName ?? sessionName;
      const res = await fetch(`${bridgeUrl}/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: createName,
          provider: selectedProvider,
          skipPermissions,
          cwd,
          fresh: !hasHistory,
          prompt,
          model: modelForCreate(),
          createInstructionFile: instructionFileCheck?.needed ? createInstructionFile : undefined,
          verifyDelivery: prompt ? true : undefined,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        const delivery = data.delivery as VerifiedDelivery | undefined;
        if (delivery && delivery.outcome !== 'delivered') {
          setDeliveryToast(deliveryFailureMessage(delivery));
        }
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
      const res = await fetch(`${bridgeUrl}/sessions/${encodeURIComponent(activeSessionName)}?action=stop`, {
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
      const res = await fetch(`${bridgeUrl}/sessions/${encodeURIComponent(activeSessionName)}/relink`, {
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

      const res = await fetch(`${bridgeUrl}/sessions/${encodeURIComponent(activeSessionName)}/image`, {
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

      // Inject bracketed reference into PTY (insert only, no submit).
      // Prefer the terminal handle so the insert rides the in-order input
      // queue (feature 071) and can't race concurrent keystrokes.
      const reference = `[Screenshot: screenshots/${filename}]`;
      if (terminalHandleRef.current) {
        terminalHandleRef.current.sendInput(reference);
      } else {
        await fetch(`${bridgeUrl}/sessions/${encodeURIComponent(activeSessionName)}/input`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ data: reference }),
        });
      }

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
  }, [bridgeUrl, activeSessionName]);

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
      // Prepend the timestamp (computed at click time, not render); bare slash
      // commands like /clear and /checkpoint are skipped by withTimestamp.
      command = withTimestamp(command);
      setShowActionsMenu(false);
      if (submit) {
        // Verified delivery (feature 070): the bridge pastes, confirms the
        // command is queued, sends Enter, and verifies the input cleared.
        const delivery = await submitVerified(activeSessionName, command, bridgeUrl);
        if (delivery && delivery.outcome !== 'delivered') {
          setDeliveryToast(deliveryFailureMessage(delivery));
        }
      } else {
        // Insert-only (no submit) — raw input stays raw. Bracketed paste
        // markers keep the TUI buffering the chunked content as one paste.
        await fetch(`${bridgeUrl}/sessions/${encodeURIComponent(activeSessionName)}/input`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ data: `\x1b[200~${command}\x1b[201~` }),
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

  // Dynamic action overflow — measures button widths and available space
  const actionsKey = renderedActiveCommands.map(a => a.label).join('\0');
  const { visibleCount, footerRef, rightControlsRef, measurerRef } = useActionOverflow(actionsKey, isRunning);
  const actualVisible = Math.min(visibleCount, renderedActiveCommands.length);

  // Close overflow menu when visible/overflow split changes (e.g. on resize)
  useEffect(() => {
    setShowActionsMenu(false);
  }, [visibleCount]);

  return (
    <div className={`relative flex h-full flex-col overflow-hidden ${className}`}>
      {/* Terminal area */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-[#222228] dark:bg-[#1a1a1a]">
        {showTerminal && isRunning ? (
          <div className="flex-1 overflow-hidden" data-terminal-id={voiceTerminalId || sessionName}>
            <Terminal
              key={terminalKey}
              sessionName={activeSessionName}
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
                      fetch(`${bridgeUrl}/sessions/${encodeURIComponent(activeSessionName)}?action=delete`, { method: 'DELETE' })
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
                {renderProviderSelector()}
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
                {renderProviderSelector()}
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

      {/* Delivery failure toast (feature 070) — verified submit reported blocked/failed/ambiguous */}
      {deliveryToast && (
        <div className="absolute bottom-3 right-3 left-3 z-50 rounded-lg border border-amber-500/30 bg-void-800/95 shadow-(--shadow-overlay) backdrop-blur-sm">
          <div className="flex items-start justify-between gap-2 px-3 py-2">
            <div className="flex items-center gap-1.5 text-xs font-medium text-amber-400">
              <svg className="h-3.5 w-3.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
              </svg>
              Prompt not confirmed submitted
            </div>
            <button
              onClick={() => setDeliveryToast(null)}
              className="text-void-500 hover:text-void-300 flex-shrink-0"
            >
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          <pre className="max-h-32 overflow-auto px-3 pb-2 text-xs text-void-300 font-mono whitespace-pre-wrap">{deliveryToast}</pre>
        </div>
      )}

      {/* Hidden measurer for action overflow calculation */}
      {isRunning && renderedActiveCommands.length > 0 && (
        <div
          ref={measurerRef}
          aria-hidden="true"
          className="pointer-events-none invisible absolute left-0 top-0"
        >
          {renderedActiveCommands.map((action) => (
            <button
              key={action.id}
              className="rounded-md border border-neon-blue-400/25 bg-neon-blue-400/10 px-2 py-1 text-xs font-medium text-neon-blue-400"
              tabIndex={-1}
            >
              {action.label}
            </button>
          ))}
          <button
            className="rounded bg-void-700 px-2 py-1 text-xs font-medium text-void-300"
            tabIndex={-1}
          >
            ...
          </button>
        </div>
      )}

      {/* Footer controls - only when running */}
      {isRunning && (
        <div ref={footerRef} className={`flex min-w-0 flex-shrink-0 items-center gap-2 px-3 py-2 ${footerClassName || 'border-t border-void-700 bg-void-800'}`}>
          {/* Active action buttons */}
          {renderedActiveCommands.slice(0, actualVisible).map((action) => (
            <button
              key={action.id}
              onClick={(e) => sendCommand(action, !e.shiftKey)}
              title={action.id === 'context' && cardAreas.length > 0
                ? `${action.description} (${cardAreas.join(', ')}) [Shift+click to insert without submitting]`
                : `${action.description} [Shift+click to insert without submitting]`}
              className="flex-shrink-0 whitespace-nowrap rounded-md border border-neon-blue-400/25 bg-neon-blue-400/10 px-2 py-1 text-xs font-medium text-neon-blue-400 transition-all hover:bg-neon-blue-400/20 hover:border-neon-blue-400/40 hover:shadow-[0_0_8px_rgba(0,191,255,0.15)]"
            >
              {action.label}
            </button>
          ))}
          {/* Overflow menu for additional actions */}
          {actualVisible < renderedActiveCommands.length && (
            <div className="relative" ref={actionsMenuRef}>
              <button
                onClick={() => setShowActionsMenu(!showActionsMenu)}
                className="rounded bg-void-700 px-2 py-1 text-xs font-medium text-void-300 hover:bg-void-600"
              >
                ...
              </button>
              {showActionsMenu && (
                <div className="absolute bottom-full right-0 z-10 mb-1 min-w-[120px] rounded-lg border border-void-600 bg-void-800 py-1 shadow-(--shadow-overlay)">
                  {renderedActiveCommands.slice(actualVisible).map((action) => (
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
          {/* Right controls */}
          <div ref={rightControlsRef} className="flex flex-shrink-0 items-center gap-2">
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
        </div>
      )}
    </div>
  );
}
