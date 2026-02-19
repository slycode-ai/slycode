import fs from 'fs/promises';
import path from 'path';
const MAX_SCREENSHOTS = 10;
function getExtension(mimeType) {
    if (mimeType.includes('jpeg') || mimeType.includes('jpg'))
        return 'jpg';
    if (mimeType.includes('gif'))
        return 'gif';
    if (mimeType.includes('webp'))
        return 'webp';
    return 'png';
}
function formatTimestamp() {
    const now = new Date();
    const y = now.getFullYear();
    const mo = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    const h = String(now.getHours()).padStart(2, '0');
    const mi = String(now.getMinutes()).padStart(2, '0');
    const s = String(now.getSeconds()).padStart(2, '0');
    return `${y}-${mo}-${d}_${h}${mi}${s}`;
}
/**
 * Save an image buffer to the screenshots/ directory in the given CWD.
 * Returns the filename (e.g., "screenshot_2026-02-24_153012.png").
 */
export async function saveScreenshot(cwd, buffer, mimeType) {
    const screenshotsDir = path.join(cwd, 'screenshots');
    await fs.mkdir(screenshotsDir, { recursive: true });
    const ext = getExtension(mimeType);
    const timestamp = formatTimestamp();
    let filename = `screenshot_${timestamp}.${ext}`;
    let filePath = path.join(screenshotsDir, filename);
    // Handle collision (same second)
    let suffix = 2;
    while (true) {
        try {
            await fs.access(filePath);
            // File exists — try next suffix
            filename = `screenshot_${timestamp}-${suffix}.${ext}`;
            filePath = path.join(screenshotsDir, filename);
            suffix++;
        }
        catch {
            // File doesn't exist — safe to use
            break;
        }
    }
    await fs.writeFile(filePath, buffer);
    await enforceRetention(screenshotsDir);
    await ensureGitignore(cwd);
    return filename;
}
/**
 * Keep only the newest MAX_SCREENSHOTS files in the directory.
 * Deletes oldest by mtime first.
 */
async function enforceRetention(dir) {
    const entries = await fs.readdir(dir);
    if (entries.length <= MAX_SCREENSHOTS)
        return;
    const stats = await Promise.all(entries.map(async (name) => {
        const filePath = path.join(dir, name);
        const stat = await fs.stat(filePath);
        return { name, filePath, mtime: stat.mtimeMs };
    }));
    // Sort oldest first
    stats.sort((a, b) => a.mtime - b.mtime);
    const toDelete = stats.slice(0, stats.length - MAX_SCREENSHOTS);
    for (const file of toDelete) {
        await fs.unlink(file.filePath).catch(() => { });
    }
}
/**
 * Ensure screenshots/ is in the project's .gitignore.
 */
async function ensureGitignore(cwd) {
    const gitignorePath = path.join(cwd, '.gitignore');
    try {
        const content = await fs.readFile(gitignorePath, 'utf-8');
        // Check if screenshots/ is already covered
        if (/^screenshots\/?$/m.test(content))
            return;
        // Append it
        const separator = content.endsWith('\n') ? '' : '\n';
        await fs.writeFile(gitignorePath, content + separator + 'screenshots/\n');
    }
    catch {
        // No .gitignore — create one
        await fs.writeFile(gitignorePath, 'screenshots/\n');
    }
}
//# sourceMappingURL=screenshot-utils.js.map