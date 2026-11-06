/**
 * Pure helpers for the full-file diff view.
 *
 * Kept free of Monaco and Vue so the layout / navigation decisions can be
 * unit-tested under happy-dom, where the real diff editor cannot run.
 */
import type { DiffTarget, WorkspaceChangeStatus } from '../types/workspaceChanges'

/** Below this container width the diff view stays in inline (unified) mode. */
export const SIDE_BY_SIDE_MIN_WIDTH = 900

/** Short porcelain-style letter shown in the diff header. */
export function statusLetter(status: WorkspaceChangeStatus): string {
  switch (status) {
    case 'added':
    case 'untracked':
      return 'A'
    case 'deleted':
      return 'D'
    case 'renamed':
      return 'R'
    case 'conflicted':
      return 'U'
    case 'typechange':
      return 'T'
    case 'modified':
      return 'M'
    default:
      return '?'
  }
}

export type DiffSpecialState = 'binary' | 'too_large' | 'submodule' | 'conflicted'

interface DiffSpecialFlags {
  binary: boolean
  too_large: boolean
  submodule: boolean
  conflicted: boolean
}

/**
 * States that cannot be rendered as a text diff. Order matters: a binary file
 * that is also flagged `too_large` should explain "binary", not "too large".
 */
export function resolveDiffSpecialState(
  data: DiffSpecialFlags | null | undefined
): DiffSpecialState | null {
  if (!data) return null
  if (data.binary) return 'binary'
  if (data.too_large) return 'too_large'
  if (data.submodule) return 'submodule'
  if (data.conflicted) return 'conflicted'
  return null
}

export function specialStateMessageKey(state: DiffSpecialState): string {
  switch (state) {
    case 'binary':
      return 'workspaceChanges.binary'
    case 'too_large':
      return 'workspaceChanges.tooLarge'
    case 'submodule':
      return 'workspaceChanges.submodule'
    case 'conflicted':
      return 'workspaceChanges.conflicted'
  }
}

/** Only files that still exist as editable text are worth opening in the editor. */
export function specialStateCanOpenInEditor(state: DiffSpecialState): boolean {
  return state === 'too_large' || state === 'conflicted'
}

/** `-1` means "no hunk selected yet". */
export function clampHunkIndex(index: number, total: number): number {
  if (total <= 0) return -1
  if (!Number.isFinite(index)) return 0
  return Math.min(Math.max(Math.trunc(index), 0), total - 1)
}

/**
 * Move the hunk cursor, clamping at both ends. From "nothing selected" (-1)
 * `next` lands on the first hunk and `prev` on the last.
 */
export function stepHunkIndex(current: number, total: number, direction: 1 | -1): number {
  if (total <= 0) return -1
  if (current < 0) return direction === 1 ? 0 : total - 1
  return clampHunkIndex(current + direction, total)
}

/** Line to reveal in the modified editor for a hunk (deletions anchor at +1). */
export function hunkRevealLine(change: { modifiedStartLineNumber: number }): number {
  const line = Math.trunc(change.modifiedStartLineNumber)
  return Number.isFinite(line) && line > 0 ? line : 1
}

/** True when both sides are identical (ignoring `null`), i.e. no review needed. */
export function sameDiffContent(original: string | null, modified: string | null): boolean {
  return (original ?? '') === (modified ?? '')
}

/** Query for `GET /api/workspace/git-file-diff`. */
export function buildDiffQuery(
  paneId: string,
  target: Pick<DiffTarget, 'path' | 'origPath'>,
  base = 'head'
): URLSearchParams {
  return new URLSearchParams({
    pane_id: paneId,
    path: target.path,
    orig_path: target.origPath ?? '',
    base,
  })
}
