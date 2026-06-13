import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { getStateDir, ensureStateDir } from './workspace';

/**
 * `slycode reset-password` (Feature 068).
 *
 * Clears the web dashboard password from ~/.slycode/auth.json and bumps the
 * token version so every existing session cookie is immediately invalidated.
 * On the next visit the dashboard shows the first-run "create a password"
 * screen again. This is the local escape hatch — it never needs network access,
 * so the owner can never be permanently locked out.
 *
 * Mirrors the auth.json shape written by web/src/lib/auth.ts. Keep in lockstep.
 */

interface AuthFile {
  schemaVersion?: number;
  passwordHash?: string | null;
  sessionSecret?: string | null;
  tokenVersion?: number;
  lockouts?: Record<string, unknown>;
}

export async function resetPassword(_args: string[]): Promise<void> {
  ensureStateDir();
  const authPath = path.join(getStateDir(), 'auth.json');

  let data: AuthFile = {};
  if (fs.existsSync(authPath)) {
    try {
      data = JSON.parse(fs.readFileSync(authPath, 'utf-8'));
    } catch {
      // Corrupt file — overwrite with a clean first-run state below.
      data = {};
    }
  }

  if (!data.passwordHash && fs.existsSync(authPath)) {
    console.log('No password is currently set — the dashboard will show the setup screen on next visit.');
    return;
  }

  const next: AuthFile = {
    schemaVersion: data.schemaVersion ?? 1,
    passwordHash: null,
    // Rotate the HMAC key alongside the version bump: defense-in-depth so a
    // previously-leaked sessionSecret cannot sign tokens for the new tokenVersion.
    // Mirrors clearPassword() in web/src/lib/auth.ts — keep in lockstep.
    sessionSecret: crypto.randomBytes(32).toString('hex'),
    tokenVersion: (data.tokenVersion ?? 0) + 1,
    lockouts: {},
  };

  const tmp = `${authPath}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, authPath);
  try {
    fs.chmodSync(authPath, 0o600);
  } catch {
    /* best effort */
  }

  console.log('Password cleared. All existing dashboard sessions have been signed out.');
  console.log('Open the dashboard to set a new password.');
}
