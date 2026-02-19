'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import type { TerminalClassesConfig, SlyActionsConfig as CommandsConfig, SlyAction as Command, Placement } from '@/lib/types';
import {
  getActionsForClass,
  normalizeActionsConfig,
  type SlyActionsConfig,
} from '@/lib/sly-actions';
import { usePolling } from '@/hooks/usePolling';
import { useVoice } from '@/contexts/VoiceContext';
import { ClaudeTerminalPanel, type TerminalContext } from './ClaudeTerminalPanel';

// Navigation levels
type NavLevel = 'list' | 'edit';

interface NavigationState {
  level: NavLevel;
  commandId: string | null;
}

interface SlyActionConfigModalProps {
  onClose: () => void;
  projectId?: string;
  projectPath?: string;
  actionUpdateCount?: number;
  onShowActionUpdates?: () => void;
}

// Template variables - each inserts a complete block
const TEMPLATE_VARIABLES = [
  {
    key: 'card',
    label: 'Card',
    template: '{{card.title}} [{{card.id}}]\nType: {{card.type}} | Priority: {{card.priority}}\n{{card.description}}',
    color: 'bg-sky-100 text-sky-800 dark:bg-sky-900/50 dark:text-sky-200'
  },
  {
    key: 'project',
    label: 'Project',
    template: '{{project.name}} ({{projectPath}})',
    color: 'bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-200'
  },
  {
    key: 'stage',
    label: 'Stage',
    template: '{{stage}}',
    color: 'bg-purple-100 text-purple-800 dark:bg-purple-900/50 dark:text-purple-200'
  },
  {
    key: 'areas',
    label: 'Areas',
    template: '{{card.areas}}',
    color: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-200'
  },
];

export function SlyActionConfigModal({ onClose, projectId: _projectId = '', projectPath: _projectPath, actionUpdateCount = 0, onShowActionUpdates }: SlyActionConfigModalProps) {
  // Data state
  const [classes, setClasses] = useState<TerminalClassesConfig | null>(null);
  const [commandsConfig, setCommandsConfig] = useState<CommandsConfig | null>(null);
  const [availableProjects, setAvailableProjects] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

  // Assistant terminal state
  const [actionsConfig, setActionsConfig] = useState<SlyActionsConfig | null>(null);
  const [assistantSessionInfo, setAssistantSessionInfo] = useState<{ hasHistory?: boolean } | null>(null);

  // Navigation state
  const [nav, setNav] = useState<NavigationState>({ level: 'list', commandId: null });

  // Tab state for list view
  const [listTab, setListTab] = useState<'commands' | 'classes'>('commands');

  // Assistant state
  const [assistantExpanded, setAssistantExpanded] = useState(false);
  const [wasAssistantExpanded, setWasAssistantExpanded] = useState(false);

  // Refresh counter - increments on each data refresh to force child component remount
  const [refreshKey, setRefreshKey] = useState(0);

  // Voice integration for assistant terminal
  const voice = useVoice();
  const terminalSendInputRef = useRef<((data: string) => void) | null>(null);

  // Track editing state to avoid reloading while user is typing
  const isEditingRef = useRef(false);

  // Command Assistant is global — always runs in the SlyCode root
  const assistantCwd = _projectPath!;
  const assistantSessionName = 'action-assistant:global';

  // Load/refresh data function
  const loadData = useCallback(async (isRefresh = false) => {
    try {
      if (!isRefresh) setLoading(true);
      const [classesRes, commandsRes, dashboardRes, actionsRes] = await Promise.all([
        fetch('/api/terminal-classes'),
        fetch('/api/sly-actions'),
        fetch('/api/dashboard'),
        fetch('/api/sly-actions'),
      ]);

      if (!classesRes.ok || !commandsRes.ok) {
        throw new Error('Failed to load configuration');
      }

      const classesData = await classesRes.json();
      const commandsData = await commandsRes.json();

      // Extract project IDs from dashboard
      if (dashboardRes.ok) {
        const dashboardData = await dashboardRes.json();
        const projectIds = (dashboardData.projects || []).map((p: { id: string }) => p.id);
        setAvailableProjects(projectIds);
      }

      // Load actions for the assistant terminal (normalize Record → array)
      if (actionsRes.ok) {
        setActionsConfig(normalizeActionsConfig(await actionsRes.json()));
      }

      setClasses(classesData);
      setCommandsConfig(commandsData);

      // Increment refresh key to force child components to remount with fresh data
      if (isRefresh) {
        setRefreshKey(k => k + 1);
      }
    } catch (err) {
      if (!isRefresh) {
        setError(err instanceof Error ? err.message : 'Failed to load configuration');
      }
    } finally {
      if (!isRefresh) setLoading(false);
    }
  }, []);

  // Initial load
  useEffect(() => {
    loadData();
  }, [loadData]);

  // Refresh when assistant panel is collapsed (user may have made changes)
  useEffect(() => {
    if (wasAssistantExpanded && !assistantExpanded) {
      // Assistant was just collapsed - refresh data
      loadData(true);
    }
    setWasAssistantExpanded(assistantExpanded);
  }, [assistantExpanded, wasAssistantExpanded, loadData]);

  // Poll for file changes (detects when AI edits files directly)
  // Uses polling instead of SSE to conserve browser connection slots
  const pollCommands = useCallback(async () => {
    if (!isEditingRef.current) {
      loadData(true);
    }
  }, [loadData]);

  usePolling(pollCommands, 5000);

  // Callback for child components to signal editing state
  const setIsEditing = useCallback((editing: boolean) => {
    isEditingRef.current = editing;
  }, []);

  // Save commands config
  const saveCommandsConfig = useCallback(async (config: CommandsConfig) => {
    setSaveStatus('saving');
    try {
      const res = await fetch('/api/sly-actions', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      });

      if (!res.ok) throw new Error('Save failed');

      setCommandsConfig(config);
      setSaveStatus('saved');
      setTimeout(() => setSaveStatus('idle'), 2000);
    } catch {
      setSaveStatus('error');
      setTimeout(() => setSaveStatus('idle'), 3000);
    }
  }, []);

  // Update a single command
  const updateCommand = useCallback((commandId: string, updates: Partial<Command>) => {
    if (!commandsConfig) return;

    const newConfig: CommandsConfig = {
      ...commandsConfig,
      commands: {
        ...commandsConfig.commands,
        [commandId]: {
          ...commandsConfig.commands[commandId],
          ...updates,
        },
      },
    };

    saveCommandsConfig(newConfig);
  }, [commandsConfig, saveCommandsConfig]);

  // Create a new command
  const createCommand = useCallback((newId: string, label: string, group: string) => {
    if (!commandsConfig) return;

    const newConfig: CommandsConfig = {
      ...commandsConfig,
      commands: {
        ...commandsConfig.commands,
        [newId]: {
          label,
          description: 'New command',
          group: group || 'Ungrouped',
          placement: 'both',
          prompt: 'Enter your command prompt here...',
          scope: 'global',
          projects: [],
        },
      },
    };

    saveCommandsConfig(newConfig);
    setNav({ level: 'edit', commandId: newId });
  }, [commandsConfig, saveCommandsConfig]);

  // Delete a command
  const deleteCommand = useCallback((commandId: string) => {
    if (!commandsConfig) return;

    const { [commandId]: _, ...remainingCommands } = commandsConfig.commands;

    // Also remove from all classAssignments
    const newAssignments = Object.fromEntries(
      Object.entries(commandsConfig.classAssignments || {}).map(
        ([cls, ids]) => [cls, ids.filter(id => id !== commandId)]
      )
    );

    const newConfig: CommandsConfig = {
      ...commandsConfig,
      commands: remainingCommands,
      classAssignments: newAssignments,
    };

    saveCommandsConfig(newConfig);
    setNav({ level: 'list', commandId: null });
  }, [commandsConfig, saveCommandsConfig]);

  // Get all existing groups
  const existingGroups = commandsConfig
    ? [...new Set(Object.values(commandsConfig.commands).map(cmd => cmd.group).filter((g): g is string => !!g))].sort()
    : [];

  // Navigation helpers
  const goToEdit = (commandId: string) => setNav({ level: 'edit', commandId });
  const goBack = useCallback(() => {
    setNav({ level: 'list', commandId: null });
  }, []);

  // Get current command being edited
  const currentCommand = nav.commandId && commandsConfig ? commandsConfig.commands[nav.commandId] : null;

  // Handle escape key — registered in capture phase with stopImmediatePropagation
  // so it fires before and blocks bubble-phase handlers (e.g. useKeyboardShortcuts)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;

      // Let Escape pass through to the terminal uninterrupted
      if (assistantExpanded) return;

      e.stopImmediatePropagation();

      if (nav.level !== 'list') {
        goBack();
      } else {
        onClose();
      }
    };

    document.addEventListener('keydown', handleKeyDown, true);
    return () => document.removeEventListener('keydown', handleKeyDown, true);
  }, [nav.level, assistantExpanded, onClose, goBack]);

  // Render header with back button
  const renderHeader = () => {
    let title = 'Sly Actions';
    if (nav.level === 'edit' && currentCommand) {
      title = currentCommand.label;
    }

    return (
      <div className="flex items-center justify-between border-b border-void-200 px-6 py-4 dark:border-void-700">
        <div className="flex items-center gap-3">
          {nav.level !== 'list' && (
            <button
              onClick={goBack}
              className="rounded p-1 hover:bg-void-100 dark:hover:bg-void-700"
            >
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
          )}
          <h2 className="text-lg font-semibold">{title}</h2>
        </div>

        <div className="flex items-center gap-3">
          {saveStatus === 'saving' && (
            <span className="text-sm text-void-500">Saving...</span>
          )}
          {saveStatus === 'saved' && (
            <span className="text-sm text-green-600 dark:text-green-400">Saved</span>
          )}
          {saveStatus === 'error' && (
            <span className="text-sm text-red-600 dark:text-red-400">Save failed</span>
          )}

          {/* Refresh button */}
          <button
            onClick={() => loadData(true)}
            className="rounded p-1 hover:bg-void-100 dark:hover:bg-void-700"
            title="Refresh commands"
          >
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          </button>

          <button
            onClick={onClose}
            className="rounded p-1 hover:bg-void-100 dark:hover:bg-void-700"
          >
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>
    );
  };

  // Render content based on navigation level
  const renderContent = () => {
    if (loading) {
      return (
        <div className="flex h-full items-center justify-center">
          <span className="text-void-500">Loading configuration...</span>
        </div>
      );
    }

    if (error) {
      return (
        <div className="flex h-full items-center justify-center">
          <span className="text-red-500">{error}</span>
        </div>
      );
    }

    if (!commandsConfig || !classes) {
      return (
        <div className="flex h-full items-center justify-center">
          <span className="text-void-500">No configuration found</span>
        </div>
      );
    }

    switch (nav.level) {
      case 'list':
        return (
          <div className="flex flex-col h-full">
            {/* Tab bar */}
            <div className="flex border-b border-void-200 dark:border-void-700 px-6">
              <button
                onClick={() => setListTab('commands')}
                className={`px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
                  listTab === 'commands'
                    ? 'border-blue-500 text-blue-600 dark:text-blue-400'
                    : 'border-transparent text-void-500 hover:text-void-700 dark:hover:text-void-300'
                }`}
              >
                Commands
              </button>
              <button
                onClick={() => setListTab('classes')}
                className={`px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
                  listTab === 'classes'
                    ? 'border-blue-500 text-blue-600 dark:text-blue-400'
                    : 'border-transparent text-void-500 hover:text-void-700 dark:hover:text-void-300'
                }`}
              >
                Classes
              </button>
              {actionUpdateCount > 0 && onShowActionUpdates && (
                <button
                  onClick={onShowActionUpdates}
                  className="ml-auto px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors border-transparent text-neon-blue-500 hover:text-neon-blue-400 flex items-center gap-1.5"
                >
                  Updates
                  <span className="flex h-5 min-w-[20px] items-center justify-center rounded-full bg-neon-blue-500 px-1.5 text-[11px] font-bold text-white">
                    {actionUpdateCount}
                  </span>
                </button>
              )}
            </div>

            {/* Tab content */}
            <div className="flex-1 overflow-y-auto">
              {listTab === 'commands' ? (
                <CommandsTable
                  commands={commandsConfig.commands}
                  onSelectCommand={goToEdit}
                  onCreateCommand={createCommand}
                  existingGroups={existingGroups}
                />
              ) : (
                <ClassAssignments
                  commands={commandsConfig.commands}
                  classAssignments={commandsConfig.classAssignments || {}}
                  classes={classes}
                  onUpdate={(newAssignments) => {
                    saveCommandsConfig({
                      ...commandsConfig,
                      classAssignments: newAssignments,
                    });
                  }}
                />
              )}
            </div>
          </div>
        );
      case 'edit':
        return nav.commandId && currentCommand ? (
          <CommandEdit
            key={`${nav.commandId}-${refreshKey}`}
            commandId={nav.commandId}
            command={currentCommand}
            existingGroups={existingGroups}
            availableProjects={availableProjects}
            onUpdate={(updates) => updateCommand(nav.commandId!, updates)}
            onDelete={() => deleteCommand(nav.commandId!)}
            onEditingChange={setIsEditing}
          />
        ) : null;
    }
  };

  // Terminal context for assistant — no context block (reads its own context file)
  const terminalContext: TerminalContext = {
    project: { name: 'SlyCode' },
    projectPath: assistantCwd,
  };

  // Terminal class for assistant
  const assistantTerminalClass = 'action-assistant' as const;

  // Filter commands for the command assistant using unified system
  const assistantActions = actionsConfig
    ? getActionsForClass(
        actionsConfig.commands,
        actionsConfig.classAssignments,
        assistantTerminalClass,
      )
    : [];

  // Render assistant panel with actual terminal
  const renderAssistantPanel = () => (
    <div
      className={`border-t border-void-200 dark:border-void-700 transition-all duration-300 ${
        assistantExpanded ? 'h-[60%]' : 'h-12'
      }`}
    >
      <button
        onClick={() => setAssistantExpanded(!assistantExpanded)}
        className="flex w-full items-center justify-between px-6 py-3 hover:bg-void-50 dark:hover:bg-void-800"
      >
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">Action Assistant</span>
          <span className="text-xs text-void-400">(Terminal for configuring actions)</span>
        </div>
        <svg
          className={`h-4 w-4 transition-transform ${assistantExpanded ? 'rotate-180' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
        </svg>
      </button>

      {assistantExpanded && actionsConfig && (
        <div className="h-[calc(100%-48px)] overflow-hidden">
          <ClaudeTerminalPanel
            sessionName={assistantSessionName}
            cwd={assistantCwd}
            actionsConfig={actionsConfig}
            actions={assistantActions}
            context={terminalContext}
            onSessionChange={(info) => setAssistantSessionInfo(info ? { hasHistory: info.hasHistory } : null)}
            voiceTerminalId="action-assistant"
            onTerminalReady={(handle) => {
              terminalSendInputRef.current = handle?.sendInput ?? null;
              if (handle) { voice.registerTerminal('action-assistant', handle); }
              else { voice.unregisterTerminal('action-assistant'); }
            }}
          />
        </div>
      )}
    </div>
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={(e) => {
        // Click outside modal closes everything (unless voice is busy on the assistant terminal)
        if (e.target === e.currentTarget) {
          const busy = voice.voiceState !== 'idle' && voice.voiceState !== 'disabled';
          if (busy) return;
          onClose();
        }
      }}
    >
      <div
        className="flex h-[90vh] w-[90vw] max-w-5xl flex-col overflow-hidden rounded-xl bg-white shadow-(--shadow-overlay) dark:bg-void-900"
        onClick={(e) => e.stopPropagation()}
      >
        {renderHeader()}

        <div className="relative flex-1 overflow-hidden">
          <div className={`h-full overflow-y-auto ${assistantExpanded ? 'opacity-30 pointer-events-none' : ''}`}>
            {renderContent()}
          </div>

          {assistantExpanded && (
            <div
              className="absolute inset-0"
              onClick={() => setAssistantExpanded(false)}
            />
          )}
        </div>

        {renderAssistantPanel()}
      </div>
    </div>
  );
}

// ============================================================================
// Level 1: Commands Table
// ============================================================================

interface CommandsTableProps {
  commands: Record<string, Command>;
  onSelectCommand: (commandId: string) => void;
  onCreateCommand: (id: string, label: string, group: string) => void;
  existingGroups: string[];
}

const PLACEMENT_LABELS: Record<string, { label: string; color: string }> = {
  startup: { label: 'Startup', color: 'bg-sky-100 text-sky-800 dark:bg-sky-900/50 dark:text-sky-200' },
  toolbar: { label: 'Toolbar', color: 'bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-200' },
  both: { label: 'Both', color: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-200' },
};

function CommandsTable({ commands, onSelectCommand, onCreateCommand, existingGroups }: CommandsTableProps) {
  const commandEntries = Object.entries(commands);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [showNewCommand, setShowNewCommand] = useState(false);
  const [newCommandId, setNewCommandId] = useState('');
  const [newCommandLabel, setNewCommandLabel] = useState('');
  const [newCommandGroup, setNewCommandGroup] = useState('');

  const groupedCommands = commandEntries.reduce((acc, [id, cmd]) => {
    const group = cmd.group || 'Ungrouped';
    if (!acc[group]) acc[group] = [];
    acc[group].push([id, cmd] as [string, Command]);
    return acc;
  }, {} as Record<string, [string, Command][]>);

  Object.values(groupedCommands).forEach(cmds => {
    cmds.sort((a, b) => a[1].label.localeCompare(b[1].label));
  });

  const sortedGroups = Object.keys(groupedCommands).sort((a, b) => {
    if (a === 'Ungrouped') return 1;
    if (b === 'Ungrouped') return -1;
    return a.localeCompare(b);
  });

  const toggleGroup = (group: string) => {
    setCollapsedGroups(prev => {
      const next = new Set(prev);
      if (next.has(group)) next.delete(group);
      else next.add(group);
      return next;
    });
  };

  const handleCreateCommand = () => {
    if (!newCommandId.trim() || !newCommandLabel.trim()) return;
    onCreateCommand(newCommandId.trim(), newCommandLabel.trim(), newCommandGroup.trim());
    setShowNewCommand(false);
    setNewCommandId('');
    setNewCommandLabel('');
    setNewCommandGroup('');
  };

  return (
    <div className="p-6">
      {sortedGroups.map((group) => {
        const cmds = groupedCommands[group];
        const isCollapsed = collapsedGroups.has(group);

        return (
          <div key={group} className="mb-4">
            <button
              onClick={() => toggleGroup(group)}
              className="flex items-center gap-2 w-full text-left py-2 px-3 bg-void-100 dark:bg-void-800 rounded-t-lg hover:bg-void-200 dark:hover:bg-void-700"
            >
              <svg
                className={`h-4 w-4 transition-transform ${isCollapsed ? '' : 'rotate-90'}`}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
              <span className="font-medium text-sm">{group}</span>
              <span className="text-xs text-void-500">({cmds.length})</span>
            </button>

            {!isCollapsed && (
              <table className="w-full border border-t-0 border-void-200 dark:border-void-700 rounded-b-lg overflow-hidden">
                <thead>
                  <tr className="border-b border-void-200 text-left text-xs text-void-500 dark:border-void-700 bg-void-50 dark:bg-void-800/50">
                    <th className="py-2 px-3 font-medium">Name</th>
                    <th className="py-2 px-3 font-medium">Label</th>
                    <th className="py-2 px-3 font-medium">Placement</th>
                    <th className="py-2 px-3 w-8"></th>
                  </tr>
                </thead>
                <tbody>
                  {cmds.map(([id, cmd]) => {
                    const pl = PLACEMENT_LABELS[cmd.placement] || PLACEMENT_LABELS.both;
                    return (
                      <tr
                        key={id}
                        onClick={() => onSelectCommand(id)}
                        className="cursor-pointer border-b border-void-100 hover:bg-void-50 dark:border-void-800 dark:hover:bg-void-800 last:border-b-0"
                      >
                        <td className="py-2 px-3 font-mono text-xs">{id}</td>
                        <td className="py-2 px-3 text-sm relative group">
                          {cmd.label}
                          {cmd.description && (
                            <div className="absolute left-0 top-full z-50 mt-1 hidden w-64 rounded-md bg-void-800 px-3 py-2 text-xs text-void-100 shadow-(--shadow-overlay) group-hover:block dark:bg-void-700">
                              {cmd.description}
                            </div>
                          )}
                        </td>
                        <td className="py-2 px-3">
                          <span className={`rounded-full px-1.5 py-0.5 text-xs ${pl.color}`}>
                            {pl.label}
                          </span>
                        </td>
                        <td className="py-2 px-3 text-right">
                          <svg className="inline h-3 w-3 text-void-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                          </svg>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        );
      })}

      {showNewCommand ? (
        <div className="mt-4 p-4 border border-void-300 dark:border-void-600 rounded-lg bg-void-50 dark:bg-void-800">
          <h3 className="text-sm font-medium mb-3">Create New Command</h3>
          <div className="flex gap-3 mb-3">
            <div className="flex-1">
              <label className="block text-xs text-void-500 mb-1">Command ID</label>
              <input
                type="text"
                value={newCommandId}
                onChange={(e) => setNewCommandId(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'))}
                placeholder="my-command"
                className="w-full rounded border border-void-300 px-2 py-1.5 text-sm font-mono dark:border-void-600 dark:bg-void-700"
                data-voice-target
                autoFocus
              />
            </div>
            <div className="flex-1">
              <label className="block text-xs text-void-500 mb-1">Label</label>
              <input
                type="text"
                value={newCommandLabel}
                onChange={(e) => setNewCommandLabel(e.target.value)}
                placeholder="My Command"
                className="w-full rounded border border-void-300 px-2 py-1.5 text-sm dark:border-void-600 dark:bg-void-700"
                data-voice-target
              />
            </div>
            <div className="w-40">
              <label className="block text-xs text-void-500 mb-1">Group</label>
              <select
                value={newCommandGroup}
                onChange={(e) => setNewCommandGroup(e.target.value)}
                className="w-full rounded border border-void-300 px-2 py-1.5 text-sm dark:border-void-600 dark:bg-void-700"
              >
                <option value="">Ungrouped</option>
                {existingGroups.map(g => (
                  <option key={g} value={g}>{g}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <button
              onClick={() => setShowNewCommand(false)}
              className="rounded px-3 py-1.5 text-sm hover:bg-void-200 dark:hover:bg-void-600"
            >
              Cancel
            </button>
            <button
              onClick={handleCreateCommand}
              disabled={!newCommandId.trim() || !newCommandLabel.trim()}
              className="rounded bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              Create
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-4 flex justify-end">
          <button
            onClick={() => setShowNewCommand(true)}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            + New Command
          </button>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Classes Tab: Per-class ordered command assignments
// ============================================================================

interface ClassAssignmentsProps {
  commands: Record<string, Command>;
  classAssignments: Record<string, string[]>;
  classes: TerminalClassesConfig;
  onUpdate: (newAssignments: Record<string, string[]>) => void;
}

function ClassAssignments({ commands, classAssignments, classes, onUpdate }: ClassAssignmentsProps) {
  const [expandedClass, setExpandedClass] = useState<string | null>(null);
  const [addingTo, setAddingTo] = useState<string | null>(null);
  const [dragState, setDragState] = useState<{ classId: string; fromIndex: number } | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  const allCommandIds = Object.keys(commands);

  const moveCommand = (classId: string, fromIndex: number, toIndex: number) => {
    const list = [...(classAssignments[classId] || [])];
    const [moved] = list.splice(fromIndex, 1);
    list.splice(toIndex, 0, moved);
    onUpdate({ ...classAssignments, [classId]: list });
  };

  const removeCommand = (classId: string, commandId: string) => {
    const list = (classAssignments[classId] || []).filter(id => id !== commandId);
    onUpdate({ ...classAssignments, [classId]: list });
  };

  const addCommand = (classId: string, commandId: string) => {
    const list = [...(classAssignments[classId] || []), commandId];
    onUpdate({ ...classAssignments, [classId]: list });
    setAddingTo(null);
  };

  const handleDragStart = (classId: string, index: number) => {
    setDragState({ classId, fromIndex: index });
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    setDragOverIndex(index);
  };

  const handleDrop = (classId: string, toIndex: number) => {
    if (dragState && dragState.classId === classId) {
      moveCommand(classId, dragState.fromIndex, toIndex);
    }
    setDragState(null);
    setDragOverIndex(null);
  };

  const handleDragEnd = () => {
    setDragState(null);
    setDragOverIndex(null);
  };

  return (
    <div className="p-6 space-y-3">
      <p className="text-xs text-void-400 mb-4">
        Assign commands to terminal classes and drag to reorder. The order here determines the button order in the UI.
      </p>

      {classes.classes.map((cls) => {
        const assigned = classAssignments[cls.id] || [];
        const isExpanded = expandedClass === cls.id;
        const unassigned = allCommandIds.filter(id => !assigned.includes(id));

        return (
          <div key={cls.id} className="border border-void-200 dark:border-void-700 rounded-lg overflow-hidden">
            {/* Accordion header */}
            <button
              onClick={() => setExpandedClass(isExpanded ? null : cls.id)}
              className="flex items-center justify-between w-full px-4 py-3 bg-void-50 dark:bg-void-800 hover:bg-void-100 dark:hover:bg-void-700 text-left"
            >
              <div className="flex items-center gap-2">
                <svg
                  className={`h-4 w-4 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
                <span className="font-medium text-sm">{cls.name}</span>
                <span className="text-xs text-void-400 font-mono">({cls.id})</span>
              </div>
              <span className="text-xs text-void-500">
                {assigned.length} command{assigned.length !== 1 ? 's' : ''}
              </span>
            </button>

            {/* Expanded content */}
            {isExpanded && (
              <div className="border-t border-void-200 dark:border-void-700">
                {assigned.length === 0 ? (
                  <div className="px-4 py-3 text-sm text-void-400 italic">
                    No commands assigned
                  </div>
                ) : (
                  <ul className="divide-y divide-void-100 dark:divide-void-800">
                    {assigned.map((cmdId, index) => {
                      const cmd = commands[cmdId];
                      const isDragging = dragState?.classId === cls.id && dragState.fromIndex === index;
                      const isDragOver = dragState?.classId === cls.id && dragOverIndex === index;

                      return (
                        <li
                          key={cmdId}
                          draggable
                          onDragStart={() => handleDragStart(cls.id, index)}
                          onDragOver={(e) => handleDragOver(e, index)}
                          onDrop={() => handleDrop(cls.id, index)}
                          onDragEnd={handleDragEnd}
                          className={`flex items-center gap-2 px-4 py-2 text-sm ${
                            isDragging ? 'opacity-30' : ''
                          } ${isDragOver ? 'bg-blue-50 dark:bg-blue-900/20' : 'hover:bg-void-50 dark:hover:bg-void-800'}`}
                        >
                          {/* Drag handle */}
                          <span className="cursor-grab text-void-400 hover:text-void-600 dark:hover:text-void-300 select-none">
                            <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24">
                              <circle cx="9" cy="6" r="1.5" />
                              <circle cx="15" cy="6" r="1.5" />
                              <circle cx="9" cy="12" r="1.5" />
                              <circle cx="15" cy="12" r="1.5" />
                              <circle cx="9" cy="18" r="1.5" />
                              <circle cx="15" cy="18" r="1.5" />
                            </svg>
                          </span>

                          {/* Order number */}
                          <span className="text-xs text-void-400 w-5 text-right">{index + 1}.</span>

                          {/* Command info */}
                          <span className="font-mono text-xs text-void-500">{cmdId}</span>
                          <span className="text-void-300 dark:text-void-600">-</span>
                          <span className="flex-1 truncate">{cmd?.label || cmdId}</span>

                          {/* Placement badge */}
                          {cmd && (
                            <span className={`rounded-full px-1.5 py-0.5 text-xs ${
                              (PLACEMENT_LABELS[cmd.placement] || PLACEMENT_LABELS.both).color
                            }`}>
                              {(PLACEMENT_LABELS[cmd.placement] || PLACEMENT_LABELS.both).label}
                            </span>
                          )}

                          {/* Remove button */}
                          <button
                            onClick={() => removeCommand(cls.id, cmdId)}
                            className="rounded p-0.5 text-void-400 hover:bg-red-100 hover:text-red-600 dark:hover:bg-red-900/30 dark:hover:text-red-400"
                            title="Remove from this class"
                          >
                            <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}

                {/* Add command dropdown */}
                <div className="px-4 py-2 border-t border-void-100 dark:border-void-800">
                  {addingTo === cls.id ? (
                    <div className="flex items-center gap-2">
                      <select
                        autoFocus
                        defaultValue=""
                        onChange={(e) => {
                          if (e.target.value) addCommand(cls.id, e.target.value);
                        }}
                        onBlur={() => setAddingTo(null)}
                        className="flex-1 rounded border border-void-300 px-2 py-1 text-sm dark:border-void-600 dark:bg-void-800"
                      >
                        <option value="" disabled>Select command...</option>
                        {(() => {
                          const grouped = unassigned.reduce((acc, cmdId) => {
                            const g = commands[cmdId]?.group || 'Ungrouped';
                            if (!acc[g]) acc[g] = [];
                            acc[g].push(cmdId);
                            return acc;
                          }, {} as Record<string, string[]>);
                          const sortedGroups = Object.keys(grouped).sort((a, b) => {
                            if (a === 'Ungrouped') return 1;
                            if (b === 'Ungrouped') return -1;
                            return a.localeCompare(b);
                          });
                          return sortedGroups.map(g => (
                            <optgroup key={g} label={g}>
                              {grouped[g].sort((a, b) => (commands[a]?.label || a).localeCompare(commands[b]?.label || b)).map(cmdId => (
                                <option key={cmdId} value={cmdId}>
                                  {commands[cmdId]?.label || cmdId}
                                </option>
                              ))}
                            </optgroup>
                          ));
                        })()}
                      </select>
                      <button
                        onClick={() => setAddingTo(null)}
                        className="text-xs text-void-500 hover:text-void-700 dark:hover:text-void-300"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setAddingTo(cls.id)}
                      disabled={unassigned.length === 0}
                      className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700 dark:text-blue-400 disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                      </svg>
                      Add Command
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ============================================================================
// Level 2: Command Edit
// ============================================================================

interface CommandEditProps {
  commandId: string;
  command: Command;
  existingGroups: string[];
  availableProjects: string[];
  onUpdate: (updates: Partial<Command>) => void;
  onDelete: () => void;
  onEditingChange?: (isEditing: boolean) => void;
}

const PLACEMENT_OPTIONS: { id: Placement; label: string }[] = [
  { id: 'startup', label: 'Startup' },
  { id: 'toolbar', label: 'Toolbar' },
  { id: 'both', label: 'Both' },
];

function CommandEdit({ commandId, command, existingGroups, availableProjects, onUpdate, onDelete, onEditingChange }: CommandEditProps) {
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [label, setLabel] = useState(command.label);
  const [description, setDescription] = useState(command.description);
  const [group, setGroup] = useState(command.group || '');
  const [promptText, setPromptText] = useState(command.prompt);
  const [placement, setPlacement] = useState<Placement>(command.placement || 'both');
  const [scope, setScope] = useState<'global' | 'specific'>(command.scope || 'global');
  const [selectedProjects, setSelectedProjects] = useState<string[]>(command.projects || []);
  const [showGroupDropdown, setShowGroupDropdown] = useState(false);
  const [projectsExpanded, setProjectsExpanded] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Debounced save for metadata + visibility
  useEffect(() => {
    const timer = setTimeout(() => {
      const updates: Partial<Command> = {};
      let changed = false;

      if (label !== command.label) { updates.label = label; changed = true; }
      if (description !== command.description) { updates.description = description; changed = true; }
      if ((group || undefined) !== command.group) { updates.group = group || undefined; changed = true; }
      if (placement !== (command.placement || 'both')) { updates.placement = placement; changed = true; }
      if (scope !== (command.scope || 'global')) { updates.scope = scope; changed = true; }

      const effectiveProjects = scope === 'specific' ? selectedProjects : [];
      if (JSON.stringify(effectiveProjects) !== JSON.stringify(command.projects || [])) {
        updates.projects = effectiveProjects;
        changed = true;
      }

      if (changed) onUpdate(updates);
    }, 500);
    return () => clearTimeout(timer);
  }, [label, description, group, placement, scope, selectedProjects, command, onUpdate]);

  // Debounced save for prompt (separate to avoid cursor jumps)
  useEffect(() => {
    const timer = setTimeout(() => {
      if (promptText !== command.prompt) {
        onUpdate({ prompt: promptText });
      }
    }, 500);
    return () => clearTimeout(timer);
  }, [promptText, command.prompt, onUpdate]);

  // Insert variable template at cursor
  const insertVariable = (template: string) => {
    if (!textareaRef.current) return;

    const textarea = textareaRef.current;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const newText = promptText.substring(0, start) + template + promptText.substring(end);

    setPromptText(newText);

    setTimeout(() => {
      textarea.focus();
      textarea.selectionStart = start + template.length;
      textarea.selectionEnd = start + template.length;
    }, 0);
  };

  const toggleProject = (project: string) => {
    setSelectedProjects((prev) =>
      prev.includes(project)
        ? prev.filter((p) => p !== project)
        : [...prev, project]
    );
  };

  return (
    <div className="p-6 flex flex-col h-full">
      {/* Row 1: Identity */}
      <div className="flex gap-3 mb-3">
        <div className="w-36 flex-shrink-0">
          <label className="block text-xs font-medium text-void-500 mb-1">Name</label>
          <input
            type="text"
            value={commandId}
            readOnly
            className="w-full rounded border border-void-300 bg-void-50 px-2 py-1.5 font-mono text-sm dark:border-void-600 dark:bg-void-800"
          />
        </div>
        <div className="w-32 flex-shrink-0">
          <label className="block text-xs font-medium text-void-500 mb-1">Label</label>
          <input
            type="text"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            onFocus={() => onEditingChange?.(true)}
            onBlur={() => onEditingChange?.(false)}
            className="w-full rounded border border-void-300 px-2 py-1.5 text-sm dark:border-void-600 dark:bg-void-800"
            data-voice-target
          />
        </div>
        <div className="w-36 flex-shrink-0 relative">
          <label className="block text-xs font-medium text-void-500 mb-1">Group</label>
          <input
            type="text"
            value={group}
            onChange={(e) => setGroup(e.target.value)}
            onFocus={() => { setShowGroupDropdown(true); onEditingChange?.(true); }}
            onBlur={() => { setTimeout(() => setShowGroupDropdown(false), 150); onEditingChange?.(false); }}
            placeholder="Ungrouped"
            className="w-full rounded border border-void-300 px-2 py-1.5 text-sm dark:border-void-600 dark:bg-void-800"
            data-voice-target
          />
          {showGroupDropdown && existingGroups.length > 0 && (
            <div className="absolute top-full left-0 right-0 mt-1 bg-white dark:bg-void-800 border border-void-300 dark:border-void-600 rounded shadow-(--shadow-overlay) z-10 max-h-32 overflow-y-auto">
              {existingGroups.map((g) => (
                <button
                  key={g}
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    setGroup(g);
                    setShowGroupDropdown(false);
                  }}
                  className="w-full text-left px-2 py-1 text-sm hover:bg-void-100 dark:hover:bg-void-700"
                >
                  {g}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="flex-1">
          <label className="block text-xs font-medium text-void-500 mb-1">Description</label>
          <input
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            onFocus={() => onEditingChange?.(true)}
            onBlur={() => onEditingChange?.(false)}
            className="w-full rounded border border-void-300 px-2 py-1.5 text-sm dark:border-void-600 dark:bg-void-800"
            data-voice-target
          />
        </div>
      </div>

      {/* Row 2: Placement + Scope (compact inline) */}
      <div className="flex items-center gap-4 mb-3 py-2 px-3 rounded-lg bg-void-50 dark:bg-void-800/50 border border-void-100 dark:border-void-700/50">
        {/* Placement toggle group */}
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-void-500 uppercase tracking-wide">Placement</span>
          <div className="flex rounded-md border border-void-200 dark:border-void-600 overflow-hidden">
            {PLACEMENT_OPTIONS.map((opt) => (
              <button
                key={opt.id}
                onClick={() => setPlacement(opt.id)}
                className={`px-2.5 py-1 text-xs font-medium transition-colors ${
                  placement === opt.id
                    ? 'bg-blue-600 text-white'
                    : 'bg-white hover:bg-void-50 dark:bg-void-800 dark:hover:bg-void-700 text-void-600 dark:text-void-300'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {/* Divider */}
        <div className="h-5 w-px bg-void-200 dark:bg-void-600" />

        {/* Scope */}
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-void-500 uppercase tracking-wide">Scope</span>
          <div className="flex rounded-md border border-void-200 dark:border-void-600 overflow-hidden">
            <button
              onClick={() => setScope('global')}
              className={`px-2.5 py-1 text-xs font-medium transition-colors ${
                scope === 'global'
                  ? 'bg-blue-600 text-white'
                  : 'bg-white hover:bg-void-50 dark:bg-void-800 dark:hover:bg-void-700 text-void-600 dark:text-void-300'
              }`}
            >
              All Projects
            </button>
            <button
              onClick={() => setScope('specific')}
              className={`px-2.5 py-1 text-xs font-medium transition-colors ${
                scope === 'specific'
                  ? 'bg-blue-600 text-white'
                  : 'bg-white hover:bg-void-50 dark:bg-void-800 dark:hover:bg-void-700 text-void-600 dark:text-void-300'
              }`}
            >
              Specific
            </button>
          </div>

          {/* Inline project chips when scope is specific */}
          {scope === 'specific' && (
            <>
              <button
                onClick={() => setProjectsExpanded(!projectsExpanded)}
                className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700 dark:text-blue-400"
              >
                {selectedProjects.length > 0
                  ? `${selectedProjects.length} project${selectedProjects.length !== 1 ? 's' : ''}`
                  : 'Select...'}
                <svg
                  className={`h-3 w-3 transition-transform ${projectsExpanded ? 'rotate-180' : ''}`}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>
            </>
          )}
        </div>
      </div>

      {/* Project picker (expands below the row when open) */}
      {scope === 'specific' && projectsExpanded && availableProjects.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-3 -mt-1 px-3">
          {availableProjects.map((project) => (
            <label
              key={project}
              className={`flex items-center gap-1 rounded border px-2 py-0.5 cursor-pointer text-xs ${
                selectedProjects.includes(project)
                  ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                  : 'border-void-200 hover:bg-void-50 dark:border-void-700'
              }`}
            >
              <input
                type="checkbox"
                checked={selectedProjects.includes(project)}
                onChange={() => toggleProject(project)}
                className="h-3 w-3 rounded border-void-300"
              />
              <span>{project}</span>
            </label>
          ))}
        </div>
      )}

      {/* Prompt Template */}
      <div className="flex-1 flex flex-col min-h-0">
        <div className="flex items-center justify-between mb-1">
          <label className="text-xs font-medium text-void-500">Prompt Template</label>
          <div className="flex gap-1.5">
            <span className="text-xs text-void-400 mr-1">Insert:</span>
            {TEMPLATE_VARIABLES.map((v) => (
              <button
                key={v.key}
                onClick={() => insertVariable(v.template)}
                className={`rounded px-2 py-0.5 text-xs font-medium min-w-[60px] ${v.color} hover:opacity-80`}
              >
                {v.label}
              </button>
            ))}
          </div>
        </div>
        <textarea
          ref={textareaRef}
          value={promptText}
          onChange={(e) => setPromptText(e.target.value)}
          onFocus={() => onEditingChange?.(true)}
          onBlur={() => onEditingChange?.(false)}
          className="flex-1 w-full rounded-lg border border-void-300 px-3 py-2 text-sm dark:border-void-600 dark:bg-void-800 resize-none font-mono"
          placeholder="Enter the prompt template for this command..."
          data-voice-target
        />
      </div>

      {/* Delete */}
      <div className="flex justify-end pt-3">
        {showDeleteConfirm ? (
          <div className="flex items-center gap-2">
            <span className="text-sm text-red-600 dark:text-red-400">Delete this command?</span>
            <button
              onClick={() => {
                onDelete();
                setShowDeleteConfirm(false);
              }}
              className="rounded bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700"
            >
              Yes, Delete
            </button>
            <button
              onClick={() => setShowDeleteConfirm(false)}
              className="rounded bg-void-200 px-3 py-1.5 text-sm font-medium text-void-700 hover:bg-void-300 dark:bg-void-700 dark:text-void-200 dark:hover:bg-void-600"
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            onClick={() => setShowDeleteConfirm(true)}
            className="flex items-center gap-1.5 rounded-lg border border-red-300 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-900/20"
          >
            <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
            Delete
          </button>
        )}
      </div>
    </div>
  );
}
