/**
 * Save an image buffer to the screenshots/ directory in the given CWD.
 * Returns the filename (e.g., "screenshot_2026-02-24_153012.png").
 */
export declare function saveScreenshot(cwd: string, buffer: Buffer, mimeType: string): Promise<string>;
