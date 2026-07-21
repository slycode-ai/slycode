'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import type { KanbanCard, KanbanStage, Problem, ChecklistItem, AgentNote, AutomationConfig as AutomationConfigType } from '@/lib/types';
import {
  getTerminalClassFromStage,
  getActionsForClass,
  withTimestamp,
} from '@/lib/sly-actions';
import { useSlyActionsConfig } from '@/hooks/useSlyActionsConfig';
import { submitVerified, notifyDeliveryFailure, type VerifiedDelivery } from '@/lib/submit-verified';
import { ClaudeTerminalPanel, type TerminalContext } from './ClaudeTerminalPanel';
import EndedSessionPanel from './EndedSessionPanel';
import { AutomationConfig } from './AutomationConfig';
import { QuestionnaireTab } from './QuestionnaireTab';
import { HtmlAttachmentsTab } from './HtmlAttachmentsTab';
import { DocAttachmentsTab } from './DocAttachmentsTab';
import { getHtmlRefs } from '@/lib/html-refs';
import { getDesignRefs, getFeatureRefs, getTestRefs } from '@/lib/doc-refs';
import { ConfirmDialog } from './ConfirmDialog';
import { getProviderColor } from '@/lib/provider-colors';
import { VoiceControlBar } from './VoiceControlBar';
import { VoiceSettingsPopover } from './VoiceSettingsPopover';
import { VoiceErrorPopup } from './VoiceErrorPopup';
import { useVoice } from '@/contexts/VoiceContext';
import { readStatus, formatStatusForPrompt } from '@/lib/status';
import { computeSessionKey, sessionBelongsToProject } from '@/lib/session-keys';

interface VoiceFocusTarget {
  type: 'input' | 'terminal';
  element?: HTMLElement;
  sendInput?: (data: string) => void;
  // Bridge session name — enables verified-submit routing for auto-submit
  sessionName?: string;
}

interface SessionInfo {
  name?: string;
  status: 'running' | 'stopped' | 'detached';
  hasHistory?: boolean;
  lastActive?: string;
  createdAt?: string;
  provider?: string;
  exitedAt?: string;
}

interface CardSession {
  name: string;
  provider: string;
  status: 'running' | 'stopped' | 'detached';
  hasHistory: boolean;
  createdAt: string;
  displayName: string;
  /** False for stopped sessions whose provider conversation id was never captured (feature 080). */
  resumable: boolean;
  exitedAt?: string;
  lastActive?: string;
}

export type NewCardData = Omit<KanbanCard, 'id' | 'order' | 'created_at' | 'updated_at'>;

export type CardCreatingState =
  | { status: 'idle' }
  | { status: 'pending' }
  | { status: 'error'; message: string };

interface CardModalProps {
  card: KanbanCard;
  stage: KanbanStage;
  projectId: string;
  projectPath?: string;
  onClose: () => void;
  onUpdate: (card: KanbanCard) => void;
  onMove: (cardId: string, stage: KanbanStage) => void;
  onDelete?: (cardId: string) => void;
  isCreateMode?: boolean;
  onCreate?: (card: NewCardData) => void;
  /**
   * Pending/error state for the eager-create round-trip. While `pending`, the
   * modal disables Submit and suppresses Escape-to-close. On `error`, an
   * inline banner with Retry/Cancel is shown. See feature 063.
   */
  creatingState?: CardCreatingState;
  onRetryCreate?: () => void;
  onCancelCreate?: () => void;
  onAutomationToggle?: (isAutomation: boolean) => void;
  suppressAutoTerminal?: boolean;
  /**
   * Quick-launch shortcut payload from the URL token redirect. When present,
   * the modal selects the matching provider tab and fires the prompt once
   * the per-provider session is alive (creating it if needed).
   */
  pendingShortcut?: {
    cardId: string;
    prompt: string;
    provider?: string;
    preferExisting?: boolean;
  } | null;
  onPendingShortcutConsumed?: () => void;
}

const STAGES: { id: KanbanStage; label: string }[] = [
  { id: 'backlog', label: 'Backlog' },
  { id: 'design', label: 'Design' },
  { id: 'implementation', label: 'Implementation' },
  { id: 'testing', label: 'Testing' },
  { id: 'done', label: 'Done' },
];

const PRIORITIES = ['critical', 'high', 'medium', 'low'] as const;

const typeColors: Record<string, string> = {
  feature: 'bg-neon-blue-400/20 text-neon-blue-600 dark:text-neon-blue-400 border border-neon-blue-400/30',
  chore: 'bg-void-200 text-void-600 dark:bg-void-700 dark:text-void-200 border border-void-300 dark:border-void-600',
  bug: 'bg-[#ff3b5c]/20 text-[#ff3b5c] border border-[#ff3b5c]/30',
};

const priorityColors: Record<string, string> = {
  critical: 'bg-[#ff3b5c]/20 text-[#ff3b5c] border border-[#ff3b5c]/30',
  high: 'bg-neon-orange-400/20 text-neon-orange-600 dark:text-neon-orange-400 border border-neon-orange-400/30',
  medium: 'bg-[#ffd600]/15 text-[#b39700] dark:text-[#ffd600]/80 border border-[#ffd600]/25',
  low: 'bg-green-500/15 text-green-700 dark:text-green-400/70 border border-green-500/20',
};

type TabId = 'details' | 'design' | 'feature' | 'html' | 'test' | 'questionnaires' | 'notes' | 'checklist' | 'terminal';

const stageTerminalColors: Record<KanbanStage, string> = {
  backlog: 'border-t border-void-600 bg-void-800',
  design: 'border-t-2 border-neon-blue-400/40 bg-void-800',
  implementation: 'border-t-2 border-neon-blue-400/50 bg-void-800',
  testing: 'border-t-2 border-neon-orange-400/40 bg-void-800',
  done: 'border-t-2 border-green-400/40 bg-void-800',
};

const stageTerminalTint: Record<KanbanStage, string> = {
  backlog: 'rgba(120, 120, 140, 0.12)',
  design: 'rgba(0, 191, 255, 0.1)',
  implementation: 'rgba(0, 191, 255, 0.12)',
  testing: 'rgba(255, 106, 51, 0.1)',
  done: 'rgba(0, 230, 118, 0.1)',
};

const stageModalStyles: Record<KanbanStage, { header: string; tabs: string; modalBorder: string; headerBorder: string; tabsBorder: string }> = {
  backlog: {
    header: 'bg-gradient-to-r from-void-200 to-void-100 dark:from-void-850 dark:to-void-850/60',
    tabs: 'bg-gradient-to-r from-void-200/50 to-void-100/50 dark:from-void-850/60 dark:to-void-850/30',
    modalBorder: 'dark:border dark:border-void-600',
    headerBorder: 'border-b border-void-300 dark:border-void-600',
    tabsBorder: 'border-b border-void-200 dark:border-void-600',
  },
  design: {
    header: 'bg-gradient-to-r from-neon-blue-200/85 to-neon-blue-50/50 dark:from-neon-blue-950/90 dark:to-neon-blue-950/30',
    tabs: 'bg-gradient-to-r from-neon-blue-100/50 to-neon-blue-50/15 dark:from-neon-blue-950/50 dark:to-neon-blue-950/15',
    modalBorder: 'dark:border dark:border-neon-blue-400/25',
    headerBorder: 'border-b border-neon-blue-200/50 dark:border-neon-blue-400/25',
    tabsBorder: 'border-b border-neon-blue-100/50 dark:border-neon-blue-400/20',
  },
  implementation: {
    header: 'bg-gradient-to-r from-neon-blue-200/85 to-neon-blue-50/50 dark:from-neon-blue-950/90 dark:to-neon-blue-900/20',
    tabs: 'bg-gradient-to-r from-neon-blue-100/50 to-neon-blue-50/15 dark:from-neon-blue-950/50 dark:to-neon-blue-950/15',
    modalBorder: 'dark:border dark:border-neon-blue-400/30',
    headerBorder: 'border-b border-neon-blue-200/50 dark:border-neon-blue-400/30',
    tabsBorder: 'border-b border-neon-blue-100/50 dark:border-neon-blue-400/20',
  },
  testing: {
    header: 'bg-gradient-to-r from-[#ff6a33]/25 to-[#ff6a33]/10 dark:from-[#ff6a33]/15 dark:to-[#ff6a33]/5',
    tabs: 'bg-gradient-to-r from-[#ff6a33]/15 to-[#ff6a33]/5 dark:from-[#ff6a33]/10 dark:to-[#ff6a33]/5',
    modalBorder: 'dark:border dark:border-[#ff6a33]/30',
    headerBorder: 'border-b border-[#ff6a33]/25 dark:border-[#ff6a33]/30',
    tabsBorder: 'border-b border-[#ff6a33]/15 dark:border-[#ff6a33]/25',
  },
  done: {
    header: 'bg-gradient-to-r from-green-200/85 to-green-50/50 dark:from-green-950/90 dark:to-green-950/30',
    tabs: 'bg-gradient-to-r from-green-100/50 to-green-50/15 dark:from-green-950/50 dark:to-green-950/15',
    modalBorder: 'dark:border dark:border-green-400/25',
    headerBorder: 'border-b border-green-200/50 dark:border-green-400/25',
    tabsBorder: 'border-b border-green-100/50 dark:border-green-400/20',
  },
};

// Orange-themed styles for automation cards
const automationModalStyles = {
  header: 'bg-gradient-to-r from-orange-200/85 to-orange-50/50 dark:from-orange-950/90 dark:to-orange-950/30',
  tabs: 'bg-gradient-to-r from-orange-100/50 to-orange-50/15 dark:from-orange-950/50 dark:to-orange-950/15',
  modalBorder: 'dark:border dark:border-orange-400/30',
  headerBorder: 'border-b border-orange-200/50 dark:border-orange-400/30',
  tabsBorder: 'border-b border-orange-100/50 dark:border-orange-400/20',
};
const automationTerminalColor = 'border-t-2 border-orange-400/50 bg-void-800';
const automationTerminalTint = 'rgba(249, 115, 22, 0.12)';

// Stage-aware input focus colors — uses CSS variable for reliable dynamic color
const stageFocusRgb: Record<KanbanStage, string> = {
  backlog: '161, 161, 170',    // void-400
  design: '129, 140, 248',     // indigo-400
  implementation: '0, 191, 255', // neon-blue-400
  testing: '255, 106, 51',     // #ff6a33
  done: '74, 222, 128',        // green-400
};
const automationFocusRgb = '251, 146, 60'; // orange-400

/** Positions a popover below an anchor element, rendered via portal to escape stacking contexts */
function VoicePopoverPortal({ anchorRef, children }: { anchorRef: React.RefObject<HTMLDivElement | null>; children: React.ReactNode }) {
  const [style, setStyle] = useState<React.CSSProperties>({ position: 'fixed', opacity: 0 });

  useEffect(() => {
    const update = () => {
      const el = anchorRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      setStyle({
        position: 'fixed',
        top: rect.bottom + 8,
        right: window.innerWidth - rect.right,
        zIndex: 9999,
        opacity: 1,
      });
    };
    update();
    window.addEventListener('scroll', update, true);
    window.addEventListener('resize', update);
    return () => {
      window.removeEventListener('scroll', update, true);
      window.removeEventListener('resize', update);
    };
  }, [anchorRef]);

  return <div style={style}>{children}</div>;
}

export function CardModal({ card, stage, projectId, projectPath, onClose, onUpdate, onMove, onDelete, isCreateMode, onCreate, creatingState, onRetryCreate, onCancelCreate, onAutomationToggle, suppressAutoTerminal, pendingShortcut, onPendingShortcutConsumed }: CardModalProps) {
  const [activeTab, setActiveTab] = useState<TabId>('details');

  const [newProblem, setNewProblem] = useState('');
  // In create mode, start with title editing enabled
  const [isEditingTitle, setIsEditingTitle] = useState(isCreateMode ?? false);
  const [editedTitle, setEditedTitle] = useState(card.title);
  const [editedDescription, setEditedDescription] = useState(card.description);

  // Track mousedown origin to prevent closing modal when dragging text selection off modal
  const mouseDownOnBackdrop = useRef(false);

  // Track last known card values to detect external updates vs local edits
  const lastKnownDescriptionRef = useRef(card.description);
  const lastKnownTitleRef = useRef(card.title);

  // Track when fields were last edited (timestamp) for edit session protection
  const editingFieldsRef = useRef<Record<string, number>>({});

  const markFieldEditing = useCallback((field: string) => {
    editingFieldsRef.current[field] = Date.now();
  }, []);

  const isFieldBeingEdited = useCallback((field: string, graceMs = 2000) => {
    const lastEdit = editingFieldsRef.current[field];
    return lastEdit !== undefined && (Date.now() - lastEdit) < graceMs;
  }, []);

  // Sync description from external updates (SSE) if user hasn't made local edits
  useEffect(() => {
    if (card.description !== lastKnownDescriptionRef.current) {
      // Card description changed externally
      // Only sync if not being actively edited AND local state matches what we last knew
      if (!isFieldBeingEdited('description')) {
        setEditedDescription((current) => {
          if (current === lastKnownDescriptionRef.current) {
            return card.description;
          }
          return current; // Preserve local edits
        });
      }
      lastKnownDescriptionRef.current = card.description;
    }
  }, [card.description, isFieldBeingEdited]);

  // Sync title from external updates (SSE) if user hasn't made local edits
  useEffect(() => {
    if (card.title !== lastKnownTitleRef.current) {
      // Card title changed externally
      // Only sync if not being actively edited AND local state matches what we last knew
      if (!isFieldBeingEdited('title')) {
        setEditedTitle((current) => {
          if (current === lastKnownTitleRef.current) {
            return card.title;
          }
          return current; // Preserve local edits
        });
      }
      lastKnownTitleRef.current = card.title;
    }
  }, [card.title, isFieldBeingEdited]);

  // Delete confirmation state
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  // Refs for keyboard navigation
  const titleInputRef = useRef<HTMLInputElement>(null);
  const descriptionRef = useRef<HTMLTextAreaElement>(null);

  // Multi-provider terminal state
  const [cardSessions, setCardSessions] = useState<CardSession[]>([]);
  const [selectedProvider, setSelectedProvider] = useState<string | null>(null);
  const actionsConfig = useSlyActionsConfig();

  // Tab bar horizontal scroll with arrow indicators
  const tabBarRef = useRef<HTMLDivElement>(null);
  const [tabBarCanScrollLeft, setTabBarCanScrollLeft] = useState(false);
  const [tabBarCanScrollRight, setTabBarCanScrollRight] = useState(false);
  const updateTabBarScroll = useCallback(() => {
    const el = tabBarRef.current;
    if (!el) return;
    setTabBarCanScrollLeft(el.scrollLeft > 2);
    setTabBarCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 2);
  }, []);
  useEffect(() => {
    const el = tabBarRef.current;
    if (!el) return;
    updateTabBarScroll();
    el.addEventListener('scroll', updateTabBarScroll, { passive: true });
    const ro = new ResizeObserver(updateTabBarScroll);
    ro.observe(el);
    return () => { el.removeEventListener('scroll', updateTabBarScroll); ro.disconnect(); };
  }, [updateTabBarScroll, activeTab, cardSessions.length]);
  const handleTabBarWheel = useCallback((e: React.WheelEvent) => {
    const el = tabBarRef.current;
    if (!el) return;
    if (el.scrollWidth <= el.clientWidth) return;
    e.preventDefault();
    el.scrollLeft += e.deltaY || e.deltaX;
  }, []);
  // Mouse drag-to-scroll on tab bar
  const tabBarDrag = useRef<{ active: boolean; startX: number; scrollStart: number; moved: boolean }>({ active: false, startX: 0, scrollStart: 0, moved: false });
  const handleTabBarMouseDown = useCallback((e: React.MouseEvent) => {
    const el = tabBarRef.current;
    if (!el || el.scrollWidth <= el.clientWidth) return;
    tabBarDrag.current = { active: true, startX: e.clientX, scrollStart: el.scrollLeft, moved: false };
    el.style.cursor = 'grabbing';
    el.style.userSelect = 'none';
  }, []);
  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      const d = tabBarDrag.current;
      if (!d.active) return;
      const dx = e.clientX - d.startX;
      if (Math.abs(dx) > 3) d.moved = true;
      if (tabBarRef.current) tabBarRef.current.scrollLeft = d.scrollStart - dx;
    };
    const onMouseUp = () => {
      if (!tabBarDrag.current.active) return;
      tabBarDrag.current.active = false;
      if (tabBarRef.current) {
        tabBarRef.current.style.cursor = '';
        tabBarRef.current.style.userSelect = '';
      }
    };
    // Suppress click on buttons after a drag
    const onClick = (e: MouseEvent) => {
      if (tabBarDrag.current.moved) {
        e.preventDefault();
        e.stopPropagation();
        tabBarDrag.current.moved = false;
      }
    };
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
    // Capture phase so we intercept before the button's click handler fires
    tabBarRef.current?.addEventListener('click', onClick, true);
    const el = tabBarRef.current;
    return () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      el?.removeEventListener('click', onClick, true);
    };
  }, []);

  // Available areas from API
  const [availableAreas, setAvailableAreas] = useState<string[]>([]);

  // New tag input state
  const [newTagInput, setNewTagInput] = useState('');

  // Tag drag-to-reorder state
  const [dragTagIndex, setDragTagIndex] = useState<number | null>(null);
  const [dragOverTagIndex, setDragOverTagIndex] = useState<number | null>(null);

  // Local checklist state with ref to avoid stale closure issues with rapid clicks
  // The ref always has the latest value (updated synchronously)
  // The state triggers re-renders
  const [localChecklist, setLocalChecklist] = useState<ChecklistItem[]>(card.checklist || []);
  const checklistRef = useRef<ChecklistItem[]>(card.checklist || []);
  const [checklistCardId, setChecklistCardId] = useState(card.id);
  const lastKnownChecklistRef = useRef(JSON.stringify(card.checklist || []));

  // Reset local checklist when card changes (different card opened)
  if (card.id !== checklistCardId) {
    const newChecklist = card.checklist || [];
    setLocalChecklist(newChecklist);
    setChecklistCardId(card.id);
  }

  // Sync refs when card changes (must be in effect, not during render)
  useEffect(() => {
    const newChecklist = card.checklist || [];
    checklistRef.current = newChecklist;
    lastKnownChecklistRef.current = JSON.stringify(newChecklist);
  }, [card.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Sync checklist from external updates (SSE) if user hasn't made local edits
  useEffect(() => {
    const cardChecklistStr = JSON.stringify(card.checklist || []);
    if (cardChecklistStr !== lastKnownChecklistRef.current) {
      // Card checklist changed externally
      // Only sync if not being actively edited AND local state matches what we last knew
      if (!isFieldBeingEdited('checklist')) {
        const localStr = JSON.stringify(checklistRef.current);
        if (localStr === lastKnownChecklistRef.current) {
          const newChecklist = card.checklist || [];
           
          setLocalChecklist(newChecklist);
          checklistRef.current = newChecklist;
        }
      }
      lastKnownChecklistRef.current = cardChecklistStr;
    }
  }, [card.checklist, isFieldBeingEdited]);

  // Toggle a checklist item - uses ref to always have latest state
  const toggleChecklistItem = (itemId: string) => {
    markFieldEditing('checklist');
    const newChecklist = checklistRef.current.map((i) =>
      i.id === itemId ? { ...i, done: !i.done } : i
    );
    checklistRef.current = newChecklist; // Update ref synchronously
    lastKnownChecklistRef.current = JSON.stringify(newChecklist); // Track local edit
    setLocalChecklist(newChecklist); // Trigger re-render
    onUpdate({ ...card, checklist: newChecklist, updated_at: new Date().toISOString() });
  };

  // Add a new checklist item
  const addChecklistItem = (text: string) => {
    markFieldEditing('checklist');
    const newItem: ChecklistItem = {
      id: `check-${Date.now()}`,
      text,
      done: false,
    };
    const newChecklist = [...checklistRef.current, newItem];
    checklistRef.current = newChecklist;
    lastKnownChecklistRef.current = JSON.stringify(newChecklist); // Track local edit
    setLocalChecklist(newChecklist);
    onUpdate({ ...card, checklist: newChecklist, updated_at: new Date().toISOString() });
  };

  // Agent notes state
  const [newNoteText, setNewNoteText] = useState('');
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const notesScrollRef = useRef<HTMLDivElement>(null);
  const [notesCanScrollUp, setNotesCanScrollUp] = useState(false);
  const [notesCanScrollDown, setNotesCanScrollDown] = useState(false);
  const prevNotesCountRef = useRef(card.agentNotes?.length ?? 0);

  // ---- Voice-to-text (v2: consume VoiceProvider context) ----
  const voice = useVoice();
  const voiceSettingsClosedAtRef = useRef(0);
  const voiceAnchorRef = useRef<HTMLDivElement>(null);
  const voiceFocusRef = useRef<VoiceFocusTarget | null>(null);
  const terminalHandleRef = useRef<{ sendInput: (data: string) => void; sessionName?: string } | null>(null);
  const activeTabRef = useRef(activeTab);
  activeTabRef.current = activeTab;

  const insertTranscribedText = useCallback((text: string) => {
    const target = voiceFocusRef.current;
    if (!target) return;

    if (target.type === 'input' && target.element) {
      if (!document.contains(target.element)) return;
      const el = target.element as HTMLInputElement | HTMLTextAreaElement;
      const start = el.selectionStart ?? el.value.length;
      const end = el.selectionEnd ?? el.value.length;
      el.focus();
      el.setSelectionRange(start, end);
      document.execCommand('insertText', false, text);
    } else if (target.type === 'terminal' && target.sendInput) {
      const shouldAutoSubmit = voice.submitModeRef.current === 'auto' && voice.settings.voice.autoSubmitTerminal;
      if (shouldAutoSubmit && target.sessionName) {
        // Verified submit (feature 070): the bridge owns paste + Enter,
        // detects blocking dialogs, and reports the typed delivery outcome.
        const sessionName = target.sessionName;
        submitVerified(sessionName, text)
          .then((delivery) => {
            if (delivery && delivery.outcome !== 'delivered') notifyDeliveryFailure(sessionName, delivery);
          })
          .catch(() => {
            notifyDeliveryFailure(sessionName, { outcome: 'failed', reason: 'request failed' });
          });
      } else {
        const send = target.sendInput;
        send(text);
        if (shouldAutoSubmit) {
          // Defensive fallback for session-less handles only — real terminal
          // handles carry a sessionName via ClaudeTerminalPanel enrichment
          setTimeout(() => send('\r'), 300);
        }
      }
    }
    voice.submitModeRef.current = 'auto';
  }, [voice.settings.voice.autoSubmitTerminal]);

  // Claim/release voice control
  useEffect(() => {
    if (isCreateMode) return; // No voice in create mode
    const claimant = {
      id: 'card-modal',
      onRecordStart: () => {
        const active = document.activeElement as HTMLElement;
        if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA') && active.closest('[data-voice-target]')) {
          voiceFocusRef.current = { type: 'input', element: active };
        } else if (activeTabRef.current === 'terminal' && terminalHandleRef.current) {
          const handle = terminalHandleRef.current;
          voiceFocusRef.current = { type: 'terminal', sendInput: handle.sendInput, sessionName: handle.sessionName };
        } else {
          voiceFocusRef.current = null;
        }
      },
      onTranscriptionComplete: insertTranscribedText,
      onRelease: () => {
        voiceFocusRef.current = null;
      },
    };
    voice.claimVoiceControl(claimant);
    return () => voice.releaseVoiceControl(claimant);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isCreateMode]); // Intentionally stable deps — claimant callbacks use refs

  // CardModal-specific focus tracking (overrides global provider tracking)
  useEffect(() => {
    const handleFocusIn = (e: FocusEvent) => {
      const target = e.target as HTMLElement;
      if (activeTabRef.current === 'terminal') {
        voice.setHasFieldFocus(true);
        return;
      }
      if (target.closest('[data-voice-target]') && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) {
        voice.setHasFieldFocus(true);
      }
    };
    const handleFocusOut = () => {
      if (activeTabRef.current === 'terminal') return;
      setTimeout(() => {
        if (activeTabRef.current === 'terminal') return;
        const active = document.activeElement as HTMLElement;
        const isVoiceTarget = active?.closest('[data-voice-target]') && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA');
        if (!isVoiceTarget) voice.setHasFieldFocus(false);
      }, 100);
    };
    document.addEventListener('focusin', handleFocusIn);
    document.addEventListener('focusout', handleFocusOut);
    return () => {
      document.removeEventListener('focusin', handleFocusIn);
      document.removeEventListener('focusout', handleFocusOut);
    };
  }, [voice]);

  // Terminal tab always counts as having field focus
  useEffect(() => {
    if (activeTab === 'terminal') {
      voice.setHasFieldFocus(true);
    }
  }, [activeTab, voice]);

  // Track scroll position for shadow indicators
  const updateNotesScrollState = useCallback(() => {
    const el = notesScrollRef.current;
    if (!el) return;
    setNotesCanScrollUp(el.scrollTop > 8);
    setNotesCanScrollDown(el.scrollTop + el.clientHeight < el.scrollHeight - 8);
  }, []);

  // Scroll to bottom when opening the notes tab
  const prevActiveTabRef = useRef(activeTab);
  useEffect(() => {
    if (activeTab === 'notes' && prevActiveTabRef.current !== 'notes') {
      requestAnimationFrame(() => {
        if (notesScrollRef.current) {
          notesScrollRef.current.scrollTop = notesScrollRef.current.scrollHeight;
        }
        updateNotesScrollState();
      });
    }
    prevActiveTabRef.current = activeTab;
  }, [activeTab, updateNotesScrollState]);

  // Scroll to bottom when a note is added (count increases), but not on delete
  useEffect(() => {
    const currentCount = card.agentNotes?.length ?? 0;
    if (currentCount > prevNotesCountRef.current && activeTab === 'notes' && notesScrollRef.current) {
      requestAnimationFrame(() => {
        if (notesScrollRef.current) {
          notesScrollRef.current.scrollTop = notesScrollRef.current.scrollHeight;
        }
        updateNotesScrollState();
      });
    }
    prevNotesCountRef.current = currentCount;
    // Recalculate shadows on any note count change (add or delete)
    if (activeTab === 'notes') {
      requestAnimationFrame(updateNotesScrollState);
    }
  }, [card.agentNotes?.length, activeTab, updateNotesScrollState]);

  const addNote = (text: string) => {
    const notes = card.agentNotes || [];
    const maxId = notes.reduce((max, n) => Math.max(max, n.id), 0);
    const newNote: AgentNote = {
      id: maxId + 1,
      agent: 'User',
      text,
      timestamp: new Date().toISOString(),
    };
    onUpdate({ ...card, agentNotes: [...notes, newNote], updated_at: new Date().toISOString() });
  };

  const deleteNote = (noteId: number) => {
    const notes = (card.agentNotes || []).filter(n => n.id !== noteId);
    onUpdate({ ...card, agentNotes: notes, updated_at: new Date().toISOString() });
  };

  const clearNotes = () => {
    onUpdate({ ...card, agentNotes: [], updated_at: new Date().toISOString() });
    setShowClearConfirm(false);
  };

  // Copy feedback state
  const [copiedTitle, setCopiedTitle] = useState(false);

  // Canonical session key derived from the project's folder path. This is what
  // the CLI uses (scripts/kanban.js:37), so session names stay in lockstep
  // regardless of what shape project.id happens to be in the registry.
  const sessionKey = projectPath ? computeSessionKey(projectPath) : projectId;
  // Alias-aware matcher — finds sessions created under either the canonical
  // sessionKey or the legacy project.id form (for backward compat with
  // sessions already persisted in bridge-sessions.json).
  const projectKeyShape = {
    id: projectId,
    path: projectPath ?? '',
    sessionKey,
    sessionKeyAliases: projectId !== sessionKey ? [projectId] : [],
  };
  const sessionName = `${sessionKey}:card:${card.id}`;
  const cwd = projectPath!;

  // Derived multi-session state
  const anyRunning = cardSessions.some(s => s.status === 'running' || s.status === 'detached');
  const anyDetached = cardSessions.some(s => s.status === 'detached') && !cardSessions.some(s => s.status === 'running');
  const hasMultipleSessions = cardSessions.length > 1;
  const activeSession = cardSessions.find(s => s.provider === selectedProvider) || cardSessions[0] || null;

  // Determine terminal class from stage
  const terminalClass = getTerminalClassFromStage(stage);

  // Get all actions for this terminal class (ordered by classAssignments)
  const actions = getActionsForClass(
    actionsConfig.commands,
    actionsConfig.classAssignments,
    terminalClass,
    { projectId, cardType: card.type }
  );

  // Build pre-rendered cardContext block
  const ctxUnresolved = card.problems.filter((p) => !p.resolved_at);
  const ctxResolvedCount = card.problems.length - ctxUnresolved.length;
  const ctxChecklist = card.checklist || [];
  const ctxCheckedCount = ctxChecklist.filter((i) => i.done).length;
  const ctxNotesCount = card.agentNotes?.length ?? 0;

  const ctxLines: string[] = [];
  ctxLines.push(`Project: ${projectId} (${cwd})`);
  ctxLines.push('');
  ctxLines.push(`Card: ${card.title} [${card.id}]`);
  ctxLines.push(`Type: ${card.type} | Priority: ${card.priority} | Stage: ${stage}`);
  if (card.description) ctxLines.push(`Description: ${card.description}`);
  if (card.areas.length > 0) ctxLines.push(`Areas: ${card.areas.join(', ')}`);
  for (const ref of getDesignRefs(card)) ctxLines.push(`Design Doc: ${ref}`);
  for (const ref of getFeatureRefs(card)) ctxLines.push(`Feature Spec: ${ref}`);
  for (const ref of getTestRefs(card)) ctxLines.push(`Test Doc: ${ref}`);
  for (const htmlRef of getHtmlRefs(card)) ctxLines.push(`HTML: ${htmlRef}`);
  if (card.questionnaire_refs && card.questionnaire_refs.length > 0) {
    ctxLines.push(`Questionnaires: ${card.questionnaire_refs.join(', ')}`);
  }
  // Status — quoted as untrusted card metadata to mitigate prompt-injection via status text.
  {
    const statusObj = readStatus(card.status);
    if (statusObj) {
      for (const line of formatStatusForPrompt(statusObj)) ctxLines.push(line);
    }
  }
  ctxLines.push(ctxChecklist.length > 0 ? `Checklist: ${ctxCheckedCount}/${ctxChecklist.length} checked` : 'Checklist: none');
  ctxLines.push(`Notes: ${ctxNotesCount}`);

  // Problems summary + detail lines
  if (ctxUnresolved.length > 0 || ctxResolvedCount > 0) {
    const parts: string[] = [];
    if (ctxUnresolved.length > 0) parts.push(`${ctxUnresolved.length} unresolved`);
    if (ctxResolvedCount > 0) parts.push(`${ctxResolvedCount} resolved`);
    ctxLines.push(`Problems: ${parts.join(', ')}`);
    const maxProblems = 10;
    for (const p of ctxUnresolved.slice(0, maxProblems)) {
      const desc = p.description.length > 100 ? p.description.slice(0, 97) + '...' : p.description;
      ctxLines.push(`  - [${p.id}] ${p.severity}: ${desc}`);
    }
    if (ctxUnresolved.length > maxProblems) {
      ctxLines.push(`  - ... and ${ctxUnresolved.length - maxProblems} more`);
    }
  } else {
    ctxLines.push('Problems: none');
  }

  const ctxStatus = readStatus(card.status);
  const terminalContext: TerminalContext = {
    cardContext: ctxLines.join('\n'),
    card: {
      id: card.id,
      title: card.title,
      description: card.description,
      type: card.type,
      priority: card.priority,
      areas: card.areas,
      // Singular template vars resolve to the first (legacy-first) ref (feature 074).
      design_ref: getDesignRefs(card)[0],
      feature_ref: getFeatureRefs(card)[0],
      // Status flattened to plain strings for the template engine.
      // `{{card.status}}` resolves to the normalized text only; empty when unset.
      status: ctxStatus?.text ?? '',
      statusSetAt: ctxStatus?.setAt ?? '',
    },
    stage,
    project: { name: projectId },
    projectPath: cwd,
  };

  // Load available areas
  useEffect(() => {
    fetch('/api/areas')
      .then((res) => res.ok ? res.json() : null)
      .then((data) => {
        if (data?.areas) setAvailableAreas(data.areas);
      })
      .catch(() => {
        // No areas available
      });
  }, []);

  // Provider config for "+" button (need to know available providers + the global default)
  interface ProviderInfo { id: string; displayName: string; model?: { available?: { id: string; label: string }[] }; permissions: { label: string; default: boolean } }
  const [availableProviders, setAvailableProviders] = useState<ProviderInfo[]>([]);
  const [globalDefault, setGlobalDefault] = useState<{ provider: string; model?: string } | null>(null);
  const [newSessionDropdown, setNewSessionDropdown] = useState(false);
  const [newSessionProvider, setNewSessionProvider] = useState<string | null>(null);
  const [newSessionSkipPerms, setNewSessionSkipPerms] = useState(true);
  const newSessionRef = useRef<HTMLDivElement>(null);
  const newSessionPortalRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    fetch('/api/providers')
      .then(res => res.ok ? res.json() : null)
      .then((data: { providers: Record<string, ProviderInfo>; defaults?: { global?: { provider: string; model?: string }; projects?: Record<string, { provider: string; model?: string }> } } | null) => {
        if (!data?.providers) return;
        setAvailableProviders(Object.values(data.providers));
        // This project's default, falling back to the last-set global
        const def = data.defaults?.projects?.[projectId] ?? data.defaults?.global;
        if (def) setGlobalDefault(def);
      })
      .catch(() => {});
  }, [projectId]);

  // Close "+" dropdown on outside click
  useEffect(() => {
    if (!newSessionDropdown) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      const inButton = newSessionRef.current?.contains(target);
      const inPortal = newSessionPortalRef.current?.contains(target);
      if (!inButton && !inPortal) {
        setNewSessionDropdown(false);
        setNewSessionProvider(null);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [newSessionDropdown]);

  // True once refreshCardSessions has completed at least one fetch — gates
  // pendingShortcut firing so we don't try to use a live session before the
  // initial sessions list arrives (which would race-create a duplicate).
  const [sessionsLoaded, setSessionsLoaded] = useState(false);

  // Shared session discovery — fetches all sessions for this card, builds cardSessions[].
  // Called on mount and from onSessionChange to detect new sibling sessions in real time.
  const refreshCardSessions = useCallback(() => {
    const cardSuffix = `card:${card.id}`;
    fetch('/api/bridge/sessions')
      .then((res) => res.ok ? res.json() : null)
      .then((data) => {
        setSessionsLoaded(true);
        if (!data?.sessions) return;
        const matches = (data.sessions as SessionInfo[]).filter((s) =>
          s.name?.endsWith(cardSuffix) && sessionBelongsToProject(s.name, projectKeyShape)
        );
        if (matches.length === 0) {
          // Clear stale pill state — switching to a card with no sessions, or
          // after the last session was deleted, would otherwise leave a
          // ghost Resume button and selected provider visible.
          setCardSessions([]);
          setSelectedProvider(null);
          return;
        }
        // Stopped sessions with no captured conversation id are shown as
        // "ended — not resumable" instead of silently hidden (feature 080)
        const sessions: CardSession[] = matches.map(s => {
          let provider = s.provider || 'claude';
          if (s.name) {
            const parts = s.name.split(':');
            const cardIdx = parts.indexOf('card');
            if (cardIdx === 2) provider = parts[1];
          }
          return {
            name: s.name || '',
            provider,
            status: s.status as CardSession['status'],
            hasHistory: s.hasHistory ?? false,
            createdAt: s.createdAt ?? '',
            displayName: provider.charAt(0).toUpperCase() + provider.slice(1),
            resumable: s.status !== 'stopped' || (s.hasHistory ?? false),
            exitedAt: s.exitedAt,
            lastActive: s.lastActive,
          };
        });
        // Resumable sessions first (so opening a card never lands on a dead
        // tab by default), then oldest-created first within each group
        sessions.sort((a, b) => {
          if (a.resumable !== b.resumable) return a.resumable ? -1 : 1;
          return (a.createdAt ?? '').localeCompare(b.createdAt ?? '');
        });
        setCardSessions(sessions);
        setSelectedProvider(prev => {
          if (prev && sessions.some(s => s.provider === prev)) return prev;
          return sessions[0]?.provider ?? null;
        });
      })
      .catch(() => {});
  }, [projectId, card.id]);

  // Fetch on mount
  useEffect(() => {
    refreshCardSessions();
  }, [refreshCardSessions]);

  // Re-run discovery when the stage changes externally while the modal is
  // open (e.g. an action moved the card). The session is keyed on card id and
  // unaffected by the move, but stage-keyed state churns — re-resolving
  // against the live bridge keeps the terminal link and pill state honest.
  const prevStageRef = useRef(stage);
  useEffect(() => {
    if (prevStageRef.current === stage) return;
    prevStageRef.current = stage;
    if (isCreateMode) return;
    refreshCardSessions();
  }, [stage, isCreateMode, refreshCardSessions]);

  // Auto-switch to terminal tab if any session is running on initial load
  const [hasAutoSwitched, setHasAutoSwitched] = useState(false);
  useEffect(() => {
    if (!hasAutoSwitched && !suppressAutoTerminal && !isAutomation && anyRunning) {
       
      setActiveTab('terminal');
      setHasAutoSwitched(true);
    }
  }, [anyRunning, hasAutoSwitched, suppressAutoTerminal]);

  // ----- Quick-launch shortcut firing -----
  //
  // When opened with a pendingShortcut, decide which provider/session to
  // target and fire the prompt. Provider rules:
  //   - If preferExisting is true and ANY session exists for this card,
  //     reuse the earliest-created one (matches the per-provider tab default).
  //   - Otherwise use shortcut.provider (or fall back to existing session if
  //     shortcut omitted a provider).
  // Firing path:
  //   - If a matching session is alive: POST bracketed-paste input + CR to
  //     the bridge directly (same primitive ClaudeTerminalPanel.sendCommand
  //     uses).
  //   - If no session: POST /api/bridge/sessions to create with the prompt
  //     embedded; the bridge passes it as a positional arg.
  // Idempotency: tracked via consumedShortcutRef so a re-render doesn't
  // re-fire. Parent is notified so it can clear its state.
  const consumedShortcutRef = useRef<string | null>(null);
  useEffect(() => {
    if (!pendingShortcut || pendingShortcut.cardId !== card.id) return;
    if (!sessionsLoaded) return; // wait for initial fetch to settle so we see existing sessions
    const promptKey = `${pendingShortcut.cardId}:${pendingShortcut.prompt}`;
    if (consumedShortcutRef.current === promptKey) return;

    // Claim the slot SYNCHRONOUSLY before any await. Without this, a
    // re-render of this effect (cardSessions updates from refresh, parent
    // re-renders, etc.) racing the async fetch chain below would start a
    // parallel fire — and each fire sends its own bracketed-paste + CR
    // pair, so the user sees the prompt typed N times.
    consumedShortcutRef.current = promptKey;
    onPendingShortcutConsumed?.();

    let cancelled = false;
    const fire = async () => {
      // Decide target provider
      let chosenProvider = pendingShortcut.provider || 'claude';
      let liveSession: CardSession | null = null;
      if (pendingShortcut.preferExisting && cardSessions.length > 0) {
        const live = cardSessions.find((s) => s.status === 'running' || s.status === 'detached');
        if (live) {
          chosenProvider = live.provider;
          liveSession = live;
        }
      } else if (!pendingShortcut.provider && cardSessions.length > 0) {
        // Provider unspecified — reuse existing session if any.
        const live = cardSessions.find((s) => s.status === 'running' || s.status === 'detached');
        if (live) {
          chosenProvider = live.provider;
          liveSession = live;
        }
      }
      // If we didn't pick from the live list, see if a session for the
      // requested provider already exists (any status).
      if (!liveSession) {
        const match = cardSessions.find((s) => s.provider === chosenProvider);
        if (match && (match.status === 'running' || match.status === 'detached')) {
          liveSession = match;
        }
      }

      // Switch the UI to the chosen provider tab + terminal tab so the user
      // sees what's happening.
      setSelectedProvider(chosenProvider);
      setActiveTab('terminal');

      const sessionName = `${sessionKey}:${chosenProvider}:card:${card.id}`;
      // Prepend the timestamp prefix (slash commands like /clear are skipped).
      const stampedPrompt = withTimestamp(pendingShortcut.prompt);
      try {
        if (liveSession) {
          // Verified delivery into the live session (feature 070): paste,
          // confirm queued, Enter, verify cleared. Non-delivered outcomes
          // surface as the in-panel toast via the delivery-failure event.
          const delivery = await submitVerified(liveSession.name, stampedPrompt);
          if (delivery && delivery.outcome !== 'delivered') {
            notifyDeliveryFailure(liveSession.name, delivery);
          }
        } else {
          // No live session — create one with the prompt embedded.
          const createRes = await fetch('/api/bridge/sessions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              name: sessionName,
              provider: chosenProvider,
              cwd,
              skipPermissions: true,
              prompt: stampedPrompt,
              verifyDelivery: true,
            }),
          });
          const created = await createRes.json().catch(() => null);
          const delivery = created?.delivery as VerifiedDelivery | undefined;
          if (delivery && delivery.outcome !== 'delivered') {
            notifyDeliveryFailure(sessionName, delivery);
          }
          // Refresh so the new session appears as a per-provider tab.
          setTimeout(() => { if (!cancelled) refreshCardSessions(); }, 1200);
        }
      } catch (err) {
        console.error('Failed to fire quick-launch shortcut:', err);
        // consumedShortcutRef was already set synchronously above, so we
        // won't loop on a hard error.
      }
    };

    fire();
    return () => { cancelled = true; };
  }, [pendingShortcut, cardSessions, card.id, sessionKey, cwd, refreshCardSessions, onPendingShortcutConsumed, sessionsLoaded]);

  // Document refs — lists with legacy single-ref fallback (feature 074).
  // Rendering + fetching now live in DocAttachmentsTab (self-contained).
  const designRefs = getDesignRefs(card);
  const featureRefs = getFeatureRefs(card);
  const testRefs = getTestRefs(card);
  const hasDesign = designRefs.length > 0;
  const hasFeature = featureRefs.length > 0;
  const hasTest = testRefs.length > 0;
  // HTML attachments: list + legacy single-ref fallback (feature 072)
  const htmlRefs = getHtmlRefs(card);
  const hasHtml = htmlRefs.length > 0;
  const hasQuestionnaires = (card.questionnaire_refs?.length ?? 0) > 0;
  const hasChecklist = localChecklist.length > 0;

  // Automation mode — compute effective styles (orange overrides stage colors)
  const isAutomation = !!card.automation;
  const modalStyles = isAutomation ? automationModalStyles : stageModalStyles[stage];
  const terminalColor = isAutomation ? automationTerminalColor : stageTerminalColors[stage];
  const terminalTint = isAutomation ? automationTerminalTint : stageTerminalTint[stage];
  const focusRgb = isAutomation ? automationFocusRgb : stageFocusRgb[stage];

  // Unlink a single attachment ref from the card (feature 074). Removes the ref
  // from whichever list (or legacy singular) holds it — UNLINK, not delete: the
  // file on disk is untouched. Persists via the modal's existing onUpdate path.
  const handleUnlinkRef = (ref: string) => {
    const updated: KanbanCard = { ...card, updated_at: new Date().toISOString() };
    const listKeys = ['design_refs', 'feature_refs', 'test_refs', 'html_refs', 'questionnaire_refs'] as const;
    for (const key of listKeys) {
      const list = updated[key];
      if (Array.isArray(list) && list.includes(ref)) {
        const kept = list.filter((r) => r !== ref);
        updated[key] = kept.length > 0 ? kept : undefined;
      }
    }
    const legacyKeys = ['design_ref', 'feature_ref', 'test_ref', 'html_ref'] as const;
    for (const key of legacyKeys) {
      if (updated[key] === ref) updated[key] = undefined;
    }
    onUpdate(updated);
  };

  const handleTitleSave = () => {
    if (editedTitle.trim() && editedTitle !== card.title) {
      lastKnownTitleRef.current = editedTitle.trim(); // Track local edit
      onUpdate({ ...card, title: editedTitle.trim(), updated_at: new Date().toISOString() });
    }
    setIsEditingTitle(false);
  };

  const handleDescriptionChange = (value: string) => {
    markFieldEditing('description');
    lastKnownDescriptionRef.current = value; // Track local edit immediately
    setEditedDescription(value);
    onUpdate({ ...card, description: value, updated_at: new Date().toISOString() });
  };

  const handleAddProblem = () => {
    if (!newProblem.trim()) return;

    const problem: Problem = {
      id: `prob-${Date.now()}`,
      description: newProblem.trim(),
      severity: 'major',
      created_at: new Date().toISOString(),
    };

    onUpdate({
      ...card,
      problems: [...card.problems, problem],
      updated_at: new Date().toISOString(),
    });

    setNewProblem('');
  };

  const handleResolveProblem = (problemId: string) => {
    onUpdate({
      ...card,
      problems: card.problems.map((p) =>
        p.id === problemId ? { ...p, resolved_at: new Date().toISOString() } : p
      ),
      updated_at: new Date().toISOString(),
    });
  };

  const handlePushBackForBugs = () => {
    const updatedTags = card.tags.includes('bug') ? card.tags : [...card.tags, 'bug'];
    onUpdate({
      ...card,
      tags: updatedTags,
      type: 'bug',
      updated_at: new Date().toISOString(),
    });
    onMove(card.id, 'implementation');
  };

  // Area handlers
  const handleAddArea = (area: string) => {
    if (!card.areas.includes(area)) {
      onUpdate({
        ...card,
        areas: [...card.areas, area],
        updated_at: new Date().toISOString(),
      });
    }
  };

  const handleRemoveArea = (area: string) => {
    onUpdate({
      ...card,
      areas: card.areas.filter((a) => a !== area),
      updated_at: new Date().toISOString(),
    });
  };

  // Tag handlers
  const handleAddTag = (tag: string) => {
    const trimmed = tag.trim().toLowerCase();
    if (trimmed && !card.tags.includes(trimmed)) {
      onUpdate({
        ...card,
        tags: [...card.tags, trimmed],
        updated_at: new Date().toISOString(),
      });
    }
    setNewTagInput('');
  };

  const handleRemoveTag = (tag: string) => {
    onUpdate({
      ...card,
      tags: card.tags.filter((t) => t !== tag),
      updated_at: new Date().toISOString(),
    });
  };

  const handleTagDrop = (fromIndex: number, toIndex: number) => {
    if (fromIndex === toIndex) return;
    const newTags = [...card.tags];
    const [moved] = newTags.splice(fromIndex, 1);
    newTags.splice(toIndex, 0, moved);
    onUpdate({ ...card, tags: newTags, updated_at: new Date().toISOString() });
    setDragTagIndex(null);
    setDragOverTagIndex(null);
  };

  const handleCopyTitle = async () => {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(card.title);
      } else {
        const textArea = document.createElement('textarea');
        textArea.value = card.title;
        textArea.style.position = 'fixed';
        textArea.style.left = '-9999px';
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand('copy');
        document.body.removeChild(textArea);
      }
      setCopiedTitle(true);
      setTimeout(() => setCopiedTitle(false), 2000);
    } catch (err) {
      console.error('Failed to copy title:', err);
      setCopiedTitle(true);
      setTimeout(() => setCopiedTitle(false), 2000);
    }
  };

  const unresolvedProblems = card.problems.filter((p) => !p.resolved_at);
  const resolvedProblems = card.problems.filter((p) => p.resolved_at);

  // Get available areas not yet added to card
  const unusedAreas = availableAreas.filter((a) => !card.areas.includes(a));

  // Handle close with save - always saves pending changes before closing
  const handleCloseWithSave = useCallback(() => {
    // Block closing while voice recording is active
    const voiceActive = voice.voiceState === 'recording' || voice.voiceState === 'paused' || voice.voiceState === 'transcribing';
    if (voiceActive) return;

    if (isCreateMode && onCreate) {
      // Block re-submit while a create round-trip is in flight.
      if (creatingState?.status === 'pending') return;
      // In create mode, call onCreate with the card data
      if (!editedTitle.trim()) {
        onClose(); // Just close if no title
        return;
      }
      onCreate({
        title: editedTitle.trim(),
        description: editedDescription,
        type: card.type,
        priority: card.priority,
        areas: card.areas,
        tags: card.tags,
        problems: card.problems,
        checklist: checklistRef.current,
        ...(card.automation ? { automation: card.automation } : {}),
      });
      // Do NOT call onClose() here — the parent decides when to close based
      // on the eager-create response. On success, the parent unmounts this
      // modal by clearing selectedCardId; on error, the modal stays open
      // and renders the inline error banner.
      return;
    }

    // Edit mode — save any pending title change, then close
    if (editedTitle.trim() && editedTitle !== card.title) {
      onUpdate({ ...card, title: editedTitle.trim(), updated_at: new Date().toISOString() });
    }
    onClose();
  }, [isCreateMode, onCreate, creatingState, editedTitle, editedDescription, card, onClose, onUpdate, voice.voiceState]);

  // Escape key handler — registered in capture phase with stopImmediatePropagation
  // so it fires before and blocks bubble-phase handlers (e.g. useKeyboardShortcuts)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;

      // Let Escape pass through to the terminal uninterrupted
      if (activeTab === 'terminal') return;

      e.stopImmediatePropagation();

      // Suppress Escape-to-close while a card create is in flight — closing
      // mid-flight could orphan the just-persisted card from the user's view.
      if (isCreateMode && creatingState?.status === 'pending') return;

      // If delete confirmation is showing, close that instead
      if (showDeleteConfirm) {
        setShowDeleteConfirm(false);
        return;
      }

      // If a text input/textarea is focused, blur it instead of closing
      const active = document.activeElement as HTMLElement | null;
      if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')) {
        active.blur();
        return;
      }

      handleCloseWithSave();
    };

    document.addEventListener('keydown', handleKeyDown, true);
    return () => document.removeEventListener('keydown', handleKeyDown, true);
  }, [activeTab, showDeleteConfirm, handleCloseWithSave, isCreateMode, creatingState]);

  // Left/right arrow keys to navigate tabs (when not in a text input)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;

      // Ignore when typing in form elements
      const target = e.target as HTMLElement;
      if (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.tagName === 'SELECT' ||
        target.isContentEditable
      ) {
        return;
      }

      // Build list of currently visible tabs
      const visibleTabs: TabId[] = ['details'];
      if (hasDesign) visibleTabs.push('design');
      if (hasFeature) visibleTabs.push('feature');
      if (hasHtml) visibleTabs.push('html');
      if (hasTest) visibleTabs.push('test');
      visibleTabs.push('notes');
      if (hasChecklist) visibleTabs.push('checklist');
      visibleTabs.push('terminal');

      const currentIndex = visibleTabs.indexOf(activeTab);
      if (currentIndex === -1) return;

      const nextIndex = e.key === 'ArrowRight'
        ? (currentIndex + 1) % visibleTabs.length
        : (currentIndex - 1 + visibleTabs.length) % visibleTabs.length;

      e.preventDefault();
      setActiveTab(visibleTabs[nextIndex]);
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [activeTab, hasDesign, hasFeature, hasHtml, hasTest, hasChecklist]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-hidden lg:overflow-y-auto bg-black/50 p-0 lg:p-4 lg:pb-16 lg:pt-16"
      onMouseDown={(e) => { mouseDownOnBackdrop.current = e.target === e.currentTarget; }}
      onClick={(e) => { if (e.target === e.currentTarget && mouseDownOnBackdrop.current) handleCloseWithSave(); }}
    >
      <div
        style={{ '--focus-rgb': focusRgb } as React.CSSProperties}
        className={`flex w-full max-w-full h-full lg:h-auto flex-col lg:max-w-4xl overflow-hidden rounded-none lg:rounded-xl bg-void-100 shadow-(--shadow-overlay) dark:bg-void-900 ${modalStyles.modalBorder}`}
      >
        {/* Header */}
        <div className={`grain depth-glow flex items-start justify-between p-3 sm:p-4 ${modalStyles.headerBorder} ${modalStyles.header}`}>
          <div className="min-w-0 flex-1">
            <div className="mb-2 flex items-center gap-2">
              <span className={`rounded px-2 py-0.5 text-xs font-medium ${typeColors[card.type]}`}>
                {card.type}
              </span>
              <span className={`rounded px-2 py-0.5 text-xs font-medium capitalize ${priorityColors[card.priority] || priorityColors.medium}`}>
                {card.priority}
              </span>
              {card.claude_session?.active && (
                <span className="flex items-center gap-1 rounded bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800 dark:bg-green-900 dark:text-green-200">
                  <span className="relative flex h-2 w-2">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75"></span>
                    <span className="relative inline-flex h-2 w-2 rounded-full bg-green-500"></span>
                  </span>
                  Session Active
                </span>
              )}
            </div>
            <div className="flex items-start gap-2">
              {isEditingTitle ? (
                <input
                  ref={titleInputRef}
                  type="text"
                  value={editedTitle}
                  data-voice-target
                  onChange={(e) => {
                    markFieldEditing('title');
                    lastKnownTitleRef.current = e.target.value; // Track local edit immediately
                    setEditedTitle(e.target.value);
                  }}
                  onBlur={() => !isCreateMode && handleTitleSave()}
                  onFocus={() => markFieldEditing('title')}
                  onKeyDown={(e) => {
                    // Ctrl+Enter to save and close
                    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                      e.preventDefault();
                      handleCloseWithSave();
                      return;
                    }
                    // Enter to save title (non-create mode) or move to description (create mode)
                    if (e.key === 'Enter') {
                      if (isCreateMode) {
                        e.preventDefault();
                        descriptionRef.current?.focus();
                      } else {
                        handleTitleSave();
                      }
                      return;
                    }
                    // Tab to move to description
                    if (e.key === 'Tab' && !e.shiftKey) {
                      e.preventDefault();
                      if (!isCreateMode) handleTitleSave();
                      descriptionRef.current?.focus();
                    }
                  }}
                  placeholder={isCreateMode ? "Enter card title..." : ""}
                  className="w-full rounded border bg-transparent px-1 text-base sm:text-xl font-bold text-void-900 outline-none dark:text-void-100"
                  style={{ borderColor: `rgb(${focusRgb})` }}
                  autoFocus
                />
              ) : (
                <h2
                  onClick={() => setIsEditingTitle(true)}
                  className="cursor-pointer text-base sm:text-xl font-bold text-void-900 hover:text-blue-600 dark:text-void-100 dark:hover:text-blue-400"
                  title="Click to edit"
                >
                  {card.title}
                </h2>
              )}
              {!isCreateMode && (
                <button
                  onClick={handleCopyTitle}
                  className="mt-1 flex-shrink-0 rounded p-1 text-void-400 hover:bg-void-200/50 hover:text-void-600 dark:hover:bg-void-700/50 dark:hover:text-void-300"
                  title={copiedTitle ? 'Copied!' : 'Copy title'}
                >
                  {copiedTitle ? (
                    <svg className="h-4 w-4 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                  ) : (
                    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                    </svg>
                  )}
                </button>
              )}
            </div>
          </div>
          <div className="flex flex-shrink-0 flex-col items-end gap-2">
            <div className="flex items-center gap-1.5 sm:gap-3">
            {/* Automation toggle switch — disabled for archived cards */}
            {!isCreateMode && (
              <label className={`flex items-center gap-1 sm:gap-2 ${card.archived ? 'cursor-not-allowed opacity-40' : 'cursor-pointer'}`} title={card.archived ? 'Unarchive card before enabling automation' : 'Toggle automation mode'}>
                <span className={`hidden sm:inline text-xs font-medium ${isAutomation ? 'text-orange-600 dark:text-orange-400' : 'text-void-500 dark:text-void-400'}`}>
                  Automation
                </span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={isAutomation}
                  disabled={!!card.archived}
                  onClick={() => {
                    if (card.archived) return;
                    if (isAutomation) {
                      // Toggle off — remove automation config
                      const { automation: _, ...rest } = card;
                      onUpdate({ ...rest, updated_at: new Date().toISOString() } as KanbanCard);
                      onAutomationToggle?.(false);
                    } else {
                      // Toggle on — add default automation config
                      const defaultConfig: AutomationConfigType = {
                        enabled: false,
                        schedule: '',
                        scheduleType: 'recurring',
                        provider: 'claude',
                        freshSession: false,
                        reportViaMessaging: false,
                      };
                      onUpdate({ ...card, automation: defaultConfig, updated_at: new Date().toISOString() });
                      onAutomationToggle?.(true);
                    }
                  }}
                  className={`relative inline-flex h-5 w-9 flex-shrink-0 rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-offset-2 ${
                    card.archived ? 'cursor-not-allowed' : 'cursor-pointer'
                  } ${
                    isAutomation
                      ? 'bg-orange-500 focus:ring-orange-500'
                      : 'bg-void-300 focus:ring-void-500 dark:bg-void-600'
                  }`}
                >
                  <span
                    className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                      isAutomation ? 'translate-x-4' : 'translate-x-0'
                    }`}
                  />
                </button>
              </label>
            )}

            {/* Archive toggle switch — disabled for automation cards */}
            {!isCreateMode && (
              <label className={`flex items-center gap-1 sm:gap-2 ${isAutomation ? 'cursor-not-allowed opacity-40' : 'cursor-pointer'}`} title={isAutomation ? 'Automation cards cannot be archived' : 'Archive card'}>
                <span className={`hidden sm:inline text-xs font-medium ${card.archived ? 'text-red-600 dark:text-red-400' : 'text-void-500 dark:text-void-400'}`}>
                  Archived
                </span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={card.archived || false}
                  disabled={isAutomation}
                  onClick={() => {
                    if (isAutomation) return;
                    const updatedCard = {
                      ...card,
                      archived: !card.archived,
                      updated_at: new Date().toISOString(),
                    };
                    onUpdate(updatedCard);
                  }}
                  className={`relative inline-flex h-5 w-9 flex-shrink-0 rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-offset-2 ${
                    isAutomation ? 'cursor-not-allowed' : 'cursor-pointer'
                  } ${
                    card.archived
                      ? 'bg-red-500 focus:ring-red-500'
                      : 'bg-void-300 focus:ring-void-500 dark:bg-void-600'
                  }`}
                >
                  <span
                    className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                      card.archived ? 'translate-x-4' : 'translate-x-0'
                    }`}
                  />
                </button>
              </label>
            )}

            {/* Delete button */}
            {!isCreateMode && onDelete && (
              <button
                onClick={() => setShowDeleteConfirm(true)}
                className="rounded-lg p-2 text-void-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/20 dark:hover:text-red-400"
                title="Delete card permanently"
              >
                <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </button>
            )}

            {/* Close button */}
            <button
              onClick={handleCloseWithSave}
              className="rounded-lg p-2 text-void-400 hover:bg-void-100 hover:text-void-600 dark:hover:bg-void-800 dark:hover:text-void-300"
            >
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
            </div>
            {/* Voice controls — right-aligned below header buttons */}
            {!isCreateMode && (
              <div ref={voiceAnchorRef}>
                <VoiceControlBar
                  voiceState={voice.voiceState}
                  elapsedSeconds={voice.elapsedSeconds}
                  disabled={!voice.hasFieldFocus && voice.voiceState === 'idle'}
                  error={voice.error}
                  onRecord={voice.startRecording}
                  onPause={voice.pauseRecording}
                  onResume={voice.resumeRecording}
                  onClear={voice.clearRecording}
                  onSubmit={voice.submitRecording}
                  onRetry={voice.retryTranscription}
                  onOpenSettings={() => {
                    if (Date.now() - voiceSettingsClosedAtRef.current < 200) return;
                    voice.setShowSettings(!voice.showSettings);
                  }}
                />
              </div>
            )}
          </div>
        </div>

        {/* Eager-create status banner (pending / error). Render only in create mode. */}
        {isCreateMode && creatingState && creatingState.status !== 'idle' && (
          <div
            role={creatingState.status === 'error' ? 'alert' : 'status'}
            aria-live="polite"
            className={`flex items-center justify-between gap-3 border-b-2 px-5 py-3.5 text-base font-medium ${
              creatingState.status === 'pending'
                ? 'border-neon-blue-400/60 bg-neon-blue-100/80 text-neon-blue-800 dark:border-neon-blue-400/50 dark:bg-neon-blue-950/70 dark:text-neon-blue-100'
                : 'border-red-400/60 bg-red-50 text-red-800 dark:border-red-500/50 dark:bg-red-950/60 dark:text-red-100'
            }`}
          >
            <div className="flex min-w-0 items-center gap-3">
              {creatingState.status === 'pending' ? (
                <>
                  <svg className="h-6 w-6 flex-shrink-0 animate-spin" viewBox="0 0 24 24" fill="none">
                    <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
                    <path d="M22 12a10 10 0 0 1-10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                  </svg>
                  <span className="text-lg font-semibold tracking-wide">Saving card…</span>
                </>
              ) : (
                <>
                  <span aria-hidden className="flex-shrink-0 text-xl leading-none">⚠</span>
                  <span className="truncate">Couldn&apos;t save: {creatingState.message}</span>
                </>
              )}
            </div>
            {creatingState.status === 'error' && (
              <div className="flex flex-shrink-0 items-center gap-2">
                <button
                  type="button"
                  onClick={() => onRetryCreate?.()}
                  className="rounded border border-red-400/50 px-3 py-1 text-sm font-medium text-red-700 hover:bg-red-100 dark:border-red-500/50 dark:text-red-200 dark:hover:bg-red-900/40"
                >
                  Retry
                </button>
                <button
                  type="button"
                  onClick={() => onCancelCreate?.()}
                  className="rounded border border-red-400/30 px-3 py-1 text-sm font-medium text-red-700 hover:bg-red-100 dark:border-red-500/30 dark:text-red-200 dark:hover:bg-red-900/40"
                >
                  Cancel
                </button>
              </div>
            )}
          </div>
        )}

        {/* Tabs — scrollable with arrow indicators */}
        <div className={`relative grain grain-soft ${modalStyles.tabsBorder} ${modalStyles.tabs}`}>
        <div ref={tabBarRef} onWheel={handleTabBarWheel} onMouseDown={handleTabBarMouseDown} className={`flex overflow-x-auto scrollbar-hide ${tabBarCanScrollLeft || tabBarCanScrollRight ? 'cursor-grab' : ''}`}>
          <button
            onClick={() => setActiveTab('details')}
            className={`shrink-0 px-4 py-2 text-sm font-medium transition-colors ${
              activeTab === 'details'
                ? isAutomation
                  ? 'border-b-2 border-orange-400 text-orange-500 dark:text-orange-400'
                  : 'border-b-2 border-neon-blue-400 text-neon-blue-500 dark:text-neon-blue-400'
                : 'text-void-500 hover:text-void-700 dark:text-void-400 dark:hover:text-void-300'
            }`}
          >
            Details
          </button>
          {hasDesign && (
            <button
              onClick={() => setActiveTab('design')}
              className={`flex shrink-0 items-center gap-1 px-4 py-2 text-sm font-medium transition-colors ${
                activeTab === 'design'
                  ? 'border-b-2 border-neon-blue-300 text-neon-blue-400 dark:text-neon-blue-300'
                  : 'text-void-500 hover:text-void-700 dark:text-void-400 dark:hover:text-void-300'
              }`}
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              Design
              {designRefs.length > 1 && (
                <span className="rounded bg-void-200 px-1.5 py-0.5 text-xs dark:bg-void-700">{designRefs.length}</span>
              )}
            </button>
          )}
          {hasFeature && (
            <button
              onClick={() => setActiveTab('feature')}
              className={`flex shrink-0 items-center gap-1 px-4 py-2 text-sm font-medium transition-colors ${
                activeTab === 'feature'
                  ? 'border-b-2 border-neon-blue-400 text-neon-blue-500 dark:text-neon-blue-400'
                  : 'text-void-500 hover:text-void-700 dark:text-void-400 dark:hover:text-void-300'
              }`}
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
              </svg>
              Feature
              {featureRefs.length > 1 && (
                <span className="rounded bg-void-200 px-1.5 py-0.5 text-xs dark:bg-void-700">{featureRefs.length}</span>
              )}
            </button>
          )}
          {hasHtml && (
            <button
              onClick={() => setActiveTab('html')}
              className={`flex shrink-0 items-center gap-1 px-4 py-2 text-sm font-medium transition-colors ${
                activeTab === 'html'
                  ? 'border-b-2 border-[#ff6a33] text-[#ff6a33]/90 dark:text-[#ff6a33]/90'
                  : 'text-void-500 hover:text-void-700 dark:text-void-400 dark:hover:text-void-300'
              }`}
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
              </svg>
              HTML
            </button>
          )}
          {hasTest && (
            <button
              onClick={() => setActiveTab('test')}
              className={`flex shrink-0 items-center gap-1 px-4 py-2 text-sm font-medium transition-colors ${
                activeTab === 'test'
                  ? 'border-b-2 border-[#00e676] text-[#00e676]/80 dark:text-[#00e676]/80'
                  : 'text-void-500 hover:text-void-700 dark:text-void-400 dark:hover:text-void-300'
              }`}
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
              </svg>
              Test
              {testRefs.length > 1 && (
                <span className="rounded bg-void-200 px-1.5 py-0.5 text-xs dark:bg-void-700">{testRefs.length}</span>
              )}
            </button>
          )}
          {hasQuestionnaires && (
            <button
              onClick={() => setActiveTab('questionnaires')}
              className={`flex shrink-0 items-center gap-1 px-4 py-2 text-sm font-medium transition-colors ${
                activeTab === 'questionnaires'
                  ? 'border-b-2 border-cyan-400 text-cyan-500 dark:text-cyan-400'
                  : 'text-void-500 hover:text-void-700 dark:text-void-400 dark:hover:text-void-300'
              }`}
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
              </svg>
              Questionnaires
              {(card.questionnaire_refs?.length ?? 0) > 1 && (
                <span className="rounded bg-cyan-100 px-1.5 py-0.5 text-xs dark:bg-cyan-900/50">
                  {card.questionnaire_refs!.length}
                </span>
              )}
            </button>
          )}
          <button
            onClick={() => setActiveTab('notes')}
            className={`flex shrink-0 items-center gap-1 px-4 py-2 text-sm font-medium transition-colors ${
              activeTab === 'notes'
                ? 'border-b-2 border-purple-400 text-purple-500 dark:text-purple-400'
                : 'text-void-500 hover:text-void-700 dark:text-void-400 dark:hover:text-void-300'
            }`}
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z" />
            </svg>
            Notes
            {(card.agentNotes?.length ?? 0) > 0 && (
              <span className="rounded bg-purple-100 px-1.5 py-0.5 text-xs dark:bg-purple-900/50">
                {card.agentNotes!.length}
              </span>
            )}
          </button>
          {hasChecklist && (
            <button
              onClick={() => setActiveTab('checklist')}
              className={`flex shrink-0 items-center gap-1 px-4 py-2 text-sm font-medium transition-colors ${
                activeTab === 'checklist'
                  ? 'border-b-2 border-[#ffd600] text-[#ffd600]/80 dark:text-[#ffd600]/80'
                  : 'text-void-500 hover:text-void-700 dark:text-void-400 dark:hover:text-void-300'
              }`}
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              Checklist
              <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs dark:bg-amber-900/50">
                {localChecklist.filter((i) => i.done).length}/{localChecklist.length}
              </span>
            </button>
          )}
          <button
            onClick={() => setActiveTab('terminal')}
            className={`flex shrink-0 items-center gap-2 px-4 py-2 text-sm font-medium transition-colors ${
              activeTab === 'terminal'
                ? 'border-b-2 border-neon-orange-400 text-neon-orange-500 dark:text-neon-orange-400'
                : 'text-void-500 hover:text-void-700 dark:text-void-400 dark:hover:text-void-300'
            }`}
          >
            <div className={`h-2 w-2 rounded-full ${
              anyRunning ? 'bg-green-500 shadow-[0_0_6px_rgba(34,197,94,0.6)]'
                : anyDetached ? 'bg-neon-orange-400 shadow-[0_0_6px_rgba(255,160,0,0.4)]'
                : 'bg-void-400'
            }`} />
            Terminal
            {anyRunning && (
              <span className="rounded bg-orange-100 px-1.5 py-0.5 text-xs dark:bg-orange-900/50">
                {activeSession?.status}
              </span>
            )}
          </button>
          {/* Provider pills + "+" button — right-aligned when terminal tab active */}
          {activeTab === 'terminal' && (
            <div className="ml-auto flex shrink-0 items-center gap-1 pr-2">
              {hasMultipleSessions && cardSessions.map(session => {
                const colors = getProviderColor(session.provider);
                const isActive = session.provider === selectedProvider;
                const isEnded = !session.resumable;
                return (
                  <button
                    key={session.provider}
                    onClick={() => setSelectedProvider(session.provider)}
                    title={isEnded ? 'Session ended — not resumable' : undefined}
                    className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-all ${
                      isActive ? 'shadow-sm' : isEnded ? 'opacity-35 hover:opacity-60' : 'opacity-60 hover:opacity-90'
                    }`}
                    style={isActive ? {
                      backgroundColor: colors.bg,
                      border: `1px solid ${colors.border}`,
                      color: colors.color,
                      ...(isEnded ? { filter: 'saturate(0.4)' } : {}),
                    } : {
                      border: '1px solid transparent',
                      color: colors.color,
                    }}
                  >
                    {isEnded ? (
                      /* Hollow ring = session record with nothing live behind it */
                      <div className="h-1.5 w-1.5 rounded-full border border-current opacity-70" />
                    ) : (
                      <div className="h-1.5 w-1.5 rounded-full" style={{
                        backgroundColor: session.status === 'running' ? '#00e676'
                          : session.status === 'detached' ? '#ff9800'
                          : '#6b7280',
                        boxShadow: session.status === 'running' ? '0 0 4px rgba(0, 230, 118, 0.6)' : 'none',
                      }} />
                    )}
                    {session.displayName}
                  </button>
                );
              })}
              {/* "+" button — always visible on terminal tab */}
              {(() => {
                const existingProviders = new Set(cardSessions.map(s => s.provider));
                const unused = availableProviders.filter(p => !existingProviders.has(p.id));
                if (unused.length === 0) return null;
                return (
                  <div ref={newSessionRef}>
                    <button
                      onClick={() => { setNewSessionDropdown(!newSessionDropdown); setNewSessionProvider(null); }}
                      className="flex h-6 w-6 items-center justify-center rounded-md border border-void-600 text-xs text-void-400 transition-all hover:border-void-500 hover:text-void-300"
                    >
                      +
                    </button>
                  </div>
                );
              })()}
            </div>
          )}
        </div>
        {/* Scroll arrow indicators */}
        {tabBarCanScrollLeft && (
          <button
            onClick={() => tabBarRef.current?.scrollBy({ left: -120, behavior: 'smooth' })}
            className="absolute left-0 top-0 z-10 flex h-full w-7 items-center justify-center bg-gradient-to-r from-void-800/90 to-transparent text-void-400 hover:text-void-200 transition-colors"
            aria-label="Scroll tabs left"
          >
            <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M15 19l-7-7 7-7" /></svg>
          </button>
        )}
        {tabBarCanScrollRight && (
          <button
            onClick={() => tabBarRef.current?.scrollBy({ left: 120, behavior: 'smooth' })}
            className="absolute right-0 top-0 z-10 flex h-full w-7 items-center justify-center bg-gradient-to-l from-void-800/90 to-transparent text-void-400 hover:text-void-200 transition-colors"
            aria-label="Scroll tabs right"
          >
            <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" /></svg>
          </button>
        )}
        </div>

        {/* Content */}
        <div className={activeTab === 'terminal' || activeTab === 'notes' || activeTab === 'html' || activeTab === 'questionnaires' ? 'min-h-0 flex-1 lg:flex-initial lg:h-[60vh]' : 'min-h-0 flex-1 overflow-y-auto overscroll-contain lg:flex-initial lg:max-h-[60vh]'}>
          {activeTab === 'details' ? (
            <div className="p-4">
              {/* Compact Metadata Strip */}
              <div className="mb-4 flex flex-wrap items-center gap-3">
                {/* Stage/Priority/Areas — hidden in automation mode */}
                {!isAutomation && (
                  <>
                    {/* Stage dropdown */}
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-medium text-void-500 dark:text-void-400">Stage:</span>
                      <select
                        value={stage}
                        onChange={(e) => onMove(card.id, e.target.value as KanbanStage)}
                        className="stage-focus rounded border border-void-300 bg-white px-2 py-1 text-xs font-medium text-void-700 dark:border-void-600 dark:bg-void-800 dark:text-void-300"
                      >
                        {STAGES.map((s) => (
                          <option key={s.id} value={s.id}>{s.label}</option>
                        ))}
                      </select>
                    </div>

                    {/* Priority dropdown */}
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-medium text-void-500 dark:text-void-400">Priority:</span>
                      <select
                        value={card.priority}
                        onChange={(e) => onUpdate({ ...card, priority: e.target.value as typeof PRIORITIES[number], updated_at: new Date().toISOString() })}
                        className="stage-focus rounded border border-void-300 bg-white px-2 py-1 text-xs font-medium capitalize text-void-700 dark:border-void-600 dark:bg-void-800 dark:text-void-300"
                      >
                        {PRIORITIES.map((p) => (
                          <option key={p} value={p}>{p}</option>
                        ))}
                      </select>
                    </div>

                    {/* Divider */}
                    <div className="h-4 w-px bg-void-300 dark:bg-void-600" />

                    {/* Areas */}
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-xs font-medium text-void-500 dark:text-void-400">Areas:</span>
                      {card.areas.map((area) => (
                        <span
                          key={area}
                          className="inline-flex items-center gap-1 rounded bg-indigo-100 px-1.5 py-0.5 text-xs text-indigo-700 dark:bg-indigo-900/50 dark:text-indigo-300"
                        >
                          {area}
                          <button
                            onClick={() => handleRemoveArea(area)}
                            className="ml-0.5 hover:text-indigo-900 dark:hover:text-indigo-100"
                          >
                            <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                          </button>
                        </span>
                      ))}
                      {unusedAreas.length > 0 && (
                        <select
                          value=""
                          onChange={(e) => {
                            if (e.target.value) handleAddArea(e.target.value);
                          }}
                          className="stage-focus rounded border border-dashed border-void-300 bg-transparent px-1.5 py-0.5 text-xs text-void-500 hover:border-void-400 dark:border-void-600 dark:text-void-400"
                        >
                          <option value="">+ Add</option>
                          {unusedAreas.map((area) => (
                            <option key={area} value={area}>{area}</option>
                          ))}
                        </select>
                      )}
                    </div>

                    {/* Divider */}
                    <div className="h-4 w-px bg-void-300 dark:bg-void-600" />
                  </>
                )}

                {/* Tags (drag-to-reorder) */}
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-xs font-medium text-void-500 dark:text-void-400">Tags:</span>
                  {card.tags.map((tag, index) => (
                    <span
                      key={tag}
                      draggable
                      onDragStart={(e) => {
                        setDragTagIndex(index);
                        e.dataTransfer.effectAllowed = 'move';
                      }}
                      onDragOver={(e) => {
                        e.preventDefault();
                        e.dataTransfer.dropEffect = 'move';
                        setDragOverTagIndex(index);
                      }}
                      onDragLeave={() => setDragOverTagIndex(null)}
                      onDrop={(e) => {
                        e.preventDefault();
                        if (dragTagIndex !== null) handleTagDrop(dragTagIndex, index);
                      }}
                      onDragEnd={() => {
                        setDragTagIndex(null);
                        setDragOverTagIndex(null);
                      }}
                      className={`inline-flex cursor-grab items-center gap-1 rounded px-1.5 py-0.5 text-xs transition-all active:cursor-grabbing ${
                        dragTagIndex === index
                          ? 'opacity-50'
                          : dragOverTagIndex === index
                            ? 'bg-orange-200 text-orange-700 ring-1 ring-orange-400/50 dark:bg-orange-900/30 dark:text-orange-300'
                            : index === 0 && isAutomation
                              ? 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300'
                              : 'bg-void-100 text-void-600 dark:bg-void-700 dark:text-void-400'
                      }`}
                    >
                      {tag}
                      <button
                        onClick={() => handleRemoveTag(tag)}
                        className="ml-0.5 hover:text-void-900 dark:hover:text-void-100"
                      >
                        <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </span>
                  ))}
                  <input
                    type="text"
                    value={newTagInput}
                    onChange={(e) => setNewTagInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && newTagInput.trim()) {
                        e.preventDefault();
                        handleAddTag(newTagInput);
                      }
                    }}
                    onBlur={() => {
                      if (newTagInput.trim()) handleAddTag(newTagInput);
                    }}
                    placeholder="+ tag"
                    className="stage-focus w-16 rounded border border-dashed border-void-300 bg-transparent px-1.5 py-0.5 text-xs text-void-500 placeholder-void-400 hover:border-void-400 dark:border-void-600 dark:text-void-400 dark:placeholder-void-500"
                  />
                </div>

                {/* References (icons only) */}
                {(hasDesign || hasFeature || hasTest || hasHtml) && (
                  <>
                    <div className="h-4 w-px bg-void-300 dark:bg-void-600" />
                    <div className="flex items-center gap-1">
                      <span className="text-xs font-medium text-void-500 dark:text-void-400">Docs:</span>
                      {hasDesign && (
                        <button
                          onClick={() => setActiveTab('design')}
                          className="relative rounded p-1.5 text-purple-600 hover:bg-purple-100 dark:text-purple-400 dark:hover:bg-purple-900/30"
                          title={designRefs.join('\n')}
                        >
                          {/* Clipboard/pencil icon for design */}
                          <svg className="h-8 w-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
                          </svg>
                          {designRefs.length > 1 && (
                            <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-purple-600 px-1 font-mono text-[10px] font-bold leading-none text-white">
                              {designRefs.length}
                            </span>
                          )}
                        </button>
                      )}
                      {hasFeature && (
                        <button
                          onClick={() => setActiveTab('feature')}
                          className="relative rounded p-1.5 text-blue-600 hover:bg-blue-100 dark:text-blue-400 dark:hover:bg-blue-900/30"
                          title={featureRefs.join('\n')}
                        >
                          {/* Checklist icon for feature */}
                          <svg className="h-8 w-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
                          </svg>
                          {featureRefs.length > 1 && (
                            <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-blue-600 px-1 font-mono text-[10px] font-bold leading-none text-white">
                              {featureRefs.length}
                            </span>
                          )}
                        </button>
                      )}
                      {hasHtml && (
                        <button
                          onClick={() => setActiveTab('html')}
                          className="relative rounded p-1.5 text-[#ff6a33] hover:bg-[#ff6a33]/15 dark:text-[#ff6a33] dark:hover:bg-[#ff6a33]/20"
                          title={htmlRefs.join('\n')}
                        >
                          {/* Code-brackets icon for HTML */}
                          <svg className="h-8 w-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
                          </svg>
                          {htmlRefs.length > 1 && (
                            <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-[#ff6a33] px-1 font-mono text-[10px] font-bold leading-none text-white">
                              {htmlRefs.length}
                            </span>
                          )}
                        </button>
                      )}
                      {hasTest && (
                        <button
                          onClick={() => setActiveTab('test')}
                          className="relative rounded p-1.5 text-green-600 hover:bg-green-100 dark:text-green-400 dark:hover:bg-green-900/30"
                          title={testRefs.join('\n')}
                        >
                          {/* Checkmark box icon for test */}
                          <svg className="h-8 w-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                          </svg>
                          {testRefs.length > 1 && (
                            <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-green-600 px-1 font-mono text-[10px] font-bold leading-none text-white">
                              {testRefs.length}
                            </span>
                          )}
                        </button>
                      )}
                    </div>
                  </>
                )}
              </div>

              {/* Description */}
              <div className="mb-4">
                <label className="mb-2 block text-sm font-medium text-void-700 dark:text-void-300">
                  {isAutomation ? 'Description / Automation Instructions' : 'Description'}
                  {isCreateMode && (
                    <span className="ml-2 font-normal text-void-400">(Ctrl+Enter to save)</span>
                  )}
                </label>
                <textarea
                  ref={descriptionRef}
                  value={editedDescription}
                  data-voice-target
                  onChange={(e) => handleDescriptionChange(e.target.value)}
                  onFocus={() => markFieldEditing('description')}
                  onKeyDown={(e) => {
                    // Ctrl+Enter or Cmd+Enter to save and close
                    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                      e.preventDefault();
                      handleCloseWithSave();
                    }
                  }}
                  placeholder="Add a description..."
                  className="stage-focus h-[235px] w-full resize-none overflow-y-auto rounded-lg border border-void-300 bg-white p-3 text-sm text-void-700 dark:border-void-600 dark:bg-void-800 dark:text-void-300"
                />
              </div>

              {/* Automation Config — shown instead of problems when automation mode is on */}
              {isAutomation && card.automation ? (
                <div className="mb-4">
                  <AutomationConfig
                    config={card.automation}
                    cardId={card.id}
                    projectId={projectId}
                    onChange={(newConfig) => {
                      onUpdate({ ...card, automation: newConfig, updated_at: new Date().toISOString() });
                    }}
                  />
                </div>
              ) : (
                /* Problems / Issues — hidden for automation cards */
                <div className="mb-4">
                  <div className="mb-2 flex items-center justify-between">
                    <label className="text-sm font-medium text-void-700 dark:text-void-300">
                      Problems / Issues ({unresolvedProblems.length} open)
                    </label>
                    {unresolvedProblems.length > 0 && stage === 'testing' && (
                      <button
                        onClick={handlePushBackForBugs}
                        className="rounded bg-red-600 px-2 py-1 text-xs font-medium text-white hover:bg-red-700"
                      >
                        Push to Implementation
                      </button>
                    )}
                  </div>

                  <div className="mb-2 space-y-2">
                    {unresolvedProblems.map((problem) => (
                      <div
                        key={problem.id}
                        className="flex items-start gap-2 rounded-lg bg-red-50 p-2 dark:bg-red-900/20"
                      >
                        <svg className="mt-0.5 h-4 w-4 flex-shrink-0 text-red-500" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                        </svg>
                        <div className="flex-1">
                          <p className="text-sm text-red-800 dark:text-red-200">{problem.description}</p>
                          <p className="text-xs text-red-600 dark:text-red-400">
                            {new Date(problem.created_at).toLocaleDateString()}
                          </p>
                        </div>
                        <button
                          onClick={() => handleResolveProblem(problem.id)}
                          className="rounded px-2 py-1 text-xs text-red-600 hover:bg-red-100 dark:text-red-400 dark:hover:bg-red-900/40"
                        >
                          Resolve
                        </button>
                      </div>
                    ))}

                    {resolvedProblems.length > 0 && (
                      <details className="text-sm">
                        <summary className="cursor-pointer text-void-500">
                          {resolvedProblems.length} resolved
                        </summary>
                        <div className="mt-2 space-y-1">
                          {resolvedProblems.map((problem) => (
                            <div
                              key={problem.id}
                              className="rounded bg-void-100 p-2 text-void-500 line-through dark:bg-void-800"
                            >
                              {problem.description}
                            </div>
                          ))}
                        </div>
                      </details>
                    )}
                  </div>

                  <div className="flex gap-2">
                    <input
                      type="text"
                      data-voice-target
                      value={newProblem}
                      onChange={(e) => setNewProblem(e.target.value)}
                      placeholder="Describe an issue..."
                      className="stage-focus flex-1 rounded-lg border border-void-300 bg-white px-3 py-2 text-sm dark:border-void-600 dark:bg-void-800 dark:text-void-100"
                      onKeyDown={(e) => e.key === 'Enter' && handleAddProblem()}
                    />
                    <button
                      onClick={handleAddProblem}
                      className="rounded-lg bg-void-200 px-3 py-2 text-sm font-medium text-void-700 hover:bg-void-300 dark:bg-void-700 dark:text-void-300 dark:hover:bg-void-600"
                    >
                      Add
                    </button>
                  </div>
                </div>
              )}

            </div>
          ) : activeTab === 'questionnaires' ? (
            /* Questionnaires View — interactive Q&A forms */
            <div className="flex h-full flex-col">
              <QuestionnaireTab
                card={card}
                projectId={projectId}
                activeSessionName={activeSession?.name ?? sessionName}
                activeProvider={selectedProvider ?? activeSession?.provider ?? undefined}
                cwd={cwd}
                onSubmitSuccess={() => setActiveTab('terminal')}
                onUnlink={handleUnlinkRef}
              />
            </div>
          ) : activeTab === 'html' && hasHtml ? (
            /* HTML Attachments View — index list + sandboxed iframe viewer (feature 072) */
            <div className="flex h-full flex-col">
              <HtmlAttachmentsTab refs={htmlRefs} projectId={projectId} cardId={card.id} onUnlink={handleUnlinkRef} />
            </div>
          ) : activeTab === 'design' || activeTab === 'feature' || activeTab === 'test' ? (
            /* Document View - Design, Feature, or Test (multi-attachment, feature 074) */
            <div className="flex h-full flex-col">
              <DocAttachmentsTab
                key={activeTab}
                kind={activeTab}
                refs={activeTab === 'design' ? designRefs : activeTab === 'feature' ? featureRefs : testRefs}
                projectId={projectId}
                cardId={card.id}
                onUnlink={handleUnlinkRef}
              />
            </div>
          ) : activeTab === 'checklist' ? (
            /* Checklist View */
            <div className="p-4">
              <div className="mb-4 flex items-center justify-between">
                <h3 className="text-lg font-medium text-void-900 dark:text-void-100">
                  Checklist ({localChecklist.filter((i) => i.done).length}/{localChecklist.length} complete)
                </h3>
                <div className="h-2 flex-1 mx-4 rounded-full bg-void-200 dark:bg-void-700">
                  <div
                    className="h-2 rounded-full bg-green-500 transition-all"
                    style={{ width: `${(localChecklist.filter((i) => i.done).length / localChecklist.length) * 100}%` }}
                  />
                </div>
              </div>
              <div className="space-y-2">
                {localChecklist.map((item) => (
                  <label
                    key={item.id}
                    className={`flex cursor-pointer select-none items-center gap-3 rounded-lg p-3 transition-colors active:scale-[0.99] ${
                      item.done
                        ? 'bg-green-50 dark:bg-green-900/20'
                        : 'bg-void-50 hover:bg-void-100 dark:bg-void-800 dark:hover:bg-void-700'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={item.done}
                      onChange={() => toggleChecklistItem(item.id)}
                      className="h-5 w-5 flex-shrink-0 rounded border-void-300 text-green-600 focus:ring-green-500"
                    />
                    <span className={`flex-1 ${item.done ? 'text-void-500 line-through' : 'text-void-900 dark:text-void-100'}`}>
                      {item.text}
                    </span>
                  </label>
                ))}
              </div>
              {/* Add new checklist item */}
              <div className="mt-4 flex gap-2">
                <input
                  type="text"
                  data-voice-target
                  placeholder="Add checklist item..."
                  className="stage-focus flex-1 rounded-lg border border-void-300 bg-white px-3 py-2 text-sm dark:border-void-600 dark:bg-void-800 dark:text-void-100"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && e.currentTarget.value.trim()) {
                      addChecklistItem(e.currentTarget.value.trim());
                      e.currentTarget.value = '';
                    }
                  }}
                />
              </div>
            </div>
          ) : activeTab === 'notes' ? (
            /* Agent Notes View */
            <div className="flex h-full flex-col p-4">
              <div className="mb-4 flex items-center justify-between">
                <h3 className="text-lg font-medium text-void-900 dark:text-void-100">
                  Notes ({card.agentNotes?.length ?? 0})
                </h3>
                {(card.agentNotes?.length ?? 0) > 0 && (
                  showClearConfirm ? (
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-void-500">Clear all notes?</span>
                      <button
                        onClick={clearNotes}
                        className="rounded px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/20"
                      >
                        Confirm
                      </button>
                      <button
                        onClick={() => setShowClearConfirm(false)}
                        className="rounded px-2 py-1 text-xs font-medium text-void-500 hover:bg-void-100 dark:hover:bg-void-800"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setShowClearConfirm(true)}
                      className="rounded px-2 py-1 text-xs font-medium text-void-500 hover:bg-void-100 hover:text-red-600 dark:hover:bg-void-800 dark:hover:text-red-400"
                    >
                      Clear All
                    </button>
                  )
                )}
              </div>
              <div className="relative min-h-0 flex-1">
              {/* Scroll shadow: top */}
              {notesCanScrollUp && (
                <div className="pointer-events-none absolute inset-x-0 top-0 z-10 h-6 bg-gradient-to-b from-void-100/90 to-transparent dark:from-void-900/90" />
              )}
              {/* Scroll shadow: bottom */}
              {notesCanScrollDown && (
                <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-6 bg-gradient-to-t from-void-100/90 to-transparent dark:from-void-900/90" />
              )}
              <div
                ref={notesScrollRef}
                onScroll={updateNotesScrollState}
                className="h-full overflow-y-auto"
              >
              {(card.agentNotes?.length ?? 0) === 0 ? (
                <div className="py-8 text-center text-sm text-void-400">
                  No notes yet. Add a note below or use the CLI: <code className="rounded bg-void-100 px-1.5 py-0.5 text-xs dark:bg-void-800">sly-kanban notes {card.id} add &quot;...&quot;</code>
                </div>
              ) : (
                <div className="space-y-3">
                  {card.agentNotes!.map((note) => {
                    const noteDate = new Date(note.timestamp);
                    const now = new Date();
                    const diffMs = now.getTime() - noteDate.getTime();
                    const diffMins = Math.floor(diffMs / 60000);
                    const diffHours = Math.floor(diffMs / 3600000);
                    const diffDays = Math.floor(diffMs / 86400000);
                    let timeAgo = 'just now';
                    if (diffDays > 0) timeAgo = `${diffDays}d ago`;
                    else if (diffHours > 0) timeAgo = `${diffHours}h ago`;
                    else if (diffMins > 0) timeAgo = `${diffMins}m ago`;

                    return (
                      <div
                        key={note.id}
                        className="group rounded-lg bg-void-50 p-3 dark:bg-void-800"
                      >
                        <div className="mb-1 flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            {note.agent && (
                              <span className="rounded bg-purple-100 px-1.5 py-0.5 text-xs font-medium text-purple-700 dark:bg-purple-900/40 dark:text-purple-300">
                                {note.agent}
                              </span>
                            )}
                            {note.summary && (
                              <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-900/40 dark:text-amber-300" title={`Summary of ${note.summarizedCount ?? '?'} notes${note.dateRange ? ` (${note.dateRange})` : ''}`}>
                                Summary
                              </span>
                            )}
                            <span className="text-xs text-void-400">{timeAgo}</span>
                          </div>
                          <button
                            onClick={() => deleteNote(note.id)}
                            className="rounded p-1 text-void-400 opacity-0 transition-opacity hover:bg-void-200 hover:text-red-500 group-hover:opacity-100 dark:hover:bg-void-700 dark:hover:text-red-400"
                            title="Delete note"
                          >
                            <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                          </button>
                        </div>
                        <p className="whitespace-pre-wrap text-sm text-void-700 dark:text-void-200">
                          {note.text}
                        </p>
                      </div>
                    );
                  })}
                </div>
              )}
              </div>
              </div>
              {/* Add new note */}
              <div className="mt-4 flex flex-shrink-0 gap-2">
                <textarea
                  value={newNoteText}
                  onChange={(e) => setNewNoteText(e.target.value)}
                  data-voice-target
                  placeholder="Type a note... (Shift+Enter for new line)"
                  rows={2}
                  className="stage-focus flex-1 resize-none rounded-lg border border-void-300 bg-white px-3 py-2 text-sm dark:border-void-600 dark:bg-void-800 dark:text-void-100"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey && newNoteText.trim()) {
                      e.preventDefault();
                      addNote(newNoteText.trim());
                      setNewNoteText('');
                    }
                  }}
                />
                <button
                  onClick={() => {
                    if (newNoteText.trim()) {
                      addNote(newNoteText.trim());
                      setNewNoteText('');
                    }
                  }}
                  disabled={!newNoteText.trim()}
                  className="rounded-lg bg-purple-500 px-4 py-2 text-sm font-medium text-white hover:bg-purple-600 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Add
                </button>
              </div>
            </div>
          ) : activeTab === 'terminal' && activeSession && !activeSession.resumable ? (
            /* Ended session with no captured conversation id (feature 080) —
               nothing to resume, so offer recovery/removal instead of a terminal */
            <div className="h-full min-w-0">
              <EndedSessionPanel
                sessionName={activeSession.name}
                provider={activeSession.provider}
                displayName={activeSession.displayName}
                endedAt={activeSession.exitedAt ?? activeSession.lastActive}
                onRelinked={refreshCardSessions}
                onDismissed={refreshCardSessions}
              />
            </div>
          ) : activeTab === 'terminal' ? (
            /* Terminal Tab - uses shared component */
            <div className="h-full min-w-0">
              <ClaudeTerminalPanel
                sessionName={sessionName}
                sessionNameAliases={projectKeyShape.sessionKeyAliases.map(alias => `${alias}:card:${card.id}`)}
                cwd={cwd}
                actionsConfig={actionsConfig}
                actions={actions}
                context={terminalContext}
                cardId={card.id}
                cardAreas={card.areas}
                projectId={projectId}
                initialProvider={selectedProvider ?? undefined}
                parentControlsProvider={hasMultipleSessions}
                footerClassName={terminalColor}
                tintColor={terminalTint}
                onSessionChange={(info) => {
                  if (!selectedProvider) {
                    // No pill state yet — the card had no sessions when the
                    // modal opened and one just appeared (e.g. started from
                    // the panel). Discover it so selectedProvider/cardSessions
                    // populate; without this the panel's provider has no
                    // anchor and an external stage move can rewrite it,
                    // unlinking the running session.
                    if (info) refreshCardSessions();
                    return;
                  }
                  // Update the current provider's status in place
                  setCardSessions(prev => {
                    if (!info) return prev.filter(s => s.provider !== selectedProvider);
                    return prev.map(s => {
                      if (s.provider !== selectedProvider) return s;
                      const hasHistory = info.hasHistory ?? s.hasHistory;
                      return {
                        ...s,
                        status: info.status,
                        hasHistory,
                        resumable: info.status !== 'stopped' || hasHistory,
                      };
                    });
                  });
                  // Re-check for new sibling sessions (e.g. cross-card prompt created a new provider)
                  refreshCardSessions();
                }}
                onProviderChange={(provider) => setSelectedProvider(provider)}
                voiceTerminalId="card-modal"
                onTerminalReady={(handle) => {
                  terminalHandleRef.current = handle ?? null;
                  if (handle) { voice.registerTerminal('card-modal', handle); }
                  else { voice.unregisterTerminal('card-modal'); }
                }}
              />
            </div>
          ) : null}
        </div>

        {/* Footer - only show when not on terminal tab (terminal has its own footer) */}
        {activeTab !== 'terminal' && (
          <div className="flex items-center justify-between border-t border-void-200 px-4 py-2 text-xs text-void-500 dark:border-void-700 dark:text-void-400">
            <span>Created: {new Date(card.created_at).toLocaleDateString()}</span>
            <span>Updated: {new Date(card.updated_at).toLocaleDateString()}</span>
          </div>
        )}
      </div>

      {/* Delete Confirmation Dialog */}
      <ConfirmDialog
        open={showDeleteConfirm}
        onClose={() => setShowDeleteConfirm(false)}
        onConfirm={() => {
          onDelete?.(card.id);
          setShowDeleteConfirm(false);
        }}
        title="Delete Card"
        message={<>Are you sure you want to permanently delete <span className="font-medium text-void-900 dark:text-void-200">&quot;{card.title}&quot;</span>? This action cannot be undone.</>}
      />

      {/* Voice popovers — rendered via portal to escape header stacking context */}
      {/* New provider session dropdown — portal to escape tab bar overflow clipping */}
      {newSessionDropdown && newSessionRef.current && createPortal(
        (() => {
          const rect = newSessionRef.current!.getBoundingClientRect();
          const existingProviders = new Set(cardSessions.map(s => s.provider));
          const unused = availableProviders.filter(p => !existingProviders.has(p.id));
          return (
            <div
              ref={newSessionPortalRef}
              className="fixed z-[60] min-w-[180px] rounded-lg border border-void-600 bg-void-800 p-2 shadow-(--shadow-overlay)"
              style={{ top: rect.bottom + 4, right: window.innerWidth - rect.right }}
            >
              {!newSessionProvider ? (
                <div className="flex flex-col gap-1">
                  <span className="px-1 text-[10px] font-medium uppercase tracking-wider text-void-500">Start session</span>
                  {unused.map(p => {
                    const colors = getProviderColor(p.id);
                    return (
                      <button
                        key={p.id}
                        onClick={() => { setNewSessionProvider(p.id); setNewSessionSkipPerms(p.permissions.default); }}
                        className="flex items-center gap-2 rounded-md px-2 py-1.5 text-xs font-medium transition-colors hover:bg-void-700"
                        style={{ color: colors.color }}
                      >
                        <div className="h-2 w-2 rounded-full" style={{ backgroundColor: colors.dot }} />
                        {p.displayName}
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  {(() => {
                    const p = availableProviders.find(pr => pr.id === newSessionProvider);
                    if (!p) return null;
                    const colors = getProviderColor(p.id);
                    return (
                      <>
                        <div className="flex items-center gap-2 text-xs font-medium" style={{ color: colors.color }}>
                          <div className="h-2 w-2 rounded-full" style={{ backgroundColor: colors.dot }} />
                          {p.displayName}
                        </div>
                        <label className="flex items-center gap-1.5 text-[11px] text-void-500 cursor-pointer">
                          <input type="checkbox" checked={newSessionSkipPerms} onChange={e => setNewSessionSkipPerms(e.target.checked)} className="rounded border-void-600" />
                          {p.permissions.label}
                        </label>
                        <button
                          onClick={async () => {
                            const name = `${sessionKey}:${newSessionProvider}:card:${card.id}`;
                            try {
                              await fetch('/api/bridge/sessions', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({
                                  name, provider: newSessionProvider, cwd, skipPermissions: newSessionSkipPerms,
                                  // Model rides only with the default provider; other providers use their own CLI default.
                                  ...(globalDefault?.model && globalDefault.provider === newSessionProvider ? { model: globalDefault.model } : {}),
                                }),
                              });
                              setSelectedProvider(newSessionProvider);
                              setNewSessionDropdown(false);
                              setNewSessionProvider(null);
                              // Refresh sessions list after a short delay for bridge to register
                              setTimeout(() => refreshCardSessions(), 1000);
                            } catch { /* bridge error */ }
                          }}
                          className="rounded-md bg-neon-blue-400/20 px-3 py-1.5 text-xs font-medium text-neon-blue-400 transition-colors hover:bg-neon-blue-400/30"
                        >
                          Start
                        </button>
                      </>
                    );
                  })()}
                </div>
              )}
            </div>
          );
        })(),
        document.body,
      )}
      {voice.showSettings && createPortal(
        <VoicePopoverPortal anchorRef={voiceAnchorRef}>
          <VoiceSettingsPopover
            settings={voice.settings.voice}
            onSave={(patch) => voice.updateSettings({ voice: patch })}
            onClose={() => { voiceSettingsClosedAtRef.current = Date.now(); voice.setShowSettings(false); }}
          />
        </VoicePopoverPortal>,
        document.body,
      )}
      {voice.voiceState === 'error' && voice.error && createPortal(
        <VoicePopoverPortal anchorRef={voiceAnchorRef}>
          <VoiceErrorPopup
            error={voice.error}
            hasRecording={voice.hasRecording}
            onRetry={() => voice.retryTranscription()}
            onClear={() => voice.clearRecording()}
            onClose={() => voice.clearRecording()}
          />
        </VoicePopoverPortal>,
        document.body,
      )}
    </div>
  );
}
