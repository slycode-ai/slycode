export type MediaKind = 'voice' | 'audio' | 'video';
export type SendKind = MediaKind | 'document';
export type FileSendErrorCode = 'bad_request' | 'file_not_found' | 'file_unreadable' | 'file_too_large' | 'unsupported_media_type' | 'denied_path';
export declare class FileSendError extends Error {
    code: FileSendErrorCode;
    httpStatus: number;
    constructor(code: FileSendErrorCode, httpStatus: number, message: string);
}
export declare const MAX_BYTES: number;
export declare const SENSITIVE_PATH_PATTERNS: RegExp[];
export declare function mediaKindFromExtension(filePath: string): MediaKind | null;
export declare function resolveSendKind(kind: MediaKind | null, asOverride?: 'document'): SendKind | null;
export declare function preflightFile(input: string, callerCwd?: string): Promise<{
    absolutePath: string;
    bytes: number;
    kind: MediaKind | null;
}>;
/**
 * Resolve a write target path and refuse the joint sensitive-path deny-list.
 *
 * The target file does NOT need to exist. To resist symlink-escape via an
 * existing ancestor, we walk up until we find an existing ancestor, run
 * realpath on it, then re-join the missing tail. The deny-list is then tested
 * against that effective resolved path.
 */
export declare function preflightWritePath(input: string): Promise<{
    absolutePath: string;
}>;
