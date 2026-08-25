/**
 * Symlink-refusing copy primitives (card #0326, security audit 2026-08-12).
 *
 * `fs.copyFileSync` dereferences symlinks by default — a symlink planted in a
 * source tree (store/, updates/, templates/) would copy the TARGET's content
 * into the destination, letting a compromised source tree exfiltrate arbitrary
 * readable files. These helpers `lstat` the source first and silently skip
 * symlinks (defense-in-depth; no legitimate source tree contains any).
 *
 * Mirror of web/src/lib/copy-guard.ts — separate published packages cannot
 * share an import (same precedent as the atomic-write pattern). Keep in sync.
 */
/**
 * Copy a single file, refusing symlink sources.
 * Returns true if copied, false if `src` was a symlink and was skipped.
 */
export declare function copyFileNoFollow(src: string, dst: string): boolean;
/**
 * Recursively copy a directory tree, refusing symlinks (file or directory)
 * anywhere in the source. Directories are created as needed.
 */
export declare function copyDirNoFollow(src: string, dst: string): void;
//# sourceMappingURL=copy-guard.d.ts.map