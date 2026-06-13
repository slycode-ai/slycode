/**
 * Web UI auth core (Feature 068).
 *
 * Single-password gate for the SlyCode dashboard. Implements Option B from
 * documentation/designs/cross_service_auth_layer.md: the web UI is the only
 * gated surface — bridge and messaging stay localhost-only and untouched, and
 * automations talk to the local bridge directly so nothing here can lock them out.
 *
 * Zero new dependencies: password hashing uses node:crypto scrypt, session
 * tokens are HMAC-SHA256 signed. The credential lives in ~/.slycode/auth.json
 * (mode 600), outside the repo and independent of the workspace.
 *
 * Designed around a Principal/Session abstraction so the future paid "Teams"
 * add-on (multi-user, per-project RBAC) can implement the same interface rather
 * than replacing this. The single shared password is the v1 implementation.
 */

import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';

// ---- Locations -------------------------------------------------------------

const SLYCODE_DIR = path.join(os.homedir(), '.slycode');
const AUTH_FILE = path.join(SLYCODE_DIR, 'auth.json');

// ---- Tunables --------------------------------------------------------------

export const SESSION_COOKIE = 'sly_session';
/** ~30 days. User confirmed: nothing breaks on expiry, only a UI re-login. */
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** scrypt params (N, r, p) + derived key length. */
const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEYLEN = 64;

/** Lockout: temporary and auto-expiring — never permanent. */
const LOCKOUT_THRESHOLD = 8; // consecutive failures before a cooldown kicks in
const LOCKOUT_COOLDOWN_MS = 15 * 60 * 1000; // 15 min, auto-passes
/** Per-failure backoff delay (ms), capped — slows scripted guessing. */
const BACKOFF_BASE_MS = 250;
const BACKOFF_MAX_MS = 4000;

// ---- Types -----------------------------------------------------------------

/**
 * A authenticated principal. v1 is always the single shared local operator.
 * The Teams add-on will return per-user principals from the same call sites.
 */
export interface Principal {
  id: string; // 'local' in v1
  kind: 'local';
}

export interface Session {
  principal: Principal;
  issuedAt: number;
  expiresAt: number;
}

interface LockoutEntry {
  count: number;
  lockedUntil: number; // epoch ms; 0 = not locked
}

interface AuthFile {
  schemaVersion: number;
  /** scrypt-format string, or null when no password is set (first-run state). */
  passwordHash: string | null;
  /** HMAC key for session tokens; generated when the first password is set. */
  sessionSecret: string | null;
  /** Bumped on password set/change/reset → invalidates all existing cookies. */
  tokenVersion: number;
  /** Per-source-IP failure tracking (keeps a remote brute-forcer from DoSing the local user). */
  lockouts: Record<string, LockoutEntry>;
}

const EMPTY_AUTH: AuthFile = {
  schemaVersion: 1,
  passwordHash: null,
  sessionSecret: null,
  tokenVersion: 1,
  lockouts: {},
};

const LOCAL_PRINCIPAL: Principal = { id: 'local', kind: 'local' };

// ---- File IO (mtime-cached for middleware hot path) ------------------------

let cache: { mtimeMs: number; data: AuthFile } | null = null;

function readAuthFile(): AuthFile {
  try {
    const stat = fs.statSync(AUTH_FILE);
    if (cache && cache.mtimeMs === stat.mtimeMs) return cache.data;
    const raw = fs.readFileSync(AUTH_FILE, 'utf-8');
    const parsed = { ...EMPTY_AUTH, ...(JSON.parse(raw) as Partial<AuthFile>) };
    if (!parsed.lockouts) parsed.lockouts = {};
    cache = { mtimeMs: stat.mtimeMs, data: parsed };
    return parsed;
  } catch {
    // Missing or corrupt → treat as first-run (NEVER fail-open to the dashboard).
    return { ...EMPTY_AUTH, lockouts: {} };
  }
}

function writeAuthFile(data: AuthFile): void {
  fs.mkdirSync(SLYCODE_DIR, { recursive: true });
  const tmp = `${AUTH_FILE}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, AUTH_FILE);
  try {
    fs.chmodSync(AUTH_FILE, 0o600);
  } catch {
    /* best effort on platforms without chmod */
  }
  cache = null; // invalidate; next read re-stats
}

// ---- Password state --------------------------------------------------------

export function isPasswordSet(): boolean {
  return !!readAuthFile().passwordHash;
}

function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16);
  const derived = crypto.scryptSync(password, salt, SCRYPT_KEYLEN, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
  });
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString('hex')}$${derived.toString('hex')}`;
}

function verifyPassword(password: string, stored: string): boolean {
  try {
    const [scheme, nStr, rStr, pStr, saltHex, hashHex] = stored.split('$');
    if (scheme !== 'scrypt') return false;
    const salt = Buffer.from(saltHex, 'hex');
    const expected = Buffer.from(hashHex, 'hex');
    const derived = crypto.scryptSync(password, salt, expected.length, {
      N: parseInt(nStr, 10),
      r: parseInt(rStr, 10),
      p: parseInt(pStr, 10),
    });
    return derived.length === expected.length && crypto.timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}

/**
 * First-run password creation. Refuses if a password already exists (callers
 * must use changePassword instead). Generates the session secret.
 */
export function setInitialPassword(password: string): void {
  const data = readAuthFile();
  if (data.passwordHash) throw new Error('Password already set');
  data.passwordHash = hashPassword(password);
  data.sessionSecret = crypto.randomBytes(32).toString('hex');
  data.tokenVersion = (data.tokenVersion || 0) + 1;
  data.lockouts = {};
  writeAuthFile(data);
}

// ---- Session tokens (HMAC-SHA256, no deps) ---------------------------------

function b64url(buf: Buffer | string): string {
  return Buffer.from(buf).toString('base64url');
}

function sign(payloadB64: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(payloadB64).digest('base64url');
}

/** Mint a signed session token for the (single, v1) local principal. */
export function createSessionToken(now = Date.now()): string {
  const data = readAuthFile();
  if (!data.sessionSecret) throw new Error('No session secret — set a password first');
  const payload = { v: data.tokenVersion, iat: now, exp: now + SESSION_TTL_MS };
  const payloadB64 = b64url(JSON.stringify(payload));
  return `${payloadB64}.${sign(payloadB64, data.sessionSecret)}`;
}

export interface VerifyResult {
  session: Session | null;
  reason?: 'no_password' | 'malformed' | 'bad_signature' | 'expired' | 'stale_version';
}

export function verifySessionToken(token: string | undefined, now = Date.now()): VerifyResult {
  const data = readAuthFile();
  if (!data.passwordHash || !data.sessionSecret) return { session: null, reason: 'no_password' };
  if (!token) return { session: null, reason: 'malformed' };
  const dot = token.lastIndexOf('.');
  if (dot < 0) return { session: null, reason: 'malformed' };
  const payloadB64 = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expectedSig = sign(payloadB64, data.sessionSecret);
  // constant-time compare
  const a = Buffer.from(sig);
  const b = Buffer.from(expectedSig);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return { session: null, reason: 'bad_signature' };
  }
  let payload: { v: number; iat: number; exp: number };
  try {
    payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf-8'));
  } catch {
    return { session: null, reason: 'malformed' };
  }
  if (payload.v !== data.tokenVersion) return { session: null, reason: 'stale_version' };
  if (now >= payload.exp) return { session: null, reason: 'expired' };
  return {
    session: { principal: LOCAL_PRINCIPAL, issuedAt: payload.iat, expiresAt: payload.exp },
  };
}

// ---- Lockout (temporary, auto-expiring) ------------------------------------
//
// SINGLE GLOBAL COUNTER (intentional). SlyCode is a single-user application,
// so there is no meaningful concept of "lock out this attacker but let the
// real owner through" — they're the same person. Tracking failures per-IP
// would also be defeated by X-Forwarded-For spoofing on any deployment where
// the web port is reachable outside a trusted proxy: an attacker could rotate
// the header per request and never trigger the lockout. By keying everything
// to a fixed 'global' bucket, the lockout applies to the whole installation
// regardless of what headers say, and the bug is closed by construction.
//
// The `ip` parameter is preserved on the public API so login route + tests
// don't need to change; it is intentionally ignored.

const GLOBAL_LOCKOUT_KEY = 'global';

/** ms a caller should be delayed before its attempt is processed (backoff). */
export function backoffDelayMs(_ip: string): number {
  const e = readAuthFile().lockouts[GLOBAL_LOCKOUT_KEY];
  if (!e || e.count <= 1) return 0;
  return Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** (e.count - 1));
}

export function isLockedOut(_ip: string, now = Date.now()): boolean {
  const e = readAuthFile().lockouts[GLOBAL_LOCKOUT_KEY];
  return !!e && e.lockedUntil > now;
}

export function lockedUntil(_ip: string): number {
  return readAuthFile().lockouts[GLOBAL_LOCKOUT_KEY]?.lockedUntil ?? 0;
}

export function recordFailure(_ip: string, now = Date.now()): void {
  const data = readAuthFile();
  const e = data.lockouts[GLOBAL_LOCKOUT_KEY] ?? { count: 0, lockedUntil: 0 };
  e.count += 1;
  if (e.count >= LOCKOUT_THRESHOLD) e.lockedUntil = now + LOCKOUT_COOLDOWN_MS;
  data.lockouts[GLOBAL_LOCKOUT_KEY] = e;
  writeAuthFile(data);
}

/** Reset failure state — called on any successful login. */
export function clearFailures(_ip: string): void {
  const data = readAuthFile();
  if (data.lockouts[GLOBAL_LOCKOUT_KEY]) {
    delete data.lockouts[GLOBAL_LOCKOUT_KEY];
    writeAuthFile(data);
  }
}

// ---- Verify a password attempt (lockout-aware) -----------------------------

export interface AttemptResult {
  ok: boolean;
  locked?: boolean;
  retryAfterMs?: number;
}

/**
 * Verify a login attempt for the single shared password, applying lockout.
 * Returns ok=true on success (and clears failures), locked=true if currently
 * cooling down. The caller sets the cookie on ok.
 */
export function verifyLoginAttempt(password: string, ip: string, now = Date.now()): AttemptResult {
  if (isLockedOut(ip, now)) {
    return { ok: false, locked: true, retryAfterMs: lockedUntil(ip) - now };
  }
  const data = readAuthFile();
  if (!data.passwordHash) return { ok: false };
  if (verifyPassword(password, data.passwordHash)) {
    clearFailures(ip);
    return { ok: true };
  }
  recordFailure(ip, now);
  return { ok: false, locked: isLockedOut(ip, now), retryAfterMs: lockedUntil(ip) - now };
}

// ---- Reset (used by `slycode reset-password`, also importable) -------------

/** Clear the password + bump token version → first-run screen + all cookies dead. */
export function clearPassword(): void {
  const data = readAuthFile();
  data.passwordHash = null;
  // Rotate the HMAC key alongside the version bump: defense-in-depth so a
  // previously-leaked sessionSecret cannot sign tokens for the new tokenVersion.
  data.sessionSecret = crypto.randomBytes(32).toString('hex');
  data.tokenVersion = (data.tokenVersion || 0) + 1;
  data.lockouts = {};
  writeAuthFile(data);
}

export const _internal = { AUTH_FILE, hashPassword, verifyPassword };
