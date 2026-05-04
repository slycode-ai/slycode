/**
 * Core types for Code Den
 */

// ============================================================================
// Registry Types
// ============================================================================

export interface Project {
  id: string;
  name: string;
  description: string;
  path: string;
  hasClaudeMd: boolean;
  masterCompliant: boolean;
  areas: string[];
  tags: string[];
  order?: number;
  /**
   * Stable bridge-session identifier derived from path.basename(path).
   * Computed deterministically from the folder name; kept in sync with
   * scripts/kanban.js so CLI and web agree on one identity per project.
   * Populated by loadRegistry() on first read if missing (self-healing).
   */
  sessionKey?: string;
  /**
   * Previous session-name prefixes that old persisted sessions may still use
   * (e.g. the legacy project.id when it diverges from sessionKey). Used for
   * alias-aware lookup so existing sessions keep resolving after upgrade.
   */
  sessionKeyAliases?: string[];
}

export interface Registry {
  $schema?: string;
  version: string;
  lastUpdated: string;
  projects: Project[];
}

// ============================================================================
// Backlog Types (per design doc section 3.1)
// ============================================================================

export type BacklogStatus = 'pending' | 'active' | 'done';
export type Priority = 'low' | 'medium' | 'high' | 'critical';

export interface BacklogItem {
  id: string;
  title: string;
  status: BacklogStatus;
  priority: Priority;
  area: string;
  created_at: string;
  // Extended fields for aggregation
  projectId?: string;
  projectName?: string;
}

// ============================================================================
// Kanban Types (workflow stages)
// ============================================================================

export type KanbanStage = 'backlog' | 'design' | 'implementation' | 'testing' | 'done';
export type CardType = 'feature' | 'chore' | 'bug';

export interface Problem {
  id: string;
  description: string;
  severity: 'minor' | 'major' | 'critical';
  created_at: string;
  resolved_at?: string;
}

export interface ClaudeSession {
  id: string;
  active: boolean;
  started_at: string;
  last_activity?: string;
  messages_count: number;
}

export interface ChecklistItem {
  id: string;
  text: string;
  done: boolean;
}

export interface AgentNote {
  id: number;              // Sequential integer (1, 2, 3...)
  agent?: string;          // "Claude", "Codex", "Gemini", "User", etc.
  text: string;            // Note content, max ~3000 characters
  timestamp: string;       // ISO 8601, auto-set on creation
  summary?: boolean;       // True if this is a summary note (from `notes summarize`)
  summarizedCount?: number; // How many notes were compressed into this summary
  dateRange?: string;      // Date range of summarized notes (e.g., "2026-01-15 to 2026-02-28")
}

export interface AutomationConfig {
  enabled: boolean;
  schedule: string;                        // Cron expression or ISO datetime
  scheduleType: 'recurring' | 'one-shot';
  provider: string;                        // Provider ID from providers.json
  freshSession: boolean;                   // Kill and recreate session each run
  workingDirectory?: string;               // Override card's project directory
  reportViaMessaging: boolean;             // Auto-append messaging instructions to prompt
  lastRun?: string;                        // ISO timestamp of last kickoff
  lastResult?: 'success' | 'error';        // Result of last kickoff attempt
  nextRun?: string;                        // ISO timestamp of next scheduled run
}

export interface KanbanCard {
  id: string;
  number?: number;
  title: string;
  description: string;
  type: CardType;
  priority: Priority;   // "critical" | "high" | "medium" | "low"
  order: number;        // Position within stage (10, 20, 30... gaps for easy insertion)
  areas: string[];      // Multiple areas for context priming
  tags: string[];       // Other tags (bug, feature, etc.)
  problems: Problem[];  // Bug tracking - issues found during testing
  checklist: ChecklistItem[];  // Task checklist (esp. for testing)
  agentNotes?: AgentNote[];    // Cross-agent notes
  claude_session?: ClaudeSession;
  design_ref?: string;  // Reference to design document
  feature_ref?: string; // Reference to feature spec
  test_ref?: string;    // Reference to test document
  html_ref?: string;    // Reference to HTML attachment (rendered in sandboxed iframe)
  questionnaire_refs?: string[]; // List of attached questionnaires (JSON, multiple per card)
  status?: {
    text: string;
    setAt: string;
    // V2 provenance — V1 data without these fields is read as kind:'manual'.
    kind?: 'manual' | 'auto';
    tier?: 'high' | 'medium' | 'low';
  };  // Short AI-set progress status; auto-cleared on stage move
  automation?: AutomationConfig;  // Present when card is in automation mode
  archived?: boolean;   // Soft delete - hidden from normal views
  created_at: string;
  updated_at: string;
  last_modified_by?: string;  // 'web' | 'cli' | 'agent' — who last wrote this card
}

export interface KanbanStages {
  backlog: KanbanCard[];
  design: KanbanCard[];
  implementation: KanbanCard[];
  testing: KanbanCard[];
  done: KanbanCard[];
}

export type CardChangeType = 'move' | 'edit' | 'create' | 'delete';

export interface ChangedCard {
  id: string;
  type: CardChangeType;
}

export interface KanbanBoard {
  project_id: string;
  stages: KanbanStages;
  last_updated: string;
  nextCardNumber?: number;
}

// ============================================================================
// Quick-launch Shortcuts Types
//
// Mirrors `messaging/src/types.ts` Shortcut + ShortcutsFile. Both copies MUST
// stay in lockstep — same convention as session-keys.ts.
// ============================================================================

export interface Shortcut {
  label: string;                  // lowercase, must contain at least one letter
  cardId: string;                 // target card id
  prompt?: string;                // optional starter prompt
  provider?: ProviderId;          // optional provider override
  preferExistingSession?: boolean; // if true, reuse existing card session even if its provider differs
}

export interface ShortcutsFile {
  projectTag: string;             // lowercase alphanumeric, 1-6 chars, unique workspace-wide
  shortcuts: Shortcut[];
}

// ============================================================================
// Design/Feature Index Types (per design doc section 3.2)
// ============================================================================

export type DesignStatus = 'drafting' | 'review' | 'finalized';
export type FeatureStatus = 'pending' | 'in_progress' | 'testing' | 'done';

export interface DesignEntry {
  id: string;
  title: string;
  status: DesignStatus;
  ref: string;
  backlog_refs: string[];
  last_updated: string;
  // Extended
  projectId?: string;
}

export interface FeatureEntry {
  id: string;
  title: string;
  status: FeatureStatus;
  ref: string;
  design_refs: string[];
  last_updated: string;
  // Extended
  projectId?: string;
}

// ============================================================================
// Changelog Types
// ============================================================================

export type ChangelogChangeType = 'feature' | 'bugfix' | 'improvement' | 'chore';

export interface ChangelogChange {
  type: ChangelogChangeType;
  description: string;
}

export interface ChangelogVersion {
  version: string;
  date: string; // YYYY-MM-DD
  changes: ChangelogChange[];
}

// ============================================================================
// Questionnaire Types (per design doc section 3.3)
// ============================================================================

export type FieldType =
  | 'text'
  | 'textarea'
  | 'number'
  | 'select'
  | 'multi-select'
  | 'checkbox'
  | 'radio';

export interface QuestionnaireField {
  id: string;
  type: FieldType;
  label: string;
  description?: string;
  options?: string[];
  default?: string | number | boolean | string[];
  required?: boolean;
}

export interface Questionnaire {
  card_id: string;
  title: string;
  description: string;
  fields: QuestionnaireField[];
}

export interface QuestionnaireResponse {
  card_id: string;
  submitted_at: string;
  responses: Record<string, string | number | boolean | string[]>;
}

// ============================================================================
// Sly Action Configuration Types
// ============================================================================

export interface TerminalClass {
  id: string;
  name: string;
  description: string;
  members: string[];
}

export interface TerminalClassesConfig {
  version: string;
  classes: TerminalClass[];
}

export type Placement = 'startup' | 'toolbar' | 'both';

// Unified action configuration (v3 — placement + classAssignments)
export interface SlyAction {
  label: string;
  description: string;
  group?: string;
  cardTypes?: string[];
  placement: Placement;
  prompt: string;
  scope: 'global' | 'specific';
  projects: string[];
}

export interface SlyActionsConfig {
  version: string;
  commands: Record<string, SlyAction>;
  classAssignments: Record<string, string[]>;
}

// Backward compatibility aliases
export type Command = SlyAction;
export type CommandsConfig = SlyActionsConfig;

// Available variables for prompt templates
export const TEMPLATE_VARIABLES = {
  card: [
    { key: '{{card.title}}', label: 'Card Title' },
    { key: '{{card.description}}', label: 'Card Description' },
    { key: '{{card.stage}}', label: 'Card Stage' },
    { key: '{{card.type}}', label: 'Card Type' },
    { key: '{{card.id}}', label: 'Card ID' },
  ],
  area: [
    { key: '{{area}}', label: 'Area Name' },
    { key: '{{area.files}}', label: 'Area Files' },
  ],
  project: [
    { key: '{{project.name}}', label: 'Project Name' },
    { key: '{{project.path}}', label: 'Project Path' },
  ],
} as const;

// ============================================================================
// Provider Types
// ============================================================================

export type ProviderId = 'claude' | 'agents' | 'codex' | 'gemini';

// ============================================================================
// CLI Assets Types (Asset Management)
// ============================================================================

export type AssetType = 'skill' | 'agent' | 'mcp';

export interface AssetFrontmatter {
  name?: string;
  version?: string;
  updated?: string;
  description?: string;
  [key: string]: unknown;  // allow extra fields (tools, model, color, etc.)
}

export interface AssetInfo {
  name: string;
  type: AssetType;
  path: string;            // relative path within .claude/ (e.g., "skills/context-priming/SKILL.md")
  frontmatter: AssetFrontmatter | null;
  isValid: boolean;        // true if frontmatter has name, version, updated, description
}

export interface ProjectAssets {
  projectId: string;
  skills: AssetInfo[];
  agents: AssetInfo[];
}

export type AssetCellStatus = 'current' | 'outdated' | 'missing';

export interface AssetCell {
  projectId: string;
  status: AssetCellStatus;
  masterVersion?: string;
  projectVersion?: string;
}

export interface AssetRow {
  name: string;
  type: AssetType;
  masterAsset: AssetInfo;
  cells: AssetCell[];
  isImported: boolean;     // true if this asset exists in the workspace
}

export interface CliAssetsData {
  skills: AssetRow[];
  agents: AssetRow[];
  nonImported: AssetRow[];
}

export interface PendingChange {
  assetName: string;
  assetType: AssetType;
  projectId: string;
  action: 'deploy' | 'remove';
  provider?: ProviderId;        // Provider for store-based operations
  source?: 'master' | 'store';  // Where asset comes from (default: 'master')
}

// ============================================================================
// Update Delivery Types
// ============================================================================

export type UpdateEntryStatus = 'update' | 'new';

export interface UpdateEntry {
  name: string;
  assetType: AssetType;
  status: UpdateEntryStatus;     // existing skill with version change vs brand new
  currentVersion?: string;       // store version (undefined if new)
  availableVersion: string;      // updates/ version (display only)
  contentHash: string;           // SHA-256 hash of upstream SKILL.md (12 hex chars)
  description?: string;          // from frontmatter
  updatesPath: string;           // relative path in updates/ (e.g. "skills/checkpoint")
  storePath: string;             // relative path in store/ (e.g. "skills/checkpoint")
  filesAffected: string[];       // list of files in the update package
  skillMdOnly: boolean;          // true if only SKILL.md is in the update
}

export type IgnoredUpdates = Record<string, string>;  // key: "skills/{name}" or "actions/{name}", value: content hash

export interface UpdatesData {
  entries: UpdateEntry[];
  totalAvailable: number;
}

// ============================================================================
// Store Types (Unified Canonical Store)
// ============================================================================

export type StoreAssetInfo = AssetInfo;

export interface StoreData {
  skills: StoreAssetInfo[];
  agents: StoreAssetInfo[];
  mcp: StoreAssetInfo[];
}

export interface ProviderAssetPaths {
  skills: string | null;
  agents: string | null;
  mcpConfig: string | null;
}

// ============================================================================
// Activity Event Types
// ============================================================================

export type EventType =
  | 'card_created'
  | 'card_moved'
  | 'card_updated'
  | 'card_reordered'
  | 'card_prompt'
  | 'problem_added'
  | 'problem_resolved'
  | 'skill_deployed'
  | 'skill_removed'
  | 'skill_imported'
  | 'session_started'
  | 'session_stopped';

export interface ActivityEvent {
  id: string;
  type: EventType;
  project: string;         // project ID
  card?: string;           // card ID (optional, not all events are card-related)
  detail: string;          // human-readable description
  source?: string;         // 'web' | 'cli' | 'agent' — who triggered the event
  timestamp: string;       // ISO 8601
}

// ============================================================================
// Health Score Types
// ============================================================================

export interface HealthFactor {
  name: string;
  weight: number;          // 0-1, relative importance
  value: number;           // current value (lower is better for penalties)
  maxValue: number;        // maximum possible value
}

export type HealthLevel = 'green' | 'amber' | 'red';

export interface HealthScore {
  score: number;           // 0-100
  level: HealthLevel;      // green >= 80, amber >= 50, red < 50
  factors: HealthFactor[];
}

// ============================================================================
// Voice / Settings Types
// ============================================================================

export type VoiceState = 'disabled' | 'idle' | 'recording' | 'paused' | 'transcribing' | 'error';

export interface VoiceShortcuts {
  startRecording: string;
  pauseResume: string;
  submit: string;
  submitPasteOnly: string;
  clear: string;
}

export interface VoiceSettings {
  autoSubmitTerminal: boolean;
  maxRecordingSeconds: number;
  shortcuts: VoiceShortcuts;
}

export interface AppSettings {
  voice: VoiceSettings;
}

export const DEFAULT_VOICE_SETTINGS: VoiceSettings = {
  autoSubmitTerminal: true,
  maxRecordingSeconds: 300,
  shortcuts: {
    startRecording: 'Ctrl+.',
    pauseResume: 'Space',
    submit: 'Enter',
    submitPasteOnly: 'Shift+Enter',
    clear: 'Escape',
  },
};

export interface TerminalHandle {
  sendInput: (data: string) => void;
}

export interface VoiceClaimant {
  id: string;
  onRecordStart?: () => void;
  onTranscriptionComplete: (text: string) => void;
  onRelease?: () => void;
}

// ============================================================================
// Platform Detection Types
// ============================================================================

export interface PlatformDetection {
  claude: boolean;
  gemini: boolean;
  codex: boolean;
}

// ============================================================================
// Search Types
// ============================================================================

export interface SearchResult {
  cardId: string;
  cardTitle: string;
  projectId: string;
  projectName: string;
  stage: KanbanStage;
  matchField: string;      // "title" | "description" | "problem" | "checklist"
  snippet: string;
  isArchived?: boolean;    // true if card is archived
}

// ============================================================================
// Aggregated View Types
// ============================================================================

export interface ProjectWithBacklog extends Project {
  backlog: BacklogItem[];
  designs: DesignEntry[];
  features: FeatureEntry[];
  accessible: boolean;
  error?: string;
  // Enriched data (populated by dashboard API)
  assets?: ProjectAssets;
  gitUncommitted?: number;
  healthScore?: HealthScore;
  platforms?: PlatformDetection;
  lastActivity?: string | null;
  activeSessions?: number;
}

export interface DashboardData {
  projects: ProjectWithBacklog[];
  totalBacklogItems: number;
  activeItems: number;
  totalOutdatedAssets?: number;
  totalUncommitted?: number;
  lastRefresh: string;
  slycodeRoot: string;
  projectsDir: string;
}

// ============================================================================
// Health Monitor Types (System & Bridge Stats)
// ============================================================================

export type SessionStatus = 'running' | 'stopped' | 'detached';

export interface SessionActivity {
  name: string;
  status: SessionStatus;
  lastOutputAt: string | null;
  isActive: boolean;  // true if output within last 3 seconds
  activityStartedAt?: string;
  lastOutputSnippet?: string;
}

export interface BridgeStats {
  bridgeTerminals: number;      // Total PTY sessions (running or detached)
  connectedClients: number;     // Total SSE/WS connections
  activelyWorking: number;      // Sessions with output in last 2s (sustained 1s+)
  sessions: SessionActivity[];  // Per-session activity info
}

export interface SystemStats {
  cpu: number;  // percentage 0-100
  memory: {
    used: number;   // bytes
    total: number;  // bytes
  };
  swap: {
    used: number;   // bytes
    total: number;  // bytes
  };
}
