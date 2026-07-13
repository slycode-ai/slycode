/**
 * Code Mode — client-side shared types (feature 076).
 * Server counterparts live in web/src/lib/atlas/* and symbol-index.ts.
 */

export interface TreeNode {
  name: string;
  path: string;
  type: 'dir' | 'file';
  /** gitignored file surfaced for editing (.env & friends) — rendered dimmed */
  ignored?: boolean;
  children?: TreeNode[];
}

export type SymbolKind = 'fn' | 'class' | 'method' | 'interface' | 'type' | 'enum' | 'const';

export interface CodeSymbol {
  name: string;
  kind: SymbolKind;
  file: string;
  line: number;
  container?: string;
}

export interface SearchMatch {
  file: string;
  line: number;
  text: string;
  spans: Array<[number, number]>;
}

export interface GitFileStatus {
  path: string;
  status: string;
  category: 'staged' | 'unstaged' | 'untracked';
}

export interface GitStatusResult {
  isRepo: boolean;
  branch?: string;
  files: GitFileStatus[];
}

export interface GitLogEntry {
  hash: string;
  shortHash: string;
  author: string;
  date: string;
  subject: string;
}

export interface BranchInfo { name: string; current: boolean }

export interface BlameLine {
  line: number;
  shortHash: string;
  author: string;
  date: string;
  summary: string;
}

/** A location the editor should open (file + optional 1-based line focus). */
export interface OpenTarget {
  path: string;
  line?: number;
  /** transient highlight range + note (AI `highlight` directive) */
  highlight?: { line: number; endLine?: number; note?: string };
}

/** Canvas scenes. map/area/file are the Atlas zoom levels (L0/L1/L3). */
export type CodeModeScene =
  | { kind: 'map' }
  | { kind: 'area'; areaId: string }
  | { kind: 'file'; path: string; areaId?: string }
  | { kind: 'editor'; target: OpenTarget }
  | { kind: 'diff'; path?: string }
  | { kind: 'commit'; hash: string; subject?: string }
  | { kind: 'log'; path?: string }
  | { kind: 'db'; focusTable?: string };

export const RAIL_TABS = ['files', 'symbols', 'search', 'git', 'db'] as const;
export type RailTab = (typeof RAIL_TABS)[number];

// ---------------------------------------------------------------------------
// Atlas snapshot types (server shapes from /api/atlas/artifacts)
// ---------------------------------------------------------------------------

export interface AtlasArea {
  id: string;
  name: string;
  paths: string[];
  summary?: string;
  pinned?: boolean;
  color?: string;
}

export interface AtlasFlow { from: string; to: string; label: string }

export interface AtlasRoot {
  schema_version: number;
  updated_at: string;
  project_overview?: string;
  areas: AtlasArea[];
  flows?: AtlasFlow[];
}

export interface AtlasKeyFile { path: string; role: string }
export interface AtlasModule { path: string; name: string; summary: string }
export interface AtlasCollection { prefix: string; summary?: string }

export interface AtlasNode {
  area: string;
  updated_at: string;
  explanation: string;
  key_files: AtlasKeyFile[];
  modules?: AtlasModule[];
  symbol_summaries?: Record<string, Record<string, string>>;
  collections?: AtlasCollection[];
  source_hashes: Record<string, string>;
}

export interface AreaFreshness {
  areaId: string;
  hasNode: boolean;
  analyzedAt?: string;
  stale: boolean;
  changedFiles: string[];
  newFiles: number;
  churn: number;
}

export interface AtlasConfig {
  enabled: boolean;
  schedule: string;
  provider?: string | null;
  last_run?: string | null;
}

// ---------------------------------------------------------------------------
// Stretch artifacts (feature 079) — client mirrors of lib/atlas shapes
// ---------------------------------------------------------------------------

export interface DigestAreaEntry {
  area: string;
  summary: string;
  commits?: number;
  files_changed?: number;
}

export interface DigestNotable { file: string; line?: number; note: string }

export interface AtlasDigest {
  schema_version: number;
  generated_at: string;
  since_commit: string;
  since_date?: string;
  head_commit: string;
  headline: string;
  areas: DigestAreaEntry[];
  notable?: DigestNotable[];
}

export interface TourStep {
  file: string;
  line?: number;
  endLine?: number;
  title: string;
  body: string;
}

export interface AtlasTour {
  schema_version: number;
  id: string;
  title: string;
  /** the question this tour answers — the refresh anchor */
  prompt?: string;
  description?: string;
  area?: string;
  updated_at: string;
  steps: TourStep[];
}

export interface TourWithFreshness {
  tour: AtlasTour;
  stale: boolean;
  changedFiles: string[];
}

export interface AreaDebt {
  areaId: string;
  commits: number;
  views: number;
  score: number;
}

export interface AtlasViewState {
  last_visit?: string;
  anchor_commit?: string;
  digest_seen?: string | null;
  area_views?: Record<string, number>;
}

export interface DbColumn { name: string; type: string; pk: boolean; nullable: boolean }
export interface DbForeignKey { column: string; refTable: string; refColumn?: string }
export interface DbTable { name: string; columns: DbColumn[]; fks: DbForeignKey[] }
export interface DbSource { kind: 'sqlite' | 'prisma' | 'sql'; path: string; tables: DbTable[]; error?: string }
export interface DbIntrospection { sources: DbSource[] }
export interface DbTableAnnotation { summary?: string; columns?: Record<string, string> }
export interface DbAnnotations {
  schema_version: number;
  updated_at: string;
  summary?: string;
  tables?: Record<string, DbTableAnnotation>;
  relations?: Array<{ from: string; to: string; label?: string }>;
}

export interface AtlasSnapshot {
  exists: boolean;
  root?: AtlasRoot;
  rootErrors?: string[];
  nodes: Record<string, AtlasNode>;
  nodeErrors: Record<string, string[]>;
  freshness: Record<string, AreaFreshness>;
  config?: AtlasConfig | null;
  digest?: AtlasDigest | null;
  viewState?: AtlasViewState | null;
  tours?: TourWithFreshness[];
  debt?: AreaDebt[];
}

export interface DeckItem { file: string; line?: number; note?: string }

export interface NavEvent {
  id: string;
  ts: string;
  type: 'navigate' | 'highlight' | 'deck';
  file?: string;
  line?: number;
  endLine?: number;
  note?: string;
  deck?: { title: string; items: DeckItem[] };
}

/** What the right context panel is describing. */
export type ContextSelection =
  | { kind: 'overview' }
  | { kind: 'area'; areaId: string }
  | { kind: 'file'; path: string; areaId?: string };
