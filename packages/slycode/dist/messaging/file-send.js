import fs from 'fs';
import path from 'path';
export class FileSendError extends Error {
    code;
    httpStatus;
    constructor(code, httpStatus, message) {
        super(message);
        this.code = code;
        this.httpStatus = httpStatus;
        this.name = 'FileSendError';
    }
}
export const MAX_BYTES = 50 * 1024 * 1024;
const EXT_TO_KIND = {
    '.ogg': 'voice',
    '.opus': 'voice',
    '.mp3': 'audio',
    '.m4a': 'audio',
    '.mp4': 'video',
    '.mov': 'video',
};
// Sensitive paths refused even with "trust any readable path" — checked
// against the resolved realpath so symlinks can't sneak past the guard.
export const SENSITIVE_PATH_PATTERNS = [
    /(?:^|\/)\.env(\..+)?$/,
    /(?:^|\/)id_(?:rsa|ecdsa|ed25519|dsa)(\.pub)?$/,
    /\/\.ssh\//,
    /\/\.aws\/credentials$/,
    /(?:^|\/)\.netrc$/,
    /\/\.docker\//,
    /\/\.kube\//,
    /^\/proc\//,
    /^\/dev\//,
    /^\/sys\//,
];
export function mediaKindFromExtension(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    return EXT_TO_KIND[ext] ?? null;
}
export function resolveSendKind(kind, asOverride) {
    if (asOverride === 'document')
        return 'document';
    return kind;
}
export async function preflightFile(input, callerCwd) {
    if (typeof input !== 'string' || input.length === 0) {
        throw new FileSendError('bad_request', 400, 'path must be a non-empty string');
    }
    // Relative paths resolve against the caller's CWD, not the service's.
    // Absolute paths are used as-is.
    const resolved = path.isAbsolute(input)
        ? input
        : (callerCwd && path.isAbsolute(callerCwd) ? path.resolve(callerCwd, input) : path.resolve(input));
    let absolutePath;
    try {
        absolutePath = await fs.promises.realpath(resolved);
    }
    catch (err) {
        const code = err.code;
        if (code === 'ENOENT')
            throw new FileSendError('file_not_found', 404, `File not found: ${input}`);
        throw new FileSendError('file_unreadable', 400, `Cannot resolve path: ${err.message}`);
    }
    for (const pattern of SENSITIVE_PATH_PATTERNS) {
        if (pattern.test(absolutePath)) {
            throw new FileSendError('denied_path', 403, `Refusing to send: path matches sensitive-location guard (${pattern})`);
        }
    }
    let stat;
    try {
        stat = await fs.promises.stat(absolutePath);
    }
    catch (err) {
        throw new FileSendError('file_unreadable', 400, `Cannot stat file: ${err.message}`);
    }
    if (!stat.isFile()) {
        throw new FileSendError('file_unreadable', 400, `Not a regular file: ${absolutePath}`);
    }
    if (stat.size > MAX_BYTES) {
        throw new FileSendError('file_too_large', 413, `File exceeds ${MAX_BYTES} bytes (got ${stat.size})`);
    }
    try {
        await fs.promises.access(absolutePath, fs.constants.R_OK);
    }
    catch {
        throw new FileSendError('file_unreadable', 400, `File is not readable: ${absolutePath}`);
    }
    return {
        absolutePath,
        bytes: stat.size,
        kind: mediaKindFromExtension(absolutePath),
    };
}
/**
 * Resolve a write target path and refuse the joint sensitive-path deny-list.
 *
 * The target file does NOT need to exist. To resist symlink-escape via an
 * existing ancestor, we walk up until we find an existing ancestor, run
 * realpath on it, then re-join the missing tail. The deny-list is then tested
 * against that effective resolved path.
 */
export async function preflightWritePath(input) {
    if (typeof input !== 'string' || input.length === 0) {
        throw new FileSendError('bad_request', 400, 'output path must be a non-empty string');
    }
    const absolute = path.resolve(input);
    // Walk up to find the first existing ancestor.
    let existingAncestor = absolute;
    const tail = [];
    while (true) {
        try {
            await fs.promises.access(existingAncestor);
            break;
        }
        catch {
            const parent = path.dirname(existingAncestor);
            if (parent === existingAncestor)
                break;
            tail.unshift(path.basename(existingAncestor));
            existingAncestor = parent;
        }
    }
    let effectivePath = absolute;
    try {
        const realAncestor = await fs.promises.realpath(existingAncestor);
        effectivePath = tail.length > 0 ? path.join(realAncestor, ...tail) : realAncestor;
    }
    catch {
        // realpath failed (e.g. /); fall back to the resolved-but-not-realpath'd form.
    }
    for (const pattern of SENSITIVE_PATH_PATTERNS) {
        if (pattern.test(effectivePath)) {
            throw new FileSendError('denied_path', 403, `Refusing to write: path matches sensitive-location guard (${pattern})`);
        }
    }
    return { absolutePath: absolute };
}
//# sourceMappingURL=file-send.js.map