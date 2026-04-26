'use client';

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useSearchParams, useRouter, usePathname } from 'next/navigation';
import type { ProjectWithBacklog, KanbanCard, KanbanStage, KanbanStages, BridgeStats, Priority, ChangedCard, CardChangeType } from '@/lib/types';
import { connectionManager } from '@/lib/connection-manager';
import { tabSync } from '@/lib/tab-sync';
import { usePolling } from '@/hooks/usePolling';
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts';
import { KanbanColumn } from './KanbanColumn';
import { CardModal } from './CardModal';
import { ConnectionStatusIndicator } from './ConnectionStatusIndicator';
import { AutomationsScreen } from './AutomationsScreen';
import { ContextMenu, type ContextMenuGroup } from './ContextMenu';
import { ConfirmDialog } from './ConfirmDialog';
import { VersionUpdateToast } from './VersionUpdateToast';
import { projectKeyAlternation } from '@/lib/session-keys';

interface SessionInfo {
  name: string;
  status: 'running' | 'stopped' | 'detached';
  hasHistory: boolean;
}

type CardSessionStatus = 'running' | 'detached' | 'resumable' | 'none';

interface ProjectKanbanProps {
  project: ProjectWithBacklog;
  projectPath?: string;
  showArchived?: boolean;
  showAutomations?: boolean;
  onAutomationToggle?: (isAutomation: boolean) => void;
  onActiveAutomationsChange?: (hasActive: boolean) => void;
  onExitMode?: () => void;
  onRefreshReady?: (refresh: () => Promise<void>) => void;
}

const STAGE_ORDER: KanbanStage[] = ['backlog', 'design', 'implementation', 'testing', 'done'];

const STAGE_CONFIG: { id: KanbanStage; label: string; color: string }[] = [
  { id: 'backlog', label: 'Backlog', color: 'zinc' },
  { id: 'design', label: 'Design', color: 'purple' },
  { id: 'implementation', label: 'Implementation', color: 'blue' },
  { id: 'testing', label: 'Testing', color: 'yellow' },
  { id: 'done', label: 'Done', color: 'green' },
];

const EMPTY_STAGES: KanbanStages = {
  backlog: [],
  design: [],
  implementation: [],
  testing: [],
  done: [],
};

// Deep equality check for stages — used by dirty-flag to avoid unnecessary saves
function stagesEqual(a: KanbanStages, b: KanbanStages): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function ProjectKanban({ project, projectPath, showArchived = false, showAutomations = false, onAutomationToggle, onActiveAutomationsChange, onExitMode, onRefreshReady }: ProjectKanbanProps) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const [stages, setStages] = useState<KanbanStages>(EMPTY_STAGES);
  // Store card ID instead of card object - allows deriving fresh data from stages
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);
  const [selectedStage, setSelectedStage] = useState<KanbanStage | null>(null);
  const [isCreatingCard, setIsCreatingCard] = useState(false);
  // Placeholder card for create mode (not yet in stages)
  const [placeholderCard, setPlaceholderCard] = useState<KanbanCard | null>(null);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saved' | 'saving' | 'error'>('idle');
  const [isLoaded, setIsLoaded] = useState(false);
  const [externalUpdate, setExternalUpdate] = useState(false);
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const saveStatusTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const connectionIdRef = useRef<string | null>(null);
  const isSavingRef = useRef(false);
  const lastSaveTimestampRef = useRef<string | null>(null);
  const lastKnownUpdateRef = useRef<string | null>(null);
  const cleanBaselineRef = useRef<KanbanStages>(EMPTY_STAGES);
  const isDirtyRef = useRef(false);
  // Always-current stages ref for use in async callbacks (avoids stale closures)
  const stagesRef = useRef<KanbanStages>(EMPTY_STAGES);
  const [cardSessions, setCardSessions] = useState<Map<string, CardSessionStatus>>(new Map());
  const [activeCards, setActiveCards] = useState<Set<string>>(new Set());
  const prevActiveCardsRef = useRef<Set<string>>(new Set());
  const consumedCardParamRef = useRef<string | null>(null);
  const editedCardIdsRef = useRef<Set<string>>(new Set());
  const movedCardIdsRef = useRef<Set<string>>(new Set());

  // Context menu state
  const [contextMenu, setContextMenu] = useState<{ position: { x: number; y: number }; card: KanbanCard; stage: KanbanStage } | null>(null);
  // Delete confirmation from context menu (separate from modal's delete)
  const [contextDeleteCard, setContextDeleteCard] = useState<KanbanCard | null>(null);
  // Suppress terminal auto-switch when opening from context menu
  const [suppressAutoTerminal, setSuppressAutoTerminal] = useState(false);
  const [triggeringCards, setTriggeringCards] = useState<Set<string>>(new Set());

  // Derive selectedCard from stages - always reflects latest data from SSE/external updates
  // Searches across all stages if card moved externally (e.g., by AI action)
  const selectedCard = useMemo(() => {
    // Create mode uses placeholder card (not yet in stages)
    if (isCreatingCard && placeholderCard) {
      return placeholderCard;
    }
    if (!selectedCardId) return null;

    // Try the expected stage first
    if (selectedStage) {
      const card = stages[selectedStage]?.find((c) => c.id === selectedCardId);
      if (card) return card;
    }

    // Card not in expected stage — search all stages (card was moved externally)
    for (const stage of STAGE_ORDER) {
      const card = stages[stage]?.find((c) => c.id === selectedCardId);
      if (card) return card;
    }

    return null;
  }, [stages, selectedCardId, selectedStage, isCreatingCard, placeholderCard]);

  // Update selectedStage when card is found in a different stage (external move)
  useEffect(() => {
    if (!selectedCardId || !selectedStage || isCreatingCard) return;
    if (stages[selectedStage]?.some((c) => c.id === selectedCardId)) return;
    for (const stage of STAGE_ORDER) {
      if (stages[stage]?.some((c) => c.id === selectedCardId)) {
        setSelectedStage(stage);
        return;
      }
    }
  }, [stages, selectedCardId, selectedStage, isCreatingCard]);

  // Keep stagesRef in sync (for async callbacks that need current value)
  stagesRef.current = stages;

  // Fetch all sessions to determine card status
  const fetchCardSessions = useCallback(async (signal: AbortSignal) => {
    try {
      const res = await fetch('/api/bridge/sessions', { signal });
      if (res.ok) {
        const data = await res.json();
        const sessions: SessionInfo[] = data.sessions || [];
        const statusMap = new Map<string, CardSessionStatus>();

        // Match sessions to cards by pattern: {projectId}:card:{cardId} or {projectId}:{provider}:card:{cardId}
        const cardPattern = new RegExp(`^${project.id}:(?:[^:]+:)?card:(.+)$`);
        for (const session of sessions) {
          const match = session.name.match(cardPattern);
          if (match) {
            const cardId = match[1];
            if (session.status === 'running') {
              statusMap.set(cardId, 'running');
            } else if (session.status === 'detached') {
              statusMap.set(cardId, 'detached');
            } else if (session.hasHistory) {
              statusMap.set(cardId, 'resumable');
            }
          }
        }

        setCardSessions(statusMap);
      }
    } catch {
      // Bridge might not be running
    }
  }, [project.id]);

  // Fetch bridge stats to determine which cards are actively working
  const fetchActiveCards = useCallback(async (signal: AbortSignal) => {
    try {
      const res = await fetch('/api/bridge/stats', { signal });
      if (res.ok) {
        const stats: BridgeStats = await res.json();
        const activeSet = new Set<string>();

        // Match active sessions to cards. Alias-aware (canonical sessionKey +
        // legacy project.id form) and regex-escaped so dots in the project id
        // don't become wildcards.
        const keyAlt = projectKeyAlternation(project);
        const cardPattern = new RegExp(`^(?:${keyAlt}):(?:[^:]+:)?card:(.+)$`);
        for (const session of stats.sessions) {
          if (session.isActive) {
            const match = session.name.match(cardPattern);
            if (match) {
              activeSet.add(match[1]);
            }
          }
        }

        // Log activity transitions (set diff)
        const prev = prevActiveCardsRef.current;
        const added = [...activeSet].filter((id) => !prev.has(id));
        const removed = [...prev].filter((id) => !activeSet.has(id));
        if (added.length > 0) {
          console.log(`[Activity] Cards became active: [${added.join(', ')}]`, stats.sessions.filter((s) => s.isActive));
        }
        if (removed.length > 0) {
          console.log(`[Activity] Cards became inactive: [${removed.join(', ')}]`);
        }
        prevActiveCardsRef.current = activeSet;

        setActiveCards(activeSet);
        // Clear triggering state for cards that are now active
        if (added.length > 0) {
          setTriggeringCards((prev) => {
            const next = new Set(prev);
            let changed = false;
            for (const id of added) {
              if (next.has(id)) { next.delete(id); changed = true; }
            }
            return changed ? next : prev;
          });
        }
      }
    } catch {
      // Bridge might not be running
    }
  }, [project.id]);

  usePolling(fetchCardSessions, 5000);
  usePolling(fetchActiveCards, 2000);

  // Report whether any automation cards are actively working
  useEffect(() => {
    if (!onActiveAutomationsChange) return;
    const automationCardIds = new Set<string>();
    for (const stage of STAGE_ORDER) {
      for (const card of stages[stage]) {
        if (card.automation) automationCardIds.add(card.id);
      }
    }
    const hasActive = [...activeCards].some((id) => automationCardIds.has(id));
    onActiveAutomationsChange(hasActive);
  }, [activeCards, stages, onActiveAutomationsChange]);

  // Load kanban data
  const loadKanban = useCallback(async (checkForChanges = false, signal?: AbortSignal) => {
    // Never overwrite unsaved user changes or in-flight saves
    if (isDirtyRef.current || isSavingRef.current) return;

    try {
      const res = await fetch(`/api/kanban?projectId=${project.id}`, { signal });
      const data = await res.json();

      // If checking for changes, only update if last_updated changed
      if (checkForChanges && lastKnownUpdateRef.current === data.last_updated) {
        return; // No changes
      }

      // Re-check dirty after async fetch — user may have edited during the request
      if (isDirtyRef.current || isSavingRef.current) return;

      lastKnownUpdateRef.current = data.last_updated;
      const loadedStages = data.stages || EMPTY_STAGES;
      setStages(loadedStages);
      cleanBaselineRef.current = loadedStages;
      setExternalUpdate(false);
    } catch {
      // Silently ignore — network errors are expected during sleep/wake
    }
  }, [project.id]);

  // Force refresh — bypasses dirty/saving guards for manual user-initiated reload
  const forceRefresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/kanban?projectId=${project.id}`);
      const data = await res.json();
      lastKnownUpdateRef.current = data.last_updated;
      const loadedStages = data.stages || EMPTY_STAGES;
      setStages(loadedStages);
      cleanBaselineRef.current = loadedStages;
      isDirtyRef.current = false;
      setExternalUpdate(false);
    } catch {
      // Silently ignore
    }
  }, [project.id]);

  // Expose force refresh to parent
  useEffect(() => {
    onRefreshReady?.(forceRefresh);
  }, [forceRefresh, onRefreshReady]);

  // Load kanban data on mount
  useEffect(() => {
    loadKanban().then(() => setIsLoaded(true));
  }, [loadKanban]);

  // Auto-open card from ?card=CARD_ID query param (once)
  useEffect(() => {
    if (!isLoaded) return;
    const cardId = searchParams.get('card');
    if (!cardId || consumedCardParamRef.current === cardId) return;

    // Find card across all stages
    for (const stage of STAGE_ORDER) {
      const card = stages[stage]?.find((c) => c.id === cardId);
      if (card) {
        consumedCardParamRef.current = cardId;
        setSelectedCardId(card.id);
        setSelectedStage(stage);
        break;
      }
    }
  }, [isLoaded, searchParams, stages]);

  // Connect to SSE stream for live updates using ConnectionManager
  useEffect(() => {
    const connectionId = connectionManager.createManagedEventSource(
      `/api/kanban/stream?projectId=${project.id}`,
      {
        update: (event: MessageEvent) => {
          const data = JSON.parse(event.data);

          // Ignore updates from our own saves (within 2 seconds)
          if (lastSaveTimestampRef.current) {
            const saveTime = new Date(lastSaveTimestampRef.current).getTime();
            const updateTime = new Date(data.timestamp).getTime();
            if (updateTime - saveTime < 2000) {
              return;
            }
          }

          // If currently saving, wait for save to complete
          if (isSavingRef.current) {
            return;
          }

          // Don't overwrite unsaved user changes with external data
          if (isDirtyRef.current) {
            return;
          }

          // Show external update indicator and refresh
          setExternalUpdate(true);
          setTimeout(() => setExternalUpdate(false), 3000);
          loadKanban();
        },
        onError: () => {
          // ConnectionManager handles reconnection automatically
        },
      }
    );
    connectionIdRef.current = connectionId;

    return () => {
      if (connectionIdRef.current) {
        connectionManager.closeConnection(connectionIdRef.current);
        connectionIdRef.current = null;
      }
    };
  }, [project.id, loadKanban]);

  // Cross-tab sync — instant updates when another tab saves kanban data
  useEffect(() => {
    const unsub = tabSync.subscribe((message) => {
      if (message.type === 'kanban-update' || message.type === 'kanban-reload') {
        if (!message.projectId || message.projectId === project.id) {
          if (!isSavingRef.current && !isDirtyRef.current) {
            loadKanban();
          }
        }
      }
    });
    return unsub;
  }, [project.id, loadKanban]);

  // Polling fallback - fs.watch can be unreliable on some systems
  const pollKanbanFallback = useCallback(async (signal: AbortSignal) => {
    if (!isSavingRef.current && !isDirtyRef.current) {
      await loadKanban(true, signal);
    }
  }, [loadKanban]);

  usePolling(pollKanbanFallback, 10000);

  // Save stages with debounce
  const saveStages = useCallback(async (stagesToSave: KanbanStages) => {
    setSaveStatus('saving');
    isSavingRef.current = true;
    try {
      // Compute which cards actually changed vs the clean baseline, with typed changeset
      const changedCards: ChangedCard[] = [];
      const baselineCards = new Map<string, string>();
      for (const stage of STAGE_ORDER) {
        for (const card of cleanBaselineRef.current[stage] || []) {
          baselineCards.set(card.id, JSON.stringify(card) + '|' + stage);
        }
      }
      for (const stage of STAGE_ORDER) {
        for (const card of stagesToSave[stage] || []) {
          const baselineKey = baselineCards.get(card.id);
          const currentKey = JSON.stringify(card) + '|' + stage;
          if (baselineKey !== currentKey) {
            if (editedCardIdsRef.current.has(card.id)) {
              changedCards.push({ id: card.id, type: 'edit' }); // Edit wins over move
            } else if (movedCardIdsRef.current.has(card.id)) {
              changedCards.push({ id: card.id, type: 'move' });
            }
            // Untracked divergence (SSE timing, connection issues, normalizeOrder drift)
            // — skip it. The server merge preserves disk truth for cards not in changedCards.
          }
          baselineCards.delete(card.id);
        }
      }
      // Cards in baseline but not in current = deleted
      for (const deletedId of baselineCards.keys()) {
        changedCards.push({ id: deletedId, type: 'delete' });
      }

      // Clear tracking refs after building payload
      editedCardIdsRef.current.clear();
      movedCardIdsRef.current.clear();

      const res = await fetch('/api/kanban', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: project.id, stages: stagesToSave, changedCards }),
      });
      if (res.ok) {
        const data = await res.json();
        lastSaveTimestampRef.current = data.last_updated;
        // Use server's merged+normalized stages as baseline (eliminates normalizeOrder drift)
        const serverStages = data.stages;
        if (serverStages) {
          cleanBaselineRef.current = serverStages;
          // Sync React state with server truth if no new user edits happened during save.
          // Without this, baseline and stages diverge — cards the user never touched appear
          // "changed" in the next save cycle and get reverted to stale frontend positions.
          if (stagesEqual(stagesRef.current, stagesToSave)) {
            setStages(serverStages);
          }
        } else {
          cleanBaselineRef.current = stagesToSave;
        }
        // Only clear dirty if stages haven't changed during the save.
        // If the user made edits while the save was in flight, stay dirty
        // so SSE/polling won't overwrite their pending changes.
        isDirtyRef.current = !stagesEqual(stagesRef.current, cleanBaselineRef.current);
        setSaveStatus('saved');
        // Notify other tabs immediately
        tabSync.broadcast('kanban-update', project.id);
        if (saveStatusTimeoutRef.current) {
          clearTimeout(saveStatusTimeoutRef.current);
        }
        saveStatusTimeoutRef.current = setTimeout(() => {
          setSaveStatus('idle');
        }, 800);
      } else {
        setSaveStatus('error');
      }
    } catch (error) {
      console.error('Failed to save kanban:', error);
      setSaveStatus('error');
    } finally {
      isSavingRef.current = false;
    }
  }, [project.id]);

  // Debounced save when stages change — only if dirty (user-originated changes)
  useEffect(() => {
    if (!isLoaded) return;

    // Skip save if stages match the clean baseline (no user changes)
    if (stagesEqual(stages, cleanBaselineRef.current)) {
      isDirtyRef.current = false;
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
        saveTimeoutRef.current = null;
      }
      return;
    }

    isDirtyRef.current = true;

    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }

    saveTimeoutRef.current = setTimeout(() => {
      saveStages(stages);
    }, 2000);

    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
      if (saveStatusTimeoutRef.current) {
        clearTimeout(saveStatusTimeoutRef.current);
      }
    };
  }, [stages, isLoaded, saveStages]);

  const handleCardClick = (card: KanbanCard, stage: KanbanStage, suppress = false) => {
    setSuppressAutoTerminal(suppress);
    setSelectedCardId(card.id);
    setSelectedStage(stage);
  };

  const handleCloseModal = () => {
    // Flush any pending dirty save immediately on close
    if (!stagesEqual(stages, cleanBaselineRef.current)) {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
        saveTimeoutRef.current = null;
      }
      saveStages(stages);
    }
    setSelectedCardId(null);
    setSelectedStage(null);
    setIsCreatingCard(false);
    setPlaceholderCard(null);

    // Clear ?card= param and reset consumed ref so search can reopen the same card
    consumedCardParamRef.current = null;
    if (searchParams.get('card')) {
      router.replace(pathname, { scroll: false });
    }
  };

  // Open modal in create mode with a placeholder card
  const handleAddCardClick = () => {
    const now = new Date().toISOString();
    const newPlaceholder: KanbanCard = {
      id: `card-${Date.now()}`, // Temporary ID, will be replaced on save
      title: '',
      description: '',
      type: 'feature',
      priority: 'medium',
      areas: [],
      tags: [],
      problems: [],
      checklist: [],
      order: 0,
      created_at: now,
      updated_at: now,
    };
    setPlaceholderCard(newPlaceholder);
    setSelectedCardId(newPlaceholder.id);
    setSelectedStage('backlog');
    setIsCreatingCard(true);
  };

  // Handle creating a new card from the modal
  const handleCreateCard = (cardData: Omit<KanbanCard, 'id' | 'order' | 'created_at' | 'updated_at'>) => {
    const now = new Date().toISOString();
    const newCard: KanbanCard = {
      ...cardData,
      id: `card-${Date.now()}`,
      order: stages.backlog.length > 0
        ? Math.max(...stages.backlog.map((c) => c.order)) + 10
        : 10,
      created_at: now,
      updated_at: now,
    };

    setStages((prev) => ({
      ...prev,
      backlog: [...prev.backlog, newCard],
    }));
  };

  const handleUpdateCard = (updatedCard: KanbanCard) => {
    // In create mode, update placeholder instead of stages
    if (isCreatingCard && placeholderCard && updatedCard.id === placeholderCard.id) {
      setPlaceholderCard(updatedCard);
      return;
    }

    if (!selectedStage) return;

    editedCardIdsRef.current.add(updatedCard.id);

    // Update stages - selectedCard will be automatically derived from the updated stages
    setStages((prev) => ({
      ...prev,
      [selectedStage]: prev[selectedStage].map((c) =>
        c.id === updatedCard.id ? updatedCard : c
      ),
    }));
  };

  const handleDeleteCard = (cardId: string) => {
    if (!selectedStage) return;

    setStages((prev) => ({
      ...prev,
      [selectedStage]: prev[selectedStage].filter((c) => c.id !== cardId),
    }));
    // Close the modal after deletion
    setSelectedCardId(null);
    setSelectedStage(null);
  };

  // Calculate order value for insertion between two cards
  const calculateOrder = (cards: KanbanCard[], insertIndex: number): number => {
    if (cards.length === 0) return 10;
    if (insertIndex === 0) return cards[0].order / 2;
    if (insertIndex >= cards.length) return cards[cards.length - 1].order + 10;

    const before = cards[insertIndex - 1].order;
    const after = cards[insertIndex].order;
    return (before + after) / 2;
  };

  const handleMoveCard = (cardId: string, newStage: KanbanStage, insertIndex?: number) => {
    movedCardIdsRef.current.add(cardId);
    setStages((prev) => {
      // Find which stage the card is currently in
      let sourceStage: KanbanStage | null = null;
      let card: KanbanCard | null = null;

      for (const stage of STAGE_ORDER) {
        const found = prev[stage].find((c) => c.id === cardId);
        if (found) {
          sourceStage = stage;
          card = found;
          break;
        }
      }

      if (!sourceStage || !card) return prev;

      // Remove from source stage
      const newSourceCards = prev[sourceStage].filter((c) => c.id !== cardId);

      // Raw target cards (without the moved card)
      const rawTargetCards = sourceStage === newStage
        ? newSourceCards
        : prev[newStage];

      // Build display-order list matching what KanbanColumn shows (filtered + sorted)
      // insertIndex from KanbanColumn is based on this filtered/sorted view
      const displayCards = [...rawTargetCards]
        .filter((c) => showArchived ? c.archived === true : (!c.archived && !c.automation))
        .sort((a, b) => a.order - b.order);

      // Adjust insertIndex for same-stage moves using display order
      let adjustedIndex = insertIndex ?? displayCards.length;
      if (sourceStage === newStage && insertIndex !== undefined) {
        const sourceDisplayCards = [...prev[sourceStage]]
          .filter((c) => showArchived ? c.archived === true : (!c.archived && !c.automation))
          .sort((a, b) => a.order - b.order);
        const displaySourceIndex = sourceDisplayCards.findIndex((c) => c.id === cardId);
        if (displaySourceIndex !== -1 && displaySourceIndex < insertIndex) {
          adjustedIndex = Math.max(0, insertIndex - 1);
        }
      }

      // Calculate order using display-ordered cards (matches visual positions)
      const newOrder = calculateOrder(displayCards, adjustedIndex);

      const updatedCard = {
        ...card,
        order: newOrder,
        updated_at: new Date().toISOString()
      };

      // Append to the raw array — display sorts by order so array position doesn't matter
      if (sourceStage === newStage) {
        return {
          ...prev,
          [sourceStage]: [...newSourceCards, updatedCard],
        };
      }

      return {
        ...prev,
        [sourceStage]: newSourceCards,
        [newStage]: [...prev[newStage], updatedCard],
      };
    });

    // Update selected card's stage if it was the one moved
    if (selectedCardId === cardId) {
      setSelectedStage(newStage);
    }
  };

  // Context menu handler
  const handleCardContextMenu = useCallback((card: KanbanCard, stage: KanbanStage, e: React.MouseEvent) => {
    e.preventDefault();
    setContextMenu({ position: { x: e.clientX, y: e.clientY }, card, stage });
  }, []);

  const closeContextMenu = useCallback(() => {
    setContextMenu(null);
  }, []);

  // Lane-color accent mapping for context menu
  const stageAccentColors: Record<string, string> = {
    backlog: 'border-t-void-400',
    design: 'border-t-neon-blue-400',
    implementation: 'border-t-neon-blue-500',
    testing: 'border-t-[#ff6a33]',
    done: 'border-t-green-400',
  };

  // Build context menu action groups for kanban board cards
  const buildKanbanMenuGroups = useCallback((card: KanbanCard, stage: KanbanStage): ContextMenuGroup[] => {
    const stages: KanbanStage[] = ['backlog', 'design', 'implementation', 'testing', 'done'];
    const stageLabels: Record<KanbanStage, string> = { backlog: 'Backlog', design: 'Design', implementation: 'Implementation', testing: 'Testing', done: 'Done' };
    const priorities: Priority[] = ['critical', 'high', 'medium', 'low'];
    const priorityLabels: Record<Priority, string> = { critical: 'Critical', high: 'High', medium: 'Medium', low: 'Low' };

    return [
      // Group 1: Properties
      {
        items: [
          {
            label: 'Move to stage',
            items: stages.map((s) => ({
              label: stageLabels[s],
              checked: s === stage,
              disabled: s === stage,
              onClick: () => { handleMoveCard(card.id, s); },
            })),
          },
          {
            label: 'Set priority',
            items: priorities.map((p) => ({
              label: priorityLabels[p],
              checked: p === card.priority,
              disabled: p === card.priority,
              onClick: () => {
                editedCardIdsRef.current.add(card.id);
                setStages((prev) => ({
                  ...prev,
                  [stage]: prev[stage].map((c) =>
                    c.id === card.id ? { ...c, priority: p, updated_at: new Date().toISOString() } : c
                  ),
                }));
              },
            })),
          },
        ],
      },
      // Group 2: Navigation & Clipboard
      {
        items: [
          {
            label: 'Open details',
            onClick: () => { handleCardClick(card, stage, true); },
          },
          {
            label: 'Copy',
            items: [
              { label: 'Card ID', onClick: () => { navigator.clipboard.writeText(card.id); } },
              { label: 'Title', onClick: () => { navigator.clipboard.writeText(card.title); } },
              { label: 'Description', onClick: () => { navigator.clipboard.writeText(card.description || ''); } },
            ],
          },
        ],
      },
      // Group 3: Lifecycle
      {
        items: [
          {
            label: card.automation ? 'Archive (disabled — automation)' : card.archived ? 'Unarchive' : 'Archive',
            disabled: !!card.automation,
            onClick: () => {
              if (card.automation) return;
              editedCardIdsRef.current.add(card.id);
              setStages((prev) => ({
                ...prev,
                [stage]: prev[stage].map((c) =>
                  c.id === card.id ? { ...c, archived: !card.archived, updated_at: new Date().toISOString() } : c
                ),
              }));
            },
          },
          {
            label: 'Delete',
            danger: true,
            onClick: () => {
              setContextDeleteCard(card);
            },
          },
        ],
      },
    ];
  }, [handleMoveCard]);

  // Build context menu action groups for automation cards
  const buildAutomationMenuGroups = useCallback((card: KanbanCard, stage: KanbanStage): ContextMenuGroup[] => {
    const priorities: Priority[] = ['critical', 'high', 'medium', 'low'];
    const priorityLabels: Record<Priority, string> = { critical: 'Critical', high: 'High', medium: 'Medium', low: 'Low' };

    const groups: ContextMenuGroup[] = [
      // Group 1: Properties
      {
        items: [
          {
            label: 'Set priority',
            items: priorities.map((p) => ({
              label: priorityLabels[p],
              checked: p === card.priority,
              disabled: p === card.priority,
              onClick: () => {
                editedCardIdsRef.current.add(card.id);
                setStages((prev) => ({
                  ...prev,
                  [stage]: prev[stage].map((c) =>
                    c.id === card.id ? { ...c, priority: p, updated_at: new Date().toISOString() } : c
                  ),
                }));
              },
            })),
          },
        ],
      },
      // Group 2: Navigation & Clipboard
      {
        items: [
          {
            label: 'Open details',
            onClick: () => { handleCardClick(card, stage, true); },
          },
          {
            label: 'Copy',
            items: [
              { label: 'Card ID', onClick: () => { navigator.clipboard.writeText(card.id); } },
              { label: 'Title', onClick: () => { navigator.clipboard.writeText(card.title); } },
              { label: 'Description', onClick: () => { navigator.clipboard.writeText(card.description || ''); } },
            ],
          },
        ],
      },
      // Group 3: Lifecycle
      {
        items: [
          {
            label: 'Delete',
            danger: true,
            onClick: () => {
              setContextDeleteCard(card);
            },
          },
        ],
      },
    ];

    // Group 4: Automation actions
    if (card.automation) {
      groups.push({
        items: [
          {
            label: card.automation.enabled ? 'Disable' : 'Enable',
            onClick: () => {
              setStages((prev) => ({
                ...prev,
                [stage]: prev[stage].map((c) =>
                  c.id === card.id && c.automation
                    ? { ...c, automation: { ...c.automation, enabled: !c.automation.enabled }, updated_at: new Date().toISOString() }
                    : c
                ),
              }));
            },
          },
          {
            label: 'Run now',
            onClick: () => {
              setTriggeringCards((prev) => new Set(prev).add(card.id));
              fetch('/api/scheduler', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'trigger', cardId: card.id, projectId: project.id }),
              }).catch(() => {
                setTriggeringCards((prev) => { const next = new Set(prev); next.delete(card.id); return next; });
              });
              // Auto-clear after 15s in case activity detection doesn't kick in
              setTimeout(() => {
                setTriggeringCards((prev) => { const next = new Set(prev); next.delete(card.id); return next; });
              }, 15000);
            },
          },
        ],
      });
    }

    return groups;
  }, []);

  // Handle delete from context menu
  const handleContextDelete = useCallback((cardId: string) => {
    // Find which stage the card is in
    for (const stage of STAGE_ORDER) {
      const found = stages[stage].find((c) => c.id === cardId);
      if (found) {
        setStages((prev) => ({
          ...prev,
          [stage]: prev[stage].filter((c) => c.id !== cardId),
        }));
        break;
      }
    }
    setContextDeleteCard(null);
  }, [stages]);

  // Escape: exit archive/automations mode first, then navigate to dashboard
  useKeyboardShortcuts({
    onEscape: () => {
      if ((showArchived || showAutomations) && onExitMode) {
        onExitMode();
      } else {
        router.push('/');
      }
    },
    enabled: !selectedCard,
  });

  if (!isLoaded) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="text-void-500">Loading kanban...</div>
      </div>
    );
  }

  return (
    <div className="relative flex flex-1 flex-col overflow-hidden">
      {/* Connection status indicator - fixed position */}
      <ConnectionStatusIndicator position="top-right" />
      <VersionUpdateToast />

      {/* Save status indicator - absolute positioned */}
      <div className="absolute top-1 right-4 z-10 flex gap-3">
        {externalUpdate && (
          <span className="text-xs text-blue-600 dark:text-blue-400">
            ↻ Updated externally
          </span>
        )}
        <span className={`text-xs transition-opacity ${
          saveStatus === 'idle' ? 'opacity-0 duration-500' :
          saveStatus === 'saved' ? 'opacity-60 text-green-600 dark:text-green-400 duration-500' :
          saveStatus === 'saving' ? 'opacity-60 text-void-500 dark:text-void-400 duration-150' :
          'opacity-100 text-red-600 dark:text-red-400 duration-150'
        }`}>
          {saveStatus === 'saving' ? '●' :
           saveStatus === 'error' ? '✗ Save failed' : '●'}
        </span>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {showAutomations ? (
          /* Automations Screen */
          <AutomationsScreen
            cards={STAGE_ORDER.flatMap((s) => stages[s].filter((c) => !!c.automation && !c.archived))}
            activeCards={activeCards}
            triggeringCards={triggeringCards}
            onCardClick={(card) => {
              // Find the stage the automation card lives in
              const cardStage = STAGE_ORDER.find((s) => stages[s].some((c) => c.id === card.id));
              if (cardStage) handleCardClick(card, cardStage);
            }}
            onCardContextMenu={(card, e) => {
              const cardStage = STAGE_ORDER.find((s) => stages[s].some((c) => c.id === card.id));
              if (cardStage) handleCardContextMenu(card, cardStage, e);
            }}
            onCreateAutomation={() => {
              // Create a new card pre-toggled to automation mode
              const now = new Date().toISOString();
              const newPlaceholder: KanbanCard = {
                id: `card-${Date.now()}`,
                title: '',
                description: '',
                type: 'chore',
                priority: 'medium',
                areas: [],
                tags: [],
                problems: [],
                checklist: [],
                automation: {
                  enabled: false,
                  schedule: '',
                  scheduleType: 'recurring',
                  provider: 'claude',
                  freshSession: false,
                  reportViaMessaging: false,
                },
                created_at: now,
                updated_at: now,
                order: 0,
              };
              setPlaceholderCard(newPlaceholder);
              setSelectedCardId(newPlaceholder.id);
              setSelectedStage('backlog');
              setIsCreatingCard(true);
            }}
          />
        ) : (
          /* Kanban Board */
          <div className="flex-1 overflow-x-auto p-4 pt-2 snap-x snap-mandatory sm:snap-none">
            <div className="mx-auto flex h-full w-full max-w-[1984px] gap-4">
              {STAGE_CONFIG.map((stageConfig) => (
                <KanbanColumn
                  key={stageConfig.id}
                  stage={stageConfig}
                  cards={[...stages[stageConfig.id]]
                    .filter((card) => showArchived ? card.archived === true : (!card.archived && !card.automation))
                    .sort((a, b) => a.order - b.order)}
                  cardSessions={cardSessions}
                  activeCards={activeCards}
                  onCardClick={(card) => handleCardClick(card, stageConfig.id)}
                  onCardContextMenu={(card, e) => handleCardContextMenu(card, stageConfig.id, e)}
                  onMoveCard={handleMoveCard}
                  onAddCardClick={stageConfig.id === 'backlog' && !showArchived ? handleAddCardClick : undefined}
                />
              ))}
            </div>
          </div>
        )}

        {/* Card Modal */}
        {selectedCard && selectedStage && (
          <CardModal
            card={selectedCard}
            stage={selectedStage}
            projectId={project.id}
            projectPath={projectPath}
            onClose={handleCloseModal}
            onUpdate={handleUpdateCard}
            onMove={handleMoveCard}
            onDelete={handleDeleteCard}
            isCreateMode={isCreatingCard}
            onCreate={isCreatingCard ? handleCreateCard : undefined}
            onAutomationToggle={onAutomationToggle}
            suppressAutoTerminal={suppressAutoTerminal}
          />
        )}
      </div>

      {/* Context Menu */}
      <ContextMenu
        open={!!contextMenu}
        position={contextMenu?.position ?? { x: 0, y: 0 }}
        groups={contextMenu
          ? (contextMenu.card.automation && showAutomations
              ? buildAutomationMenuGroups(contextMenu.card, contextMenu.stage)
              : buildKanbanMenuGroups(contextMenu.card, contextMenu.stage))
          : []}
        accentColor={contextMenu
          ? (contextMenu.card.automation && showAutomations
              ? 'border-t-orange-400'
              : stageAccentColors[contextMenu.stage] || 'border-t-void-400')
          : undefined}
        onClose={closeContextMenu}
      />

      {/* Delete Confirmation from Context Menu */}
      <ConfirmDialog
        open={!!contextDeleteCard}
        onClose={() => setContextDeleteCard(null)}
        onConfirm={() => {
          if (contextDeleteCard) handleContextDelete(contextDeleteCard.id);
        }}
        title="Delete Card"
        message={contextDeleteCard ? <>Are you sure you want to permanently delete <span className="font-medium text-void-900 dark:text-void-200">&quot;{contextDeleteCard.title}&quot;</span>? This action cannot be undone.</> : ''}
      />

      {/* Copyright notice — centered under backlog column (w-72 + p-4 offset) */}
      <div className="pointer-events-none absolute bottom-[1.2px] left-4 w-72 text-center text-[10px] text-void-400 dark:text-void-600">
        &copy; 2026 SlyCode (slycode.ai). All rights reserved.
      </div>
    </div>
  );
}
