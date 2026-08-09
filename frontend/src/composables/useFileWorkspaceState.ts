import type { EditorPaneLayout } from '../types/editorPane'
import type { DirEntry } from '../components/workspace/TreeRows'

export interface PersistedFileWorkspaceState {
  editorLayout: EditorPaneLayout
  activeEditorLeafId: string | null
  childCache: Record<string, DirEntry[]>
  expanded: Set<string>
  cwdLabel: string
}

const store = new Map<string, PersistedFileWorkspaceState>()

export function saveFileWorkspaceState(
  paneId: string,
  state: PersistedFileWorkspaceState,
): void {
  store.set(paneId, state)
}

export function loadFileWorkspaceState(
  paneId: string,
): PersistedFileWorkspaceState | undefined {
  return store.get(paneId)
}

export function clearFileWorkspaceState(paneId: string): void {
  store.delete(paneId)
}
