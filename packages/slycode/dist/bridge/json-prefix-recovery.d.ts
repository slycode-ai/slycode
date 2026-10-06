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
export declare function recoverJsonPrefix(text: string): RecoveredJson | null;
