/**
 * terminal-snapshot.ts — row-accurate text extraction from a headless xterm
 * buffer (card #0351).
 *
 * Why not SerializeAddon: it serialises LOGICAL lines — when a buffer row is
 * flagged `isWrapped` (the terminal auto-wrapped onto it) the addon emits no
 * `\r\n` before it, so the two physical rows come back joined as one string.
 * Windows ConPTY repaints every row to the full terminal width and lets the
 * terminal auto-wrap onto the next row instead of writing `\r\n`, so on
 * Windows EVERY row is `isWrapped` and a Claude screen serialises as
 * `────…────❯ ` / `────…────  ⏵⏵ …` (real capture 2026-09-13: the classifier
 * never saw a bare separator row, every poll was `unrecognized`, every voice
 * submit ended `ambiguous`). Reading the buffer row by row sidesteps the wrap
 * flag entirely; on Linux (providers write `\r\n` themselves) the output is
 * the same text the addon produced, minus its trailing mode residue.
 *
 * Kept dependency-free of session-manager so it can be tested with
 * @xterm/headless directly.
 */
/** The subset of xterm's Terminal/IBuffer API this module touches. */
export interface RowReadableTerminal {
    buffer: {
        active: {
            length: number;
            getLine(y: number): {
                translateToString(trimRight?: boolean): string;
            } | undefined;
        };
    };
}
/**
 * Last `lines` physical rows of the ACTIVE buffer (alternate screen when the
 * app switched to it), one string per row, right-trimmed. Trailing blank rows
 * (the unused viewport below the cursor) are dropped so `lines` buys content,
 * not padding — matching the old `.trim()` of the serialised snapshot.
 */
export declare function bufferRows(term: RowReadableTerminal, lines: number): string[];
/** Same rows joined with `\n` (the classifier splits on /\r?\n/). */
export declare function bufferText(term: RowReadableTerminal, lines: number): string;
