/**
 * Copy text to the clipboard, including on insecure origins.
 *
 * `navigator.clipboard` only exists in secure contexts (HTTPS or localhost).
 * SlyCode is often opened over plain HTTP on a tailnet address, where calling
 * it throws "Cannot read properties of undefined". Falls back to the legacy
 * execCommand('copy') path there, or when the async API rejects.
 */
export async function copyText(text: string): Promise<boolean> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // fall through to the legacy path
    }
  }
  const active = document.activeElement as HTMLElement | null;
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  }
  ta.remove();
  active?.focus?.();
  return ok;
}
