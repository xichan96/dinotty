import type { Ref } from 'vue'
import { apiUrl, authFetch, getApiBase } from './apiBase'
import {
  loadFileWorkspaceState,
  saveFileWorkspaceState,
  type PersistedFileWorkspaceState,
} from './useFileWorkspaceState'
import type { DirEntry } from '../components/workspace/TreeRows'

export interface FileWorkspaceBootOptions {
  paneId: Ref<string>
  sourcePaneId: Ref<string | undefined>
  visible: Ref<boolean>
  shellType: Ref<string | undefined>
  initialPath: Ref<string | undefined>
  childCache: Ref<Record<string, DirEntry[]>>
  expanded: Ref<Set<string>>
  cwdLabel: Ref<string>
  previewErr: Ref<string>
  meta: Ref<any>
  selectedRel: Ref<string | null>
  selectedIsDir: Ref<boolean>
  inlineCreate: Ref<{ parentRel: string; kind: 'file' | 'dir' } | null>
  contextMenu: Ref<any>
  editorLayout: Ref<any>
  activeEditorLeafId: Ref<string | null>
  activeLeaf: Ref<any>
  ensureChildren: (rel: string) => Promise<void>
  onSelectFile: (rel: string) => Promise<void> | void
  onSelectDir: (rel: string) => void
  connectTreeWatchSocket: () => void
  disconnectTreeWatchSocket: () => void
  fetchGitStatus: () => Promise<void>
}

export interface FileWorkspaceBoot {
  reloadAll: () => Promise<void>
  expandFirstLevelDirs: () => Promise<void>
  captureState: () => PersistedFileWorkspaceState
  applyState: (s: PersistedFileWorkspaceState) => void
  boot: () => Promise<void>
  openFromTerminal: (path: string) => Promise<void>
}

export function useFileWorkspaceBoot(opts: FileWorkspaceBootOptions): FileWorkspaceBoot {
  const {
    paneId,
    sourcePaneId,
    shellType,
    initialPath,
    childCache,
    expanded,
    cwdLabel,
    previewErr,
    meta,
    selectedRel,
    selectedIsDir,
    inlineCreate,
    contextMenu,
    editorLayout,
    activeEditorLeafId,
    activeLeaf,
    ensureChildren,
    onSelectFile,
    onSelectDir,
    connectTreeWatchSocket,
    fetchGitStatus,
  } = opts

  async function reloadAll(): Promise<void> {
    inlineCreate.value = null
    contextMenu.value = null
    childCache.value = {}
    expanded.value = new Set()
    previewErr.value = ''
    meta.value = null
    try {
      await ensureChildren('')
    } catch {
      previewErr.value = 'list failed'
    }
  }

  async function expandFirstLevelDirs(): Promise<void> {
    const entries = childCache.value['']
    if (!entries) return
    const dirs = entries.filter((e) => e.is_dir)
    if (!dirs.length) return
    const dirPaths = dirs.map((d) => d.name)
    expanded.value = new Set(dirPaths)
    await Promise.all(dirPaths.map((p) => ensureChildren(p)))
  }

  function captureState(): PersistedFileWorkspaceState {
    return {
      editorLayout: editorLayout.value,
      activeEditorLeafId: activeEditorLeafId.value,
      childCache: childCache.value,
      expanded: expanded.value,
      cwdLabel: cwdLabel.value,
    }
  }

  function applyState(s: PersistedFileWorkspaceState): void {
    editorLayout.value = s.editorLayout
    activeEditorLeafId.value = s.activeEditorLeafId
    childCache.value = s.childCache
    expanded.value = s.expanded
    cwdLabel.value = s.cwdLabel ?? ''
  }

  async function boot(): Promise<void> {
    const saved = paneId.value ? loadFileWorkspaceState(paneId.value) : undefined
    inlineCreate.value = null
    contextMenu.value = null
    previewErr.value = ''
    if (saved) {
      applyState(saved)
      try {
        connectTreeWatchSocket()
        fetchGitStatus()
      } catch {
        // best-effort
      }
      // Old saved states (pre-cwdLabel persistence) restore childCache without
      // cwdLabel, leaving the tree draggable but with no absolute path for
      // drag-to-terminal. Refresh from backend to recover.
      if (!cwdLabel.value) {
        try {
          await ensureChildren('')
        } catch {
          // best-effort; tree stays interactive with cached entries
        }
      }
      const leaf = activeLeaf.value
      // Old in-memory state (pre-decoupling) may have a leaf stuck on a
      // directory - clear it so the placeholder shows instead of a blank
      // dir leaf, then re-open the file if one was remembered.
      if (leaf?.isDir) {
        leaf.filePath = null
        leaf.isDir = false
      }
      if (leaf?.filePath) void onSelectFile(leaf.filePath)
      return
    }
    selectedRel.value = null
    selectedIsDir.value = false
    meta.value = null
    childCache.value = {}
    expanded.value = new Set()

    // Prefer explicit initial path (e.g. from leaf.path or openFromPath call)
    if (initialPath.value) {
      try {
        await openFromTerminal(initialPath.value)
        connectTreeWatchSocket()
        fetchGitStatus()
      } catch {
        previewErr.value = 'list failed'
      }
      return
    }

    // SSH pane with no explicit path: auto-navigate to the pane's cwd so the
    // file tree opens at the directory the user is working in, not `/`.
    const sshPaneId = sourcePaneId.value
    if (shellType.value === 'ssh' && sshPaneId) {
      try {
        await getApiBase()
        const q = new URLSearchParams({ pane_id: sshPaneId })
        const res = await authFetch(apiUrl(`/api/workspace/cwd?${q}`))
        if (res.ok) {
          const { cwd } = (await res.json()) as { cwd?: string }
          if (cwd) {
            await openFromTerminal(cwd)
            connectTreeWatchSocket()
            fetchGitStatus()
            return
          }
        }
      } catch {
        // best-effort; fall through to default tree (root listing)
      }
    }

    try {
      await ensureChildren('')
      connectTreeWatchSocket()
      fetchGitStatus()
    } catch {
      previewErr.value = 'list failed'
    }
  }

  async function openFromTerminal(path: string): Promise<void> {
    const apiPane = sourcePaneId.value || paneId.value
    await getApiBase()
    const q = new URLSearchParams({ pane_id: apiPane, path })
    const res = await authFetch(apiUrl(`/api/workspace/resolve?${q}`))
    if (!res.ok) return
    const { rel } = await res.json()
    previewErr.value = ''
    inlineCreate.value = null
    contextMenu.value = null
    childCache.value = {}
    expanded.value = new Set()
    try {
      await ensureChildren('')
    } catch {
      previewErr.value = 'list failed'
      return
    }
    const parts = (rel as string).split('/').filter(Boolean)
    if (parts.length === 0) {
      selectedRel.value = null
      selectedIsDir.value = false
      meta.value = null
      return
    }
    let acc = ''
    const nextExpanded = new Set(expanded.value)
    for (let i = 0; i < parts.length - 1; i++) {
      acc = acc ? `${acc}/${parts[i]}` : parts[i]
      nextExpanded.add(acc)
      await ensureChildren(acc)
    }
    expanded.value = nextExpanded
    const base = parts[parts.length - 1]
    const parentRel = parts.slice(0, -1).join('/')
    await ensureChildren(parentRel)
    const full = rel as string
    const parentEntries = childCache.value[parentRel]
    const entry = parentEntries?.find((e) => e.name === base)
    if (entry?.is_dir) onSelectDir(full)
    else await onSelectFile(full)
  }

  return {
    reloadAll,
    expandFirstLevelDirs,
    captureState,
    applyState,
    boot,
    openFromTerminal,
  }
}

// Re-export for callers that need to persist state on pane switch
export { saveFileWorkspaceState }
