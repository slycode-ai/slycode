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
export declare function getGitStatus(cwd: string): Promise<GitStatus>;
