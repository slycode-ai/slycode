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
export type InputRegionClassification = 'empty' | 'queued_ours' | 'queued_other' | 'no_input_region' | 'unrecognized';
export type VerifyAction = 'wait' | 'resend_enter' | 'delivered' | 'failed' | 'blocked' | 'ambiguous';
export interface PastePlaceholder {
    kind: 'lines' | 'chars';
    /** null when the placeholder carries no count — Claude ≥2.1.176 renders
     *  long SINGLE-line pastes as "[Pasted text #2]" with no "+N lines" suffix
     *  (observed live 2026-06-13; the spike only saw the multi-line form). */
    count: number | null;
}
/** Strip ALL whitespace (incl. NBSP — covered by \s in JS) for tolerant matching. */
export declare function normalizeForMatch(text: string): string;
export declare function hasDialogMarkers(snapshot: string): boolean;
export interface InputRegion {
    found: boolean;
    /** Region text with the prompt marker (❯ / › / * / >) stripped, lines joined with \n. */
    text: string;
}
/**
 * Extract the input region for a provider from a stripped snapshot.
 * Returns { found: false } when the provider's layout anchors are absent
 * (dialog screens, startup screens, chrome drift).
 */
export declare function extractInputRegion(provider: SubmitProvider, snapshot: string): InputRegion;
/**
 * Parse a paste placeholder out of (normalized or raw) input-region text.
 * Matches all three providers' formats, whitespace-insensitively.
 */
export declare function parsePastePlaceholder(text: string): PastePlaceholder | null;
/**
 * Classify the input region of a snapshot.
 *
 * `expected` is the payload we pasted (or are about to paste). Pass null for a
 * pre-paste check where we only care about empty / non-empty / blocked.
 */
export declare function classifyInputRegion(provider: SubmitProvider, snapshot: string, expected: string | null): InputRegionClassification;
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
export declare function decideNextAction(input: VerifyDecisionInput): VerifyAction;
