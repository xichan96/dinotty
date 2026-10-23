import type { Ref } from 'vue'
import { apiUrl, authFetch, getApiBase } from './apiBase'
import {
  loadFileWorkspaceState,
  saveFileWorkspaceState,
  type PersistedFileWorkspaceState,
} from './useFileWorkspaceState'
import type { DirEntry } from '../components/workspace/TreeRows'

/** An API failure that keeps the HTTP status (0 = network/transport) and the
 *  server's JSON `error` detail, so the UI can map it to a localized message
 *  instead of surfacing backend English. */
export interface WorkspaceError extends Error {
  status: number
  detail: string
  /** Directory the failure belongs to, when the caller knows it. */
  rel?: string
}

export type WorkspaceErrorKind = 'forbidden' | 'notFound' | 'conflict' | 'network' | 'unknown'

export function makeWorkspaceError(status: number, detail = '', rel?: string): WorkspaceError {
  const err = new Error(detail || (status ? `HTTP ${status}` : 'network error')) as WorkspaceError
  err.name = 'WorkspaceError'
  err.status = status
  err.detail = detail
  if (rel !== undefined) err.rel = rel
  return err
}

/** Read `{ error }` from a non-OK workspace response and keep its status. */
export async function workspaceErrorFromResponse(res: Response): Promise<WorkspaceError> {
  let detail = ''
  try {
    const body = (await res.json()) as { error?: unknown }
    if (typeof body?.error === 'string') detail = body.error
  } catch {
    // Non-JSON body (proxy error page, truncated response) — status is enough.
  }
  return makeWorkspaceError(res.status, detail)
}

export function asWorkspaceError(e: unknown): WorkspaceError {
  if (e instanceof Error && typeof (e as WorkspaceError).status === 'number') {
    return e as WorkspaceError
  }
  return makeWorkspaceError(0, e instanceof Error ? e.message : String(e ?? ''))
}

export function withWorkspaceErrorRel(e: unknown, rel: string): WorkspaceError {
  const err = asWorkspaceError(e)
  err.rel = rel
  return err
}

export function workspaceErrorKind(e: unknown): WorkspaceErrorKind {
  if (!e) return 'unknown'
  const status = (e as WorkspaceError).status
  // Anything without an HTTP status is a transport failure (fetch rejected).
  if (typeof status !== 'number' || status === 0) return 'network'
  if (status === 403) return 'forbidden'
  if (status === 404) return 'notFound'
  if (status === 409) return 'conflict'
  return 'unknown'
}

export interface FileWorkspaceBootOptions {
  paneId: Ref<string>
  sourcePaneId: Ref<string | undefined>
  visible: Ref<boolean>
  shellType: Ref<string | undefined>
  initialPath: Ref<string | undefined>
  childCache: Ref<Record<string, DirEntry[]>>
  expanded: Ref<Set<string>>
  cwdLabel: Ref<string>
  previewErr: Ref<WorkspaceError | null>
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
    previewErr.value = null
    meta.value = null
    try {
      await ensureChildren('')
    } catch (e) {
      previewErr.value = withWorkspaceErrorRel(e, '')
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
    previewErr.value = null
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
      } catch (e) {
        previewErr.value = withWorkspaceErrorRel(e, '')
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
    } catch (e) {
      previewErr.value = withWorkspaceErrorRel(e, '')
    }
  }

  async function openFromTerminal(path: string): Promise<void> {
    const apiPane = sourcePaneId.value || paneId.value
    await getApiBase()
    const q = new URLSearchParams({ pane_id: apiPane, path })
    let res: Response
    try {
      res = await authFetch(apiUrl(`/api/workspace/resolve?${q}`))
    } catch (e) {
      previewErr.value = asWorkspaceError(e)
      return
    }
    if (!res.ok) {
      previewErr.value = await workspaceErrorFromResponse(res)
      return
    }
    const { rel } = await res.json()
    previewErr.value = null
    inlineCreate.value = null
    contextMenu.value = null
    childCache.value = {}
    expanded.value = new Set()
    try {
      await ensureChildren('')
    } catch (e) {
      previewErr.value = withWorkspaceErrorRel(e, '')
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
    const base = parts[parts.length - 1]
    const parentRel = parts.slice(0, -1).join('/')
    try {
      for (let i = 0; i < parts.length - 1; i++) {
        acc = acc ? `${acc}/${parts[i]}` : parts[i]
        nextExpanded.add(acc)
        await ensureChildren(acc)
      }
      expanded.value = nextExpanded
      await ensureChildren(parentRel)
    } catch (e) {
      previewErr.value = withWorkspaceErrorRel(e, acc || parentRel)
      return
    }
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
