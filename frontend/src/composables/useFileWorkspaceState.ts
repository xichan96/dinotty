import type { EditorPaneLayout } from '../types/editorPane'
import type { DirEntry } from '../components/workspace/TreeRows'

/** Left-hand list shown by the files pane. */
export type FileWorkspaceLeftView = 'tree' | 'changes'

export interface PersistedFileWorkspaceState {
  editorLayout: EditorPaneLayout
  activeEditorLeafId: string | null
  childCache: Record<string, DirEntry[]>
  expanded: Set<string>
  cwdLabel: string
  /** Absent in states saved before the changes view existed (=> tree). */
  leftView?: FileWorkspaceLeftView
}

const store = new Map<string, PersistedFileWorkspaceState>()

export function saveFileWorkspaceState(paneId: string, state: PersistedFileWorkspaceState): void {
  store.set(paneId, state)
}

export function loadFileWorkspaceState(paneId: string): PersistedFileWorkspaceState | undefined {
  return store.get(paneId)
}

export function clearFileWorkspaceState(paneId: string): void {
  store.delete(paneId)
}

/**
 * Restore the left view independently of `applyState` (which is owned by the
 * boot composable and ignores this optional field). Unknown/older values fall
 * back to the tree so a stale state cannot leave the pane empty.
 */
export function loadFileWorkspaceLeftView(paneId: string): FileWorkspaceLeftView {
  return loadFileWorkspaceState(paneId)?.leftView === 'changes' ? 'changes' : 'tree'
}
