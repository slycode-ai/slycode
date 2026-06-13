/**
 * Zero-impact migration for Feature 068's default-bind flip.
 *
 * The default `host` changed from `0.0.0.0` to `127.0.0.1`. Configs with an
 * explicit `host:` line are unaffected (resolveConfig prefers them). The only
 * at-risk case is a config that has NO explicit host key — flipping the default
 * would silently switch it to localhost and break remote access. This pins such
 * a config to the PRIOR default (`0.0.0.0`) so behaviour is preserved exactly.
 *
 * Idempotent: once host is explicit it never triggers again. Best-effort —
 * never throws into the start path.
 */
export declare function migrateLegacyHost(workspace: string): void;
export declare function config(args: string[]): Promise<void>;
//# sourceMappingURL=config.d.ts.map