/**
 * Card Questionnaires — schema, validation, file IO, submit-message builder.
 *
 * Mirrors the file IO portion of `scripts/kanban.js` (questionnaire subcommands).
 * Keep the two in lockstep — same convention as `web/src/lib/status.ts` ↔ CLI
 * status helpers.
 */

import { promises as fs } from 'fs';
import path from 'path';
import { randomBytes } from 'crypto';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type QuestionnaireStatus = 'draft' | 'submitted';

export type QuestionnaireItem =
  | ExpositionItem
  | FreeTextItem
  | SingleChoiceItem
  | MultiChoiceItem
  | BooleanItem
  | ScaleItem
  | NumberItem;

export interface ExpositionItem {
  type: 'exposition';
  text: string;
}

export interface FreeTextItem {
  type: 'free_text';
  id: string;
  question: string;
  required?: boolean;
  answer: string | null;
}

export interface SingleChoiceItem {
  type: 'single_choice';
  id: string;
  question: string;
  options: string[];
  allow_other?: boolean;
  required?: boolean;
  answer: string | null;
}

export interface MultiChoiceItem {
  type: 'multi_choice';
  id: string;
  question: string;
  options: string[];
  allow_other?: boolean;
  required?: boolean;
  answer: string[] | null;
}

export interface BooleanItem {
  type: 'boolean';
  id: string;
  question: string;
  required?: boolean;
  answer: boolean | null;
}

export interface ScaleItem {
  type: 'scale';
  id: string;
  question: string;
  min: number;
  max: number;
  step?: number;
  required?: boolean;
  answer: number | null;
}

export interface NumberItem {
  type: 'number';
  id: string;
  question: string;
  min?: number;
  max?: number;
  step?: number;
  required?: boolean;
  answer: number | null;
}

export interface Questionnaire {
  name: string;
  title: string;
  intro?: string;
  status: QuestionnaireStatus;
  schema_version: number;
  updated_at: string;
  submitted_at: string | null;
  submission_count: number;
  items: QuestionnaireItem[];
}

export type AnswerableItem = Exclude<QuestionnaireItem, ExpositionItem>;

// ---------------------------------------------------------------------------
// Validation (hand-written — kept simple; mirrors kanban.js conventions)
// ---------------------------------------------------------------------------

export class QuestionnaireValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'QuestionnaireValidationError';
  }
}

const ITEM_TYPES = new Set([
  'exposition',
  'free_text',
  'single_choice',
  'multi_choice',
  'boolean',
  'scale',
  'number',
]);

function isString(v: unknown): v is string {
  return typeof v === 'string';
}
function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}
function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every(isString);
}

export function isAnswerableItem(item: QuestionnaireItem): item is AnswerableItem {
  return item.type !== 'exposition';
}

/**
 * Validate a parsed JSON object as a Questionnaire. Throws
 * QuestionnaireValidationError on failure. Returns a Questionnaire on success
 * (the same object, narrowed; we do not deep-clone).
 */
export function validateQuestionnaire(data: unknown): Questionnaire {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new QuestionnaireValidationError('Questionnaire must be a JSON object');
  }
  const q = data as Record<string, unknown>;

  if (!isString(q.name) || !q.name.trim()) {
    throw new QuestionnaireValidationError('"name" must be a non-empty string');
  }
  if (!isString(q.title)) {
    throw new QuestionnaireValidationError('"title" must be a string');
  }
  if (q.intro !== undefined && !isString(q.intro)) {
    throw new QuestionnaireValidationError('"intro" must be a string when provided');
  }
  if (q.status !== 'draft' && q.status !== 'submitted') {
    throw new QuestionnaireValidationError('"status" must be "draft" or "submitted"');
  }
  if (!isFiniteNumber(q.schema_version) || q.schema_version < 1) {
    throw new QuestionnaireValidationError('"schema_version" must be a positive number');
  }
  if (!isString(q.updated_at)) {
    throw new QuestionnaireValidationError('"updated_at" must be an ISO timestamp string');
  }
  if (q.submitted_at !== null && !isString(q.submitted_at)) {
    throw new QuestionnaireValidationError('"submitted_at" must be a string or null');
  }
  if (!isFiniteNumber(q.submission_count) || q.submission_count < 0) {
    throw new QuestionnaireValidationError('"submission_count" must be a non-negative number');
  }
  if (!Array.isArray(q.items)) {
    throw new QuestionnaireValidationError('"items" must be an array');
  }

  const seenIds = new Set<string>();
  for (let i = 0; i < q.items.length; i++) {
    validateItem(q.items[i], i, seenIds);
  }

  return q as unknown as Questionnaire;
}

function validateItem(raw: unknown, index: number, seenIds: Set<string>): void {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new QuestionnaireValidationError(`items[${index}] must be an object`);
  }
  const item = raw as Record<string, unknown>;
  const type = item.type;
  if (!isString(type) || !ITEM_TYPES.has(type)) {
    throw new QuestionnaireValidationError(
      `items[${index}].type must be one of ${[...ITEM_TYPES].join(', ')}`
    );
  }

  if (type === 'exposition') {
    if (!isString(item.text)) {
      throw new QuestionnaireValidationError(`items[${index}] (exposition).text must be a string`);
    }
    return;
  }

  // All non-exposition items require id + question
  if (!isString(item.id) || !item.id.trim()) {
    throw new QuestionnaireValidationError(`items[${index}].id must be a non-empty string`);
  }
  if (seenIds.has(item.id)) {
    throw new QuestionnaireValidationError(`items[${index}].id "${item.id}" is duplicated`);
  }
  seenIds.add(item.id);
  if (!isString(item.question)) {
    throw new QuestionnaireValidationError(`items[${index}] (${item.id}).question must be a string`);
  }
  if (item.required !== undefined && typeof item.required !== 'boolean') {
    throw new QuestionnaireValidationError(`items[${index}] (${item.id}).required must be boolean`);
  }

  switch (type) {
    case 'free_text':
      if (item.answer !== null && !isString(item.answer)) {
        throw new QuestionnaireValidationError(
          `items[${index}] (${item.id}).answer must be a string or null`
        );
      }
      break;
    case 'single_choice':
      if (!isStringArray(item.options) || item.options.length === 0) {
        throw new QuestionnaireValidationError(
          `items[${index}] (${item.id}).options must be a non-empty string[]`
        );
      }
      if (item.allow_other !== undefined && typeof item.allow_other !== 'boolean') {
        throw new QuestionnaireValidationError(
          `items[${index}] (${item.id}).allow_other must be boolean`
        );
      }
      if (item.answer !== null && !isString(item.answer)) {
        throw new QuestionnaireValidationError(
          `items[${index}] (${item.id}).answer must be a string or null`
        );
      }
      break;
    case 'multi_choice':
      if (!isStringArray(item.options) || item.options.length === 0) {
        throw new QuestionnaireValidationError(
          `items[${index}] (${item.id}).options must be a non-empty string[]`
        );
      }
      if (item.allow_other !== undefined && typeof item.allow_other !== 'boolean') {
        throw new QuestionnaireValidationError(
          `items[${index}] (${item.id}).allow_other must be boolean`
        );
      }
      if (item.answer !== null && !isStringArray(item.answer)) {
        throw new QuestionnaireValidationError(
          `items[${index}] (${item.id}).answer must be a string[] or null`
        );
      }
      break;
    case 'boolean':
      if (item.answer !== null && typeof item.answer !== 'boolean') {
        throw new QuestionnaireValidationError(
          `items[${index}] (${item.id}).answer must be a boolean or null`
        );
      }
      break;
    case 'scale':
      if (!isFiniteNumber(item.min) || !isFiniteNumber(item.max) || item.min >= item.max) {
        throw new QuestionnaireValidationError(
          `items[${index}] (${item.id}) requires numeric min < max`
        );
      }
      if (item.step !== undefined && (!isFiniteNumber(item.step) || item.step <= 0)) {
        throw new QuestionnaireValidationError(
          `items[${index}] (${item.id}).step must be a positive number when provided`
        );
      }
      if (item.answer !== null && (!isFiniteNumber(item.answer) || item.answer < item.min || item.answer > item.max)) {
        throw new QuestionnaireValidationError(
          `items[${index}] (${item.id}).answer must be a number in [${item.min}, ${item.max}] or null`
        );
      }
      break;
    case 'number':
      if (item.min !== undefined && !isFiniteNumber(item.min)) {
        throw new QuestionnaireValidationError(
          `items[${index}] (${item.id}).min must be a number when provided`
        );
      }
      if (item.max !== undefined && !isFiniteNumber(item.max)) {
        throw new QuestionnaireValidationError(
          `items[${index}] (${item.id}).max must be a number when provided`
        );
      }
      if (item.step !== undefined && (!isFiniteNumber(item.step) || item.step <= 0)) {
        throw new QuestionnaireValidationError(
          `items[${index}] (${item.id}).step must be a positive number when provided`
        );
      }
      if (item.answer !== null && !isFiniteNumber(item.answer)) {
        throw new QuestionnaireValidationError(
          `items[${index}] (${item.id}).answer must be a number or null`
        );
      }
      break;
  }
}

/**
 * Validate that a candidate `value` is the correct shape for `item`'s answer.
 * Used by the patch endpoint to reject malformed UI payloads before write.
 */
export function validateAnswerValue(item: QuestionnaireItem, value: unknown): void {
  if (item.type === 'exposition') {
    throw new QuestionnaireValidationError('Cannot set an answer on an exposition item');
  }
  if (value === null) return; // Clearing is always allowed.

  switch (item.type) {
    case 'free_text':
      if (!isString(value)) throw new QuestionnaireValidationError(`${item.id}: answer must be a string`);
      break;
    case 'single_choice':
      if (!isString(value)) throw new QuestionnaireValidationError(`${item.id}: answer must be a string`);
      if (!isValidChoice(value, item.options, item.allow_other)) {
        throw new QuestionnaireValidationError(
          `${item.id}: answer "${value}" is not in options${item.allow_other ? ' (and not Other:)' : ''}`
        );
      }
      break;
    case 'multi_choice':
      if (!isStringArray(value)) throw new QuestionnaireValidationError(`${item.id}: answer must be a string[]`);
      for (const v of value) {
        if (!isValidChoice(v, item.options, item.allow_other)) {
          throw new QuestionnaireValidationError(
            `${item.id}: "${v}" is not in options${item.allow_other ? ' (and not Other:)' : ''}`
          );
        }
      }
      break;
    case 'boolean':
      if (typeof value !== 'boolean') throw new QuestionnaireValidationError(`${item.id}: answer must be boolean`);
      break;
    case 'scale':
      if (!isFiniteNumber(value) || value < item.min || value > item.max) {
        throw new QuestionnaireValidationError(`${item.id}: answer must be in [${item.min}, ${item.max}]`);
      }
      break;
    case 'number':
      if (!isFiniteNumber(value)) throw new QuestionnaireValidationError(`${item.id}: answer must be a number`);
      if (item.min !== undefined && value < item.min) {
        throw new QuestionnaireValidationError(`${item.id}: answer must be >= ${item.min}`);
      }
      if (item.max !== undefined && value > item.max) {
        throw new QuestionnaireValidationError(`${item.id}: answer must be <= ${item.max}`);
      }
      break;
  }
}

function isValidChoice(value: string, options: string[], allowOther?: boolean): boolean {
  if (options.includes(value)) return true;
  if (allowOther && value.startsWith('Other:')) return true;
  return false;
}

// ---------------------------------------------------------------------------
// Path validation
// ---------------------------------------------------------------------------

const QUESTIONNAIRE_DIR = 'documentation/questionnaires/';

/**
 * Validate a relative questionnaire path. Throws on failure.
 * Accepts forward-slash paths only; callers should normalize backslashes first.
 */
export function validateQuestionnairePath(relPath: string): void {
  if (!isString(relPath) || !relPath.trim()) {
    throw new QuestionnaireValidationError('Path must be a non-empty string');
  }
  const posix = relPath.replace(/\\/g, '/');
  if (!posix.startsWith(QUESTIONNAIRE_DIR)) {
    throw new QuestionnaireValidationError(
      `Path must start with "${QUESTIONNAIRE_DIR}" (got "${posix}")`
    );
  }
  if (!posix.toLowerCase().endsWith('.json')) {
    throw new QuestionnaireValidationError(`Path must end with .json (got "${posix}")`);
  }
  if (posix.includes('..')) {
    throw new QuestionnaireValidationError(`Path must not contain ".." (got "${posix}")`);
  }
}

/**
 * Resolve a project-relative questionnaire path against a project root, ensuring
 * the resolved absolute path stays inside the project's `documentation/questionnaires/`.
 */
export function resolveQuestionnaireAbsPath(projectRoot: string, relPath: string): string {
  validateQuestionnairePath(relPath);
  const abs = path.resolve(projectRoot, relPath);
  const allowedBase = path.resolve(projectRoot, QUESTIONNAIRE_DIR);
  if (abs !== allowedBase && !abs.startsWith(allowedBase + path.sep)) {
    throw new QuestionnaireValidationError(`Resolved path escapes "${QUESTIONNAIRE_DIR}"`);
  }
  return abs;
}

// ---------------------------------------------------------------------------
// File IO
// ---------------------------------------------------------------------------

export async function loadQuestionnaire(absPath: string): Promise<Questionnaire> {
  const raw = await fs.readFile(absPath, 'utf-8');
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new QuestionnaireValidationError(
      `Invalid JSON in ${path.basename(absPath)}: ${err instanceof Error ? err.message : String(err)}`
    );
  }
  return validateQuestionnaire(parsed);
}

/**
 * Atomic write: write to temp + rename. Sets `updated_at` to now.
 * Caller is responsible for any other field mutations before calling.
 */
export async function saveQuestionnaire(absPath: string, q: Questionnaire): Promise<void> {
  q.updated_at = new Date().toISOString();
  // Re-validate before write — protects against caller mutations producing invalid state.
  validateQuestionnaire(q);
  const json = JSON.stringify(q, null, 2) + '\n';
  const tmpPath = `${absPath}.tmp.${process.pid}.${Date.now()}.${randomBytes(4).toString('hex')}`;
  await fs.writeFile(tmpPath, json, 'utf-8');
  await fs.rename(tmpPath, absPath);
}

/**
 * Patch one item's answer. Loads from disk, validates, mutates one field,
 * writes atomically. NEVER re-serializes from a stale UI document.
 *
 * Throws QuestionnaireValidationError on invalid item id or value shape.
 */
export async function patchAnswer(
  absPath: string,
  itemId: string,
  value: unknown
): Promise<{ schema_version: number }> {
  const q = await loadQuestionnaire(absPath);
  const idx = q.items.findIndex((it) => isAnswerableItem(it) && it.id === itemId);
  if (idx === -1) {
    const err = new QuestionnaireValidationError(`Item id "${itemId}" not found`);
    (err as { code?: string }).code = 'ITEM_NOT_FOUND';
    throw err;
  }
  const item = q.items[idx] as AnswerableItem;
  validateAnswerValue(item, value);
  // Set the answer in place. The discriminated union makes the assignment safe.
  // We trust validateAnswerValue to have shape-checked the value.
  (item as { answer: unknown }).answer = value;
  await saveQuestionnaire(absPath, q);
  return { schema_version: q.schema_version };
}

// ---------------------------------------------------------------------------
// Counts & required-check
// ---------------------------------------------------------------------------

export interface AnsweredCounts {
  answered: number;
  answerable: number;
  requiredMissing: number;
}

export function getAnsweredCounts(q: Questionnaire): AnsweredCounts {
  let answered = 0;
  let answerable = 0;
  let requiredMissing = 0;
  for (const item of q.items) {
    if (!isAnswerableItem(item)) continue;
    answerable++;
    const filled = isAnswerFilled(item);
    if (filled) answered++;
    if (item.required && !filled) requiredMissing++;
  }
  return { answered, answerable, requiredMissing };
}

/** True if the item has a non-null, non-empty answer. */
export function isAnswerFilled(item: AnswerableItem): boolean {
  if (item.answer === null || item.answer === undefined) return false;
  switch (item.type) {
    case 'free_text':
      return typeof item.answer === 'string' && item.answer.trim().length > 0;
    case 'single_choice':
      return typeof item.answer === 'string' && item.answer.trim().length > 0;
    case 'multi_choice':
      return Array.isArray(item.answer) && item.answer.length > 0;
    case 'boolean':
      return item.answer === true || item.answer === false;
    case 'scale':
    case 'number':
      return typeof item.answer === 'number' && Number.isFinite(item.answer);
  }
}

// ---------------------------------------------------------------------------
// Submit-message builder
// ---------------------------------------------------------------------------

/**
 * Strip control characters and ANSI escape sequences. Keep newlines + tabs
 * (those are display-safe; we'll handle them via indentation in the message).
 */
export function stripControlChars(s: string): string {
  // ANSI CSI sequences: ESC [ ... <final byte 0x40-0x7E>
  // Other ANSI escapes: ESC + single char (e.g. ESC ] for OSC)
  let out = s.replace(/\x1B\[[\x30-\x3F]*[\x20-\x2F]*[\x40-\x7E]/g, '');
  out = out.replace(/\x1B\][^\x07\x1B]*(?:\x07|\x1B\\)/g, ''); // OSC strings
  out = out.replace(/\x1B./g, ''); // any other ESC + char
  // Strip non-printable C0 (except \t \n \r) and DEL + C1
  // eslint-disable-next-line no-control-regex
  out = out.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]/g, '');
  return out;
}

/**
 * Build the submit message — the human-readable Q&A block that gets written
 * into the card's terminal session. Agent reads this as prose.
 *
 * `relPath` is the project-relative path to the questionnaire JSON file.
 */
export function buildSubmitMessage(q: Questionnaire, relPath: string): string {
  const lines: string[] = [];
  lines.push(`[Questionnaire submitted: ${stripControlChars(q.name)}]`);
  lines.push(`File: ${relPath}`);
  lines.push('');

  for (const item of q.items) {
    if (!isAnswerableItem(item)) continue;
    const question = stripControlChars(item.question);
    lines.push(`Q: ${question}`);
    lines.push(`A: ${formatAnswerForMessage(item)}`);
    lines.push('');
  }

  // Trim trailing blank line.
  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  return lines.join('\n');
}

function formatAnswerForMessage(item: AnswerableItem): string {
  if (!isAnswerFilled(item)) return '(no answer)';
  switch (item.type) {
    case 'free_text': {
      const v = stripControlChars(item.answer as string);
      const parts = v.split('\n');
      if (parts.length === 1) return parts[0];
      // Multi-line: first line on the A: line, subsequent indented under it.
      return parts.map((p, i) => (i === 0 ? p : `   ${p}`)).join('\n');
    }
    case 'single_choice':
      return stripControlChars(item.answer as string);
    case 'multi_choice':
      return (item.answer as string[]).map((v) => stripControlChars(v)).join(', ');
    case 'boolean':
      return (item.answer as boolean) ? 'true' : 'false';
    case 'scale':
    case 'number':
      return String(item.answer);
  }
}

// ---------------------------------------------------------------------------
// Factory: starter document
// ---------------------------------------------------------------------------

/** Build an empty draft questionnaire scaffold (used by tests/seed scripts). */
export function newQuestionnaire(name: string, title: string): Questionnaire {
  return {
    name,
    title,
    status: 'draft',
    schema_version: 1,
    updated_at: new Date().toISOString(),
    submitted_at: null,
    submission_count: 0,
    items: [],
  };
}
