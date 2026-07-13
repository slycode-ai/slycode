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
const DIGEST_JSON = path.join(ATLAS_DIR, 'digest.json');
const VIEW_STATE_JSON = path.join(ATLAS_DIR, 'view-state.json');
const TOURS_DIR = path.join(ATLAS_DIR, 'tours');
const DB_JSON = path.join(ATLAS_DIR, 'db.json');

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
  // Stretch artifacts (feature 079)
  maxHeadlineLen: 300, maxDigestAreas: 16, maxDigestSummaryLen: 600,
  maxNotable: 12, maxNotableNoteLen: 200,
  maxTourTitleLen: 80, maxTourPromptLen: 300, maxTourDescLen: 500, maxTourSteps: 30, minTourSteps: 2,
  maxStepTitleLen: 80, maxStepBodyLen: 1500,
  maxDbSummaryLen: 2000, maxDbTables: 120, maxDbTableSummaryLen: 300,
  maxDbColumnNoteLen: 160, maxDbColumnsPerTable: 80, maxDbRelations: 60,
  maxDbRelationLabelLen: 60,
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

// --- Stretch validators (feature 079) — LOCKSTEP MIRROR of schema.ts --------

function validateDigest(d, knownAreaIds) {
  const errs = [];
  if (!d || typeof d !== 'object') return ['digest: not an object'];
  if (d.schema_version !== ATLAS_SCHEMA_VERSION) errs.push(`digest: schema_version must be ${ATLAS_SCHEMA_VERSION}`);
  if (typeof d.headline !== 'string' || !d.headline.trim() || d.headline.length > LIMITS.maxHeadlineLen) {
    errs.push(`digest: headline required (≤ ${LIMITS.maxHeadlineLen} chars)`);
  }
  if (!Array.isArray(d.areas) || d.areas.length === 0 || d.areas.length > LIMITS.maxDigestAreas) {
    errs.push(`digest: areas must be 1-${LIMITS.maxDigestAreas} entries`);
  } else {
    d.areas.forEach((a, i) => {
      const where = `digest.areas[${i}]`;
      if (!a || typeof a !== 'object') { errs.push(`${where}: not an object`); return; }
      if (typeof a.area !== 'string' || !SLUG_RE.test(a.area)) errs.push(`${where}: area must be a slug`);
      else if (knownAreaIds && !knownAreaIds.has(a.area)) errs.push(`${where}: unknown area '${a.area}' — not in atlas.json`);
      if (typeof a.summary !== 'string' || !a.summary.trim() || a.summary.length > LIMITS.maxDigestSummaryLen) {
        errs.push(`${where}: summary required (≤ ${LIMITS.maxDigestSummaryLen} chars)`);
      }
      if (a.commits !== undefined && (!Number.isInteger(a.commits) || a.commits < 0)) errs.push(`${where}: commits must be a non-negative integer`);
      if (a.files_changed !== undefined && (!Number.isInteger(a.files_changed) || a.files_changed < 0)) errs.push(`${where}: files_changed must be a non-negative integer`);
    });
  }
  if (d.notable !== undefined) {
    if (!Array.isArray(d.notable) || d.notable.length > LIMITS.maxNotable) {
      errs.push(`digest: notable must be an array ≤ ${LIMITS.maxNotable}`);
    } else {
      d.notable.forEach((n, i) => {
        if (!n || !isRelPath(n.file) ||
            (n.line !== undefined && (!Number.isInteger(n.line) || n.line < 1)) ||
            typeof n.note !== 'string' || !n.note.trim() || n.note.length > LIMITS.maxNotableNoteLen) {
          errs.push(`digest.notable[${i}]: needs repo-relative file (+ optional line ≥1) + note ≤ ${LIMITS.maxNotableNoteLen} chars`);
        }
      });
    }
  }
  if (d.generated_at !== undefined && (typeof d.generated_at !== 'string' || isNaN(Date.parse(d.generated_at)))) errs.push('digest: generated_at must be ISO date');
  if (d.since_commit !== undefined && (typeof d.since_commit !== 'string' || !/^[0-9a-f]{4,40}$/.test(d.since_commit))) errs.push('digest: since_commit must be a hex ref');
  if (d.head_commit !== undefined && (typeof d.head_commit !== 'string' || !/^[0-9a-f]{4,40}$/.test(d.head_commit))) errs.push('digest: head_commit must be a hex ref');
  return errs;
}

function validateTour(d, knownAreaIds) {
  const errs = [];
  if (!d || typeof d !== 'object') return ['tour: not an object'];
  if (d.schema_version !== ATLAS_SCHEMA_VERSION) errs.push(`tour: schema_version must be ${ATLAS_SCHEMA_VERSION}`);
  if (typeof d.id !== 'string' || !SLUG_RE.test(d.id)) errs.push('tour: id must be a slug');
  if (typeof d.title !== 'string' || !d.title.trim() || d.title.length > LIMITS.maxTourTitleLen) {
    errs.push(`tour: title required (≤ ${LIMITS.maxTourTitleLen} chars)`);
  }
  if (d.prompt !== undefined && (typeof d.prompt !== 'string' || !d.prompt.trim() || d.prompt.length > LIMITS.maxTourPromptLen)) {
    errs.push(`tour: prompt must be a non-empty string ≤ ${LIMITS.maxTourPromptLen} chars`);
  }
  if (d.description !== undefined && (typeof d.description !== 'string' || d.description.length > LIMITS.maxTourDescLen)) {
    errs.push(`tour: description must be ≤ ${LIMITS.maxTourDescLen} chars`);
  }
  if (d.area !== undefined) {
    if (typeof d.area !== 'string' || !SLUG_RE.test(d.area)) errs.push('tour: area must be a slug');
    else if (knownAreaIds && !knownAreaIds.has(d.area)) errs.push(`tour: unknown area '${d.area}' — not in atlas.json`);
  }
  if (!Array.isArray(d.steps) || d.steps.length < LIMITS.minTourSteps || d.steps.length > LIMITS.maxTourSteps) {
    errs.push(`tour: steps must be ${LIMITS.minTourSteps}-${LIMITS.maxTourSteps} entries`);
  } else {
    d.steps.forEach((s, i) => {
      const where = `tour.steps[${i}]`;
      if (!s || typeof s !== 'object') { errs.push(`${where}: not an object`); return; }
      if (!isRelPath(s.file)) errs.push(`${where}: file must be repo-relative`);
      if (s.line !== undefined && (!Number.isInteger(s.line) || s.line < 1)) errs.push(`${where}: line must be a positive integer`);
      if (s.endLine !== undefined && (!Number.isInteger(s.endLine) || s.endLine < (s.line ?? 1))) errs.push(`${where}: endLine must be ≥ line`);
      if (typeof s.title !== 'string' || !s.title.trim() || s.title.length > LIMITS.maxStepTitleLen) errs.push(`${where}: title required (≤ ${LIMITS.maxStepTitleLen} chars)`);
      if (typeof s.body !== 'string' || !s.body.trim() || s.body.length > LIMITS.maxStepBodyLen) errs.push(`${where}: body required (≤ ${LIMITS.maxStepBodyLen} chars)`);
    });
  }
  if (d.updated_at !== undefined && (typeof d.updated_at !== 'string' || isNaN(Date.parse(d.updated_at)))) errs.push('tour: updated_at must be ISO date');
  return errs;
}

const DB_NAME_RE = /^[A-Za-z_][A-Za-z0-9_$-]{0,63}$/;

function validateDbAnnotations(d) {
  const errs = [];
  if (!d || typeof d !== 'object') return ['db: not an object'];
  if (d.schema_version !== ATLAS_SCHEMA_VERSION) errs.push(`db: schema_version must be ${ATLAS_SCHEMA_VERSION}`);
  if (d.summary !== undefined && (typeof d.summary !== 'string' || d.summary.length > LIMITS.maxDbSummaryLen)) {
    errs.push(`db: summary must be ≤ ${LIMITS.maxDbSummaryLen} chars`);
  }
  if (d.tables !== undefined) {
    if (!d.tables || typeof d.tables !== 'object' || Array.isArray(d.tables)) {
      errs.push('db: tables must be an object');
    } else {
      const names = Object.keys(d.tables);
      if (names.length > LIMITS.maxDbTables) errs.push(`db: too many tables (max ${LIMITS.maxDbTables})`);
      for (const t of names) {
        if (!DB_NAME_RE.test(t)) { errs.push(`db.tables: bad table name '${t}'`); continue; }
        const ann = d.tables[t];
        if (!ann || typeof ann !== 'object' || Array.isArray(ann)) { errs.push(`db.tables[${t}]: must be an object`); continue; }
        if (ann.summary !== undefined && (typeof ann.summary !== 'string' || ann.summary.length > LIMITS.maxDbTableSummaryLen)) {
          errs.push(`db.tables[${t}]: summary must be ≤ ${LIMITS.maxDbTableSummaryLen} chars`);
        }
        if (ann.columns !== undefined) {
          if (!ann.columns || typeof ann.columns !== 'object' || Array.isArray(ann.columns)) { errs.push(`db.tables[${t}].columns: must be an object`); continue; }
          const cols = Object.keys(ann.columns);
          if (cols.length > LIMITS.maxDbColumnsPerTable) errs.push(`db.tables[${t}]: too many columns (max ${LIMITS.maxDbColumnsPerTable})`);
          for (const c of cols) {
            if (!DB_NAME_RE.test(c)) errs.push(`db.tables[${t}].columns: bad column name '${c}'`);
            else if (typeof ann.columns[c] !== 'string' || ann.columns[c].length > LIMITS.maxDbColumnNoteLen) {
              errs.push(`db.tables[${t}].columns.${c}: note must be ≤ ${LIMITS.maxDbColumnNoteLen} chars`);
            }
          }
        }
      }
    }
  }
  if (d.relations !== undefined) {
    if (!Array.isArray(d.relations) || d.relations.length > LIMITS.maxDbRelations) {
      errs.push(`db: relations must be an array ≤ ${LIMITS.maxDbRelations}`);
    } else {
      d.relations.forEach((r, i) => {
        if (!r || typeof r !== 'object' ||
            typeof r.from !== 'string' || !DB_NAME_RE.test(r.from) ||
            typeof r.to !== 'string' || !DB_NAME_RE.test(r.to) ||
            (r.label !== undefined && (typeof r.label !== 'string' || r.label.length > LIMITS.maxDbRelationLabelLen))) {
          errs.push(`db.relations[${i}]: needs from/to table names (+ label ≤ ${LIMITS.maxDbRelationLabelLen} chars)`);
        }
      });
    }
  }
  if (d.updated_at !== undefined && (typeof d.updated_at !== 'string' || isNaN(Date.parse(d.updated_at)))) errs.push('db: updated_at must be ISO date');
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
  fs.mkdirSync(TOURS_DIR, { recursive: true });
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
  // Stretch info (feature 079): digest anchor, tours, db sources.
  const anchor = digestAnchor();
  const digestDoc = readJson(DIGEST_JSON);
  const headNow = gitOut(['rev-parse', 'HEAD']);
  const digest = {
    anchorCommit: anchor,
    anchorDate: null,
    commitsSince: null,
    perArea: {},
    generatedAt: digestDoc ? digestDoc.generated_at : null,
    // current = the existing digest already covers anchor..HEAD — regenerating
    // would produce the same thing; the nightly run should skip.
    current: Boolean(digestDoc && anchor && digestDoc.since_commit === anchor && headNow && digestDoc.head_commit === headNow),
  };
  if (anchor) {
    const anchorDate = gitOut(['show', '-s', '--format=%cI', anchor]);
    const countStr = gitOut(['rev-list', '--count', `${anchor}..HEAD`]);
    digest.anchorDate = anchorDate;
    digest.commitsSince = countStr === null ? null : parseInt(countStr, 10);
    if (digest.commitsSince) {
      // Per-area commit counts: one git log pass, commits separated by @@.
      const log = gitOut(['log', '--name-only', '--pretty=format:@@', `${anchor}..HEAD`]);
      if (log) {
        for (const commitBlock of log.split('@@')) {
          const files = commitBlock.split('\n').map(s => s.trim()).filter(Boolean);
          if (!files.length) continue;
          const hit = new Set();
          for (const area of root.areas) {
            if (files.some(f => underPaths(f, area.paths))) hit.add(area.id);
          }
          for (const id of hit) digest.perArea[id] = (digest.perArea[id] || 0) + 1;
        }
      }
    }
  }
  const tours = readTours();
  let dbSources = [];
  try {
    const { discoverSources } = require(path.join(__dirname, 'db-introspect.js'));
    dbSources = discoverSources(PROJECT_ROOT, projectFiles());
  } catch { /* introspection module unavailable — report none */ }

  if (asJson) {
    console.log(JSON.stringify({
      exists: true,
      areas: report,
      digest,
      tours,
      db: { sources: dbSources, annotated: fs.existsSync(DB_JSON) },
    }, null, 2));
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
    if (anchor) {
      console.log(digest.current
        ? `DIGEST: current (already covers ${anchor.slice(0, 8)}..HEAD) — skip.`
        : digest.commitsSince
          ? `DIGEST: ${digest.commitsSince} commits since anchor ${anchor.slice(0, 8)} — write-digest is due (areas: ${Object.entries(digest.perArea).map(([k, v]) => `${k}:${v}`).join(', ') || 'none mapped'}).`
          : `DIGEST: no commits since anchor ${anchor.slice(0, 8)} — skip.`);
    } else {
      console.log('DIGEST: no anchor yet (Code Mode never opened) — skip.');
    }
    const staleTours = tours.filter(t => t.stale);
    if (tours.length) console.log(`TOURS: ${tours.length} (${staleTours.length ? `${staleTours.length} STALE: ${staleTours.map(t => t.id).join(', ')}` : 'all fresh'}).`);
    if (dbSources.length) console.log(`DB: ${dbSources.length} source(s) detected${fs.existsSync(DB_JSON) ? ', annotated' : ' — write-db annotations missing'} (see \`sly-atlas db\`).`);
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

// --- Stretch commands (feature 079) ------------------------------------------

function gitOut(args) {
  try {
    const { execFileSync } = require('child_process');
    return execFileSync('git', args, {
      cwd: PROJECT_ROOT, encoding: 'utf-8', windowsHide: true, timeout: 15000, maxBuffer: 32 * 1024 * 1024,
    }).trim();
  } catch {
    return null;
  }
}

/** The digest anchor: the commit the user last acknowledged (view-state),
 *  falling back to the current digest's own anchor. Null = no anchor yet
 *  (user has never entered Code Mode) → no digest should be generated. */
function digestAnchor() {
  const viewState = readJson(VIEW_STATE_JSON);
  if (viewState && typeof viewState.anchor_commit === 'string' && /^[0-9a-f]{4,40}$/.test(viewState.anchor_commit)) {
    return viewState.anchor_commit;
  }
  const digest = readJson(DIGEST_JSON);
  if (digest && typeof digest.since_commit === 'string') return digest.since_commit;
  return null;
}

function cmdWriteDigest(args) {
  const root = readJson(ATLAS_JSON);
  if (!root) fail(['no atlas.json — run the first scan before writing a digest']);
  const knownIds = new Set(root.areas.map(a => a.id));
  const payload = loadPayload(args);

  const anchor = digestAnchor() || (typeof payload.since_commit === 'string' ? payload.since_commit : null);
  if (!anchor) {
    fail(['no digest anchor: view-state has no anchor_commit and no prior digest exists',
      'The digest anchors to the user\'s last acknowledged visit. Until Code Mode has been opened once, skip the digest.']);
  }

  const doc = {
    schema_version: ATLAS_SCHEMA_VERSION,
    headline: payload.headline,
    areas: payload.areas,
    notable: payload.notable,
  };
  const errs = validateDigest(doc, knownIds);
  if (errs.length) fail(errs);

  // Hallucination guard: every notable file must exist.
  const missing = (doc.notable || []).map(n => n.file).filter(f => !fs.existsSync(containedAbs(f)));
  if (missing.length) fail(missing.map(f => `notable file does not exist: ${f}`));

  const head = gitOut(['rev-parse', 'HEAD']);
  if (!head) fail(['cannot resolve git HEAD — digest needs a git repository']);
  doc.generated_at = new Date().toISOString();
  doc.since_commit = anchor;
  const sinceDate = gitOut(['show', '-s', '--format=%cI', anchor]);
  if (sinceDate) doc.since_date = sinceDate;
  doc.head_commit = head;

  const finalErrs = validateDigest(doc, knownIds);
  if (finalErrs.length) fail(finalErrs);
  writeJsonAtomic(DIGEST_JSON, doc);
  console.log(`Wrote digest.json — "${doc.headline.slice(0, 60)}${doc.headline.length > 60 ? '…' : ''}" covering ${anchor.slice(0, 8)}..${head.slice(0, 8)} (${doc.areas.length} areas${doc.notable ? `, ${doc.notable.length} notable` : ''}).`);
}

function cmdWriteTour(args) {
  const root = readJson(ATLAS_JSON);
  const knownIds = root ? new Set(root.areas.map(a => a.id)) : undefined;
  const payload = loadPayload(args);

  const doc = {
    schema_version: ATLAS_SCHEMA_VERSION,
    id: payload.id,
    title: payload.title,
    prompt: payload.prompt,
    description: payload.description,
    area: payload.area,
    updated_at: new Date().toISOString(),
    steps: payload.steps,
  };
  const errs = validateTour(doc, knownIds);
  if (errs.length) fail(errs);

  // Hallucination guard + staleness stamp over every step file.
  const hashes = {};
  const missing = [];
  for (const s of doc.steps) {
    const rel = s.file.replace(/\\/g, '/');
    if (rel in hashes) continue;
    try {
      hashes[rel] = hashContent(fs.readFileSync(containedAbs(rel)));
    } catch {
      missing.push(rel);
    }
  }
  if (missing.length) {
    fail(missing.map(f => `step file does not exist: ${f}`),
      'Every tour step must anchor to a real file. Check for typos or stale paths.');
  }
  doc.source_hashes = hashes;

  fs.mkdirSync(TOURS_DIR, { recursive: true });
  writeJsonAtomic(path.join(TOURS_DIR, `${doc.id}.json`), doc);
  console.log(`Wrote tours/${doc.id}.json — "${doc.title}", ${doc.steps.length} steps over ${Object.keys(hashes).length} files.`);
}

function cmdDeleteTour(args) {
  const id = args[0] && !args[0].startsWith('--') ? args[0] : null;
  if (!id || !SLUG_RE.test(id)) fail(['usage: sly-atlas delete-tour <tour-id>']);
  const file = path.join(TOURS_DIR, `${id}.json`);
  if (!fs.existsSync(file)) fail([`no such tour: ${id}`]);
  fs.unlinkSync(file);
  console.log(`Deleted tours/${id}.json`);
}

function readTours() {
  let entries = [];
  try { entries = fs.readdirSync(TOURS_DIR).filter(f => f.endsWith('.json')); } catch { return []; }
  const tours = [];
  for (const f of entries.sort()) {
    const doc = readJson(path.join(TOURS_DIR, f));
    if (!doc || validateTour(doc).length) continue; // skip corrupt/invalid quietly
    const changed = [];
    for (const [rel, expected] of Object.entries(doc.source_hashes || {})) {
      let actual = null;
      try { actual = hashContent(fs.readFileSync(path.resolve(PROJECT_ROOT, rel))); } catch { /* deleted */ }
      if (actual !== expected) changed.push(rel);
    }
    tours.push({ id: doc.id, title: doc.title, area: doc.area, steps: doc.steps.length, stale: changed.length > 0, changed });
  }
  return tours;
}

function cmdWriteDb(args) {
  const payload = loadPayload(args);
  const doc = {
    schema_version: ATLAS_SCHEMA_VERSION,
    updated_at: new Date().toISOString(),
    summary: payload.summary,
    tables: payload.tables,
    relations: payload.relations,
  };
  const errs = validateDbAnnotations(doc);
  if (errs.length) fail(errs);
  writeJsonAtomic(DB_JSON, doc);
  const tableCount = Object.keys(doc.tables || {}).length;
  console.log(`Wrote db.json — ${tableCount} annotated tables${doc.relations ? `, ${doc.relations.length} relations` : ''}.`);
}

function cmdDb(args) {
  const { introspect } = require(path.join(__dirname, 'db-introspect.js'));
  const result = introspect(PROJECT_ROOT, projectFiles());
  if (args.includes('--json')) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  if (result.sources.length === 0) {
    console.log('No database sources detected (SQLite files, schema.prisma, or CREATE TABLE .sql files).');
    return;
  }
  for (const src of result.sources) {
    console.log(`${src.kind.toUpperCase().padEnd(7)} ${src.path}${src.error ? ` — ERROR: ${src.error}` : ''}`);
    for (const t of src.tables) {
      const pk = t.columns.filter(c => c.pk).map(c => c.name).join(',');
      console.log(`  ${t.name} (${t.columns.length} cols${pk ? `, pk: ${pk}` : ''}${t.fks.length ? `, ${t.fks.length} fks` : ''})`);
    }
  }
  console.log('\nAnnotate with `sly-atlas write-db --file <db.json>` — see the atlas skill.');
}

// --- context: the atlas as machine context for agents ------------------------

function firstParagraph(text) {
  return String(text || '').split(/\n\s*\n/)[0].trim();
}

function buildContext(opts) {
  const root = readJson(ATLAS_JSON);
  if (!root || validateAtlasRoot(root).length) return { error: 'No valid atlas — run the first scan (see the atlas skill).' };
  const nodes = {};
  for (const a of root.areas) {
    const n = readJson(path.join(NODES_DIR, `${a.id}.json`));
    if (n && !validateAtlasNode(n).length) nodes[a.id] = n;
  }

  if (opts.area) {
    const area = root.areas.find(a => a.id === opts.area);
    if (!area) return { error: `Unknown area '${opts.area}'. Known: ${root.areas.map(a => a.id).join(', ')}` };
    const node = nodes[area.id];
    return {
      kind: 'area',
      area: { id: area.id, name: area.name, paths: area.paths, summary: area.summary },
      explanation: node ? node.explanation : undefined,
      key_files: node ? node.key_files : [],
      modules: node ? node.modules || [] : [],
      symbol_summaries: node ? node.symbol_summaries || {} : {},
      analyzed_at: node ? node.updated_at : undefined,
    };
  }

  if (opts.files && opts.files.length) {
    const under = (file, prefixes) => prefixes.some(p => file === p || file.startsWith(p.endsWith('/') ? p : p + '/'));
    const out = { kind: 'files', files: [] };
    for (const f of opts.files) {
      const rel = String(f).replace(/\\/g, '/');
      const area = root.areas.find(a => under(rel, a.paths));
      const node = area ? nodes[area.id] : undefined;
      out.files.push({
        path: rel,
        area: area ? { id: area.id, name: area.name } : undefined,
        area_gist: node ? firstParagraph(node.explanation) : undefined,
        role: node ? (node.key_files || []).find(k => k.path === rel)?.role : undefined,
        module_summary: node ? (node.modules || []).find(m => m.path === rel)?.summary : undefined,
        symbols: node ? (node.symbol_summaries || {})[rel] : undefined,
      });
    }
    return out;
  }

  // Project brief
  return {
    kind: 'project',
    overview: root.project_overview,
    updated_at: root.updated_at,
    areas: root.areas.map(a => ({
      id: a.id, name: a.name, paths: a.paths, summary: a.summary,
      gist: nodes[a.id] ? firstParagraph(nodes[a.id].explanation) : undefined,
      key_files: nodes[a.id] ? (nodes[a.id].key_files || []).slice(0, 6) : [],
    })),
    flows: root.flows || [],
  };
}

function contextMarkdown(ctx, budget) {
  const sections = [];
  if (ctx.kind === 'project') {
    sections.push(`# Codebase Atlas brief\n\n${ctx.overview || '(no overview)'}\n`);
    sections.push('## Areas\n\n' + ctx.areas.map(a =>
      `- **${a.name}** (\`${a.id}\`) — ${a.summary || ''}\n  paths: ${a.paths.join(', ')}${a.gist ? `\n  ${a.gist}` : ''}`,
    ).join('\n'));
    if (ctx.flows.length) sections.push('## Flows\n\n' + ctx.flows.map(f => `- ${f.from} → ${f.to}: ${f.label}`).join('\n'));
    for (const a of ctx.areas) {
      if (!a.key_files.length) continue;
      sections.push(`## Key files — ${a.name}\n\n` + a.key_files.map(k => `- \`${k.path}\` — ${k.role}`).join('\n'));
    }
  } else if (ctx.kind === 'area') {
    sections.push(`# Area brief: ${ctx.area.name} (\`${ctx.area.id}\`)\n\npaths: ${ctx.area.paths.join(', ')}${ctx.analyzed_at ? `\nanalyzed: ${ctx.analyzed_at}` : ''}\n`);
    if (ctx.explanation) sections.push(ctx.explanation);
    if (ctx.key_files.length) sections.push('## Key files\n\n' + ctx.key_files.map(k => `- \`${k.path}\` — ${k.role}`).join('\n'));
    if (ctx.modules.length) sections.push('## Modules\n\n' + ctx.modules.map(m => `- **${m.name}** (\`${m.path}\`) — ${m.summary}`).join('\n'));
    const symFiles = Object.entries(ctx.symbol_summaries);
    for (const [file, syms] of symFiles) {
      sections.push(`## Symbols — \`${file}\`\n\n` + Object.entries(syms).map(([n, s]) => `- \`${n}\` — ${s}`).join('\n'));
    }
  } else if (ctx.kind === 'files') {
    sections.push('# File context brief\n');
    for (const f of ctx.files) {
      const lines = [`## \`${f.path}\``];
      if (f.area) lines.push(`Area: **${f.area.name}** (\`${f.area.id}\`)`);
      if (f.role) lines.push(`Role: ${f.role}`);
      if (f.module_summary) lines.push(f.module_summary);
      if (f.area_gist) lines.push(`\n${f.area_gist}`);
      if (f.symbols) lines.push('\nSymbols:\n' + Object.entries(f.symbols).map(([n, s]) => `- \`${n}\` — ${s}`).join('\n'));
      if (!f.area && !f.role && !f.module_summary) lines.push('(not described in the atlas)');
      sections.push(lines.join('\n'));
    }
  }
  // Budget: keep whole sections front-to-back; the tail sections (per-area key
  // files / per-file symbols) are the lowest-value, so dropping from the end
  // degrades gracefully. The output NEVER exceeds the budget — the trim note
  // is only appended when it fits.
  let out = '';
  let trimmedFrom = -1;
  for (let i = 0; i < sections.length; i++) {
    const candidate = out ? out + '\n\n' + sections[i] : sections[i];
    if (candidate.length > budget) { trimmedFrom = i; break; }
    out = candidate;
  }
  if (!out) return sections.length ? sections[0].slice(0, Math.max(0, budget - 2)) + ' …' : '';
  if (trimmedFrom >= 0) {
    const note = `\n\n…(${sections.length - trimmedFrom} sections trimmed to fit budget)`;
    if (out.length + note.length <= budget) out += note;
  }
  return out;
}

function cmdContext(args) {
  const area = getFlag(args, '--area');
  const filesArg = getFlag(args, '--files');
  const budgetArg = getFlag(args, '--budget');
  const budget = Math.max(500, Math.min(100000, parseInt(budgetArg || '6000', 10) || 6000));
  const ctx = buildContext({ area, files: filesArg ? filesArg.split(',').map(s => s.trim()).filter(Boolean) : undefined });
  if (ctx.error) fail([ctx.error]);
  if (args.includes('--json')) {
    console.log(JSON.stringify(ctx, null, 2));
    return;
  }
  console.log(contextMarkdown(ctx, budget));
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

Stretch artifacts (feature 079):
  sly-atlas write-digest --file <json>           Catch-up digest: {headline, areas:[{area,summary,commits?,files_changed?}], notable?}
                                                 Anchored to the user's last acknowledged visit (view-state); CLI stamps commits/dates.
  sly-atlas write-tour --file <json>             Guided tour: {id, title, description?, area?, steps:[{file,line?,endLine?,title,body}]}
                                                 Step files must exist; source hashes stamped (tours go stale like nodes).
  sly-atlas delete-tour <id>                     Remove a tour artifact
  sly-atlas db [--json]                          Deterministic DB introspection (SQLite/prisma/SQL DDL sources)
  sly-atlas write-db --file <json>               DB annotations: {summary?, tables?:{name:{summary?,columns?}}, relations?}
  sly-atlas context [--area <id>] [--files a,b] [--json] [--budget <chars>]
                                                 Deterministic agent-context brief assembled from atlas artifacts

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
    case 'write-digest': cmdWriteDigest(rest); break;
    case 'write-tour': cmdWriteTour(rest); break;
    case 'delete-tour': cmdDeleteTour(rest); break;
    case 'write-db': cmdWriteDb(rest); break;
    case 'db': cmdDb(rest); break;
    case 'context': cmdContext(rest); break;
    case 'help': case '--help': case undefined: console.log(HELP); break;
    default:
      console.error(`Unknown command: ${cmd}\n`);
      console.log(HELP);
      process.exit(1);
  }
}

// Exported for the web↔CLI lockstep parity test (schema.test.ts) and the
// context-builder unit tests (contextMarkdown is pure).
module.exports = {
  validateAtlasRoot, validateAtlasNode, validateNavEvent,
  validateDigest, validateTour, validateDbAnnotations,
  contextMarkdown,
  LIMITS, AREA_PALETTE,
};
