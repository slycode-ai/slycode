/**
 * Terminal Events — Custom event system for pushing prompts to the global terminal.
 * Used by conversion, compliance fix, and asset assistant flows.
 */

export interface TerminalPromptEvent {
  prompt: string;
  autoSubmit?: boolean;
}

const TERMINAL_PROMPT_EVENT = 'slycode:terminal-prompt';

/**
 * Dispatch a prompt to the global terminal.
 * The GlobalClaudePanel listens for this event and either:
 * - Sends input to a running session, or
 * - Starts a new session with the prompt
 */
export function pushToTerminal(prompt: string, autoSubmit = true): void {
  const event = new CustomEvent<TerminalPromptEvent>(TERMINAL_PROMPT_EVENT, {
    detail: { prompt, autoSubmit },
  });
  window.dispatchEvent(event);
}

/**
 * Listen for terminal prompt events.
 * Returns a cleanup function.
 */
export function onTerminalPrompt(
  callback: (event: TerminalPromptEvent) => void,
): () => void {
  const handler = (e: Event) => {
    const detail = (e as CustomEvent<TerminalPromptEvent>).detail;
    callback(detail);
  };
  window.addEventListener(TERMINAL_PROMPT_EVENT, handler);
  return () => window.removeEventListener(TERMINAL_PROMPT_EVENT, handler);
}
