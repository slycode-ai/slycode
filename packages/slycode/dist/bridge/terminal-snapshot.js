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
/**
 * Last `lines` physical rows of the ACTIVE buffer (alternate screen when the
 * app switched to it), one string per row, right-trimmed. Trailing blank rows
 * (the unused viewport below the cursor) are dropped so `lines` buys content,
 * not padding — matching the old `.trim()` of the serialised snapshot.
 */
export function bufferRows(term, lines) {
    const buf = term.buffer.active;
    const row = (y) => (buf.getLine(y)?.translateToString(true) ?? '').replace(/\s+$/, '');
    // Find the last row with content: the viewport below the cursor is blank
    // rows, and ConPTY pads rows with REAL spaces (translateToString's
    // trimRight only drops null cells), hence the explicit right-trim.
    let end = buf.length;
    while (end > 0 && row(end - 1) === '')
        end--;
    const rows = [];
    for (let y = Math.max(0, end - lines); y < end; y++)
        rows.push(row(y));
    return rows;
}
/** Same rows joined with `\n` (the classifier splits on /\r?\n/). */
export function bufferText(term, lines) {
    return bufferRows(term, lines).join('\n');
}
//# sourceMappingURL=terminal-snapshot.js.map