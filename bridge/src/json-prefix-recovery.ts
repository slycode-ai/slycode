/**
 * Recover the longest valid JSON prefix of a damaged file (card #0366).
 *
 * The damage this exists for is trailing overrun: two overlapping writes to one
 * path leave a complete document followed by the tail of a longer one. A JSON
 * text is exactly one top-level value, so the only prefix that can parse is the
 * one ending where the first top-level object/array closes — find that point
 * with a string/escape-aware depth scan and parse up to it.
 *
 * Pure and dependency-free so it can be table-tested.
 */

export interface RecoveredJson {
  value: unknown;
  /** Length (in UTF-16 code units) of the prefix that parsed. */
  end: number;
}

export function recoverJsonPrefix(text: string): RecoveredJson | null {
  let depth = 0;
  let inString = false;
  let escaped = false;
  let started = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }

    if (ch === '"') {
      // A top-level string is never a session file — only objects/arrays recover.
      if (!started) return null;
      inString = true;
    } else if (ch === '{' || ch === '[') {
      depth++;
      started = true;
    } else if (ch === '}' || ch === ']') {
      if (!started) return null;
      depth--;
      if (depth === 0) {
        const end = i + 1;
        try {
          return { value: JSON.parse(text.slice(0, end)), end };
        } catch {
          return null;
        }
      }
    } else if (!started && !/\s/.test(ch)) {
      return null;
    }
  }

  return null;
}
