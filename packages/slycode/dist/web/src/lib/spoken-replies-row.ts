/**
 * The "Spoken replies" row in Voice Settings (#0369 owner feedback): status
 * text plus a switch that drives the SAME speaker permission as the speaker
 * button by the mic (useSpeakerController.setEnabled). The switch follows the
 * button's rule: turning sound OFF is always allowed (an outage can never trap
 * it on); turning it ON is blocked while spoken replies are unavailable.
 */

export interface SpokenRepliesInput {
  /** null until the bridge has reported once. */
  enabled: boolean | null;
  available: boolean;
  messagingRunning: boolean | null;
  ttsReason: string | null | undefined;
}

export interface SpokenRepliesRow {
  dot: 'pending' | 'ok' | 'warn';
  text: string;
  /** null while the state is unknown (nothing to switch yet). */
  toggle: { checked: boolean; disabled: boolean } | null;
}

export const SPEAKER_ON_TEXT = 'On: agents may speak in the browser';
export const SPEAKER_OFF_TEXT = 'Off: agents stay silent';

export function spokenRepliesRow(s: SpokenRepliesInput): SpokenRepliesRow {
  if (s.enabled === null) return { dot: 'pending', text: 'Checking the voice service…', toggle: null };
  const toggle = { checked: s.enabled, disabled: !s.available && !s.enabled };
  if (s.available) return { dot: 'ok', text: s.enabled ? SPEAKER_ON_TEXT : SPEAKER_OFF_TEXT, toggle };
  // Unavailable states keep their wording; only the switch is new.
  const text = s.messagingRunning === false
    ? 'Unavailable: the messaging service is off. Start it to allow spoken replies.'
    : `Unavailable: ${s.ttsReason ?? 'the voice provider is not set up. Check the TTS keys in the messaging .env, then restart the messaging service.'}`;
  return { dot: 'warn', text, toggle };
}
