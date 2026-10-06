/**
 * Pitch-preserving time-stretch (WSOLA) for speech PCM, feature 087.
 *
 * Used for the provider-neutral speaking speed (TTS_SPEED, falling back to
 * ELEVENLABS_SPEED) on providers with no speed control (Gemini). Chosen over a
 * pace instruction in Gemini's style prompt by a live check on 2026-10-01:
 * "about ten percent quicker" in the style made speech 1.20–1.30× faster and
 * varied run to run, while WSOLA at 1.1 measured 1.088× with no audible
 * artefacts (5/5 listening check). Coarse-then-fine search: ~0.8 s per 77 s of
 * audio on a loaded host.
 *
 * factor > 1 = faster/shorter, < 1 = slower/longer. 1 returns the input.
 */
import type { Pcm } from './audio-encode.js';
export declare function timeStretch(pcm: Pcm, factor: number): Pcm;
