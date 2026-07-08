#!/usr/bin/env node

/**
 * sly-atlas — Codebase Atlas CLI (feature 076)
 *
 * The WRITE PATH for atlas artifacts. Agents (via the atlas skill) call this
 * to publish structure; every write is schema-validated here so a confused
 * agent can only produce a rejected write, never a corrupt atlas. The web UI
 * renders whatever this CLI has accepted.
 *
 * VALIDATION IS MIRRORED from web/src/lib/atlas/schema.ts — KEEP IN LOCKSTEP
 * (same convention as status/questionnaire logic in scripts/kanban.js).
 *
 * Commands:
 *   sly-atlas init                              Create documentation/atlas/ scaffolding
 *   sly-atlas status [--json]                   Staleness report per area
 *   sly-atlas propose-areas --file <json>       Write/replace atlas.json root (pins preserved)
 *   sly-atlas write-node <areaId> --file <json> Validate + hash-stamp + write an area node
 *   sly-atlas navigate <file[:line[-end]]> [--note "..."]     Jump the Code Mode view
 *   sly-atlas highlight <file:line[-end]> --note "..."        Highlight a range with a note
 *   sly-atlas deck --file <json>                Present a clickable result deck
 *   sly-atlas help
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ---------------------------------------------------------------------------
// Project root (same marker as sly-kanban: documentation/kanban.json)
// ---------------------------------------------------------------------------
function findProjectRoot() {
  let dir = process.cwd();
  while (dir !== path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, 'documentation', 'kanban.json'))) return dir;
    dir = path.dirname(dir);
  }
  return null;
}

const PROJECT_ROOT = findProjectRoot();
if (!PROJECT_ROOT) {
  console.error('Error: not inside a SlyCode project (no documentation/kanban.json found above cwd).');
  process.exit(1);
}
const ATLAS_DIR = path.join(PROJECT_ROOT, 'documentation', 'atlas');
const ATLAS_JSON = path.join(ATLAS_DIR, 'atlas.json');
const NODES_DIR = path.join(ATLAS_DIR, 'nodes');
const CONFIG_JSON = path.join(ATLAS_DIR, 'config.json');
const NAV_EVENTS_JSON = path.join(ATLAS_DIR, 'nav-events.json');

// ---------------------------------------------------------------------------
// Schema constants + validators — LOCKSTEP MIRROR of web/src/lib/atlas/schema.ts
// ---------------------------------------------------------------------------
const ATLAS_SCHEMA_VERSION = 1;
const AREA_PALETTE = [
  '#4cb8f0', '#9d8cf5', '#ef6fb0', '#e8b64a', '#52c98b', '#7f8ea3',
  '#5fd4d0', '#d98d5f', '#b3a1f7', '#8fbf6a', '#e8748a', '#6a9ac9',
];
const LIMITS = {
  maxAreas: 16, maxPathsPerArea: 10, maxNameLen: 60, maxSummaryLen: 200,
  maxOverviewLen: 2000, maxExplanationLen: 8000, maxKeyFiles: 40, maxModules: 80,
  maxRoleLen: 80, maxSymbolFiles: 60, maxSymbolsPerFile: 60, maxSymbolSummaryLen: 200,
  maxFlows: 12, maxFlowLabelLen: 60, maxDeckItems: 30, maxNoteLen: 500, maxNavEvents: 50,
  maxCollections: 20,
};
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,31}$/;

function isRelPath(p) {
  return typeof p === 'string' && p.length > 0 && p.length < 300 &&
    !p.startsWith('/') && !/^[a-zA-Z]:/.test(p) && !p.split(/[\\/]/).includes('..');
}

function validateAtlasRoot(d) {
  const errs = [];
  if (!d || typeof d !== 'object') return ['root: not an object'];
  if (d.schema_version !== ATLAS_SCHEMA_VERSION) errs.push(`root: schema_version must be ${ATLAS_SCHEMA_VERSION}`);
  if (typeof d.updated_at !== 'string' || isNaN(Date.parse(d.updated_at))) errs.push('root: updated_at must be ISO date');
  if (d.project_overview !== undefined && (typeof d.project_overview !== 'string' || d.project_overview.length > LIMITS.maxOverviewLen)) {
    errs.push(`root: project_overview must be a string ≤ ${LIMITS.maxOverviewLen} chars`);
  }
  if (!Array.isArray(d.areas) || d.areas.length === 0) { errs.push('root: areas must be a non-empty array'); return errs; }
  if (d.areas.length > LIMITS.maxAreas) errs.push(`root: too many areas (max ${LIMITS.maxAreas})`);
  const ids = new Set();
  d.areas.forEach((a, i) => {
    const where = `areas[${i}]`;
    if (!a || typeof a !== 'object') { errs.push(`${where}: not an object`); return; }
    if (typeof a.id !== 'string' || !SLUG_RE.test(a.id)) errs.push(`${where}: id must match ${SLUG_RE}`);
    else if (ids.has(a.id)) errs.push(`${where}: duplicate id '${a.id}'`);
    else ids.add(a.id);
    if (typeof a.name !== 'string' || !a.name.trim() || a.name.length > LIMITS.maxNameLen) errs.push(`${where}: name required (≤ ${LIMITS.maxNameLen} chars)`);
    if (!Array.isArray(a.paths) || a.paths.length === 0 || a.paths.length > LIMITS.maxPathsPerArea || !a.paths.every(isRelPath)) {
      errs.push(`${where}: paths must be 1-${LIMITS.maxPathsPerArea} repo-relative prefixes`);
    }
    if (a.summary !== undefined && (typeof a.summary !== 'string' || a.summary.length > LIMITS.maxSummaryLen)) {
      errs.push(`${where}: summary must be ≤ ${LIMITS.maxSummaryLen} chars`);
    }
    if (a.pinned !== undefined && typeof a.pinned !== 'boolean') errs.push(`${where}: pinned must be boolean`);
  });
  if (d.flows !== undefined) {
    if (!Array.isArray(d.flows) || d.flows.length > LIMITS.maxFlows) errs.push(`root: flows must be an array ≤ ${LIMITS.maxFlows}`);
    else d.flows.forEach((f, i) => {
      if (!f || typeof f !== 'object' || !ids.has(f.from) || !ids.has(f.to) ||
          typeof f.label !== 'string' || f.label.length > LIMITS.maxFlowLabelLen) {
        errs.push(`flows[${i}]: from/to must be known area ids, label ≤ ${LIMITS.maxFlowLabelLen} chars`);
      }
    });
  }
  return errs;
}

function validateAtlasNode(d, knownAreaIds) {
  const errs = [];
  if (!d || typeof d !== 'object') return ['node: not an object'];
  if (d.schema_version !== ATLAS_SCHEMA_VERSION) errs.push(`node: schema_version must be ${ATLAS_SCHEMA_VERSION}`);
  if (typeof d.area !== 'string' || !SLUG_RE.test(d.area)) errs.push('node: area must be a slug');
  else if (knownAreaIds && !knownAreaIds.has(d.area)) errs.push(`node: unknown area '${d.area}' — not in atlas.json`);
  if (typeof d.updated_at !== 'string' || isNaN(Date.parse(d.updated_at))) errs.push('node: updated_at must be ISO date');
  if (typeof d.explanation !== 'string' || !d.explanation.trim() || d.explanation.length > LIMITS.maxExplanationLen) {
    errs.push(`node: explanation required (≤ ${LIMITS.maxExplanationLen} chars)`);
  }
  if (!Array.isArray(d.key_files) || d.key_files.length === 0 || d.key_files.length > LIMITS.maxKeyFiles) {
    errs.push(`node: key_files must be 1-${LIMITS.maxKeyFiles} entries`);
  } else {
    d.key_files.forEach((k, i) => {
      if (!k || !isRelPath(k.path) || typeof k.role !== 'string' || k.role.length > LIMITS.maxRoleLen) {
        errs.push(`node.key_files[${i}]: needs repo-relative path + role ≤ ${LIMITS.maxRoleLen} chars`);
      }
    });
  }
  if (d.modules !== undefined) {
    if (!Array.isArray(d.modules) || d.modules.length > LIMITS.maxModules) errs.push(`node: modules must be an array ≤ ${LIMITS.maxModules}`);
    else d.modules.forEach((m, i) => {
      if (!m || !isRelPath(m.path) || typeof m.name !== 'string' || !m.name ||
          typeof m.summary !== 'string' || m.summary.length > LIMITS.maxSummaryLen) {
        errs.push(`node.modules[${i}]: needs path, name, summary ≤ ${LIMITS.maxSummaryLen} chars`);
      }
    });
  }
  if (d.symbol_summaries !== undefined) {
    if (!d.symbol_summaries || typeof d.symbol_summaries !== 'object' || Array.isArray(d.symbol_summaries)) {
      errs.push('node: symbol_summaries must be an object');
    } else {
      const files = Object.keys(d.symbol_summaries);
      if (files.length > LIMITS.maxSymbolFiles) errs.push(`node: symbol_summaries covers too many files (max ${LIMITS.maxSymbolFiles})`);
      for (const f of files) {
        if (!isRelPath(f)) { errs.push(`node.symbol_summaries: bad path '${f}'`); continue; }
        const syms = d.symbol_summaries[f];
        if (!syms || typeof syms !== 'object' || Array.isArray(syms)) { errs.push(`node.symbol_summaries[${f}]: must be an object`); continue; }
        const names = Object.keys(syms);
        if (names.length > LIMITS.maxSymbolsPerFile) errs.push(`node.symbol_summaries[${f}]: too many symbols (max ${LIMITS.maxSymbolsPerFile})`);
        for (const n of names) {
          if (typeof syms[n] !== 'string' || syms[n].length > LIMITS.maxSymbolSummaryLen) {
            errs.push(`node.symbol_summaries[${f}].${n}: summary must be ≤ ${LIMITS.maxSymbolSummaryLen} chars`);
          }
        }
      }
    }
  }
  if (d.collections !== undefined) {
    if (!Array.isArray(d.collections) || d.collections.length > LIMITS.maxCollections) {
      errs.push(`node: collections must be an array ≤ ${LIMITS.maxCollections}`);
    } else {
      d.collections.forEach((c, i) => {
        if (!c || !isRelPath(c.prefix) ||
            (c.summary !== undefined && (typeof c.summary !== 'string' || c.summary.length > LIMITS.maxSummaryLen))) {
          errs.push(`node.collections[${i}]: needs repo-relative prefix (+ summary ≤ ${LIMITS.maxSummaryLen} chars)`);
        }
      });
    }
  }
  if (d.source_hashes !== undefined) {
    if (!d.source_hashes || typeof d.source_hashes !== 'object' || Array.isArray(d.source_hashes)) {
      errs.push('node: source_hashes must be an object');
    } else {
      for (const [p, h] of Object.entries(d.source_hashes)) {
        // trailing '/' = collection member-list hash (directory convention)
        const key = p.endsWith('/') ? p.slice(0, -1) : p;
        if (!isRelPath(key) || typeof h !== 'string' || !/^[0-9a-f]{12}$/.test(h)) {
          errs.push(`node.source_hashes['${p}']: must map repo-relative path → 12-hex hash`);
        }
      }
    }
  }
  return errs;
}

function validateNavEvent(d) {
  const errs = [];
  if (!d || typeof d !== 'object') return ['nav: not an object'];
  if (d.type !== 'navigate' && d.type !== 'highlight' && d.type !== 'deck') errs.push('nav: type must be navigate|highlight|deck');
  if (d.note !== undefined && (typeof d.note !== 'string' || d.note.length > LIMITS.maxNoteLen)) errs.push(`nav: note ≤ ${LIMITS.maxNoteLen} chars`);
  if (d.type === 'navigate' || d.type === 'highlight') {
    if (!isRelPath(d.file)) errs.push('nav: file must be repo-relative');
    if (d.line !== undefined && (!Number.isInteger(d.line) || d.line < 1)) errs.push('nav: line must be a positive integer');
    if (d.endLine !== undefined && (!Number.isInteger(d.endLine) || d.endLine < (d.line ?? 1))) errs.push('nav: endLine must be ≥ line');
    if (d.type === 'highlight' && d.line === undefined) errs.push('nav: highlight requires a line');
  }
  if (d.type === 'deck') {
    const deck = d.deck;
    if (!deck || typeof deck !== 'object' || typeof deck.title !== 'string' || !deck.title.trim()) {
      errs.push('nav: deck requires a title');
    } else if (!Array.isArray(deck.items) || deck.items.length === 0 || deck.items.length > LIMITS.maxDeckItems) {
      errs.push(`nav: deck.items must be 1-${LIMITS.maxDeckItems} entries`);
    } else {
      deck.items.forEach((it, i) => {
        if (!it || !isRelPath(it.file) ||
            (it.line !== undefined && (!Number.isInteger(it.line) || it.line < 1)) ||
            (it.note !== undefined && (typeof it.note !== 'string' || it.note.length > LIMITS.maxNoteLen))) {
          errs.push(`nav: deck.items[${i}] invalid`);
        }
      });
    }
  }
  return errs;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function hashContent(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex').slice(0, 12);
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf-8')); } catch { return null; }
}

function writeJsonAtomic(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', 'utf-8');
  fs.renameSync(tmp, file);
}

function fail(errors, hint) {
  console.error('REJECTED — fix these and retry:');
  for (const e of Array.isArray(errors) ? errors : [errors]) console.error(`  ✗ ${e}`);
  if (hint) console.error(hint);
  process.exit(1);
}

function getFlag(args, name) {
  const i = args.indexOf(name);
  if (i === -1) return undefined;
  return args[i + 1];
}

function loadPayload(args) {
  const file = getFlag(args, '--file');
  const inline = getFlag(args, '--json');
  if (!file && !inline) fail(['provide --file <path.json> or --json \'<inline json>\'']);
  try {
    return JSON.parse(inline !== undefined ? inline : fs.readFileSync(file, 'utf-8'));
  } catch (e) {
    fail([`payload is not valid JSON: ${e.message}`]);
  }
}

function containedAbs(rel) {
  const posix = String(rel).replace(/\\/g, '/');
  const abs = path.resolve(PROJECT_ROOT, posix);
  if (abs !== PROJECT_ROOT && !abs.startsWith(PROJECT_ROOT + path.sep)) fail([`path escapes project: ${rel}`]);
  return abs;
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

function cmdInit() {
  fs.mkdirSync(NODES_DIR, { recursive: true });
  if (!fs.existsSync(CONFIG_JSON)) {
    writeJsonAtomic(CONFIG_JSON, { enabled: false, schedule: '0 3 * * *', provider: null, model: null, last_run: null });
  }
  console.log(`Initialized ${path.relative(PROJECT_ROOT, ATLAS_DIR)}/`);
  console.log(fs.existsSync(ATLAS_JSON)
    ? 'atlas.json already exists.'
    : 'No atlas.json yet — run the first scan (propose-areas, then write-node per area).');
}

/** All tracked+untracked project files (gitignore respected). Cached per run. */
let PROJECT_FILES = null;
function projectFiles() {
  if (PROJECT_FILES) return PROJECT_FILES;
  try {
    const { execFileSync } = require('child_process');
    const out = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], {
      cwd: PROJECT_ROOT, encoding: 'utf-8', windowsHide: true, timeout: 15000, maxBuffer: 32 * 1024 * 1024,
    });
    PROJECT_FILES = out.split('\n').filter(Boolean);
  } catch {
    PROJECT_FILES = [];
  }
  return PROJECT_FILES;
}

function underPaths(file, prefixes) {
  return prefixes.some(p => file === p || file.startsWith(p.endsWith('/') ? p : p + '/'));
}

/** Members of a collection prefix (sorted). */
function collectionMembers(prefix) {
  const norm = prefix.endsWith('/') ? prefix.slice(0, -1) : prefix;
  return projectFiles().filter(f => underPaths(f, [norm])).sort();
}

/** Deterministic member-list hash — MUST match web store.ts memberListHash. */
function collectionListHash(prefix) {
  return hashContent(collectionMembers(prefix).join('\n'));
}

/** File-level coverage for one area: what the node describes vs what exists. */
function areaCoverage(area, node) {
  const files = projectFiles().filter(f => underPaths(f, area.paths));
  const described = new Set();
  const collectionPrefixes = (node && node.collections ? node.collections : []).map(c => c.prefix);
  if (node) {
    for (const k of node.key_files || []) described.add(k.path);
    for (const m of node.modules || []) described.add(m.path);
    for (const f of Object.keys(node.symbol_summaries || {})) described.add(f);
  }
  const isDescribed = (f) => described.has(f) || underPaths(f, collectionPrefixes);
  const undescribed = files.filter(f => !isDescribed(f));
  // Largest undescribed files first — the highest-value enrichment targets.
  const ranked = undescribed
    .map(f => {
      let size = 0;
      try { size = fs.statSync(path.resolve(PROJECT_ROOT, f)).size; } catch { /* gone */ }
      return { f, size };
    })
    .sort((a, b) => b.size - a.size)
    .slice(0, 8)
    .map(x => x.f);
  const describedCount = files.filter(isDescribed).length;
  return {
    totalFiles: files.length,
    describedFiles: describedCount,
    pct: files.length ? Math.round((describedCount / files.length) * 100) : 100,
    collections: collectionPrefixes,
    topUndescribed: ranked,
  };
}

function cmdStatus(args) {
  const asJson = args.includes('--json');
  const root = readJson(ATLAS_JSON);
  if (!root) {
    const out = { exists: false, message: 'No atlas.json — first scan needed (propose-areas, then write-node per area).' };
    console.log(asJson ? JSON.stringify(out, null, 2) : out.message);
    return;
  }
  const rootErrs = validateAtlasRoot(root);
  if (rootErrs.length) fail(rootErrs, 'atlas.json on disk is invalid — regenerate it with propose-areas.');
  const report = [];
  for (const area of root.areas) {
    const node = readJson(path.join(NODES_DIR, `${area.id}.json`));
    const coverage = areaCoverage(area, node);
    if (!node) {
      report.push({ area: area.id, name: area.name, hasNode: false, stale: true, changed: [], coverage, reason: 'no node written yet' });
      continue;
    }
    const changed = [];
    for (const [rel, expected] of Object.entries(node.source_hashes || {})) {
      if (rel.endsWith('/')) {
        // collection member-list hash — membership change marks the area stale
        if (collectionListHash(rel) !== expected) changed.push(`${rel} (membership changed)`);
        continue;
      }
      const abs = path.resolve(PROJECT_ROOT, rel);
      let actual = null;
      try { actual = hashContent(fs.readFileSync(abs)); } catch { /* deleted */ }
      if (actual !== expected) changed.push(rel);
    }
    report.push({
      area: area.id,
      name: area.name,
      hasNode: true,
      analyzedAt: node.updated_at,
      stale: changed.length > 0,
      changed,
      coverage,
    });
  }
  if (asJson) {
    console.log(JSON.stringify({ exists: true, areas: report }, null, 2));
  } else {
    for (const r of report) {
      const flag = r.stale ? 'STALE' : 'fresh';
      console.log(`${flag.padEnd(6)} ${r.area.padEnd(16)} ${r.hasNode ? `analyzed ${r.analyzedAt}` : 'NO NODE'} · coverage ${r.coverage.describedFiles}/${r.coverage.totalFiles} files (${r.coverage.pct}%)${r.changed.length ? ` — ${r.changed.length} changed: ${r.changed.slice(0, 5).join(', ')}${r.changed.length > 5 ? '…' : ''}` : ''}`);
    }
    const staleCount = report.filter(r => r.stale).length;
    const thinnest = [...report].sort((a, b) => a.coverage.pct - b.coverage.pct)[0];
    console.log(`\n${report.length} areas, ${staleCount} stale. Re-analyze stale areas first.`);
    if (thinnest && thinnest.coverage.pct < 100) {
      console.log(`Then ENRICH the thinnest area ('${thinnest.area}', ${thinnest.coverage.pct}%) with write-node --merge — see the atlas skill's coverage crawl.`);
    }
  }
}

function cmdProposeAreas(args) {
  const payload = loadPayload(args);
  const existing = readJson(ATLAS_JSON);

  const doc = {
    schema_version: ATLAS_SCHEMA_VERSION,
    updated_at: new Date().toISOString(),
    generated_by: payload.generated_by || 'atlas-skill',
    project_overview: payload.project_overview,
    areas: Array.isArray(payload.areas) ? payload.areas.map(a => ({ ...a })) : payload.areas,
    flows: payload.flows,
  };

  // Pinned areas are user-owned identity: they must survive, with their names.
  if (existing && Array.isArray(existing.areas)) {
    const pinned = existing.areas.filter(a => a.pinned);
    for (const p of pinned) {
      const proposed = (doc.areas || []).find(a => a && a.id === p.id);
      if (!proposed) fail([`pinned area '${p.id}' (${p.name}) missing from proposal — pinned areas must be kept`]);
      proposed.name = p.name;        // pinned name wins
      proposed.pinned = true;
    }
  }

  const errs = validateAtlasRoot(doc);
  if (errs.length) fail(errs);

  // Deterministic colors: keep existing assignments, fill new areas from the
  // palette. THE AGENT NEVER PICKS COLORS — strip any it sent.
  const prevColors = new Map((existing?.areas || []).map(a => [a.id, a.color]).filter(([, c]) => c));
  const used = new Set(prevColors.values());
  let paletteIdx = 0;
  for (const area of doc.areas) {
    const prev = prevColors.get(area.id);
    if (prev) { area.color = prev; continue; }
    while (paletteIdx < AREA_PALETTE.length && used.has(AREA_PALETTE[paletteIdx])) paletteIdx++;
    area.color = AREA_PALETTE[paletteIdx % AREA_PALETTE.length];
    used.add(area.color);
    paletteIdx++;
  }

  // Warn (not fail) on area paths that don't exist on disk.
  for (const area of doc.areas) {
    for (const p of area.paths) {
      if (!fs.existsSync(path.resolve(PROJECT_ROOT, p))) {
        console.error(`warn: areas['${area.id}'] path does not exist on disk: ${p}`);
      }
    }
  }

  writeJsonAtomic(ATLAS_JSON, doc);
  fs.mkdirSync(NODES_DIR, { recursive: true });
  console.log(`Wrote atlas.json — ${doc.areas.length} areas${doc.flows ? `, ${doc.flows.length} flows` : ''}.`);
  console.log('Next: write a node per area with `sly-atlas write-node <areaId> --file <node.json>`.');
}

function cmdWriteNode(args) {
  const areaId = args[0] && !args[0].startsWith('--') ? args[0] : null;
  if (!areaId) fail(['usage: sly-atlas write-node <areaId> --file <node.json> [--merge]']);
  const root = readJson(ATLAS_JSON);
  if (!root) fail(['no atlas.json — run propose-areas first']);
  const knownIds = new Set(root.areas.map(a => a.id));
  const merge = args.includes('--merge');
  const payload = loadPayload(args.slice(1));
  if (payload.area && payload.area !== areaId) fail([`payload.area '${payload.area}' does not match argument '${areaId}'`]);

  // --merge: enrich the existing node without dropping anything (the coverage
  // crawl's write mode). Payload entries win on conflict; everything already
  // described is preserved.
  let base = { explanation: undefined, key_files: [], modules: [], symbol_summaries: {} };
  if (merge) {
    const prev = readJson(path.join(NODES_DIR, `${areaId}.json`));
    if (!prev) fail([`--merge: no existing node for '${areaId}' — write it without --merge first`]);
    // Prune base entries whose files were deleted since — but only base ones:
    // payload paths still hard-fail below (the hallucination guard).
    const exists = (p) => fs.existsSync(path.resolve(PROJECT_ROOT, p));
    base = {
      explanation: prev.explanation,
      key_files: (prev.key_files || []).filter(k => exists(k.path)),
      modules: (prev.modules || []).filter(m => exists(m.path)),
      symbol_summaries: Object.fromEntries(Object.entries(prev.symbol_summaries || {}).filter(([f]) => exists(f))),
      collections: prev.collections || [],
      source_hashes: Object.fromEntries(
        Object.entries(prev.source_hashes || {}).filter(([f]) => f.endsWith('/') || exists(f)),
      ),
    };
  }

  const byPath = (list) => new Map((list || []).map(x => [x.path, x]));
  const mergedKeyFiles = merge
    ? [...new Map([...byPath(base.key_files), ...byPath(payload.key_files)]).values()]
    : payload.key_files;
  const mergedModules = merge
    ? [...new Map([...byPath(base.modules), ...byPath(payload.modules)]).values()]
    : payload.modules;
  const byPrefix = (list) => new Map((list || []).map(x => [x.prefix, x]));
  const mergedCollections = merge
    ? [...new Map([...byPrefix(base.collections), ...byPrefix(payload.collections)]).values()]
    : payload.collections;
  let mergedSymbols = payload.symbol_summaries;
  if (merge) {
    mergedSymbols = { ...(base.symbol_summaries || {}) };
    for (const [f, syms] of Object.entries(payload.symbol_summaries || {})) {
      mergedSymbols[f] = { ...(mergedSymbols[f] || {}), ...syms };
    }
    if (Object.keys(mergedSymbols).length === 0) mergedSymbols = undefined;
  }

  const doc = {
    schema_version: ATLAS_SCHEMA_VERSION,
    area: areaId,
    updated_at: new Date().toISOString(),
    explanation: payload.explanation ?? base.explanation,
    key_files: mergedKeyFiles,
    modules: mergedModules && mergedModules.length ? mergedModules : undefined,
    symbol_summaries: mergedSymbols,
    collections: mergedCollections && mergedCollections.length ? mergedCollections : undefined,
  };

  const errs = validateAtlasNode(doc, knownIds);
  if (errs.length) fail(errs);

  // Stamp source hashes for every file the node describes (+ optional extra
  // `sources` list in the payload). Missing files are REJECTED — this is the
  // hallucinated-path guard.
  const sources = new Set();
  for (const k of doc.key_files) sources.add(k.path.replace(/\\/g, '/'));
  for (const m of doc.modules || []) sources.add(m.path.replace(/\\/g, '/'));
  for (const f of Object.keys(doc.symbol_summaries || {})) sources.add(f.replace(/\\/g, '/'));
  if (Array.isArray(payload.sources)) {
    for (const s of payload.sources) {
      if (!isRelPath(s)) fail([`sources: bad path '${s}'`]);
      sources.add(String(s).replace(/\\/g, '/'));
    }
  }
  // Under --merge, carry forward previously-stamped FILE sources too so the
  // staleness contract keeps covering everything the node ever described.
  // (Collection '<prefix>/' entries are restamped fresh below.)
  if (merge) {
    for (const rel of Object.keys(base.source_hashes || {})) {
      if (!rel.endsWith('/')) sources.add(rel);
    }
  }

  const missing = [];
  const hashes = {};
  for (const rel of sources) {
    const abs = containedAbs(rel);
    try {
      hashes[rel] = hashContent(fs.readFileSync(abs));
    } catch {
      missing.push(rel);
    }
  }
  if (missing.length) {
    fail(missing.map(m => `described file does not exist: ${m}`),
      'Every path in key_files/modules/symbol_summaries/sources must exist. Check for typos or stale paths.');
  }
  // Stamp collection member-list hashes ('<prefix>/' convention). An empty
  // collection is rejected — likely a typo'd prefix.
  for (const c of doc.collections || []) {
    const members = collectionMembers(c.prefix);
    if (members.length === 0) fail([`collection prefix has no files: ${c.prefix}`]);
    const key = c.prefix.endsWith('/') ? c.prefix : c.prefix + '/';
    hashes[key] = hashContent(members.join('\n'));
  }

  // ALSO auto-stamp the area's own path prefixes as member-list hashes: any
  // file ADDED or REMOVED anywhere under the area marks it stale, so brand-new
  // files can never sit invisible until the coverage crawl finds them. Same
  // '<prefix>/' convention — readers need no new logic.
  const areaDef = root.areas.find(a => a.id === areaId);
  for (const p of areaDef.paths) {
    const key = p.endsWith('/') ? p : p + '/';
    if (!(key in hashes)) hashes[key] = hashContent(collectionMembers(p).join('\n'));
  }
  doc.source_hashes = hashes;

  writeJsonAtomic(path.join(NODES_DIR, `${areaId}.json`), doc);
  console.log(`${merge ? 'Merged into' : 'Wrote'} nodes/${areaId}.json — ${Object.keys(hashes).length} sources stamped, ${doc.key_files.length} key files${doc.symbol_summaries ? `, ${Object.keys(doc.symbol_summaries).length} files with symbol summaries` : ''}.`);
}

// --- Navigation verbs (Phase 3) ---------------------------------------------

function appendNavEvent(event) {
  const errs = validateNavEvent(event);
  if (errs.length) fail(errs);
  const doc = readJson(NAV_EVENTS_JSON) || { events: [] };
  if (!Array.isArray(doc.events)) doc.events = [];
  doc.events.push(event);
  while (doc.events.length > LIMITS.maxNavEvents) doc.events.shift();
  writeJsonAtomic(NAV_EVENTS_JSON, doc);
}

function parseLocation(spec) {
  // <file>[:line[-endLine]]
  const m = String(spec).match(/^(.+?)(?::(\d+)(?:-(\d+))?)?$/);
  if (!m) return null;
  const out = { file: m[1].replace(/\\/g, '/') };
  if (m[2]) out.line = parseInt(m[2], 10);
  if (m[3]) out.endLine = parseInt(m[3], 10);
  return out;
}

function makeEvent(type, extra) {
  return {
    id: `nav-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    ts: new Date().toISOString(),
    type,
    ...extra,
  };
}

function cmdNavigate(args) {
  const loc = args[0] && !args[0].startsWith('--') ? parseLocation(args[0]) : null;
  if (!loc) fail(['usage: sly-atlas navigate <file[:line[-endLine]]> [--note "..."]']);
  const note = getFlag(args, '--note');
  appendNavEvent(makeEvent('navigate', { ...loc, note }));
  console.log(`Navigation sent: ${loc.file}${loc.line ? ':' + loc.line : ''} — the Code Mode view will jump there.`);
}

function cmdHighlight(args) {
  const loc = args[0] && !args[0].startsWith('--') ? parseLocation(args[0]) : null;
  const note = getFlag(args, '--note');
  if (!loc || !loc.line) fail(['usage: sly-atlas highlight <file:line[-endLine]> --note "..."']);
  if (!note) fail(['highlight requires --note "explanation shown with the highlight"']);
  appendNavEvent(makeEvent('highlight', { ...loc, note }));
  console.log(`Highlight sent: ${loc.file}:${loc.line}${loc.endLine ? '-' + loc.endLine : ''}`);
}

function cmdDeck(args) {
  const payload = loadPayload(args);
  const deck = { title: payload.title, items: payload.items };
  appendNavEvent(makeEvent('deck', { deck, note: payload.note }));
  console.log(`Deck sent: "${deck.title}" — ${deck.items.length} locations. The user can click through them.`);
}

// ---------------------------------------------------------------------------
// Entry
// ---------------------------------------------------------------------------

const HELP = `sly-atlas — Codebase Atlas CLI

Artifact writes (validated — invalid payloads are rejected, atlas untouched):
  sly-atlas init                                 Create documentation/atlas/ scaffolding
  sly-atlas status [--json]                      Per-area staleness + file coverage report (what to re-analyze, what to enrich)
  sly-atlas propose-areas --file <json>          Write the atlas root: {project_overview?, areas:[{id,name,paths,summary?}], flows?}
                                                 Pinned areas survive with their user-set names. Colors are assigned by the CLI.
  sly-atlas write-node <areaId> --file <json> [--merge]
                                                 Write one area node: {explanation, key_files:[{path,role}], modules?, symbol_summaries?, sources?}
                                                 --merge enriches the existing node (union; payload wins on conflict; nothing dropped).
                                                 Source hashes are stamped at write time; described files must exist.

Navigation verbs (one-shot directives rendered by the Code Mode UI):
  sly-atlas navigate <file[:line[-end]]> [--note "..."]
  sly-atlas highlight <file:line[-end]> --note "..."
  sly-atlas deck --file <json>                   {title, items:[{file, line?, note?}]}

All commands run relative to the enclosing SlyCode project (found via documentation/kanban.json).
See the atlas skill (.claude/skills/atlas/SKILL.md) for the full workflow.`;

if (require.main === module) {
  const [cmd, ...rest] = process.argv.slice(2);
  switch (cmd) {
    case 'init': cmdInit(); break;
    case 'status': cmdStatus(rest); break;
    case 'propose-areas': cmdProposeAreas(rest); break;
    case 'write-node': cmdWriteNode(rest); break;
    case 'navigate': cmdNavigate(rest); break;
    case 'highlight': cmdHighlight(rest); break;
    case 'deck': cmdDeck(rest); break;
    case 'help': case '--help': case undefined: console.log(HELP); break;
    default:
      console.error(`Unknown command: ${cmd}\n`);
      console.log(HELP);
      process.exit(1);
  }
}

// Exported for the web↔CLI lockstep parity test (schema.test.ts).
module.exports = { validateAtlasRoot, validateAtlasNode, validateNavEvent, LIMITS, AREA_PALETTE };
