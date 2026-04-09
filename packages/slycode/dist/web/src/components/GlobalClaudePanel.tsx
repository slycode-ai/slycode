'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import {
  getActionsForClass,
  type TerminalClass,
} from '@/lib/sly-actions';
import { useSlyActionsConfig } from '@/hooks/useSlyActionsConfig';
import { onTerminalPrompt } from '@/lib/terminal-events';
import { ClaudeTerminalPanel, type TerminalContext } from './ClaudeTerminalPanel';
import { BranchTab } from './BranchTab';
import { useVoice } from '@/contexts/VoiceContext';

interface SessionInfo {
  status: 'running' | 'stopped' | 'detached';
  hasHistory?: boolean;
}

interface GlobalClaudePanelProps {
  projectId?: string;
  projectName?: string;
  projectDescription?: string;
  projectPath?: string;
  sessionNameOverride?: string;
  cwdOverride?: string;
  terminalClassOverride?: TerminalClass;
  isActive?: boolean;
  label?: string;
  voiceTerminalId?: string;
  onTerminalReady?: (handle: { sendInput: (data: string) => void } | null) => void;
}

export function GlobalClaudePanel({
  projectId,
  projectName,
  projectDescription,
  projectPath,
  sessionNameOverride,
  cwdOverride,
  terminalClassOverride,
  isActive,
  label,
  voiceTerminalId,
  onTerminalReady,
}: GlobalClaudePanelProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const [sessionInfo, setSessionInfo] = useState<SessionInfo | null>(null);
  const actionsConfig = useSlyActionsConfig();
  const voice = useVoice();
  const [globalProvider, setGlobalProvider] = useState('claude');

  // Fetch global default provider
  useEffect(() => {
    fetch('/api/providers')
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        if (data?.defaults?.global?.provider) {
          setGlobalProvider(data.defaults.global.provider);
        }
      })
      .catch(() => { /* use default */ });
  }, []);

  const resolvedLabel = label || (projectName ? projectName : 'Global Terminal');
  const sessionName = sessionNameOverride || `${projectId}:global`;
  const cwd = cwdOverride || projectPath!;

  const isRunning = sessionInfo?.status === 'running' || sessionInfo?.status === 'detached';

  const terminalClass = terminalClassOverride || 'project-terminal';

  // Get all actions for this terminal class (ordered by classAssignments)
  const actions = getActionsForClass(
    actionsConfig.commands,
    actionsConfig.classAssignments,
    terminalClass,
    { projectId }
  );

  // Build context for prompt templates
  const isGlobalTerminal = terminalClass === 'global-terminal';
  const name = projectName || projectId || 'Global';

  let contextBlock: string;
  if (isGlobalTerminal) {
    const lines = [
      `SlyCode Management Terminal`,
      `Workspace: ${cwd}`,
      '',
      'This is the management terminal for your SlyCode environment. Use it for cross-project searches, questions, and general workspace operations.',
    ];
    contextBlock = lines.join('\n');
  } else {
    const lines = [
      `Project: ${name} (${cwd})`,
    ];
    if (projectDescription) lines.push(`Description: ${projectDescription}`);
    lines.push('');
    lines.push('This is a project-scoped terminal. Use it for:');
    lines.push('- Codebase exploration and analysis');
    lines.push('- Creating and triaging backlog cards');
    lines.push('- Organising and prioritising cards across stages');
    lines.push('- Updating context priming references');
    lines.push('- Project-level debugging and investigation');
    contextBlock = lines.join('\n');
  }

  const terminalContext: TerminalContext = {
    ...(isGlobalTerminal ? { globalContext: contextBlock } : { projectContext: contextBlock }),
    project: { name, description: projectDescription },
    projectPath: cwd,
  };

  // Handle terminal prompt events (from CLI assets: convert, fix, assistant)
  const handleTerminalPrompt = useCallback(async (event: { prompt: string; autoSubmit?: boolean }) => {
    setIsExpanded(true);

    // Build the provider-specific session name (matches ClaudeTerminalPanel logic)
    const providerSessionName = sessionName.endsWith(':global')
      ? sessionName.replace(/:global$/, `:${globalProvider}:global`)
      : sessionName;

    // Always check bridge for actual session status (local state may be stale after refresh/navigation)
    let actuallyRunning = isRunning;
    if (!actuallyRunning) {
      try {
        const statusRes = await fetch(`/api/bridge/sessions/${encodeURIComponent(providerSessionName)}`);
        if (statusRes.ok) {
          const statusData = await statusRes.json();
          if (statusData.status === 'running' || statusData.status === 'detached') {
            actuallyRunning = true;
            setSessionInfo({ status: statusData.status, hasHistory: statusData.hasHistory });
          }
        }
      } catch {
        // Bridge not reachable — fall through to start new session
      }
    }

    if (actuallyRunning) {
      // Session is running — send input directly via bridge API
      try {
        await fetch(`/api/bridge/sessions/${encodeURIComponent(providerSessionName)}/input`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ data: event.prompt }),
        });
        if (event.autoSubmit !== false) {
          // Delay before Enter — multi-line pastes trigger bracket paste mode
          // and need time to process before \r can submit
          await new Promise(r => setTimeout(r, 300));
          await fetch(`/api/bridge/sessions/${encodeURIComponent(providerSessionName)}/input`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ data: '\r' }),
          });
        }
      } catch (err) {
        console.error('Failed to push prompt to terminal:', err);
      }
    } else {
      // No session running — start a new session with the prompt
      try {
        const res = await fetch('/api/bridge/sessions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: providerSessionName,
            provider: globalProvider,
            skipPermissions: true,
            cwd,
            fresh: true,
            prompt: event.prompt,
          }),
        });
        if (res.ok) {
          const data = await res.json();
          setSessionInfo({ status: data.status, hasHistory: data.hasHistory });
        }
      } catch (err) {
        console.error('Failed to start terminal session with prompt:', err);
      }
    }
  }, [isRunning, sessionName, cwd, globalProvider]);

  useEffect(() => {
    return onTerminalPrompt(handleTerminalPrompt);
  }, [handleTerminalPrompt]);

  // Close panel when clicking outside (unless voice is actively recording/transcribing on this terminal)
  const voiceState = voice.voiceState;
  useEffect(() => {
    if (!isExpanded) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        // Don't collapse while voice is busy — text needs to land in this terminal
        const busy = voiceState !== 'idle' && voiceState !== 'disabled';
        if (busy) return;
        setIsExpanded(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isExpanded, voiceState]);

  return (
    <div
      ref={panelRef}
      className={`fixed z-40 transition-all duration-300 ${
        isExpanded ? 'inset-0 h-svh w-screen sm:inset-auto sm:bottom-0 sm:right-4 sm:h-[500px] sm:w-[700px]' : 'bottom-0 right-4 h-12 w-64'
      }`}
    >
      {/* Header bar */}
      <div
        className={`light-clean grain depth-glow flex h-12 cursor-pointer items-center justify-between px-4 transition-all border border-b-0 border-neon-blue-800/60 bg-[#2490b5] text-white/90 dark:border-transparent dark:from-neon-blue-600 dark:via-neon-blue-800/90 dark:to-neon-blue-950/85 dark:text-white ${isExpanded ? 'rounded-none sm:rounded-t-md' : 'rounded-t-md'} ${isActive && !isExpanded ? 'active-glow-global' : ''} ${isExpanded ? 'shadow-[0_-4px_20px_-4px_rgba(0,136,179,0.25)] dark:shadow-[0_-4px_20px_-4px_rgba(0,191,255,0.4)]' : 'shadow-[0_-3px_12px_rgba(0,60,120,0.4),0_-1px_4px_rgba(0,60,120,0.25)] dark:shadow-[0_-3px_12px_rgba(0,0,0,0.7),0_-1px_4px_rgba(0,0,0,0.4)]'}`}
        onClick={() => !isExpanded && setIsExpanded(true)}
      >
        <div className="flex min-w-0 items-center gap-2">
          <div className={`h-2.5 w-2.5 flex-shrink-0 rounded-full ${
            isRunning ? 'bg-green-400 shadow-[0_0_8px_rgba(74,222,128,0.6)]' : 'bg-neon-blue-300 dark:bg-void-400'
          }`} />
          <span className="truncate font-semibold text-black/80 dark:text-white">{resolvedLabel}</span>
        </div>
        <div className="flex items-center gap-2">
          {isRunning && (
            <span className="rounded bg-black/10 px-1.5 py-0.5 text-xs text-neon-blue-950 dark:bg-white/20 dark:text-white">
              {sessionInfo?.status}
            </span>
          )}
          <button
            onClick={(e) => {
              e.stopPropagation();
              setIsExpanded(!isExpanded);
            }}
            className="rounded p-1 hover:bg-black/10 dark:hover:bg-white/20"
          >
            <svg
              className={`h-5 w-5 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
            </svg>
          </button>
        </div>
      </div>

      {/* Expanded panel */}
      {isExpanded && (
        <div className="flex h-[calc(100%-3rem)] flex-col rounded-none sm:rounded-b-md border border-t-0 border-void-700 bg-[#222228] dark:bg-[#1a1a1a] shadow-(--shadow-overlay) overflow-hidden">
          <ClaudeTerminalPanel
            sessionName={sessionName}
            cwd={cwd}
            actionsConfig={actionsConfig}
            actions={actions}
            context={terminalContext}
            initialProvider={globalProvider}
            tintColor="rgba(0, 191, 255, 0.1)"
            voiceTerminalId={voiceTerminalId}
            onSessionChange={(info) => setSessionInfo(info ? { status: info.status, hasHistory: info.hasHistory } : null)}
            onProviderChange={(provider) => setGlobalProvider(provider)}
            onTerminalReady={onTerminalReady}
          />
        </div>
      )}

      {/* Git branch tab - positioned to the left of the panel */}
      {cwd && (
        <BranchTab projectPath={cwd} isTerminalExpanded={isExpanded} />
      )}
    </div>
  );
}
