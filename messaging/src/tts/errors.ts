/** Render and provider errors shared by tts.ts, tts-render.ts and the adapters (feature 087). */

/** Thrown when a render (queue wait + provider call + encode) exceeds the caller's deadline. */
export class RenderTimeoutError extends Error {
  constructor(ms: number) {
    super(`TTS render timed out after ${ms}ms`);
    this.name = 'RenderTimeoutError';
  }
}

/** Thrown when the caller abandoned the request (client disconnected) before or during the render. */
export class RenderCancelledError extends Error {
  constructor() {
    super('render cancelled by caller');
    this.name = 'RenderCancelledError';
  }
}

/** Provider-level failure with a stable code the routes map to HTTP errors. */
export class TtsProviderError extends Error {
  constructor(public readonly code: string, message: string, public readonly status = 400) {
    super(message);
    this.name = 'TtsProviderError';
  }
}

/** Thrown by strict voice searches when the provider cannot be reached or errors. */
export class VoicesUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VoicesUnavailableError';
  }
}

/** A failed voice lookup, with candidates the caller can show (rows are VoiceInfo). */
export class VoiceLookupError extends TtsProviderError {
  constructor(code: 'voice_not_found' | 'voice_ambiguous', message: string, readonly candidates: Array<{ voice_id: string; name: string; category: string; description?: string; labels?: Record<string, string>; expiresAt?: string }>) {
    super(code, message, code === 'voice_not_found' ? 404 : 409);
    this.name = 'VoiceLookupError';
  }
}

/**
 * A designed (custom) voice that can no longer be rendered: expired by its
 * stored date, or gone at the provider. Routes rewrite the message with the
 * fix, suggesting `--recreate` only when a local recipe exists (feature 087
 * phase 4).
 */
export class VoiceUnusableError extends TtsProviderError {
  constructor(
    readonly why: 'expired' | 'missing',
    readonly voice: { id: string; name: string; expiresAt?: string },
    message: string,
  ) {
    super(why === 'expired' ? 'voice_expired' : 'voice_not_found', message, why === 'expired' ? 410 : 404);
    this.name = 'VoiceUnusableError';
  }
}
