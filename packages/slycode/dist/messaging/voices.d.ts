/**
 * ElevenLabs voice search — moved to tts/elevenlabs.ts (feature 087).
 * Thin re-exports so pre-087 callers keep their imports.
 */
export { type ElevenLabsVoice, searchElevenLabsVoices as searchVoices, searchElevenLabsVoicesStrict as searchVoicesStrict, } from './tts/elevenlabs.js';
export { VoicesUnavailableError } from './tts/errors.js';
