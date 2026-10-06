/**
 * Marks UI that belongs to the Voice Settings popover but renders elsewhere
 * (the voice search panel, portalled to <body>): a click inside it must not
 * close the popover underneath (#0369).
 */
export const VOICE_SETTINGS_LAYER_ATTR = 'data-voice-settings-layer';
