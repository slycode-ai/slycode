import { execFile } from 'child_process';
import fs from 'fs/promises';
/**
 * Get the current git branch and uncommitted file count for a directory.
 * Never throws — returns { branch: null, uncommitted: 0 } on any error.
 */
export async function getGitStatus(cwd) {
    const result = { branch: null, uncommitted: 0 };
    // Validate CWD exists
    try {
        await fs.access(cwd);
    }
    catch {
        return result;
    }
    // Run both git commands in parallel
    const [branch, uncommitted] = await Promise.all([
        gitBranch(cwd),
        gitUncommitted(cwd),
    ]);
    result.branch = branch;
    result.uncommitted = uncommitted;
    return result;
}
function gitBranch(cwd) {
    return new Promise((resolve) => {
        execFile('git', ['symbolic-ref', '--short', 'HEAD'], { cwd, timeout: 5000, windowsHide: true }, (err, stdout) => {
            if (err) {
                resolve(null);
                return;
            }
            const branch = stdout.trim();
            resolve(branch || null);
        });
    });
}
function gitUncommitted(cwd) {
    return new Promise((resolve) => {
        execFile('git', ['status', '--porcelain'], { cwd, timeout: 5000, windowsHide: true }, (err, stdout) => {
            if (err) {
                resolve(0);
                return;
            }
            const lines = stdout.trim();
            resolve(lines ? lines.split('\n').length : 0);
        });
    });
}
//# sourceMappingURL=git-utils.js.map