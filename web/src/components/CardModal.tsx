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
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { StagePipeline } from './StagePipeline';
import { VOICE_SHEET_QUERY, visibleBottom } from '@/lib/visible-viewport';
import { VoiceSheet } from './VoiceSheet';
import { Check, ChevronDown, Columns2 } from 'lucide-react';
import { readCardSplit, writeCardSplit, readSplitDefault, writeSplitDefault, readSplitRatio, writeSplitRatio, clampRatio, DEFAULT_RATIO } from '@/lib/card-split-prefs';
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
import { SpeakerToggle } from './SpeakerToggle';
import { formatSpeakerLine } from '@/lib/speaker-line';
import { VoiceErrorPopup } from './VoiceErrorPopup';
import { useVoice } from '@/contexts/VoiceContext';
import { readStatus, formatStatusForPrompt } from '@/lib/status';
import { computeSessionKey, sessionBelongsToProject } from '@/lib/session-keys';
import { formatDate } from '@/lib/date-format';
import { formatCardNumber } from '@/lib/kanban-numbering';
import { placePopover } from '@/lib/popover-placement';
import Tooltip from './Tooltip';

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
  conversationStartedAt?: string;
  provider?: string;
  exitedAt?: string;
}

interface CardSession {
  name: string;
  provider: string;
  status: 'running' | 'stopped' | 'detached';
  hasHistory: boolean;
  createdAt: string;
  /** When the current conversation began (card #0373); absent from older bridges. */
  conversationStartedAt?: string;
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
  /**
   * Flush the parent's debounced board save to disk NOW (card #0357), optionally
   * committing one card edit in the same write. Resolves true once the write has
   * settled successfully. Awaited before any Sly Action / session start so the
   * agent's own `sly-kanban show` reads what the modal shows.
   */
  onFlushSave?: (cardOverride?: KanbanCard) => Promise<boolean>;
  onMove: (cardId: string, stage: KanbanStage) => void;
  onDelete?: (cardId: string) => void;
  isCreateMode?: boolean;
  /** Eager create. `stayOpen` keeps the modal open on the persisted card (card #0357). Resolves true on success. */
  onCreate?: (card: NewCardData, opts?: { stayOpen?: boolean }) => Promise<boolean>;
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

// Visual elevation: type and priority are information, not decoration —
// neutral chips, with only Critical in the danger colour.
const typeColors: Record<string, string> = {
  feature: 'border border-line bg-surface-2 text-ink-2',
  chore: 'border border-line bg-surface-2 text-ink-2',
  bug: 'border border-line bg-surface-2 text-ink-2',
};

const priorityColors: Record<string, string> = {
  critical: 'border border-transparent bg-danger/10 text-danger-text',
  high: 'border border-line bg-surface-2 text-ink-1',
  medium: 'border border-line bg-surface-2 text-ink-2',
  low: 'border border-line bg-surface-2 text-ink-3',
};

type TabId = 'details' | 'design' | 'feature' | 'html' | 'test' | 'questionnaires' | 'notes' | 'checklist' | 'terminal';

const stageTerminalColors: Record<KanbanStage, string> = {
  backlog: 'border-t border-line bg-void-800',
  design: 'border-t border-line bg-void-800',
  implementation: 'border-t border-line bg-void-800',
  testing: 'border-t border-line bg-void-800',
  done: 'border-t border-line bg-void-800',
};

const stageTerminalTint: Record<KanbanStage, string> = {
  backlog: 'rgba(120, 120, 140, 0.12)',
  design: 'rgba(0, 191, 255, 0.1)',
  implementation: 'rgba(0, 191, 255, 0.12)',
  testing: 'rgba(255, 106, 51, 0.1)',
  done: 'rgba(0, 230, 118, 0.1)',
};

// Stage identity: a 2px stage rule on the modal's top edge and a faint stage
// tint in the header (stronger in the dark skin). Everything else is flat.
const stageModalStyles: Record<KanbanStage, { header: string; tabs: string; modalBorder: string; headerBorder: string; tabsBorder: string }> = {
  backlog: {
    header: 'bg-gradient-to-r from-st-backlog/[0.07] to-transparent dark:from-st-backlog/[0.12]',
    tabs: '',
    modalBorder: 'lg:border lg:border-line lg:border-t-2 lg:border-t-st-backlog',
    headerBorder: 'border-b border-line',
    tabsBorder: 'border-b border-line',
  },
  design: {
    header: 'bg-gradient-to-r from-st-design/[0.07] to-transparent dark:from-st-design/[0.12]',
    tabs: '',
    modalBorder: 'lg:border lg:border-line lg:border-t-2 lg:border-t-st-design',
    headerBorder: 'border-b border-line',
    tabsBorder: 'border-b border-line',
  },
  implementation: {
    header: 'bg-gradient-to-r from-st-impl/[0.07] to-transparent dark:from-st-impl/[0.12]',
    tabs: '',
    modalBorder: 'lg:border lg:border-line lg:border-t-2 lg:border-t-st-impl',
    headerBorder: 'border-b border-line',
    tabsBorder: 'border-b border-line',
  },
  testing: {
    header: 'bg-gradient-to-r from-st-test/[0.07] to-transparent dark:from-st-test/[0.12]',
    tabs: '',
    modalBorder: 'lg:border lg:border-line lg:border-t-2 lg:border-t-st-test',
    headerBorder: 'border-b border-line',
    tabsBorder: 'border-b border-line',
  },
  done: {
    header: 'bg-gradient-to-r from-st-done/[0.07] to-transparent dark:from-st-done/[0.12]',
    tabs: '',
    modalBorder: 'lg:border lg:border-line lg:border-t-2 lg:border-t-st-done',
    headerBorder: 'border-b border-line',
    tabsBorder: 'border-b border-line',
  },
};

// Orange-themed styles for automation cards
const automationModalStyles = {
  header: 'bg-gradient-to-r from-agent/[0.08] to-transparent dark:from-agent/[0.12]',
  tabs: '',
  modalBorder: 'lg:border lg:border-line lg:border-t-2 lg:border-t-agent',
  headerBorder: 'border-b border-line',
  tabsBorder: 'border-b border-line',
};
const automationTerminalColor = 'border-t border-line bg-void-800';
const automationTerminalTint = 'rgba(249, 115, 22, 0.12)';

// Stage-aware input focus colors — uses CSS variable for reliable dynamic color
const stageFocusRgb: Record<KanbanStage, string> = {
  backlog: '161, 161, 170',    // void-400
  design: '138, 111, 245',     // stage design hue
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
      // Below the gear, or above when there is more room; the popover's
      // height is capped to that room via --voice-popover-max-h (#0369).
      // Capped to what can be seen, so the keyboard or a toolbar never hides its end (#0376).
      const place = placePopover(rect, { width: window.innerWidth, height: visibleBottom(window) });
      setStyle({
        position: 'fixed',
        ...(place.side === 'below' ? { top: place.top } : { bottom: place.bottom }),
        right: place.right,
        zIndex: 9999,
        opacity: 1,
        ['--voice-popover-max-h' as string]: `${place.maxHeight}px`,
      });
    };
    update();
    window.addEventListener('scroll', update, true);
    window.addEventListener('resize', update);
    window.visualViewport?.addEventListener('resize', update);
    return () => {
      window.removeEventListener('scroll', update, true);
      window.removeEventListener('resize', update);
      window.visualViewport?.removeEventListener('resize', update);
    };
  }, [anchorRef]);

  return <div style={style}>{children}</div>;
}

export function CardModal({ card, stage, projectId, projectPath, onClose, onUpdate, onFlushSave, onMove, onDelete, isCreateMode, onCreate, creatingState, onRetryCreate, onCancelCreate, onAutomationToggle, suppressAutoTerminal, pendingShortcut, onPendingShortcutConsumed }: CardModalProps) {
  const [activeTab, setActiveTab] = useState<TabId>('details');
  // Workbench (wide screens): the terminal sits beside the card instead of in
  // a tab. The left side shows the last non-terminal tab; selecting
  // "terminal" (auto-open, questionnaire submit) leaves it where it was.
  const isWide = useMediaQuery('(min-width: 1280px)');
  const voiceSheetLayout = useMediaQuery(VOICE_SHEET_QUERY);
  // Side by side: per card, falling back to a per-browser default (off out of
  // the box) — handy for reading a design doc while typing in the terminal,
  // not always wanted. Rules live in lib/card-split-prefs.
  const [splitPref, setSplitPref] = useState(() => readCardSplit(card.id));
  const [splitDefault, setSplitDefault] = useState(() => readSplitDefault());
  const [splitPrefCardId, setSplitPrefCardId] = useState(card.id);
  if (splitPrefCardId !== card.id) {
    setSplitPrefCardId(card.id);
    setSplitPref(readCardSplit(card.id));
  }
  const toggleSplit = () => {
    const next = !splitPref;
    setSplitPref(next);
    writeCardSplit(card.id, next);
  };
  const [splitMenuOpen, setSplitMenuOpen] = useState(false);
  const splitMenuBtnRef = useRef<HTMLButtonElement>(null);
  const toggleSplitDefault = () => {
    const next = !splitDefault;
    writeSplitDefault(next);
    setSplitDefault(next);
    setSplitPref(readCardSplit(card.id));
  };
  // Column ratio (card side's share), dragged on an invisible strip over the
  // column border; one value for every card.
  const [splitRatio, setSplitRatio] = useState(() => readSplitRatio());
  const [splitDragging, setSplitDragging] = useState(false);
  const splitGridRef = useRef<HTMLDivElement>(null);
  const setRatioAndSave = (r: number) => { const c = clampRatio(r); setSplitRatio(c); writeSplitRatio(c); };
  const canSplit = isWide && !isCreateMode;
  const splitMode = canSplit && splitPref;
  const [lastLeftTab, setLastLeftTab] = useState<TabId>('details');
  if (activeTab !== 'terminal' && activeTab !== lastLeftTab) setLastLeftTab(activeTab);
  const contentTab: TabId = splitMode && activeTab === 'terminal' ? lastLeftTab : activeTab;

  // Questionnaire delivery warning — lives at modal level so it survives the
  // auto-switch to the terminal tab that follows a submit (the tab-local toast
  // used to unmount before it could be read).
  const [questionnaireWarning, setQuestionnaireWarning] = useState<string | null>(null);

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
      // Capture the previous known value BEFORE queuing the state update: React
      // may run the functional updater later (not eagerly) when other updates
      // are pending in the same tick — e.g. a CLI write that changed title AND
      // description arrives via SSE as one refresh. By then the ref already
      // holds the NEW value, the compare fails, and the field silently keeps
      // its stale copy. See card "Card modal reverts title on close".
      const prevKnownDescription = lastKnownDescriptionRef.current;
      if (!isFieldBeingEdited('description')) {
        setEditedDescription((current) => {
          if (current === prevKnownDescription) {
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
      // Same pre-capture as the description effect above. This one matters
      // more: handleCloseWithSave writes editedTitle back whenever it differs
      // from card.title, so a stale editedTitle REVERTS an external rename on
      // close (observed 2026-08-25: director card title reverted while open).
      const prevKnownTitle = lastKnownTitleRef.current;
      if (!isFieldBeingEdited('title')) {
        setEditedTitle((current) => {
          if (current === prevKnownTitle) {
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
  // Live handle of the mounted Terminal — set by onTerminalReady, nulled by
  // the panel's onDispose when that instance is torn down.
  const terminalHandleRef = useRef<{ sendInput: (data: string) => void; sessionName?: string } | null>(null);
  // Last voice-target field that held focus. The mic BUTTON takes focus on
  // Android Chrome before its click handler runs, so document.activeElement
  // is the button by then — this remembers the field the user meant.
  const lastVoiceInputRef = useRef<HTMLElement | null>(null);
  const activeTabRef = useRef(activeTab);
  activeTabRef.current = activeTab;
  const splitModeRef = useRef(splitMode);
  splitModeRef.current = splitMode;
  // Workbench: which side last had focus decides where dictation lands.
  const terminalPaneRef = useRef<HTMLDivElement>(null);
  const lastFocusZoneRef = useRef<'terminal' | 'input'>('terminal');

  const isVoiceInput = (el: Element | null | undefined): el is HTMLInputElement | HTMLTextAreaElement =>
    !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') && !!el.closest('[data-voice-target]');

  // Deliver a transcript. Returns an error message when it could NOT be
  // delivered — the recorder then shows the error popup and keeps the audio +
  // transcript so Retry re-delivers. Targets are re-resolved at delivery
  // time: a field or terminal captured at record start may have been
  // detached (tab switch) or disposed (provider switch) since.
  const insertTranscribedText = useCallback((text: string): string | void => {
    const captured = voiceFocusRef.current;
    const NO_TARGET = 'Nowhere to insert the transcript. Focus a text field or open the Terminal tab, then Retry.';

    if (captured?.type === 'input') {
      let el = captured.element;
      if (!el || !document.contains(el)) {
        // Detached — accept the currently focused voice field, if any
        const active = document.activeElement;
        if (isVoiceInput(active)) el = active;
        else if (activeTabRef.current === 'terminal' && terminalHandleRef.current) el = undefined;
        else return 'The text field you were dictating into is gone. Focus a field (or open the Terminal tab), then Retry.';
      }
      if (el) {
        const input = el as HTMLInputElement | HTMLTextAreaElement;
        const start = input.selectionStart ?? input.value.length;
        const end = input.selectionEnd ?? input.value.length;
        input.focus();
        input.setSelectionRange(start, end);
        document.execCommand('insertText', false, text);
        voice.submitModeRef.current = 'auto';
        return;
      }
    }

    // Terminal: always use the LIVE handle, never the one captured at record
    // start (a provider/session switch remounts the Terminal and disposes the
    // old handle's InputQueue — sendInput on it silently no-ops).
    const wantsTerminal = captured?.type === 'terminal' || (!captured && activeTabRef.current === 'terminal') || captured?.type === 'input';
    const handle = terminalHandleRef.current;
    if (!wantsTerminal) return NO_TARGET;
    if (!handle) return 'The terminal you were dictating into is no longer open. Open the Terminal tab (with a running session), then Retry.';

    {
      const target = { type: 'terminal' as const, sendInput: handle.sendInput, sessionName: handle.sessionName };
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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voice.settings.voice.autoSubmitTerminal]);
  // The claimant is registered once (stable deps below) so it calls through a
  // ref — otherwise it would hold the first render's closure forever.
  const insertTranscribedTextRef = useRef(insertTranscribedText);
  insertTranscribedTextRef.current = insertTranscribedText;

  // Claim/release voice control
  useEffect(() => {
    if (isCreateMode) return; // No voice in create mode
    const claimant = {
      id: 'card-modal',
      onRecordStart: () => {
        const active = document.activeElement as HTMLElement;
        const lastInput = lastVoiceInputRef.current;
        if (isVoiceInput(active)) {
          voiceFocusRef.current = { type: 'input', element: active };
        } else if (splitModeRef.current) {
          // Workbench: both sides are visible — dictate into whichever side
          // had focus last (the terminal unless a card field was used since).
          if (lastFocusZoneRef.current === 'input' && lastInput && document.contains(lastInput)) {
            voiceFocusRef.current = { type: 'input', element: lastInput };
          } else if (terminalHandleRef.current) {
            const handle = terminalHandleRef.current;
            voiceFocusRef.current = { type: 'terminal', sendInput: handle.sendInput, sessionName: handle.sessionName };
          } else {
            voiceFocusRef.current = null;
          }
        } else if (activeTabRef.current === 'terminal' && terminalHandleRef.current) {
          const handle = terminalHandleRef.current;
          voiceFocusRef.current = { type: 'terminal', sendInput: handle.sendInput, sessionName: handle.sessionName };
        } else if (lastInput && document.contains(lastInput)) {
          // Focus moved to a control (the mic button) — keep the last field
          voiceFocusRef.current = { type: 'input', element: lastInput };
        } else {
          voiceFocusRef.current = null;
        }
      },
      onTranscriptionComplete: (text: string) => insertTranscribedTextRef.current(text),
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
      if (splitModeRef.current) {
        // Workbench: the terminal is always present, so voice is always armed;
        // remember which side was focused last for dictation targeting.
        if (terminalPaneRef.current?.contains(target)) {
          lastFocusZoneRef.current = 'terminal';
        } else if (isVoiceInput(target)) {
          lastVoiceInputRef.current = target;
          lastFocusZoneRef.current = 'input';
        }
        voice.setHasFieldFocus(true);
        return;
      }
      if (activeTabRef.current === 'terminal') {
        voice.setHasFieldFocus(true);
        return;
      }
      if (isVoiceInput(target)) {
        lastVoiceInputRef.current = target;
        voice.setHasFieldFocus(true);
      }
    };
    const handleFocusOut = () => {
      if (activeTabRef.current === 'terminal' || splitModeRef.current) return;
      setTimeout(() => {
        if (activeTabRef.current === 'terminal' || splitModeRef.current) return;
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

  // Terminal tab (or the always-visible workbench terminal) counts as field focus
  useEffect(() => {
    if (activeTab === 'terminal' || splitMode) {
      voice.setHasFieldFocus(true);
    }
  }, [activeTab, splitMode, voice]);

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
  ctxLines.push(`Card: ${card.title} [${card.number != null ? `${formatCardNumber(card.number)}, ` : ''}${card.id}]`);
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
  // Speaker permission snapshot (feature 086) — runtime state, a separate line after the
  // status metadata, never inside the quoted status block. Live value from the bridge stream.
  ctxLines.push(formatSpeakerLine(voice.speaker.enabled === null ? 'unknown' : voice.speaker.enabled ? 'on' : 'off'));
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
  const [newSessionError, setNewSessionError] = useState<string | null>(null);
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
            conversationStartedAt: s.conversationStartedAt,
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
  // The session an automation run would resume, for the panel's conversation-age
  // line (card #0373): undefined until sessions load, null when there is none.
  const automationSession = !isAutomation || !sessionsLoaded
    ? undefined
    : cardSessions.find(s => s.provider === (card.automation?.provider || 'claude')) ?? null;
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

  // Commit anything still local to the modal (a focused title edit — the
  // description already reaches the parent on every keystroke) and push the
  // parent's debounced save to disk (card #0357). Awaited by the terminal
  // panel before every action dispatch / session start; fired on tab switches.
  const flushPendingEdits = useCallback(async (): Promise<boolean> => {
    if (isCreateMode) return true; // nothing on disk yet — the terminal is gated
    const trimmed = editedTitle.trim();
    let override: KanbanCard | undefined;
    if (trimmed && trimmed !== card.title) {
      lastKnownTitleRef.current = trimmed;
      override = { ...card, title: trimmed, updated_at: new Date().toISOString() };
    }
    setIsEditingTitle(false);
    if (!onFlushSave) {
      if (override) onUpdate(override);
      return true;
    }
    return onFlushSave(override);
  }, [isCreateMode, editedTitle, card, onFlushSave, onUpdate]);

  // Payload for the eager create — shared by Submit/Ctrl+Enter and the
  // create-mode tab switch so both persist exactly what is typed.
  const buildCreatePayload = useCallback((): NewCardData => ({
    title: editedTitle.trim(),
    description: editedDescription,
    type: card.type,
    priority: card.priority,
    areas: card.areas,
    tags: card.tags,
    problems: card.problems,
    checklist: checklistRef.current,
    ...(card.automation ? { automation: card.automation } : {}),
  }), [editedTitle, editedDescription, card]);

  // Tab switches go through here so pending edits are flushed on the way out
  // of Details (and everywhere else — a clean board makes it a no-op).
  // Create mode (card #0357): the placeholder has no id on disk, so a tab
  // click is one motion — accept the title as typed, run the eager create,
  // await it, then switch on the persisted card (the parent re-renders this
  // modal in edit mode with the real id). A failed create stays on Details
  // with the existing error/retry banner; an empty title just refocuses the
  // title input (nothing to create — same outcome as Submit, minus the close).
  const selectTab = useCallback((tab: TabId) => {
    if (!isCreateMode) {
      void flushPendingEdits();
      setActiveTab(tab);
      return;
    }
    if (tab === 'details') { setActiveTab(tab); return; }
    if (!onCreate || creatingState?.status === 'pending') return;
    if (!editedTitle.trim()) {
      setIsEditingTitle(true);
      titleInputRef.current?.focus();
      return;
    }
    setIsEditingTitle(false);
    void onCreate(buildCreatePayload(), { stayOpen: true }).then((ok) => {
      if (ok) setActiveTab(tab);
    });
  }, [isCreateMode, flushPendingEdits, onCreate, creatingState, editedTitle, buildCreatePayload]);

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
      void onCreate(buildCreatePayload());
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
  }, [isCreateMode, onCreate, creatingState, editedTitle, buildCreatePayload, card, onClose, onUpdate, voice.voiceState]);

  // Escape key handler — registered in capture phase with stopImmediatePropagation
  // so it fires before and blocks bubble-phase handlers (e.g. useKeyboardShortcuts)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;

      // Let Escape pass through to the terminal uninterrupted — on the
      // terminal tab, or (workbench) whenever the terminal pane has focus.
      if (activeTab === 'terminal' && !splitMode) return;
      if (splitMode && terminalPaneRef.current?.contains(document.activeElement)) return;

      e.stopImmediatePropagation();

      // Suppress Escape-to-close while a card create is in flight — closing
      // mid-flight could orphan the just-persisted card from the user's view.
      if (isCreateMode && creatingState?.status === 'pending') return;

      // Side-by-side options menu open: close just the menu
      if (splitMenuOpen) {
        setSplitMenuOpen(false);
        return;
      }

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
  }, [activeTab, splitMode, showDeleteConfirm, handleCloseWithSave, isCreateMode, creatingState, splitMenuOpen]);

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
        target.isContentEditable ||
        target.getAttribute('role') === 'separator'
      ) {
        return;
      }

      // Build list of currently visible tabs
      const visibleTabs: TabId[] = ['details'];
      if (hasDesign) visibleTabs.push('design');
      if (hasFeature) visibleTabs.push('feature');
      if (hasHtml) visibleTabs.push('html');
      if (hasTest) visibleTabs.push('test');
      if (hasQuestionnaires) visibleTabs.push('questionnaires');
      visibleTabs.push('notes');
      if (hasChecklist) visibleTabs.push('checklist');
      if (!splitMode) visibleTabs.push('terminal'); // workbench: terminal is always visible

      const currentIndex = visibleTabs.indexOf(contentTab);
      if (currentIndex === -1) return;

      const nextIndex = e.key === 'ArrowRight'
        ? (currentIndex + 1) % visibleTabs.length
        : (currentIndex - 1 + visibleTabs.length) % visibleTabs.length;

      e.preventDefault();
      selectTab(visibleTabs[nextIndex]);
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [contentTab, splitMode, hasDesign, hasFeature, hasHtml, hasTest, hasQuestionnaires, hasChecklist, selectTab]);

  // Provider pills + "+" — in the tab bar (terminal tab) or the workbench terminal header.
  const providerPills = (
            <div className="ml-auto flex shrink-0 items-center gap-1 pr-2">
              {hasMultipleSessions && cardSessions.map(session => {
                const colors = getProviderColor(session.provider);
                const isActive = session.provider === selectedProvider;
                const isEnded = !session.resumable;
                return (
                  <Tooltip key={session.provider} content={isEnded ? 'Session ended — not resumable' : undefined}>
                    <button
                      onClick={() => setSelectedProvider(session.provider)}
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
                          backgroundColor: session.status === 'running' ? 'var(--live)'
                            : session.status === 'detached' ? 'var(--agent)'
                            : 'var(--line-strong)',
                        }} />
                      )}
                      {session.displayName}
                    </button>
                  </Tooltip>
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
                      className="flex h-6 w-6 items-center justify-center rounded-md border border-line-strong text-xs text-ink-3 transition-colors hover:border-ink-3 hover:text-ink-1"
                    >
                      +
                    </button>
                  </div>
                );
              })()}
            </div>
  );

  // The terminal (or the ended-session panel) — one instance, placed either in
  // the Terminal tab or in the workbench's right-hand column.
  const terminalPane = activeSession && !activeSession.resumable ? (
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
  ) : (
            /* Terminal Tab - uses shared component */
            <div className="h-full min-w-0">
              <ClaudeTerminalPanel
                sessionName={sessionName}
                sessionNameAliases={projectKeyShape.sessionKeyAliases.map(alias => `${alias}:card:${card.id}`)}
                cwd={cwd}
                actionsConfig={actionsConfig}
                actions={actions}
                context={terminalContext}
                onBeforeDispatch={flushPendingEdits}
                cardId={card.id}
                cardAreas={card.areas}
                projectId={projectId}
                scheduledPrompts={card.scheduled_prompts}
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
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-hidden lg:overflow-y-auto bg-black/40 p-0 backdrop-blur-[2px] dark:bg-black/60 lg:p-4 lg:pb-16 lg:pt-16"
      onMouseDown={(e) => { mouseDownOnBackdrop.current = e.target === e.currentTarget; }}
      onClick={(e) => { if (e.target === e.currentTarget && mouseDownOnBackdrop.current) handleCloseWithSave(); }}
    >
      <div
        style={{ '--focus-rgb': focusRgb } as React.CSSProperties}
        className={`flex w-full max-w-full h-full lg:h-auto flex-col lg:max-w-5xl ${splitMode ? 'xl:max-w-[min(1440px,96vw)]' : ''} overflow-hidden rounded-none lg:rounded-xl bg-surface-1 shadow-(--shadow-overlay) ${modalStyles.modalBorder}`}
      >
        {/* Header */}
        <div className={`flex items-start justify-between p-3 sm:px-5 sm:py-4 ${modalStyles.headerBorder} ${modalStyles.header}`}>
          <div className="min-w-0 flex-1">
            <div className="mb-2 flex items-center gap-2">
              <span className={`rounded px-2 py-0.5 text-xs font-medium capitalize ${typeColors[card.type]}`}>
                {card.type}
              </span>
              <span className={`rounded px-2 py-0.5 text-xs font-medium capitalize ${priorityColors[card.priority] || priorityColors.medium}`}>
                {card.priority}
              </span>
              {card.claude_session?.active && (
                <span className="flex items-center gap-1.5 rounded bg-live/10 px-2 py-0.5 text-xs font-medium text-live-text">
                  <span className="relative flex h-2 w-2">
                    <span className="live-dot" />
                  </span>
                  Session Active
                </span>
              )}
              {!isCreateMode && !isAutomation && (
                <StagePipeline stages={STAGES} stage={stage} onMove={(s) => onMove(card.id, s)} />
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
                  className="w-full rounded border bg-transparent px-1 text-lg font-semibold tracking-tight text-ink-1 outline-none sm:text-[22px] sm:leading-7"
                  style={{ borderColor: `rgb(${focusRgb})` }}
                  autoFocus
                />
              ) : (
                <Tooltip content="Click to edit" placement="bottom">
                  <h2
                    onClick={() => setIsEditingTitle(true)}
                    className="cursor-pointer text-lg font-semibold tracking-tight text-ink-1 transition-colors hover:text-accent sm:text-[22px] sm:leading-7"
                  >
                    {card.title}
                  </h2>
                </Tooltip>
              )}
              {!isCreateMode && (
                <Tooltip content={copiedTitle ? 'Copied!' : 'Copy title'} placement="bottom">
                  <button
                    onClick={handleCopyTitle}
                    aria-label={copiedTitle ? 'Copied!' : 'Copy title'}
                    className="mt-1 flex-shrink-0 rounded p-1 text-ink-3 hover:bg-surface-3 hover:text-ink-2"
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
                </Tooltip>
              )}
            </div>
          </div>
          <div className="flex flex-shrink-0 flex-col items-end gap-2">
            <div className="flex items-center gap-1.5 sm:gap-3">
            {/* Automation toggle switch — disabled for archived cards */}
            {!isCreateMode && (
              <Tooltip content={card.archived ? 'Unarchive card before enabling automation' : 'Toggle automation mode'} placement="bottom">
                <label className={`flex items-center gap-1 sm:gap-2 ${card.archived ? 'cursor-not-allowed opacity-40' : 'cursor-pointer'}`}>
                  <span className={`hidden sm:inline text-xs font-medium ${isAutomation ? 'text-agent-text' : 'text-ink-3'}`}>
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
                        ? 'bg-agent focus:ring-agent'
                        : 'bg-surface-3 focus:ring-void-500'
                    }`}
                  >
                    <span
                      className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                        isAutomation ? 'translate-x-4' : 'translate-x-0'
                      }`}
                    />
                  </button>
                </label>
              </Tooltip>
            )}

            {/* Archive toggle switch — disabled for automation cards */}
            {!isCreateMode && (
              <Tooltip content={isAutomation ? 'Automation cards cannot be archived' : 'Archive card'} placement="bottom">
                <label className={`flex items-center gap-1 sm:gap-2 ${isAutomation ? 'cursor-not-allowed opacity-40' : 'cursor-pointer'}`}>
                  <span className={`hidden sm:inline text-xs font-medium ${card.archived ? 'text-red-600 dark:text-red-400' : 'text-ink-3'}`}>
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
                        : 'bg-surface-3 focus:ring-void-500'
                    }`}
                  >
                    <span
                      className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                        card.archived ? 'translate-x-4' : 'translate-x-0'
                      }`}
                    />
                  </button>
                </label>
              </Tooltip>
            )}

            {/* Delete button */}
            {!isCreateMode && onDelete && (
              <Tooltip content="Delete card permanently" placement="bottom">
                <button
                  onClick={() => setShowDeleteConfirm(true)}
                  aria-label="Delete card permanently"
                  className="rounded-lg p-2 text-ink-3 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/20 dark:hover:text-red-400"
                >
                  <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                </button>
              </Tooltip>
            )}

            {/* Close button */}
            <button
              onClick={handleCloseWithSave}
              className="rounded-lg p-2 text-ink-3 hover:bg-surface-3 hover:text-ink-2"
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
                  beforeSettings={
                    <SpeakerToggle
                      speaker={voice.speaker}
                      hideOnNarrow={voice.voiceState === 'recording' || voice.voiceState === 'paused' || voice.voiceState === 'transcribing'}
                    />
                  }
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
                ? 'border-accent/60 bg-accent/80 text-accent'
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
        <div className={`flex items-stretch grain grain-soft ${modalStyles.tabsBorder} ${modalStyles.tabs}`}>
        <div className="relative min-w-0 flex-1">
        <div ref={tabBarRef} onWheel={handleTabBarWheel} onMouseDown={handleTabBarMouseDown} className={`flex overflow-x-auto scrollbar-hide ${tabBarCanScrollLeft || tabBarCanScrollRight ? 'cursor-grab' : ''}`}>
          <button
            onClick={() => selectTab('details')}
            className={`shrink-0 px-4 py-2 text-sm font-medium transition-colors ${
              contentTab === 'details'
                ? isAutomation
                  ? 'border-b-2 border-accent text-ink-1'
                  : 'border-b-2 border-accent text-ink-1'
                : 'border-b-2 border-transparent text-ink-3 hover:text-ink-1'
            }`}
          >
            Details
          </button>
          {hasDesign && (
            <button
              onClick={() => selectTab('design')}
              className={`flex shrink-0 items-center gap-1 px-4 py-2 text-sm font-medium transition-colors ${
                contentTab === 'design'
                  ? 'border-b-2 border-accent text-ink-1'
                  : 'border-b-2 border-transparent text-ink-3 hover:text-ink-1'
              }`}
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              Design
              {designRefs.length > 1 && (
                <span className="rounded bg-surface-3 px-1.5 py-0.5 font-mono text-[11px] text-ink-2">{designRefs.length}</span>
              )}
            </button>
          )}
          {hasFeature && (
            <button
              onClick={() => selectTab('feature')}
              className={`flex shrink-0 items-center gap-1 px-4 py-2 text-sm font-medium transition-colors ${
                contentTab === 'feature'
                  ? 'border-b-2 border-accent text-ink-1'
                  : 'border-b-2 border-transparent text-ink-3 hover:text-ink-1'
              }`}
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
              </svg>
              Feature
              {featureRefs.length > 1 && (
                <span className="rounded bg-surface-3 px-1.5 py-0.5 font-mono text-[11px] text-ink-2">{featureRefs.length}</span>
              )}
            </button>
          )}
          {hasHtml && (
            <button
              onClick={() => selectTab('html')}
              className={`flex shrink-0 items-center gap-1 px-4 py-2 text-sm font-medium transition-colors ${
                contentTab === 'html'
                  ? 'border-b-2 border-accent text-ink-1'
                  : 'border-b-2 border-transparent text-ink-3 hover:text-ink-1'
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
              onClick={() => selectTab('test')}
              className={`flex shrink-0 items-center gap-1 px-4 py-2 text-sm font-medium transition-colors ${
                contentTab === 'test'
                  ? 'border-b-2 border-accent text-ink-1'
                  : 'border-b-2 border-transparent text-ink-3 hover:text-ink-1'
              }`}
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
              </svg>
              Test
              {testRefs.length > 1 && (
                <span className="rounded bg-surface-3 px-1.5 py-0.5 font-mono text-[11px] text-ink-2">{testRefs.length}</span>
              )}
            </button>
          )}
          {hasQuestionnaires && (
            <button
              onClick={() => selectTab('questionnaires')}
              className={`flex shrink-0 items-center gap-1 px-4 py-2 text-sm font-medium transition-colors ${
                contentTab === 'questionnaires'
                  ? 'border-b-2 border-accent text-ink-1'
                  : 'border-b-2 border-transparent text-ink-3 hover:text-ink-1'
              }`}
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
              </svg>
              Questionnaires
              {(card.questionnaire_refs?.length ?? 0) > 1 && (
                <span className="rounded bg-surface-3 px-1.5 py-0.5 font-mono text-[11px] text-ink-2">
                  {card.questionnaire_refs!.length}
                </span>
              )}
            </button>
          )}
          <button
            onClick={() => selectTab('notes')}
            className={`flex shrink-0 items-center gap-1 px-4 py-2 text-sm font-medium transition-colors ${
              contentTab === 'notes'
                ? 'border-b-2 border-accent text-ink-1'
                : 'border-b-2 border-transparent text-ink-3 hover:text-ink-1'
            }`}
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z" />
            </svg>
            Notes
            {(card.agentNotes?.length ?? 0) > 0 && (
              <span className="rounded bg-surface-3 px-1.5 py-0.5 font-mono text-[11px] text-ink-2">
                {card.agentNotes!.length}
              </span>
            )}
          </button>
          {hasChecklist && (
            <button
              onClick={() => selectTab('checklist')}
              className={`flex shrink-0 items-center gap-1 px-4 py-2 text-sm font-medium transition-colors ${
                contentTab === 'checklist'
                  ? 'border-b-2 border-accent text-ink-1'
                  : 'border-b-2 border-transparent text-ink-3 hover:text-ink-1'
              }`}
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              Checklist
              <span className="rounded bg-surface-3 px-1.5 py-0.5 font-mono text-[11px] text-ink-2">
                {localChecklist.filter((i) => i.done).length}/{localChecklist.length}
              </span>
            </button>
          )}
          {!splitMode && (
          <button
            onClick={() => selectTab('terminal')}
            className={`flex shrink-0 items-center gap-2 px-4 py-2 text-sm font-medium transition-colors ${
              contentTab === 'terminal'
                ? 'border-b-2 border-accent text-ink-1'
                : 'border-b-2 border-transparent text-ink-3 hover:text-ink-1'
            }`}
          >
            <div className={`h-2 w-2 rounded-full ${
              anyRunning ? 'bg-live'
                : anyDetached ? 'bg-agent'
                : 'bg-line-strong'
            }`} />
            Terminal
            {anyRunning && (
              <span className="rounded bg-surface-3 px-1.5 py-0.5 font-mono text-[11px] text-ink-2">
                {activeSession?.status}
              </span>
            )}
          </button>
          )}
          {/* Provider pills + "+" button — right-aligned when terminal tab active */}
          {contentTab === 'terminal' && providerPills}
        </div>
        {/* Scroll arrow indicators */}
        {tabBarCanScrollLeft && (
          <button
            onClick={() => tabBarRef.current?.scrollBy({ left: -120, behavior: 'smooth' })}
            className="absolute left-0 top-0 z-10 flex h-full w-7 items-center justify-center bg-gradient-to-r from-surface-1 to-transparent text-ink-3 hover:text-ink-1 transition-colors"
            aria-label="Scroll tabs left"
          >
            <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M15 19l-7-7 7-7" /></svg>
          </button>
        )}
        {tabBarCanScrollRight && (
          <button
            onClick={() => tabBarRef.current?.scrollBy({ left: 120, behavior: 'smooth' })}
            className="absolute right-0 top-0 z-10 flex h-full w-7 items-center justify-center bg-gradient-to-l from-surface-1 to-transparent text-ink-3 hover:text-ink-1 transition-colors"
            aria-label="Scroll tabs right"
          >
            <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" /></svg>
          </button>
        )}
        </div>
        {canSplit && (
          <div className="relative my-1 mr-2 flex shrink-0 items-stretch">
            <Tooltip content={splitMode ? 'Back to tabs for this card' : 'Show the terminal beside this card'} placement="bottom">
              <button
                type="button"
                onClick={toggleSplit}
                aria-pressed={splitMode}
                className={`flex items-center gap-1.5 rounded-l-md pl-2.5 pr-2 text-[12px] font-medium transition-colors ${
                  splitMode ? 'bg-accent/12 text-accent' : 'text-ink-3 hover:bg-surface-3 hover:text-ink-1'
                }`}
              >
                <Columns2 aria-hidden className="h-4 w-4" strokeWidth={1.75} />
                Side by side
              </button>
            </Tooltip>
            <button
              ref={splitMenuBtnRef}
              type="button"
              onClick={() => setSplitMenuOpen((o) => !o)}
              aria-label="Side by side options"
              aria-haspopup="menu"
              aria-expanded={splitMenuOpen}
              className={`flex items-center rounded-r-md px-1 transition-colors ${
                splitMode ? 'bg-accent/12 text-accent hover:bg-accent/20' : 'text-ink-3 hover:bg-surface-3 hover:text-ink-1'
              }`}
            >
              <ChevronDown aria-hidden className="h-3.5 w-3.5" strokeWidth={2} />
            </button>
            {/* Portalled: the tab bar's grain layer is its own stacking context,
                which would trap the menu under the terminal column. */}
            {splitMenuOpen && splitMenuBtnRef.current && createPortal(
              <>
                <div className="fixed inset-0 z-[60]" onClick={() => setSplitMenuOpen(false)} />
                <div
                  role="menu"
                  className="fixed z-[61] w-64 rounded-lg border border-line bg-surface-1 p-1 shadow-(--shadow-overlay)"
                  style={{ top: splitMenuBtnRef.current.getBoundingClientRect().bottom + 4, right: window.innerWidth - splitMenuBtnRef.current.getBoundingClientRect().right }}
                >
                  <button
                    type="button"
                    role="menuitemcheckbox"
                    aria-checked={splitDefault}
                    autoFocus
                    onClick={toggleSplitDefault}
                    className="flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left text-[13px] text-ink-1 outline-none hover:bg-surface-3 focus-visible:bg-surface-3"
                  >
                    <span className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border ${splitDefault ? 'border-accent bg-accent text-white dark:text-[#04121a]' : 'border-line-strong'}`}>
                      {splitDefault && <Check aria-hidden className="h-3 w-3" strokeWidth={3} />}
                    </span>
                    <span>
                      Side by side for all cards
                      <span className="block text-[12px] text-ink-3">Cards you&apos;ve switched yourself keep their own setting.</span>
                    </span>
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    disabled={splitRatio === DEFAULT_RATIO}
                    onClick={() => { setRatioAndSave(DEFAULT_RATIO); setSplitMenuOpen(false); }}
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] text-ink-1 outline-none hover:bg-surface-3 focus-visible:bg-surface-3 disabled:text-ink-3 disabled:hover:bg-transparent"
                  >
                    <span className="h-4 w-4 shrink-0" />
                    Reset column widths
                  </button>
                </div>
              </>,
              document.body,
            )}
          </div>
        )}
        </div>

        {/* Content — on wide screens a workbench: card on the left, terminal always on the right */}
        <div
          ref={splitGridRef}
          className={splitMode ? `relative grid overflow-hidden${splitDragging ? ' select-none' : ''}` : 'contents'}
          // Fixed height + one minmax(0,1fr) row: the terminal fits itself to
          // its box, so a content-sized row would feed back and grow forever.
          style={splitMode ? {
            gridTemplateColumns: `minmax(0, ${splitRatio}fr) minmax(0, ${1 - splitRatio}fr)`,
            gridTemplateRows: 'minmax(0, 1fr)',
            height: 'clamp(480px, calc(100vh - 19rem), 860px)',
            flex: 'none',
          } : undefined}
        >
        <div className={splitMode
          ? (contentTab === 'notes' || contentTab === 'html' || contentTab === 'questionnaires' ? 'h-full min-h-0' : 'h-full min-h-0 overflow-y-auto overscroll-contain')
          : (contentTab === 'terminal' || contentTab === 'notes' || contentTab === 'html' || contentTab === 'questionnaires' ? 'min-h-0 flex-1 lg:flex-initial lg:h-[60vh]' : 'min-h-0 flex-1 overflow-y-auto overscroll-contain lg:flex-initial lg:max-h-[60vh]')}>
          {contentTab === 'details' ? (
            <div className="p-4">
              {/* Compact Metadata Strip */}
              <div className="mb-4 flex flex-wrap items-center gap-3">
                {/* Stage/Priority/Areas — hidden in automation mode */}
                {!isAutomation && (
                  <>
                    {/* Stage dropdown */}
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-medium text-ink-3">Stage:</span>
                      <select
                        value={stage}
                        onChange={(e) => onMove(card.id, e.target.value as KanbanStage)}
                        className="stage-focus rounded border border-line-strong bg-surface-1 px-2 py-1 text-xs font-medium text-ink-2"
                      >
                        {STAGES.map((s) => (
                          <option key={s.id} value={s.id}>{s.label}</option>
                        ))}
                      </select>
                    </div>

                    {/* Priority dropdown */}
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-medium text-ink-3">Priority:</span>
                      <select
                        value={card.priority}
                        onChange={(e) => onUpdate({ ...card, priority: e.target.value as typeof PRIORITIES[number], updated_at: new Date().toISOString() })}
                        className="stage-focus rounded border border-line-strong bg-surface-1 px-2 py-1 text-xs font-medium capitalize text-ink-2"
                      >
                        {PRIORITIES.map((p) => (
                          <option key={p} value={p}>{p}</option>
                        ))}
                      </select>
                    </div>

                    {/* Divider */}
                    <div className="h-4 w-px bg-surface-3" />

                    {/* Areas */}
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-xs font-medium text-ink-3">Areas:</span>
                      {card.areas.map((area) => (
                        <span
                          key={area}
                          className="inline-flex items-center gap-1 rounded border border-line px-1.5 py-0.5 text-xs text-ink-2"
                        >
                          {area}
                          <button
                            onClick={() => handleRemoveArea(area)}
                            className="ml-0.5 text-ink-3 hover:text-ink-1"
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
                          className="stage-focus rounded border border-dashed border-line-strong bg-transparent px-1.5 py-0.5 text-xs text-ink-3 hover:border-ink-3"
                        >
                          <option value="">+ Add</option>
                          {unusedAreas.map((area) => (
                            <option key={area} value={area}>{area}</option>
                          ))}
                        </select>
                      )}
                    </div>

                    {/* Divider */}
                    <div className="h-4 w-px bg-surface-3" />
                  </>
                )}

                {/* Tags (drag-to-reorder) */}
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-xs font-medium text-ink-3">Tags:</span>
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
                              : 'bg-surface-2 text-ink-2'
                      }`}
                    >
                      {tag}
                      <button
                        onClick={() => handleRemoveTag(tag)}
                        className="ml-0.5 hover:text-ink-1"
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
                    className="stage-focus w-16 rounded border border-dashed border-line-strong bg-transparent px-1.5 py-0.5 text-xs text-ink-3 placeholder:text-ink-3 hover:border-ink-3"
                  />
                </div>

                {/* References (icons only) */}
                {(hasDesign || hasFeature || hasTest || hasHtml) && (
                  <>
                    <div className="h-4 w-px bg-surface-3" />
                    <div className="flex items-center gap-1">
                      <span className="text-xs font-medium text-ink-3">Docs:</span>
                      {hasDesign && (
                        <Tooltip content={designRefs.join('\n')}>
                          <button
                            onClick={() => selectTab('design')}
                            className="relative rounded p-1.5 text-ink-2 hover:bg-surface-3 hover:text-ink-1"
                          >
                            {/* Clipboard/pencil icon for design */}
                            <svg className="h-8 w-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
                            </svg>
                            {designRefs.length > 1 && (
                              <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 font-mono text-[10px] font-bold leading-none text-white dark:text-[#04121a]">
                                {designRefs.length}
                              </span>
                            )}
                          </button>
                        </Tooltip>
                      )}
                      {hasFeature && (
                        <Tooltip content={featureRefs.join('\n')}>
                          <button
                            onClick={() => selectTab('feature')}
                            className="relative rounded p-1.5 text-accent hover:bg-blue-100 dark:hover:bg-blue-900/30"
                          >
                            {/* Checklist icon for feature */}
                            <svg className="h-8 w-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
                            </svg>
                            {featureRefs.length > 1 && (
                              <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 font-mono text-[10px] font-bold leading-none text-on-primary">
                                {featureRefs.length}
                              </span>
                            )}
                          </button>
                        </Tooltip>
                      )}
                      {hasHtml && (
                        <Tooltip content={htmlRefs.join('\n')}>
                          <button
                            onClick={() => selectTab('html')}
                            className="relative rounded p-1.5 text-[#ff6a33] hover:bg-[#ff6a33]/15 dark:text-[#ff6a33] dark:hover:bg-[#ff6a33]/20"
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
                        </Tooltip>
                      )}
                      {hasTest && (
                        <Tooltip content={testRefs.join('\n')}>
                          <button
                            onClick={() => selectTab('test')}
                            className="relative rounded p-1.5 text-green-600 hover:bg-green-100 dark:text-green-400 dark:hover:bg-green-900/30"
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
                        </Tooltip>
                      )}
                    </div>
                  </>
                )}
              </div>

              {/* Description */}
              <div className="mb-4">
                <label className="mb-2 block text-sm font-medium text-ink-2">
                  {isAutomation ? 'Description / Automation Instructions' : 'Description'}
                  {isCreateMode && (
                    <span className="ml-2 font-normal text-ink-3">(Ctrl+Enter to save)</span>
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
                  className="stage-focus h-[235px] w-full resize-none overflow-y-auto rounded-lg border border-line-strong bg-surface-1 p-3 text-sm text-ink-2"
                />
              </div>

              {/* Automation Config — shown instead of problems when automation mode is on */}
              {isAutomation && card.automation ? (
                <div className="mb-4">
                  <AutomationConfig
                    config={card.automation}
                    cardId={card.id}
                    projectId={projectId}
                    session={automationSession}
                    onChange={(newConfig) => {
                      onUpdate({ ...card, automation: newConfig, updated_at: new Date().toISOString() });
                    }}
                  />
                </div>
              ) : (
                /* Problems / Issues — hidden for automation cards */
                <div className="mb-4">
                  <div className="mb-2 flex items-center justify-between">
                    <label className="text-sm font-medium text-ink-2">
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
                            {formatDate(problem.created_at)}
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
                        <summary className="cursor-pointer text-ink-3">
                          {resolvedProblems.length} resolved
                        </summary>
                        <div className="mt-2 space-y-1">
                          {resolvedProblems.map((problem) => (
                            <div
                              key={problem.id}
                              className="rounded bg-surface-2 p-2 text-ink-3 line-through"
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
                      className="stage-focus flex-1 rounded-lg border border-line-strong bg-surface-1 px-3 py-2 text-sm text-ink-1"
                      onKeyDown={(e) => e.key === 'Enter' && handleAddProblem()}
                    />
                    <button
                      onClick={handleAddProblem}
                      className="rounded-lg bg-surface-3 px-3 py-2 text-sm font-medium text-ink-2 hover:bg-surface-3"
                    >
                      Add
                    </button>
                  </div>
                </div>
              )}

            </div>
          ) : contentTab === 'questionnaires' ? (
            /* Questionnaires View — interactive Q&A forms */
            <div className="flex h-full flex-col">
              <QuestionnaireTab
                card={card}
                projectId={projectId}
                activeSessionName={activeSession?.name ?? sessionName}
                activeProvider={selectedProvider ?? activeSession?.provider ?? undefined}
                cwd={cwd}
                onSubmitSuccess={(warning) => {
                  setQuestionnaireWarning(warning ?? null);
                  setActiveTab('terminal');
                }}
                onUnlink={handleUnlinkRef}
              />
            </div>
          ) : contentTab === 'html' && hasHtml ? (
            /* HTML Attachments View — index list + sandboxed iframe viewer (feature 072) */
            <div className="flex h-full flex-col">
              <HtmlAttachmentsTab refs={htmlRefs} projectId={projectId} cardId={card.id} onUnlink={handleUnlinkRef} />
            </div>
          ) : contentTab === 'design' || contentTab === 'feature' || contentTab === 'test' ? (
            /* Document View - Design, Feature, or Test (multi-attachment, feature 074) */
            <div className="flex h-full flex-col">
              <DocAttachmentsTab
                key={contentTab}
                kind={contentTab}
                refs={contentTab === 'design' ? designRefs : contentTab === 'feature' ? featureRefs : testRefs}
                projectId={projectId}
                cardId={card.id}
                onUnlink={handleUnlinkRef}
              />
            </div>
          ) : contentTab === 'checklist' ? (
            /* Checklist View */
            <div className="p-4">
              <div className="mb-4 flex items-center justify-between">
                <h3 className="text-lg font-medium text-ink-1">
                  Checklist ({localChecklist.filter((i) => i.done).length}/{localChecklist.length} complete)
                </h3>
                <div className="h-2 flex-1 mx-4 rounded-full bg-surface-3">
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
                        : 'bg-surface-2 hover:bg-surface-3'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={item.done}
                      onChange={() => toggleChecklistItem(item.id)}
                      className="h-5 w-5 flex-shrink-0 rounded border-line-strong text-green-600 focus:ring-green-500"
                    />
                    <span className={`flex-1 ${item.done ? 'text-ink-3 line-through' : 'text-ink-1'}`}>
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
                  className="stage-focus flex-1 rounded-lg border border-line-strong bg-surface-1 px-3 py-2 text-sm text-ink-1"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && e.currentTarget.value.trim()) {
                      addChecklistItem(e.currentTarget.value.trim());
                      e.currentTarget.value = '';
                    }
                  }}
                />
              </div>
            </div>
          ) : contentTab === 'notes' ? (
            /* Agent Notes View */
            <div className="flex h-full flex-col p-4">
              <div className="mb-4 flex items-center justify-between">
                <h3 className="text-lg font-medium text-ink-1">
                  Notes ({card.agentNotes?.length ?? 0})
                </h3>
                {(card.agentNotes?.length ?? 0) > 0 && (
                  showClearConfirm ? (
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-ink-3">Clear all notes?</span>
                      <button
                        onClick={clearNotes}
                        className="rounded px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/20"
                      >
                        Confirm
                      </button>
                      <button
                        onClick={() => setShowClearConfirm(false)}
                        className="rounded px-2 py-1 text-xs font-medium text-ink-3 hover:bg-surface-3"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setShowClearConfirm(true)}
                      className="rounded px-2 py-1 text-xs font-medium text-ink-3 hover:bg-surface-3 hover:text-red-600 dark:hover:text-red-400"
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
                <div className="py-8 text-center text-sm text-ink-3">
                  No notes yet. Add a note below or use the CLI: <code className="rounded bg-surface-2 px-1.5 py-0.5 text-xs">sly-kanban notes {card.id} add &quot;...&quot;</code>
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
                        className="group rounded-lg bg-surface-2 p-3"
                      >
                        <div className="mb-1 flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            {note.agent && (
                              <span className="rounded bg-surface-3 px-1.5 py-0.5 text-xs font-medium text-ink-2">
                                {note.agent}
                              </span>
                            )}
                            {note.summary && (
                              <Tooltip content={`Summary of ${note.summarizedCount ?? '?'} notes${note.dateRange ? ` (${note.dateRange})` : ''}`}>
                                <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
                                  Summary
                                </span>
                              </Tooltip>
                            )}
                            <span className="text-xs text-ink-3">{timeAgo}</span>
                          </div>
                          <Tooltip content="Delete note">
                            <button
                              onClick={() => deleteNote(note.id)}
                              aria-label="Delete note"
                              className="rounded p-1 text-ink-3 opacity-0 transition-opacity hover:bg-surface-3 hover:text-red-500 group-hover:opacity-100 dark:hover:text-red-400"
                            >
                              <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                              </svg>
                            </button>
                          </Tooltip>
                        </div>
                        <p className="whitespace-pre-wrap text-sm text-ink-2">
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
                  className="stage-focus flex-1 resize-none rounded-lg border border-line-strong bg-surface-1 px-3 py-2 text-sm text-ink-1"
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
                  className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-on-primary hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Add
                </button>
              </div>
            </div>
          ) : contentTab === 'terminal' ? (
            terminalPane
          ) : null}
        </div>
        {splitMode && (
          /* Column divider: an invisible 9px strip over the existing border —
             drag to resize, double-click to reset, arrow keys when focused. */
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize card and terminal columns"
            aria-valuemin={25}
            aria-valuemax={70}
            aria-valuenow={Math.round(splitRatio * 100)}
            tabIndex={0}
            onPointerDown={(e) => {
              if (e.button !== 0) return;
              e.preventDefault();
              e.currentTarget.setPointerCapture(e.pointerId);
              setSplitDragging(true);
            }}
            onPointerMove={(e) => {
              if (!splitDragging || !splitGridRef.current) return;
              const r = splitGridRef.current.getBoundingClientRect();
              setSplitRatio(clampRatio((e.clientX - r.left) / r.width));
            }}
            onPointerUp={() => { if (splitDragging) { setSplitDragging(false); writeSplitRatio(splitRatio); } }}
            onPointerCancel={() => { if (splitDragging) { setSplitDragging(false); writeSplitRatio(splitRatio); } }}
            onDoubleClick={() => setRatioAndSave(DEFAULT_RATIO)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
                e.preventDefault();
                setRatioAndSave(splitRatio + (e.key === 'ArrowRight' ? 0.02 : -0.02));
              } else if (e.key === 'Home') {
                e.preventDefault();
                setRatioAndSave(DEFAULT_RATIO);
              }
            }}
            className="absolute inset-y-0 z-20 w-[9px] -translate-x-1/2 cursor-col-resize touch-none focus:outline-none focus-visible:bg-accent/30"
            style={{ left: `${splitRatio * 100}%` }}
          />
        )}
        {splitMode && (
          <div ref={terminalPaneRef} className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden border-l border-line">
            <div className="flex h-10 shrink-0 items-center gap-2 border-b border-line pl-4">
              <span className="text-[13px] font-medium text-ink-1">Terminal</span>
              {anyRunning && (
                <span className="rounded bg-surface-3 px-1.5 py-0.5 font-mono text-[11px] text-ink-2">{activeSession?.status}</span>
              )}
              {providerPills}
            </div>
            <div className="min-h-0 flex-1 overflow-hidden">{terminalPane}</div>
          </div>
        )}
        </div>

        {/* Questionnaire delivery warning — modal-level so it outlives the
            post-submit switch to the terminal tab. In-flow rather than floating
            so it never covers the terminal's input line. */}
        {questionnaireWarning && (
          <div className="flex shrink-0 items-start gap-3 border-t border-amber-400/40 bg-amber-50/80 px-4 py-3 dark:bg-amber-950/40">
            <svg className="mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M5.07 19h13.86a2 2 0 001.74-3L13.74 4a2 2 0 00-3.48 0L3.33 16a2 2 0 001.74 3z" />
            </svg>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold text-amber-900 dark:text-amber-200">
                Questionnaire submitted with a warning
              </div>
              <div className="mt-0.5 text-sm text-amber-800 dark:text-amber-100/80">
                {questionnaireWarning}
              </div>
            </div>
            <Tooltip content="Dismiss">
              <button
                onClick={() => setQuestionnaireWarning(null)}
                aria-label="Dismiss"
                className="shrink-0 rounded p-1 text-amber-700/70 transition-colors hover:bg-amber-200/50 hover:text-amber-900 dark:text-amber-300/70 dark:hover:bg-amber-900/40 dark:hover:text-amber-100"
              >
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </Tooltip>
          </div>
        )}

        {/* Footer - hidden on the terminal tab (terminal has its own footer); always shown in the workbench */}
        {(splitMode || activeTab !== 'terminal') && (
          <div className="flex items-center justify-between border-t border-line px-4 py-2 text-[11px] text-ink-3">
            <span>Created: {formatDate(card.created_at)}</span>
            <span>Updated: {formatDate(card.updated_at)}</span>
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
        message={<>Are you sure you want to permanently delete <span className="font-medium text-ink-1">&quot;{card.title}&quot;</span>? This action cannot be undone.</>}
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
              className="fixed z-[60] min-w-[180px] rounded-lg border border-line bg-surface-1 p-2 shadow-(--shadow-overlay)"
              style={{ top: rect.bottom + 4, right: window.innerWidth - rect.right }}
            >
              {!newSessionProvider ? (
                <div className="flex flex-col gap-1">
                  <span className="px-1 text-[10px] font-medium text-ink-3">Start session</span>
                  {unused.map(p => {
                    const colors = getProviderColor(p.id);
                    return (
                      <button
                        key={p.id}
                        onClick={() => { setNewSessionProvider(p.id); setNewSessionSkipPerms(p.permissions.default); }}
                        className="flex items-center gap-2 rounded-md px-2 py-1.5 text-xs font-medium transition-colors hover:bg-surface-3"
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
                        <label className="flex items-center gap-1.5 text-[11px] text-ink-3 cursor-pointer">
                          <input type="checkbox" checked={newSessionSkipPerms} onChange={e => setNewSessionSkipPerms(e.target.checked)} className="rounded border-line-strong" />
                          {p.permissions.label}
                        </label>
                        <button
                          onClick={async () => {
                            // Same flush-then-act path as every other session start
                            // (card #0357): the new agent's first `sly-kanban show`
                            // must read the card the modal shows.
                            setNewSessionError(null);
                            if (!(await flushPendingEdits())) {
                              setNewSessionError('Card edits could not be saved — fix the board save error, then start again');
                              return;
                            }
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
                          className="rounded-md bg-accent/20 px-3 py-1.5 text-xs font-medium text-accent transition-colors hover:bg-accent/30"
                        >
                          Start
                        </button>
                        {newSessionError && (
                          <div role="alert" className="max-w-[220px] text-[11px] leading-snug text-danger-text">{newSessionError}</div>
                        )}
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
      {voice.showSettings && (() => {
        const closeVoiceSettings = () => { voiceSettingsClosedAtRef.current = Date.now(); voice.setShowSettings(false); };
        const popover = (sheet: boolean) => (
          <VoiceSettingsPopover
            settings={voice.settings.voice}
            onSave={(patch) => voice.updateSettings({ voice: patch })}
            onClose={closeVoiceSettings}
            speaker={voice.speaker}
            saveError={voice.settingsSaveError}
            projectId={projectId}
            variant={sheet ? 'sheet' : 'popover'}
          />
        );
        // Phones: a bottom sheet sized to what can be seen (#0376).
        return voiceSheetLayout
          ? <VoiceSheet variant="bottom" label="Voice Settings" onClose={closeVoiceSettings}>{popover(true)}</VoiceSheet>
          : createPortal(<VoicePopoverPortal anchorRef={voiceAnchorRef}>{popover(false)}</VoicePopoverPortal>, document.body);
      })()}
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
