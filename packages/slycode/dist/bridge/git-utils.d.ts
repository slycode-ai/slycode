export interface GitStatus {
    branch: string | null;
    uncommitted: number;
}
/**
 * Get the current git branch and uncommitted file count for a directory.
 * Never throws — returns { branch: null, uncommitted: 0 } on any error.
 */
export declare function getGitStatus(cwd: string): Promise<GitStatus>;
