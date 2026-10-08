/**
 * submit-verify.ts — pure classifier functions for the self-verifying prompt
 * submit flow (feature 070).
 *
 * Classifies a session's input region from an ANSI-stripped terminal snapshot
 * (the output of SessionManager.getSnapshot) to answer one question: is OUR
 * pasted prompt still sitting unsent in the input box?
 *
 * Grounded in empirical spike findings (documentation/designs/
 * spike_findings_submit_detection.md). Key facts the logic relies on:
 *  - Stripped snapshots collapse spaces unpredictably → ALL matching is
 *    whitespace-insensitive (normalizeForMatch strips every \s).
 *  - Long (multi-line) pastes render as placeholders with a count field:
 *      Claude  "[Pasted text #1 +21 lines]"   (count = payload lines - 1)
 *      Codex   "[Pasted Content 3199 chars]"  (count = exact payload chars)
 *  - Short pastes render literally (whitespace-mangled).
 *  - Codex's empty-input hint text ROTATES between runs → success is keyed on
 *    the DISAPPEARANCE of queued_ours, never on a positive "empty" match.
 *  - Blocked dialogs (trust prompt / update prompt / auth-wait) render NO
 *    recognizable input region; pasting into them shows nothing.
 *
 * This module must stay dependency-free (no session-manager imports) so it can
 * be table-tested against fixture snapshots.
 */

/**
 * Providers whose TUI chrome this classifier understands. This list is
 * inherently per-TUI (each entry has hand-captured fixtures and an
 * extractInputRegion arm) — it is NOT the provider registry. A provider that
 * is driven by a non-PTY transport (feature 085) never appears here.
 */
export const SUBMIT_PROVIDERS = ['claude', 'codex'] as const;
export type SubmitProvider = typeof SUBMIT_PROVIDERS[number];

export function isSubmitProvider(provider: string | undefined | null): provider is SubmitProvider {
  return !!provider && (SUBMIT_PROVIDERS as readonly string[]).includes(provider);
}

export type InputRegionClassification =
  | 'empty'            // input region present, no meaningful content (bare prompt char / known hint)
  | 'queued_ours'      // our payload (placeholder with matching count, or normalized prefix) is in the input region
  | 'queued_other'     // input region holds content that is not recognizably ours
  | 'no_input_region'  // no input region AND known blocking-dialog markers present (trust/update/auth)
  | 'unrecognized';    // could not parse the screen layout (chrome drift, partial redraw)

export type VerifyAction = 'wait' | 'resend_enter' | 'delivered' | 'failed' | 'blocked' | 'ambiguous';

export interface PastePlaceholder {
  kind: 'lines' | 'chars';
  /** null when the placeholder carries no count — Claude ≥2.1.176 renders
   *  long SINGLE-line pastes as "[Pasted text #2]" with no "+N lines" suffix
   *  (observed live 2026-06-13; the spike only saw the multi-line form). */
  count: number | null;
}

/** Strip ALL whitespace (incl. NBSP — covered by \s in JS) for tolerant matching. */
export function normalizeForMatch(text: string): string {
  return text.replace(/\s+/g, '');
}

/**
 * Known blocking-dialog markers (checked only when no input region was found,
 * so transcript text containing these phrases cannot false-positive — a normal
 * screen always has an input region alongside its transcript).
 */
const DIALOG_MARKERS: RegExp[] = [
  /do you trust/i,                  // Codex + Claude trust-folder dialogs
  /press enter to continue/i,       // Codex trust dialog footer
  /waiting for authentication/i,    // CLI auth-wait screens (captured in spike)
  /update available/i,              // CLI update prompts (user-observed on Codex)
  /new version/i,
  /login required|please log ?in/i,
  // Codex ≥0.160 on Windows, first start after an update (real capture,
  // card #0382): "Set up the Codex agent sandbox … › 1. Set up default
  // sandbox (requires Administrator permissions) … enter select · esc back".
  // An Enter here would pick the admin-sandbox option. Whitespace-tolerant:
  // older Windows snapshots collapsed spaces.
  /set\s*up\s*the\s*codex\s*agent\s*sandbox/i,
  // Claude Code's current trust-folder dialog (real Windows bridge log, card
  // #0382): "Quick safety check: Is this a project you created or one you
  // trust? … ❯ No, exit / Yes, I trust this folder / Enter to confirm". It
  // never says "do you trust", so it read as unrecognized, the deferred
  // paste went in and its Enter picked the highlighted "No, exit" — the
  // session quit (outcome_failed session_stopped ×3).
  /quick\s*safety\s*check/i,
  /yes,?\s*i\s*trust\s*this\s*folder/i,
];

export function hasDialogMarkers(snapshot: string): boolean {
  return DIALOG_MARKERS.some(rx => rx.test(snapshot));
}

/**
 * Claude's input-box separators. The BOTTOM one is always a bare row of
 * box-drawing horizontal bars. Since Claude Code 2.1.274 (live captures
 * 2026-09-17, card #0362) the TOP one carries the session title (and the
 * fast-mode tag) right-aligned inside the rule, closed by a single bar:
 *   "──────────── Review Fable codebase comprehensively ─"   (104 cols)
 *   " Verified submit false positive investigation with a deli… ─"  (60 cols)
 * Claude Code fits the title to the terminal width with a "…" — it never
 * wraps onto a second row — but a long title / narrow terminal consumes ALL
 * the leading bars, so the titled form cannot require any. A bare-bars-only
 * anchor missed every titled screen → `unrecognized`, and (with no input
 * region found) a "new version" phrase in the transcript promoted the passive
 * "✔ Update installed · Restart to apply" notice into a blocked dialog.
 */
const CLAUDE_SEPARATOR = /^\s*─{10,}\s*$/;
/** Titled top rule: optional leading bars, a label, then a closing bar run at end of row. */
const CLAUDE_TITLED_SEPARATOR = /^\s*(?:─+\s+)?\S.*\s─+\s*$/;
/**
 * Codex footer: "gpt-5.5 medium · ~/path", "tab to queue message100% context left", etc.
 * The cwd after the `·` is a Unix path on Linux/macOS (`~/…` or `/…`); on
 * Windows Codex prints it natively — `~\projects\x` when under the profile,
 * or a bare drive path `C:\Users\…` / `D:\work` otherwise — so the anchor
 * accepts a drive letter too (card #0351). Without it every Windows Codex
 * screen read as "no footer" → unrecognized → ambiguous.
 */
const CODEX_FOOTER = /(·\s*(~|\/|[A-Za-z]:[\\/])|context left|tab to queue)/;

/**
 * Codex composer markers, by version:
 *   `›` (U+203A) — ≤0.137 composer; history rows in every version; and the
 *                  composer AGAIN in 0.155 (live Linux capture 2026-10-07,
 *                  card #0382: composer and history rows both `›`).
 *                  The REAL Windows capture (Codex 0.160.1, ConPTY) draws
 *                  `›` too — the screenshot's ">" was the web font.
 *   `»` (U+00BB) — 0.147 composer only (card #0336).
 */
const CODEX_COMPOSER_MARKER = /^\s*[»›]/;
/** Upper bound on composer height when walking up from the footer. */
const CODEX_COMPOSER_MAX_ROWS = 20;

/**
 * Structural composer anchor: the composer is the contiguous non-blank block
 * directly above the footer (blank rows between them are skipped), and its
 * first row carries the composer marker. Returns the TOPMOST marker row in
 * that block — payload continuation rows that happen to start with `›` sit
 * below it and can never be mistaken for the composer top, and
 * transcript rows (separated from the composer by blank rows) are never
 * reached. The footer is the LAST footer-matching row on screen; rows below
 * it (e.g. Windows "⚠ 1 warning · f2 to view") are ignored.
 */
function findCodexComposer(lines: string[]): { top: number; bottom: number } | null {
  let footer = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (CODEX_FOOTER.test(lines[i])) { footer = i; break; }
  }
  if (footer === -1) return null;
  let bottom = footer - 1;
  while (bottom >= 0 && lines[bottom].trim() === '') bottom--;
  if (bottom < 0) return null;
  let top = -1;
  for (let i = bottom; i >= 0 && bottom - i < CODEX_COMPOSER_MAX_ROWS && lines[i].trim() !== ''; i--) {
    if (CODEX_COMPOSER_MARKER.test(lines[i])) top = i;
  }
  return top === -1 ? null : { top, bottom };
}

/**
 * Claude prompt marker. `❯` (U+276F) everywhere — the REAL Windows capture
 * (2026-09-13, ConPTY, card #0351) renders `❯` too; the Windows failure was
 * the snapshot path joining rows (see terminal-snapshot.ts), not the glyph.
 * ASCII `>` is kept only as a cheap tolerance for consoles that do fall back
 * to ASCII symbols; it has no captured fixture.
 */
const CLAUDE_PROMPT_MARKERS = ['❯', '>'] as const;

/** Known per-provider empty-input hint patterns (normalized, whitespace-stripped). */
const CLAUDE_HINT = /^try["“].*["”]$/i;            // ❯ Try "fix lint errors"

export interface InputRegion {
  found: boolean;
  /** Region text with the prompt marker (❯ / › / * / >) stripped, lines joined with \n. */
  text: string;
}

function splitLines(snapshot: string): string[] {
  return snapshot.split(/\r?\n/);
}

/**
 * Extract the input region for a provider from a stripped snapshot.
 * Returns { found: false } when the provider's layout anchors are absent
 * (dialog screens, startup screens, chrome drift).
 */
export function extractInputRegion(provider: SubmitProvider, snapshot: string): InputRegion {
  const lines = splitLines(snapshot);

  if (provider === 'claude') {
    // Input box = content between the LAST bare `────` row (bottom) and the
    // nearest separator above it — bare, or the titled form (top only). First
    // content line must start with ❯: a dialog's choice list between two rules
    // still reads as not-found. The passive "✔ Update installed · Restart to
    // apply" notice sits ABOVE the top separator and never enters the region.
    let bottom = -1;
    for (let i = lines.length - 1; i >= 0; i--) {
      if (CLAUDE_SEPARATOR.test(lines[i])) { bottom = i; break; }
    }
    if (bottom === -1) return { found: false, text: '' };
    let top = -1;
    for (let i = bottom - 1; i >= 0; i--) {
      if (CLAUDE_SEPARATOR.test(lines[i]) || CLAUDE_TITLED_SEPARATOR.test(lines[i])) { top = i; break; }
    }
    if (top === -1) return { found: false, text: '' };
    if (bottom - top < 2) return { found: false, text: '' };
    const region = lines.slice(top + 1, bottom);
    const first = region[0]?.trimStart() ?? '';
    const marker = CLAUDE_PROMPT_MARKERS.find(m => first.startsWith(m));
    if (!marker) return { found: false, text: '' };
    if (marker === '❯') {
      // `❯` never occurs in user text — strip every occurrence (legacy behaviour).
      return { found: true, text: region.join('\n').replace(/❯/g, '') };
    }
    // ASCII `>` DOES occur in payloads ("a > b", quoted mail) — strip only the
    // leading marker on the prompt line, never inside the text.
    const stripped = [region[0].replace(/^(\s*)>/, '$1'), ...region.slice(1)];
    return { found: true, text: stripped.join('\n') };
  }

  if (provider === 'codex') {
    // Structural anchor first (card #0382): the block directly above the
    // footer. Only the leading marker on the composer's first row is
    // stripped — `>` / `›` / `»` inside payload text survive intact.
    const composer = findCodexComposer(lines);
    if (composer) {
      const rows = lines.slice(composer.top, composer.bottom + 1);
      rows[0] = rows[0].replace(CODEX_COMPOSER_MARKER, m => m.slice(0, -1));
      return { found: true, text: rows.join('\n') };
    }

    // Legacy fallback (»/› only, never ASCII `>`) for screens the structural
    // anchor cannot read — e.g. a literal paste containing blank rows splits
    // the composer, so the block above the footer has no marker row.
    // Composer marker drift: Codex ≤0.137 rendered the editable composer AND
    // submitted history rows with `›` (U+203A). Codex 0.147 renders the live
    // composer with `»` (U+00BB) and keeps `›` for history rows (live capture
    // 2026-08-22, card #0336). So: prefer the LAST `»` line; fall back to the
    // LAST `›` line only when no `»` exists. Picking a `›` row while a `»`
    // composer is on screen would read already-submitted text as queued.
    // Input = lines from the composer line down to the next blank or footer
    // line. A model/footer line somewhere after it is REQUIRED — the trust
    // dialog also renders a `›` choice line but has no footer.
    let promptIdx = -1;
    for (let i = lines.length - 1; i >= 0; i--) {
      if (lines[i].trimStart().startsWith('»')) { promptIdx = i; break; }
    }
    if (promptIdx === -1) {
      for (let i = lines.length - 1; i >= 0; i--) {
        if (lines[i].trimStart().startsWith('›')) { promptIdx = i; break; }
      }
    }
    if (promptIdx === -1) return { found: false, text: '' };
    const hasFooter = lines.slice(promptIdx + 1).some(l => CODEX_FOOTER.test(l));
    if (!hasFooter) return { found: false, text: '' };
    const region: string[] = [];
    for (let i = promptIdx; i < lines.length; i++) {
      const line = lines[i];
      if (i > promptIdx && (line.trim() === '' || CODEX_FOOTER.test(line))) break;
      region.push(line);
    }
    const text = region.join('\n').replace(/[›»]/g, '');
    return { found: true, text };
  }

  // Unknown/unhandled provider layout — treat as unparseable, never guess.
  return { found: false, text: '' };
}

/**
 * Parse a paste placeholder out of (normalized or raw) input-region text.
 * Matches both providers' formats, whitespace-insensitively.
 */
export function parsePastePlaceholder(text: string): PastePlaceholder | null {
  const n = normalizeForMatch(text).toLowerCase();
  let m = n.match(/\[pastedcontent(\d+)chars\]/);
  if (m) return { kind: 'chars', count: parseInt(m[1], 10) };
  m = n.match(/\[pastedtext#?\d*\+(\d+)lines?\]/);
  if (m) return { kind: 'lines', count: parseInt(m[1], 10) };
  // Claude countless form: "[Pasted text #2]" — long single-line pastes
  // (e.g. voice transcripts) carry no line count.
  m = n.match(/\[pastedtext#?\d*\]/);
  if (m) return { kind: 'lines', count: null };
  return null;
}

/** Unicode code-point length (Codex's placeholder count unit; String.length is UTF-16). */
export function codePointLength(text: string): number {
  let n = 0;
  for (const _ of text) n++;
  return n;
}

/**
 * Allowed gap between a Codex "[Pasted Content N chars]" count and our
 * payload's code points. Linux renders the exact count; Windows Codex under
 * ConPTY runs 0–5 short PER 1024-char bridge write chunk (real bridge log,
 * card #0382: a 9094-char paste rendered as placeholders of 1019–1024
 * chars). Still far tighter than a merged double paste (2 × 2859 → 5710).
 * 1024 mirrors CHUNKED_WRITE_SIZE in pty-handler.ts (kept dependency-free).
 */
export function codexCharsTolerance(expected: string): number {
  return 2 + 6 * Math.ceil(codePointLength(expected) / 1024);
}

/** How many normalized leading characters of the payload we try to find. */
const PREFIX_LEN = 48;
/** Minimum normalized region length for the viewport-window (region ⊂ payload) match — short generic text must not claim ownership. */
const VIEWPORT_MIN_MATCH = 24;

function payloadQueued(regionText: string, expected: string): boolean {
  const normRegion = normalizeForMatch(regionText);
  const normExpected = normalizeForMatch(expected);
  if (normExpected.length === 0) return false;

  // Placeholder branch — long pastes never show literal content.
  const placeholder = parsePastePlaceholder(regionText);
  if (placeholder) {
    if (placeholder.count === null) {
      // Countless placeholder (Claude single-line form): no count to
      // corroborate. Accept as ours when the payload is substantial enough
      // to have rendered as a placeholder at all — short payloads render
      // literally and would have matched the prefix branch instead.
      return normExpected.length >= 40;
    }
    if (placeholder.kind === 'chars') {
      // Codex counts Unicode CODE POINTS (live capture 2026-08-22: a CRLF +
      // emoji payload of 1093 UTF-16 units / 1077 code points / 1178 UTF-8
      // bytes rendered "[Pasted Content 1077 chars]"). `String.length` is
      // UTF-16 and over-counts astral characters (emoji) → use code points.
      // Windows (card #0382): one paste can render as SEVERAL placeholders
      // (one per bridge write chunk) whose counts run a few short — sum
      // them, and use the chunk-scaled tolerance.
      let total = 0;
      for (const m of normalizeForMatch(regionText).toLowerCase().matchAll(/\[pastedcontent(\d+)chars\]/g)) total += parseInt(m[1], 10);
      return Math.abs(total - codePointLength(expected)) <= codexCharsTolerance(expected);
    }
    // Claude reports payloadLines-1 ("+21 lines" for 22); keep a ±-tolerant
    // window so off-by-one rendering differences never fail verification.
    const payloadLines = expected.split('\n').length;
    return placeholder.count >= payloadLines - 2 && placeholder.count <= payloadLines + 1;
  }

  // Literal branch — short pastes render as (whitespace-mangled) text.
  const prefix = normExpected.slice(0, PREFIX_LEN);
  if (prefix.length < 8) {
    // Very short payloads must match fully to avoid false positives.
    return normRegion.includes(normExpected);
  }
  if (normRegion.includes(prefix)) return true;

  // Viewport-window branch — proven by live capture 2026-07-09: a medium-
  // length paste (too short for a placeholder, taller than the input box)
  // leaves the cursor at the END, so the box shows only a tail/middle window
  // of the message and the prefix is scrolled out of view. If everything
  // visible in the region is a substring of our payload (and long enough to
  // be non-coincidental), it's ours.
  if (normRegion.length >= VIEWPORT_MIN_MATCH && normExpected.includes(normRegion)) {
    return true;
  }
  return false;
}

/**
 * Count paste placeholders ANYWHERE in a snapshot whose count corroborates
 * `expected` (same tolerance rules as payloadQueued). Layout-independent —
 * used as a TEMPORAL signal only: the caller compares pre-paste vs post-paste
 * counts and treats a newly introduced occurrence as "our paste landed", and
 * its later disappearance as "it left the box". Absolute presence is never a
 * verdict: transcript/tool output can legitimately contain placeholder text
 * (a review on card #0336 quoted "[Pasted Content 3199 chars]" verbatim).
 */
export function countMatchingPlaceholders(snapshot: string, expected: string): number {
  const n = normalizeForMatch(snapshot).toLowerCase();
  const payloadLines = expected.split('\n').length;
  let count = 0;
  const expectedCodePoints = codePointLength(expected);
  const tolerance = codexCharsTolerance(expected);
  for (const m of n.matchAll(/\[pastedcontent(\d+)chars\]/g)) {
    if (Math.abs(parseInt(m[1], 10) - expectedCodePoints) <= tolerance) count++;
  }
  for (const m of n.matchAll(/\[pastedtext#?\d*\+(\d+)lines?\]/g)) {
    const c = parseInt(m[1], 10);
    if (c >= payloadLines - 2 && c <= payloadLines + 1) count++;
  }
  return count;
}

/**
 * Classify the input region of a snapshot.
 *
 * `expected` is the payload we pasted (or are about to paste). Pass null for a
 * pre-paste check where we only care about empty / non-empty / blocked.
 */
export function classifyInputRegion(
  provider: SubmitProvider,
  snapshot: string,
  expected: string | null,
): InputRegionClassification {
  const region = extractInputRegion(provider, snapshot);
  if (!region.found) {
    return hasDialogMarkers(snapshot) ? 'no_input_region' : 'unrecognized';
  }

  const norm = normalizeForMatch(region.text);

  if (expected !== null && payloadQueued(region.text, expected)) {
    return 'queued_ours';
  }

  if (norm.length === 0) return 'empty';
  if (provider === 'claude' && CLAUDE_HINT.test(norm)) return 'empty';
  if (provider === 'codex') {
    // Codex shows a ROTATING hint when empty ("Explain this codebase", ...).
    // A single-line non-matching region with no placeholder is overwhelmingly
    // likely to be the hint. Cost of misclassification is low: this value only
    // feeds the pre-paste warning, never the resend/delivered decision.
    const contentLines = region.text.split('\n').filter(l => l.trim() !== '').length;
    if (contentLines <= 1 && !parsePastePlaceholder(region.text)) return 'empty';
  }

  return 'queued_other';
}

/**
 * Card #0382: is a JUST-STARTED session's input box ready to paste into?
 * Fed the classifications of successive polls (expected = null) on the
 * deferred / resume path, where the provider is still starting up.
 *
 * Real Windows sequence: Codex drew "› Ask Codex to do anything" with only a
 * "? for shortcuts" hint row (no model · path footer yet → unrecognized), the
 * bridge pasted anyway, and Codex then raised its agent-sandbox dialog over
 * the paste — the Enter went to the dialog. So: never paste into an
 * unreadable screen; require the input box to be found on two consecutive
 * polls (startup chrome settled); a dialog is a hard stop.
 */
export type ReadyInputVerdict = 'ready' | 'wait' | 'blocked';

export function readyInputVerdict(polls: Array<InputRegionClassification | null>): ReadyInputVerdict {
  const last = polls[polls.length - 1];
  if (last === 'no_input_region') return 'blocked';
  const found = (c: InputRegionClassification | null | undefined) =>
    c === 'empty' || c === 'queued_other' || c === 'queued_ours';
  if (polls.length >= 2 && found(last) && found(polls[polls.length - 2])) return 'ready';
  return 'wait';
}

export interface VerifyDecisionInput {
  /** Classifications observed in the CURRENT post-Enter poll ladder, in order. */
  polls: InputRegionClassification[];
  /** Total polls planned for one ladder (3 → 1s/3s/6s). */
  maxPolls: number;
  /** Enter resends already performed. */
  resends: number;
  /** Maximum Enter resends allowed. */
  maxResends: number;
}

/**
 * Decide the next action after a post-Enter poll.
 *
 * Success = our queued content DISAPPEARED (whatever replaced it — empty box,
 * rotating hint, other text, or even a permission dialog raised by the model
 * starting to work). A resend fires only when EVERY poll of a full ladder still
 * shows queued_ours — the spike observed legitimate submits clearing as late as
 * ~5s, so resending earlier than ladder-end would be spurious (and post-submit
 * double-Enter is only validated harmless on Claude).
 */
export function decideNextAction(input: VerifyDecisionInput): VerifyAction {
  const { polls, maxPolls, resends, maxResends } = input;
  if (polls.length === 0) return 'wait';
  const last = polls[polls.length - 1];

  if (last === 'unrecognized') {
    // No observation — NOT evidence the paste disappeared, and NOT evidence
    // it is still queued. Keep looking while the ladder has polls left; an
    // unreadable screen at ladder end is an honest 'ambiguous' (card #0336:
    // a single unreadable 1s glance used to bail straight to ambiguous while
    // the prompt had in fact landed). Never resends from here.
    return polls.length < maxPolls ? 'wait' : 'ambiguous';
  }
  if (last === 'no_input_region') {
    // Queued content gone, dialog now showing. The paste was confirmed queued
    // BEFORE Enter, so a post-Enter dialog means the submit was accepted and
    // the model's work raised it (e.g. permission prompt) → delivered.
    // (The dangerous pre-paste dialog case is handled before pasting.)
    return 'delivered';
  }
  if (last !== 'queued_ours') return 'delivered';

  // Still queued (positively observed).
  if (polls.length < maxPolls) return 'wait';
  // Full ladder exhausted. A resend is the one dangerous action (a second
  // Enter into a box that DID submit is the historical double-fire), so it
  // needs EVERY poll of the ladder to have positively shown our payload —
  // a ladder like [unrecognized, unrecognized, queued_ours] is one late
  // repaint, not proof, and must not resend.
  const allQueued = polls.every(p => p === 'queued_ours');
  if (!allQueued) return 'ambiguous';
  if (resends < maxResends) return 'resend_enter';
  return 'failed';
}
