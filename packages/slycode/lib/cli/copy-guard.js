"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.copyFileNoFollow = copyFileNoFollow;
exports.copyDirNoFollow = copyDirNoFollow;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
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
function copyFileNoFollow(src, dst) {
    if (fs.lstatSync(src).isSymbolicLink())
        return false;
    fs.copyFileSync(src, dst);
    return true;
}
/**
 * Recursively copy a directory tree, refusing symlinks (file or directory)
 * anywhere in the source. Directories are created as needed.
 */
function copyDirNoFollow(src, dst) {
    fs.mkdirSync(dst, { recursive: true });
    for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
        const srcEntry = path.join(src, entry.name);
        const dstEntry = path.join(dst, entry.name);
        if (entry.isSymbolicLink())
            continue;
        if (entry.isDirectory()) {
            copyDirNoFollow(srcEntry, dstEntry);
        }
        else if (entry.isFile()) {
            fs.copyFileSync(srcEntry, dstEntry);
        }
    }
}
//# sourceMappingURL=copy-guard.js.map