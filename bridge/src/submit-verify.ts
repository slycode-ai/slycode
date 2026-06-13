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
 *      Gemini  "[Pasted Text: 22 lines]"      (count = payload lines)
 *  - Short pastes render literally (whitespace-mangled).
 *  - Codex's empty-input hint text ROTATES between runs → success is keyed on
 *    the DISAPPEARANCE of queued_ours, never on a positive "empty" match.
 *  - Blocked dialogs (trust prompt / update prompt / auth-wait) render NO
 *    recognizable input region; pasting into them shows nothing.
 *
 * This module must stay dependency-free (no session-manager imports) so it can
 * be table-tested against fixture snapshots.
 */

export type SubmitProvider = 'claude' | 'codex' | 'gemini';

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
  /waiting for authentication/i,    // Gemini auth-wait screen (captured in spike)
  /update available/i,              // CLI update prompts (user-observed on Codex)
  /new version/i,
  /login required|please log ?in/i,
];

export function hasDialogMarkers(snapshot: string): boolean {
  return DIALOG_MARKERS.some(rx => rx.test(snapshot));
}

/** A line consisting only of box-drawing horizontal bars (Claude's input separators). */
const CLAUDE_SEPARATOR = /^\s*─{10,}\s*$/;
/** Codex footer: "gpt-5.5 medium · ~/path", "tab to queue message100% context left", etc. */
const CODEX_FOOTER = /(·\s*(~|\/)|context left|tab to queue)/;
/** Gemini input region delimiters: runs of upper/lower half-blocks. */
const GEMINI_TOP = /^\s*▄{10,}\s*$/;
const GEMINI_BOTTOM = /^\s*▀{10,}\s*$/;

/** Known per-provider empty-input hint patterns (normalized, whitespace-stripped). */
const CLAUDE_HINT = /^try["“].*["”]$/i;            // ❯ Try "fix lint errors"
const GEMINI_HINT = /^typeyourmessageor@path\/to\/file$/i;

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
    // Input box = content between the LAST TWO bare `────` separator rows,
    // first content line starting with ❯.
    const sepIdx: number[] = [];
    for (let i = 0; i < lines.length; i++) {
      if (CLAUDE_SEPARATOR.test(lines[i])) sepIdx.push(i);
    }
    if (sepIdx.length < 2) return { found: false, text: '' };
    const top = sepIdx[sepIdx.length - 2];
    const bottom = sepIdx[sepIdx.length - 1];
    if (bottom - top < 2) return { found: false, text: '' };
    const region = lines.slice(top + 1, bottom);
    if (!region[0] || !region[0].trimStart().startsWith('❯')) return { found: false, text: '' };
    const text = region.join('\n').replace(/❯/g, '');
    return { found: true, text };
  }

  if (provider === 'codex') {
    // Input = lines from the last `›`-prefixed line down to the next blank or
    // footer line. A model/footer line somewhere after the `›` line is REQUIRED —
    // the trust dialog also renders a `›` choice line but has no footer.
    let promptIdx = -1;
    for (let i = lines.length - 1; i >= 0; i--) {
      if (lines[i].trimStart().startsWith('›')) { promptIdx = i; break; }
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
    const text = region.join('\n').replace(/›/g, '');
    return { found: true, text };
  }

  // gemini
  let topIdx = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (GEMINI_TOP.test(lines[i])) { topIdx = i; break; }
  }
  if (topIdx === -1) return { found: false, text: '' };
  let bottomIdx = -1;
  for (let i = topIdx + 1; i < lines.length; i++) {
    if (GEMINI_BOTTOM.test(lines[i])) { bottomIdx = i; break; }
  }
  if (bottomIdx === -1 || bottomIdx - topIdx < 2) return { found: false, text: '' };
  const region = lines.slice(topIdx + 1, bottomIdx);
  // Strip the leading marker (* unfocused / > focused) from the first line only.
  const first = region[0].replace(/^\s*[*>]\s?/, '');
  const text = [first, ...region.slice(1)].join('\n');
  return { found: true, text };
}

/**
 * Parse a paste placeholder out of (normalized or raw) input-region text.
 * Matches all three providers' formats, whitespace-insensitively.
 */
export function parsePastePlaceholder(text: string): PastePlaceholder | null {
  const n = normalizeForMatch(text).toLowerCase();
  let m = n.match(/\[pastedcontent(\d+)chars\]/);
  if (m) return { kind: 'chars', count: parseInt(m[1], 10) };
  m = n.match(/\[pastedtext#?\d*\+(\d+)lines?\]/);
  if (m) return { kind: 'lines', count: parseInt(m[1], 10) };
  m = n.match(/\[pastedtext:?(\d+)lines?\]/);
  if (m) return { kind: 'lines', count: parseInt(m[1], 10) };
  // Claude countless form: "[Pasted text #2]" — long single-line pastes
  // (e.g. voice transcripts) carry no line count.
  m = n.match(/\[pastedtext#?\d*\]/);
  if (m) return { kind: 'lines', count: null };
  return null;
}

/** How many normalized leading characters of the payload we try to find. */
const PREFIX_LEN = 48;

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
      // Codex: exact payload char count observed in spike; allow tiny tolerance.
      return Math.abs(placeholder.count - expected.length) <= 2;
    }
    // Claude reports payloadLines-1 ("+21 lines" for 22), Gemini payloadLines.
    const payloadLines = expected.split('\n').length;
    return placeholder.count >= payloadLines - 2 && placeholder.count <= payloadLines + 1;
  }

  // Literal branch — short pastes render as (whitespace-mangled) text.
  const prefix = normExpected.slice(0, PREFIX_LEN);
  if (prefix.length < 8) {
    // Very short payloads must match fully to avoid false positives.
    return normRegion.includes(normExpected);
  }
  return normRegion.includes(prefix);
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
  if (provider === 'gemini' && GEMINI_HINT.test(norm)) return 'empty';
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

  if (last === 'unrecognized') return 'ambiguous';
  if (last === 'no_input_region') {
    // Queued content gone, dialog now showing. The paste was confirmed queued
    // BEFORE Enter, so a post-Enter dialog means the submit was accepted and
    // the model's work raised it (e.g. permission prompt) → delivered.
    // (The dangerous pre-paste dialog case is handled before pasting.)
    return 'delivered';
  }
  if (last !== 'queued_ours') return 'delivered';

  // Still queued.
  if (polls.length < maxPolls) return 'wait';
  // Full ladder exhausted with the prompt still sitting in the input box.
  if (resends < maxResends) return 'resend_enter';
  return 'failed';
}
