import { execFile } from 'child_process';
import path from 'path';
import fs from 'fs/promises';

export type FileCategory = 'staged' | 'unstaged' | 'untracked';

export interface ChangedFile {
  status: string;
  path: string;
  category: FileCategory;
}

export interface GitStatus {
  branch: string | null;
  uncommitted: number;
  files: ChangedFile[];
}

/**
 * Get the current git branch, uncommitted file count, and changed file details.
 * Never throws — returns { branch: null, uncommitted: 0, files: [] } on any error.
 */
export async function getGitStatus(cwd: string): Promise<GitStatus> {
  const result: GitStatus = { branch: null, uncommitted: 0, files: [] };

  // Validate CWD exists
  try {
    await fs.access(cwd);
  } catch {
    return result;
  }

  // Run both git commands in parallel
  const [branch, filesData] = await Promise.all([
    gitBranch(cwd),
    gitChangedFiles(cwd),
  ]);

  result.branch = branch;
  result.files = filesData.files;
  result.uncommitted = filesData.uncommitted;
  return result;
}

function gitBranch(cwd: string): Promise<string | null> {
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

/**
 * Parse `git status --porcelain` output into structured file entries.
 *
 * Porcelain v1 format: XY filename
 *   X = staged status, Y = unstaged status
 *   ?? = untracked, !! = ignored
 *   Renamed: R  old -> new
 *
 * A file with changes in both index and worktree (e.g. MM) produces
 * two entries (one staged, one unstaged) but counts as one uncommitted file.
 */
function gitChangedFiles(cwd: string): Promise<{ files: ChangedFile[]; uncommitted: number }> {
  return new Promise((resolve) => {
    execFile('git', ['status', '--porcelain'], { cwd, timeout: 5000, windowsHide: true }, (err, stdout) => {
      if (err) {
        resolve({ files: [], uncommitted: 0 });
        return;
      }
      // trimEnd only — leading spaces are significant (X=' ' means not staged)
      const output = stdout.trimEnd();
      if (!output) {
        resolve({ files: [], uncommitted: 0 });
        return;
      }

      const lines = output.split('\n').filter(l => l.length > 0);
      const files: ChangedFile[] = [];
      const uniquePaths = new Set<string>();

      for (const line of lines) {
        if (line.length < 3) continue; // Minimum: "XYf" or "XY f"

        const x = line[0]; // staged status
        const y = line[1]; // unstaged status
        // Porcelain format is "XY PATH" (separator space at index 2).
        // Robustly handle edge cases where separator may be absent.
        const pathStart = line[2] === ' ' ? 3 : 2;
        const rawPath = line.slice(pathStart);

        // Extract the display path (for renames: "old -> new", use new)
        const filePath = rawPath.includes(' -> ')
          ? rawPath.split(' -> ')[1]
          : rawPath;

        if (x === '?' && y === '?') {
          // Untracked
          files.push({ status: '?', path: filePath, category: 'untracked' });
          uniquePaths.add(filePath);
        } else {
          // Staged change (X is not space and not ?)
          if (x !== ' ' && x !== '?') {
            files.push({ status: x, path: filePath, category: 'staged' });
            uniquePaths.add(filePath);
          }
          // Unstaged change (Y is not space)
          if (y !== ' ') {
            files.push({ status: y, path: filePath, category: 'unstaged' });
            uniquePaths.add(filePath);
          }
        }
      }

      resolve({ files, uncommitted: uniquePaths.size });
    });
  });
}
