/**
 * Gemini voice cloning consent statements (#0376), verbatim from Google's
 * voice-replication docs (checked 2026-10-05). The consent recording must be
 * the same person as the sample, reading one of these exactly.
 *
 * LOCKSTEP: web/src/lib/consent-statements.ts holds an identical copy from
 * the `export` line down (the web shows the text; messaging validates the
 * locale). Change both or neither.
 */
export interface ConsentStatement {
    locale: string;
    language: string;
    statement: string;
}
export declare const CONSENT_STATEMENTS: ReadonlyArray<ConsentStatement>;
/** Locale when none is chosen. */
export declare const DEFAULT_CONSENT_LOCALE = "en-US";
/** The statement for a locale (case-insensitive), or null when Google doesn't support it. */
export declare function consentFor(locale: string | null | undefined): ConsentStatement | null;
/**
 * The best consent locale for a language or accent code: an exact match
 * ("en-AU"), else the first locale of that language ("en" → en-US), else the
 * default.
 */
export declare function consentLocaleFor(code: string | null | undefined): string;
/** Sample (reference) take: Google needs 10–30 s of natural speech. */
export declare const CLONE_SAMPLE_SECONDS: {
    readonly min: 10;
    readonly max: 30;
};
/** Consent take: long enough for the statement, short enough to stay one take. */
export declare const CLONE_CONSENT_SECONDS: {
    readonly min: 3;
    readonly max: 20;
};
/** Slack for encoder rounding at either end. */
export declare const CLONE_SECONDS_TOLERANCE = 0.25;
