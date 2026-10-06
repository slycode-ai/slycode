import { readWorkspaceEnvKey } from './workspace-env';

const KEY = 'SLYCODE_CLEARTEXT_WARNING';

/** True for the values that switch a setting off: off, 0, false (any case). */
export function isOffValue(value: string | null | undefined): boolean {
  const v = (value ?? '').trim().toLowerCase();
  return v === 'off' || v === '0' || v === 'false';
}

/**
 * SLYCODE_CLEARTEXT_WARNING=off hides the red plain-HTTP banner — for a
 * trusted network, or an instance with no password. Process env wins; the
 * workspace .env is the fallback. Default: the warning is on.
 */
export function isCleartextWarningDisabled(): boolean {
  return isOffValue(process.env[KEY] ?? readWorkspaceEnvKey(KEY));
}
