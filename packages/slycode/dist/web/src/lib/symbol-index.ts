/**
 * Code Mode — deterministic symbol index (feature 076, NO LSP).
 *
 * Parses source files with web-tree-sitter (per-language grammar packages,
 * each shipping its own compatible wasm) and extracts symbol definitions:
 * functions, classes, methods, interfaces, types, enums. Languages: TS/TSX/JS,
 * Python, Bash, Java. Powers jump-to-definition, the Symbols rail, and the
 * L3 file atlas.
 *
 * Server-side only. Per-project cache keyed by file mtime — indexing is
 * incremental after the first pass. HMR-safe via globalThis (scheduler
 * convention).
 */

import { promises as fs } from 'fs';
import fsSync from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { Parser, Language, Query } from 'web-tree-sitter';

const execFileAsync = promisify(execFile);

export type SymbolKind = 'fn' | 'class' | 'method' | 'interface' | 'type' | 'enum' | 'const';

export interface CodeSymbol {
  name: string;
  kind: SymbolKind;
  /** repo-relative posix path */
  file: string;
  /** 1-based line of the definition */
  line: number;
  /** enclosing container, e.g. class name for methods */
  container?: string;
}

interface FileEntry {
  mtimeMs: number;
  symbols: CodeSymbol[];
}

interface ProjectIndex {
  files: Map<string, FileEntry>; // key: repo-relative posix path
  builtAt: number;
}

// ---------------------------------------------------------------------------
// Language registry
// ---------------------------------------------------------------------------

const LANG_BY_EXT: Record<string, string> = {
  '.ts': 'typescript',
  '.mts': 'typescript',
  '.cts': 'typescript',
  '.tsx': 'tsx',
  '.js': 'javascript',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  '.jsx': 'javascript',
  '.py': 'python',
  '.sh': 'bash',
  '.bash': 'bash',
  '.java': 'java',
};

const MAX_FILE_BYTES = 512 * 1024;
const MAX_FILES = 4000;

// ---------------------------------------------------------------------------
// Parser bootstrap (lazy, shared)
// ---------------------------------------------------------------------------

interface TsState {
  ready: Promise<void> | null;
  languages: Map<string, Language>;
  queries: Map<string, Query>;
  parser: Parser | null;
  indexes: Map<string, ProjectIndex>;
  building: Map<string, Promise<ProjectIndex>>;
}

const TS_KEY = '__slycode_symbol_index__';
function state(): TsState {
  const g = globalThis as unknown as Record<string, TsState>;
  if (!g[TS_KEY]) {
    g[TS_KEY] = { ready: null, languages: new Map(), queries: new Map(), parser: null, indexes: new Map(), building: new Map() };
  }
  return g[TS_KEY];
}

async function ensureParser(): Promise<void> {
  const s = state();
  if (!s.ready) {
    s.ready = Parser.init().then(() => {
      s.parser = new Parser();
    });
  }
  await s.ready;
}

/**
 * Per-language grammar packages (each ships its own wasm built against a
 * compatible ABI — the aggregated tree-sitter-wasms bundle was stale and its
 * bash grammar crashed web-tree-sitter 0.25 on files > ~2 KB).
 */
const GRAMMAR_PKG: Record<string, string> = {
  typescript: 'tree-sitter-typescript/tree-sitter-typescript.wasm',
  tsx: 'tree-sitter-typescript/tree-sitter-tsx.wasm',
  javascript: 'tree-sitter-javascript/tree-sitter-javascript.wasm',
  python: 'tree-sitter-python/tree-sitter-python.wasm',
  bash: 'tree-sitter-bash/tree-sitter-bash.wasm',
  java: 'tree-sitter-java/tree-sitter-java.wasm',
};

function grammarPath(name: string): string {
  // Next bundles route handlers, so require.resolve on a non-JS asset is
  // unreliable — resolve against plausible node_modules roots instead.
  const rel = path.join('node_modules', ...GRAMMAR_PKG[name].split('/'));
  const candidates = [
    path.join(process.cwd(), rel),                    // dev: cwd is web/
    path.join(process.cwd(), 'web', rel),             // dev: cwd is repo root
    path.join(path.dirname(process.cwd()), 'web', rel),
  ];
  for (const c of candidates) {
    if (fsSync.existsSync(c)) return c;
  }
  throw new Error(`tree-sitter grammar not found: ${name} (looked in ${candidates.join(', ')})`);
}

async function loadLanguage(name: string): Promise<Language> {
  const s = state();
  const cached = s.languages.get(name);
  if (cached) return cached;
  const lang = await Language.load(grammarPath(name));
  s.languages.set(name, lang);
  return lang;
}

// ---------------------------------------------------------------------------
// Symbol extraction — compiled tree-sitter queries (one WASM pass per file;
// a recursive namedChild() walk crosses the WASM boundary per node and was
// ~200ms/file on real sources).
// ---------------------------------------------------------------------------

const TS_QUERY = `
(function_declaration name: (identifier) @name) @def
(generator_function_declaration name: (identifier) @name) @def
(class_declaration name: (type_identifier) @name) @def
(abstract_class_declaration name: (type_identifier) @name) @def
(method_definition name: (property_identifier) @name) @def
(interface_declaration name: (type_identifier) @name) @def
(type_alias_declaration name: (type_identifier) @name) @def
(enum_declaration name: (identifier) @name) @def
(variable_declarator name: (identifier) @name value: [(arrow_function) (function_expression)]) @def
`;

const JS_QUERY = `
(function_declaration name: (identifier) @name) @def
(generator_function_declaration name: (identifier) @name) @def
(class_declaration name: (identifier) @name) @def
(method_definition name: (property_identifier) @name) @def
(variable_declarator name: (identifier) @name value: [(arrow_function) (function_expression)]) @def
`;

const PY_QUERY = `
(function_definition name: (identifier) @name) @def
(class_definition name: (identifier) @name) @def
`;

const BASH_QUERY = `
(function_definition name: (word) @name) @def
`;

const JAVA_QUERY = `
(class_declaration name: (identifier) @name) @def
(interface_declaration name: (identifier) @name) @def
(enum_declaration name: (identifier) @name) @def
(record_declaration name: (identifier) @name) @def
(method_declaration name: (identifier) @name) @def
(constructor_declaration name: (identifier) @name) @def
`;

const QUERY_SRC: Record<string, string> = {
  typescript: TS_QUERY,
  tsx: TS_QUERY,
  javascript: JS_QUERY,
  python: PY_QUERY,
  bash: BASH_QUERY,
  java: JAVA_QUERY,
};

const KIND_BY_NODE_TYPE: Record<string, SymbolKind> = {
  function_declaration: 'fn',
  generator_function_declaration: 'fn',
  class_declaration: 'class',
  abstract_class_declaration: 'class',
  method_definition: 'method',
  interface_declaration: 'interface',
  type_alias_declaration: 'type',
  enum_declaration: 'enum',
  variable_declarator: 'fn',
  function_definition: 'fn', // python + bash
  class_definition: 'class', // python
  method_declaration: 'method',      // java
  constructor_declaration: 'method', // java
  record_declaration: 'class',       // java
};

const CONTAINER_TYPES = new Set([
  'class_declaration',
  'abstract_class_declaration',
  'class_definition',
  'interface_declaration', // java default methods
  'enum_declaration',      // java enum methods
  'record_declaration',
]);

async function getQuery(langName: string): Promise<Query> {
  const s = state();
  const cached = s.queries.get(langName);
  if (cached) return cached;
  const lang = await loadLanguage(langName);
  const query = new Query(lang, QUERY_SRC[langName]);
  s.queries.set(langName, query);
  return query;
}

type SyntaxNodeLike = {
  type: string;
  text: string;
  parent: SyntaxNodeLike | null;
  startPosition: { row: number };
  childForFieldName(name: string): SyntaxNodeLike | null;
};

/** Nearest enclosing class name, if any (few WASM hops, symbols are sparse). */
function findContainer(node: SyntaxNodeLike): string | undefined {
  let cur = node.parent;
  while (cur) {
    if (CONTAINER_TYPES.has(cur.type)) {
      return cur.childForFieldName('name')?.text;
    }
    cur = cur.parent;
  }
  return undefined;
}

async function parseFile(absPath: string, relPath: string, langName: string): Promise<CodeSymbol[]> {
  const s = state();
  await ensureParser();
  const buf = await fs.readFile(absPath);
  if (buf.length > MAX_FILE_BYTES || buf.includes(0)) return [];
  const lang = await loadLanguage(langName);
  const query = await getQuery(langName);
  s.parser!.setLanguage(lang);
  const tree = s.parser!.parse(buf.toString('utf-8'));
  if (!tree) return [];
  try {
    const out: CodeSymbol[] = [];
    for (const match of query.matches(tree.rootNode)) {
      let def: SyntaxNodeLike | undefined;
      let nameNode: SyntaxNodeLike | undefined;
      for (const cap of match.captures) {
        if (cap.name === 'def') def = cap.node as unknown as SyntaxNodeLike;
        else if (cap.name === 'name') nameNode = cap.node as unknown as SyntaxNodeLike;
      }
      if (!def || !nameNode) continue;
      const baseKind = KIND_BY_NODE_TYPE[def.type];
      if (!baseKind) continue;
      const container = findContainer(def);
      const kind: SymbolKind =
        baseKind === 'fn' && container && (langName === 'python') ? 'method' : baseKind;
      out.push({ name: nameNode.text, kind, file: relPath, line: def.startPosition.row + 1, container });
    }
    return out;
  } finally {
    tree.delete();
  }
}

// ---------------------------------------------------------------------------
// Project indexing
// ---------------------------------------------------------------------------

async function listIndexableFiles(root: string): Promise<string[]> {
  let files: string[] = [];
  try {
    const { stdout } = await execFileAsync(
      'git',
      ['ls-files', '--cached', '--others', '--exclude-standard'],
      { cwd: root, windowsHide: true, timeout: 15000, maxBuffer: 32 * 1024 * 1024 },
    );
    files = stdout.split('\n').filter(Boolean);
  } catch {
    return []; // non-git projects: symbol index unavailable rather than walking blind
  }
  return files
    .filter(f => LANG_BY_EXT[path.posix.extname(f).toLowerCase()])
    .slice(0, MAX_FILES);
}

async function buildIndex(projectId: string, root: string): Promise<ProjectIndex> {
  const s = state();
  const prev = s.indexes.get(projectId);
  const files = await listIndexableFiles(root);
  const index: ProjectIndex = { files: new Map(), builtAt: Date.now() };

  for (const rel of files) {
    const abs = path.join(root, rel);
    let mtimeMs: number;
    try {
      mtimeMs = (await fs.stat(abs)).mtimeMs;
    } catch {
      continue; // deleted between listing and stat
    }
    const cached = prev?.files.get(rel);
    if (cached && cached.mtimeMs === mtimeMs) {
      index.files.set(rel, cached);
      continue;
    }
    const ext = path.posix.extname(rel).toLowerCase();
    try {
      const symbols = await parseFile(abs, rel, LANG_BY_EXT[ext]);
      index.files.set(rel, { mtimeMs, symbols });
    } catch {
      // unparseable file — skip, never fail the whole index
    }
  }

  s.indexes.set(projectId, index);
  return index;
}

/** Get (building if needed) the symbol index for a project. Single-flight. */
async function getIndex(projectId: string, root: string, refresh: boolean): Promise<ProjectIndex> {
  const s = state();
  const existing = s.indexes.get(projectId);
  if (existing && !refresh && Date.now() - existing.builtAt < 30_000) return existing;

  const inflight = s.building.get(projectId);
  if (inflight) return inflight;

  const p = buildIndex(projectId, root).finally(() => s.building.delete(projectId));
  s.building.set(projectId, p);
  return p;
}

export interface SymbolQuery {
  /** filter to one repo-relative file */
  file?: string;
  /** case-insensitive substring on symbol name */
  q?: string;
  limit?: number;
}

/** Public API: query the project's symbols. */
export async function querySymbols(
  projectId: string,
  root: string,
  query: SymbolQuery = {},
): Promise<{ symbols: CodeSymbol[]; fileCount: number; total: number }> {
  const index = await getIndex(projectId, root, false);
  const limit = Math.min(query.limit ?? 200, 1000);
  const needle = query.q?.toLowerCase();

  let symbols: CodeSymbol[] = [];
  if (query.file) {
    symbols = index.files.get(query.file.replace(/\\/g, '/'))?.symbols ?? [];
  } else {
    for (const entry of index.files.values()) symbols = symbols.concat(entry.symbols);
  }
  const total = symbols.length;
  if (needle) {
    // rank: prefix matches first, then substring
    const pre: CodeSymbol[] = [];
    const sub: CodeSymbol[] = [];
    for (const s of symbols) {
      const n = s.name.toLowerCase();
      if (n.startsWith(needle)) pre.push(s);
      else if (n.includes(needle)) sub.push(s);
    }
    symbols = [...pre, ...sub];
  }
  return { symbols: symbols.slice(0, limit), fileCount: index.files.size, total };
}
