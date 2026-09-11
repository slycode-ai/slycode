/**
 * Session-name parsing (feature 086).
 *
 * Single home for the session-name grammar the bridge uses. Shapes seen in
 * the wild (see web/src/lib/session-keys.ts sessionNameFor and
 * SessionManager.toLegacySessionName):
 *
 *   {project}:{provider}:card:{cardId}   current card terminal
 *   {project}:card:{cardId}              legacy (pre multi-provider)
 *   {project}:{provider}:global          current project terminal
 *   {project}:global                     legacy
 *   {project}:{provider}:atlas           Code Mode atlas terminal (feature 076)
 *   {project}:atlas                      legacy atlas
 *   action-assistant:global              Sly action config assistant
 *
 * messaging/src/bridge-client.ts carries the same card regex; keep in step.
 */
export type SessionKind = 'card' | 'global' | 'atlas' | 'action' | 'unknown';
export interface ParsedSessionName {
    projectKey: string;
    provider?: string;
    kind: SessionKind;
    cardId?: string;
}
export declare function parseSessionName(name: string): ParsedSessionName;
/**
 * Rate-limit bucket key. Keeps PROVIDER identity (a card's claude and codex
 * terminals are different agents with their own allowance — one must never
 * block the other) while collapsing true aliases: the bridge resolves legacy
 * provider-less names to the live session before calling this, and a
 * reconnect/recreate of the same session name lands on the same key. A
 * provider-less legacy name is its own identity (`<project>:legacy:...`).
 */
export declare function canonicalRateKey(name: string): string;
export interface SourceLabelHints {
    cardNumber?: string | number;
    cardTitle?: string;
    projectName?: string;
}
/** Human label for the speech bubble: "#0348 · title", "proj · global terminal". */
export declare function sourceLabel(parsed: ParsedSessionName, hints?: SourceLabelHints): string;
