/**
 * Cooperative contracts for the "changes" view of the files pane.
 *
 * Response shapes intentionally mirror the backend JSON (snake_case) so the
 * list and diff viewers can consume `/git-changes` and `/git-file-diff`
 * without a mapping layer. Keep this file dependency-free: both feature
 * branches (list shell + diff view) build against it.
 */

export type WorkspaceChangeStatus =
  | 'modified'
  | 'added'
  | 'deleted'
  | 'renamed'
  | 'untracked'
  | 'conflicted'
  | 'typechange'

export interface WorkspaceChangeFile {
  /** Path relative to the pane cwd, matching `EditorTab.filePath`. */
  path: string
  /** Previous path for renames, also cwd-relative. */
  orig_path: string | null
  /** Porcelain XY columns. Empty string means "no change in that area". */
  index_status: string
  worktree_status: string
  status: WorkspaceChangeStatus
  /** `null` when line counting was skipped (binary, too large, truncated). */
  additions: number | null
  deletions: number | null
  binary: boolean
  conflicted: boolean
  submodule: boolean
}

export interface WorkspaceChangesSummary {
  files: number
  additions: number
  deletions: number
  /** False when some untracked files could not be counted within the caps. */
  counts_complete: boolean
  /** True when the file list itself was capped. */
  truncated: boolean
}

export interface WorkspaceChangesResponse {
  is_git_repo: boolean
  repo_root: string | null
  head: string | null
  summary: WorkspaceChangesSummary
  files: WorkspaceChangeFile[]
}

export interface WorkspaceGitFileDiffResponse {
  is_git_repo: boolean
  path: string
  orig_path: string | null
  /** Currently always "head"; kept explicit for future index/worktree modes. */
  base: string
  original: string | null
  modified: string | null
  binary: boolean
  too_large: boolean
  submodule: boolean
  conflicted: boolean
}

/** What an editor leaf is currently showing as a diff. */
export interface DiffTarget {
  /** cwd-relative path; must match the active tab's filePath. */
  path: string
  origPath: string | null
  status: WorkspaceChangeStatus
  conflicted: boolean
}
