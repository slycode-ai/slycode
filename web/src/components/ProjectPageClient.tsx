'use client';

import { useState, useCallback, useEffect } from 'react';
import type { BridgeStats } from '@/lib/types';
import { usePolling } from '@/hooks/usePolling';
import { GlobalClaudePanel } from './GlobalClaudePanel';
import { useVoice } from '@/contexts/VoiceContext';

interface ProjectPageClientProps {
  projectId: string;
  projectName: string;
  projectDescription: string;
  projectPath: string;
  children: React.ReactNode;
}

export function ProjectPageClient({
  projectId,
  projectName,
  projectDescription,
  projectPath,
  children,
}: ProjectPageClientProps) {
  const [isGlobalActive, setIsGlobalActive] = useState(false);
  const [isProjectGlobalActive, setIsProjectGlobalActive] = useState(false);
  const voice = useVoice();

  // Poll bridge stats for global terminal activity (every 2s)
  const fetchActivity = useCallback(async (signal: AbortSignal) => {
    const projGlobalPattern = new RegExp(`^${projectId}:(?:[^:]+:)?global$`);
    try {
      const res = await fetch('/api/bridge/stats', { signal });
      if (res.ok) {
        const stats: BridgeStats = await res.json();
        const globalSession = stats.sessions.find((s) => s.name === 'global:global' || /^global:[^:]+:global$/.test(s.name));
        const projGlobalSession = stats.sessions.find((s) => projGlobalPattern.test(s.name));
        setIsGlobalActive(globalSession?.isActive ?? false);
        setIsProjectGlobalActive(projGlobalSession?.isActive ?? false);
      }
    } catch {
      // Bridge might not be running
    }
  }, [projectId]);

  usePolling(fetchActivity, 2000);

  // Lock body scroll — project page is a fixed viewport layout
  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = ''; };
  }, []);

  return (
    <div className={`flex h-svh flex-col overflow-hidden bg-void-50 dark:bg-void-950 ${isGlobalActive ? 'active-glow-border-left' : ''}`}>
      {children}

      {/* Global Claude Panel */}
      <GlobalClaudePanel
        projectId={projectId}
        projectName={projectName}
        projectDescription={projectDescription}
        projectPath={projectPath}
        isActive={isProjectGlobalActive}
        voiceTerminalId="project-global"
        onTerminalReady={(handle) => {
          if (handle) voice.registerTerminal('project-global', handle);
          else voice.unregisterTerminal('project-global');
        }}
      />
    </div>
  );
}
