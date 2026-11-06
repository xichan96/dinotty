import type { WorkspaceChangeFile, WorkspaceChangeStatus } from '../types/workspaceChanges'

/** Files that live in one directory, with the directory chain to display. */
export interface ChangesGroup {
  /** cwd-relative directory; `''` for files at the workspace root. */
  dir: string
  files: WorkspaceChangeFile[]
}

interface DirNode {
  files: WorkspaceChangeFile[]
  dirs: Map<string, DirNode>
}

function emptyNode(): DirNode {
  return { files: [], dirs: new Map() }
}

function sortFiles(files: WorkspaceChangeFile[]): WorkspaceChangeFile[] {
  return [...files].sort((a, b) => a.path.localeCompare(b.path))
}

/**
 * Group a flat change list by directory, collapsing single-child directory
 * chains so `src/components/ui` renders as one header instead of three
 * one-row levels. Groups and files are sorted by path for a stable list.
 */
export function groupChangesByDirectory(files: WorkspaceChangeFile[]): ChangesGroup[] {
  const root = emptyNode()
  for (const file of files) {
    const parts = file.path.split('/').filter(Boolean)
    const name = parts.pop()
    if (!name) continue
    let node = root
    for (const part of parts) {
      let child = node.dirs.get(part)
      if (!child) {
        child = emptyNode()
        node.dirs.set(part, child)
      }
      node = child
    }
    node.files.push(file)
  }

  const out: ChangesGroup[] = []

  function visit(node: DirNode, prefix: string): void {
    if (node.files.length || node.dirs.size !== 1) {
      // A directory that holds files (or branches) is its own group; a chain
      // with no files would otherwise leave an empty header in the list.
      if (node.files.length) out.push({ dir: prefix, files: sortFiles(node.files) })
      for (const [name, child] of [...node.dirs.entries()].sort(([a], [b]) => a.localeCompare(b))) {
        visit(child, prefix ? `${prefix}/${name}` : name)
      }
      return
    }
    // No files and exactly one child: merge the chain into one group header.
    const [name, child] = [...node.dirs.entries()][0]
    visit(child, prefix ? `${prefix}/${name}` : name)
  }

  visit(root, '')
  return out
}

const STATUS_LETTERS: Record<WorkspaceChangeStatus, string> = {
  modified: 'M',
  added: 'A',
  deleted: 'D',
  renamed: 'R',
  untracked: 'U',
  conflicted: '!',
  typechange: 'T',
}

/** Single-character porcelain-style marker used in the list rows. */
export function changeStatusLetter(file: WorkspaceChangeFile): string {
  if (file.conflicted) return '!'
  return STATUS_LETTERS[file.status] ?? 'M'
}

/** True when the change has an index-side (staged) component. */
export function isStagedChange(file: WorkspaceChangeFile): boolean {
  return (file.index_status ?? '').trim() !== ''
}

export function countStagedChanges(files: WorkspaceChangeFile[]): number {
  return files.reduce((n, file) => (isStagedChange(file) ? n + 1 : n), 0)
}

/** `+12` / `—`; null means the backend skipped counting (binary, capped). */
export function formatChangeCount(value: number | null, sign: '+' | '-'): string {
  return value == null ? '—' : `${sign}${value}`
}
