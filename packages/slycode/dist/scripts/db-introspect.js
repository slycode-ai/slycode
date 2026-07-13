/**
 * db-introspect — deterministic database schema introspection (feature 079).
 *
 * SINGLE implementation shared by the sly-atlas CLI (direct require) and the
 * web app (runtime createRequire via lib/atlas/db-schema.ts). Plain CJS, no
 * side effects, no dependencies beyond the optional node:sqlite built-in.
 *
 * Sources it understands:
 *   - SQLite database files  (header-verified, read-only, via node:sqlite)
 *   - Prisma schemas         (schema.prisma model blocks)
 *   - SQL DDL files          (CREATE TABLE statements)
 *
 * Output shape (all sources):
 *   { sources: [{ kind, path, tables: [{ name, columns: [{ name, type, pk,
 *     nullable }], fks: [{ column, refTable, refColumn }] }], error? }] }
 */

'use strict';

const fs = require('fs');
const path = require('path');

const SQLITE_MAX_BYTES = 64 * 1024 * 1024;
const SQL_MAX_BYTES = 1024 * 1024;
const MAX_SQL_FILES = 40;
const MAX_SQLITE_FILES = 10;
const SQLITE_HEADER = Buffer.from('SQLite format 3\0', 'latin1');

// ---------------------------------------------------------------------------
// Discovery — pick candidate sources out of a repo-relative file list
// ---------------------------------------------------------------------------

/** @param {string[]} files repo-relative paths (git ls-files style) */
function discoverSources(projectRoot, files) {
  const sqlite = [];
  const prisma = [];
  const sql = [];
  for (const f of files) {
    const lower = f.toLowerCase();
    if (/\.(db|sqlite|sqlite3)$/.test(lower)) sqlite.push(f);
    else if (lower.endsWith('schema.prisma') || lower.endsWith('.prisma')) prisma.push(f);
    else if (lower.endsWith('.sql')) sql.push(f);
  }
  const out = [];
  for (const f of sqlite.slice(0, MAX_SQLITE_FILES)) {
    const abs = path.resolve(projectRoot, f);
    try {
      const st = fs.statSync(abs);
      if (!st.isFile() || st.size > SQLITE_MAX_BYTES || st.size < 100) continue;
      const fd = fs.openSync(abs, 'r');
      const head = Buffer.alloc(16);
      fs.readSync(fd, head, 0, 16, 0);
      fs.closeSync(fd);
      if (head.equals(SQLITE_HEADER)) out.push({ kind: 'sqlite', path: f });
    } catch { /* unreadable — skip */ }
  }
  for (const f of prisma) out.push({ kind: 'prisma', path: f });
  let sqlCount = 0;
  for (const f of sql) {
    if (sqlCount >= MAX_SQL_FILES) break;
    const abs = path.resolve(projectRoot, f);
    try {
      const st = fs.statSync(abs);
      if (!st.isFile() || st.size > SQL_MAX_BYTES) continue;
      const text = fs.readFileSync(abs, 'utf-8');
      if (/create\s+table/i.test(text)) { out.push({ kind: 'sql', path: f }); sqlCount++; }
    } catch { /* skip */ }
  }
  return out;
}

// ---------------------------------------------------------------------------
// SQLite (node:sqlite — guarded; absent → source reports an error, not a crash)
// ---------------------------------------------------------------------------

function quoteIdent(name) {
  return '"' + String(name).replace(/"/g, '""') + '"';
}

function introspectSqlite(absPath) {
  let DatabaseSync;
  try {
    ({ DatabaseSync } = require('node:sqlite'));
  } catch {
    return { tables: [], error: 'node:sqlite unavailable on this runtime' };
  }
  let db;
  try {
    db = new DatabaseSync(absPath, { readOnly: true });
  } catch (e) {
    return { tables: [], error: `cannot open: ${e.message}` };
  }
  try {
    const rows = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
      .all();
    const tables = [];
    for (const row of rows) {
      const name = String(row.name);
      const cols = db.prepare(`PRAGMA table_info(${quoteIdent(name)})`).all();
      const fkRows = db.prepare(`PRAGMA foreign_key_list(${quoteIdent(name)})`).all();
      tables.push({
        name,
        columns: cols.map(c => ({
          name: String(c.name),
          type: String(c.type || ''),
          pk: Number(c.pk) > 0,
          nullable: Number(c.notnull) === 0 && Number(c.pk) === 0,
        })),
        fks: fkRows.map(fk => ({
          column: String(fk.from),
          refTable: String(fk.table),
          refColumn: fk.to == null ? undefined : String(fk.to),
        })),
      });
    }
    return { tables };
  } catch (e) {
    return { tables: [], error: `introspection failed: ${e.message}` };
  } finally {
    try { db.close(); } catch { /* ignore */ }
  }
}

// ---------------------------------------------------------------------------
// Prisma schema parsing
// ---------------------------------------------------------------------------

function parsePrisma(text) {
  const tables = [];
  const modelNames = new Set();
  const modelRe = /model\s+([A-Za-z_][A-Za-z0-9_]*)\s*\{([^}]*)\}/g;
  let m;
  const bodies = [];
  while ((m = modelRe.exec(text)) !== null) {
    modelNames.add(m[1]);
    bodies.push([m[1], m[2]]);
  }
  for (const [name, body] of bodies) {
    const columns = [];
    const fks = [];
    for (const rawLine of body.split('\n')) {
      const line = rawLine.replace(/\/\/.*$/, '').trim();
      if (!line || line.startsWith('@@')) continue;
      const fm = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s+([A-Za-z_][A-Za-z0-9_]*)(\[\])?(\?)?\s*(.*)$/);
      if (!fm) continue;
      const [, fieldName, fieldType, isList, optional, rest] = fm;
      const isRelationField = modelNames.has(fieldType);
      const relMatch = rest.match(/@relation\([^)]*fields:\s*\[([^\]]+)\][^)]*references:\s*\[([^\]]+)\]/);
      if (relMatch) {
        const fromCols = relMatch[1].split(',').map(s => s.trim());
        const toCols = relMatch[2].split(',').map(s => s.trim());
        fromCols.forEach((c, i) => fks.push({ column: c, refTable: fieldType, refColumn: toCols[i] }));
      }
      if (isRelationField) continue; // relation object fields aren't columns
      if (isList) continue;          // scalar lists are rare; skip as non-column noise
      columns.push({
        name: fieldName,
        type: fieldType + (optional ? '?' : ''),
        pk: /@id\b/.test(rest),
        nullable: Boolean(optional),
      });
    }
    tables.push({ name, columns, fks });
  }
  return { tables };
}

// ---------------------------------------------------------------------------
// SQL DDL parsing (CREATE TABLE …)
// ---------------------------------------------------------------------------

/** Split a paren-body on top-level commas (respects nesting + quotes). */
function splitTopLevel(body) {
  const parts = [];
  let depth = 0;
  let cur = '';
  let quote = null;
  for (const ch of body) {
    if (quote) {
      cur += ch;
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') { quote = ch; cur += ch; continue; }
    if (ch === '(') { depth++; cur += ch; continue; }
    if (ch === ')') { depth--; cur += ch; continue; }
    if (ch === ',' && depth === 0) { parts.push(cur.trim()); cur = ''; continue; }
    cur += ch;
  }
  if (cur.trim()) parts.push(cur.trim());
  return parts;
}

function stripQuotes(ident) {
  return String(ident || '').replace(/^[`"'[]|[`"'\]]$/g, '').trim();
}

/** Clean a (possibly quoted, possibly schema-qualified) table reference. */
function cleanTableRef(raw) {
  const segments = String(raw || '').split('.');
  return stripQuotes(segments[segments.length - 1]);
}

function parseSqlDdl(text) {
  const tables = [];
  // Table name: everything up to whitespace/open-paren — handles quoted and
  // schema-qualified forms ("public"."order-items"); segments cleaned below.
  const re = /create\s+table\s+(?:if\s+not\s+exists\s+)?([^\s(]+)\s*\(/gi;
  let m;
  while ((m = re.exec(text)) !== null) {
    const segments = m[1].split('.');
    const name = stripQuotes(segments[segments.length - 1]); // drop schema qualifier
    if (!/^[A-Za-z_]/.test(name)) continue;
    // Find the matching close paren from the open at re.lastIndex - 1.
    let depth = 1;
    let i = re.lastIndex;
    let quote = null;
    while (i < text.length && depth > 0) {
      const ch = text[i];
      if (quote) { if (ch === quote) quote = null; }
      else if (ch === "'" || ch === '"' || ch === '`') quote = ch;
      else if (ch === '(') depth++;
      else if (ch === ')') depth--;
      i++;
    }
    if (depth !== 0) continue; // unterminated — skip
    const body = text.slice(re.lastIndex, i - 1);
    re.lastIndex = i;

    const columns = [];
    const fks = [];
    const pkCols = new Set();
    for (const part of splitTopLevel(body)) {
      const upper = part.toUpperCase();
      if (upper.startsWith('PRIMARY KEY')) {
        const pkm = part.match(/\(([^)]+)\)/);
        if (pkm) pkm[1].split(',').forEach(c => pkCols.add(stripQuotes(c.trim())));
        continue;
      }
      if (upper.startsWith('FOREIGN KEY')) {
        const fkm = part.match(/foreign\s+key\s*\(([^)]+)\)\s*references\s+([^\s(]+)\s*(?:\(([^)]+)\))?/i);
        if (fkm) {
          const cols = fkm[1].split(',').map(s => stripQuotes(s.trim()));
          const refTable = cleanTableRef(fkm[2]);
          const refCols = fkm[3] ? fkm[3].split(',').map(s => stripQuotes(s.trim())) : [];
          cols.forEach((c, idx) => fks.push({ column: c, refTable, refColumn: refCols[idx] }));
        }
        continue;
      }
      if (/^(CONSTRAINT|UNIQUE|CHECK|INDEX|KEY|EXCLUDE)\b/.test(upper)) {
        // CONSTRAINT … FOREIGN KEY / PRIMARY KEY forms
        const fkm = part.match(/foreign\s+key\s*\(([^)]+)\)\s*references\s+([^\s(]+)\s*(?:\(([^)]+)\))?/i);
        if (fkm) {
          const cols = fkm[1].split(',').map(s => stripQuotes(s.trim()));
          const refTable = cleanTableRef(fkm[2]);
          const refCols = fkm[3] ? fkm[3].split(',').map(s => stripQuotes(s.trim())) : [];
          cols.forEach((c, idx) => fks.push({ column: c, refTable, refColumn: refCols[idx] }));
        }
        const pkm = part.match(/primary\s+key\s*\(([^)]+)\)/i);
        if (pkm) pkm[1].split(',').forEach(c => pkCols.add(stripQuotes(c.trim())));
        continue;
      }
      // Plain column definition: name type [modifiers]
      const cm = part.match(/^([`"'[]?[A-Za-z_][A-Za-z0-9_$-]*[`"'\]]?)\s+([A-Za-z][A-Za-z0-9_]*(?:\s*\([^)]*\))?)/);
      if (!cm) continue;
      const colName = stripQuotes(cm[1]);
      const colType = cm[2].replace(/\s+/g, ' ');
      const isPk = /primary\s+key/i.test(part);
      if (isPk) pkCols.add(colName);
      const inlineRef = part.match(/references\s+([^\s(]+)\s*(?:\(([^)]+)\))?/i);
      if (inlineRef) {
        fks.push({
          column: colName,
          refTable: cleanTableRef(inlineRef[1]),
          refColumn: inlineRef[2] ? stripQuotes(inlineRef[2].split(',')[0].trim()) : undefined,
        });
      }
      columns.push({
        name: colName,
        type: colType,
        pk: isPk,
        nullable: !/not\s+null/i.test(part) && !isPk,
      });
    }
    for (const col of columns) if (pkCols.has(col.name)) col.pk = true;
    tables.push({ name, columns, fks });
  }
  return { tables };
}

// ---------------------------------------------------------------------------
// Full introspection
// ---------------------------------------------------------------------------

/**
 * @param {string} projectRoot absolute project root
 * @param {string[]} files repo-relative file list (gitignore-respected)
 */
function introspect(projectRoot, files) {
  const sources = [];
  for (const cand of discoverSources(projectRoot, files)) {
    const abs = path.resolve(projectRoot, cand.path);
    let result;
    try {
      if (cand.kind === 'sqlite') result = introspectSqlite(abs);
      else if (cand.kind === 'prisma') result = parsePrisma(fs.readFileSync(abs, 'utf-8'));
      else result = parseSqlDdl(fs.readFileSync(abs, 'utf-8'));
    } catch (e) {
      result = { tables: [], error: String(e.message || e) };
    }
    sources.push({ kind: cand.kind, path: cand.path, tables: result.tables, ...(result.error ? { error: result.error } : {}) });
  }
  return { sources };
}

module.exports = { discoverSources, introspect, introspectSqlite, parsePrisma, parseSqlDdl, splitTopLevel };
