import { nextTick, ref, type Ref } from 'vue'
import { getApiBase, apiUrl, authFetch } from './apiBase'
import {
  asWorkspaceError,
  workspaceErrorFromResponse,
  withWorkspaceErrorRel,
  type WorkspaceError,
} from './useFileWorkspaceBoot'
import type { DirEntry } from '../components/workspace/TreeRows'

export interface UseFileWorkspaceTreeOptions {
  paneId: () => string
  isSsh: () => boolean
  cwdLabel: Ref<string>
  childCache: Ref<Record<string, DirEntry[]>>
  expanded: Ref<Set<string>>
  gitStatusMap: Ref<Record<string, string>>
  previewErr: Ref<WorkspaceError | null>
  selectedRel: Ref<string | null>
  treeWrapRef: Ref<HTMLElement | null>
  reloadAll: () => Promise<void>
}

/**
 * Owns the explorer's directory listings, git badges and expansion state.
 * The editor side never touches these directly, which keeps API caches out of
 * the tab/editor wiring.
 */
export function useFileWorkspaceTree(opts: UseFileWorkspaceTreeOptions) {
  const refreshBusy = ref(false)

  async function fetchList(rel: string): Promise<DirEntry[]> {
    await getApiBase()
    const q = new URLSearchParams({ pane_id: opts.paneId(), path: rel })
    if (opts.cwdLabel.value) q.set('root', opts.cwdLabel.value)
    let res: Response
    try {
      res = await authFetch(apiUrl(`/api/workspace/list?${q}`))
    } catch (e) {
      // Transport failure: status 0 so the UI reports a network error.
      throw asWorkspaceError(e)
    }
    // Keep the server's status and `{ error }` body — the error bar maps them
    // to localized text and decides whether Retry is useful.
    if (!res.ok) throw await workspaceErrorFromResponse(res)
    const data = await res.json()
    if (opts.isSsh()) {
      // The remote backend reports the directory it just listed; tree rel paths
      // are always relative to the initial root '/', so following it would make
      // cwdLabel drift on every navigation.
      opts.cwdLabel.value = '/'
    } else {
      opts.cwdLabel.value = data.cwd || ''
    }
    return data.entries || []
  }

  async function fetchGitStatus() {
    try {
      await getApiBase()
      const q = new URLSearchParams({ pane_id: opts.paneId() })
      const res = await authFetch(apiUrl(`/api/workspace/git-status?${q}`))
      if (!res.ok) return
      const data = await res.json()
      if (!data.is_git_repo) {
        opts.gitStatusMap.value = {}
        return
      }
      const map: Record<string, string> = {}
      for (const f of data.files || []) {
        map[f.path] = f.status
      }
      opts.gitStatusMap.value = map
    } catch {
      opts.gitStatusMap.value = {}
    }
  }

  // One listing request per directory: concurrent expanders (hover-expand,
  // ensureParentsExpanded, rapid toggles) share the in-flight promise.
  const pendingChildren = new Map<string, Promise<void>>()

  function ensureChildren(rel: string): Promise<void> {
    if (opts.childCache.value[rel]) return Promise.resolve()
    const inFlight = pendingChildren.get(rel)
    if (inFlight) return inFlight
    const request = (async () => {
      try {
        const entries = await fetchList(rel)
        opts.childCache.value = { ...opts.childCache.value, [rel]: entries }
      } finally {
        pendingChildren.delete(rel)
      }
    })()
    // Fire-and-forget callers (toggle, context menu, drag hover) must not
    // produce an unhandled rejection; show the first failure in the error bar.
    request.catch((e) => {
      if (!opts.previewErr.value) opts.previewErr.value = withWorkspaceErrorRel(e, rel)
    })
    pendingChildren.set(rel, request)
    return request
  }

  function onToggle(rel: string) {
    const next = new Set(opts.expanded.value)
    if (next.has(rel)) next.delete(rel)
    else next.add(rel)
    opts.expanded.value = next
    if (next.has(rel)) void ensureChildren(rel)
  }

  /** Explorer "collapse all": close every directory but keep the selection so
   *  the highlighted row stays revealed under its collapsed ancestors. */
  function collapseAll() {
    opts.expanded.value = new Set()
  }

  async function refreshTree() {
    if (refreshBusy.value) return
    refreshBusy.value = true
    try {
      await opts.reloadAll()
    } finally {
      refreshBusy.value = false
    }
  }

  /** Expand every ancestor that is not open yet and wait for its listing, so
   *  the target row exists in the DOM before we try to scroll to it. */
  async function ensureParentsExpanded(rel: string): Promise<void> {
    const parts = rel.split('/')
    const next = new Set(opts.expanded.value)
    next.add('')
    const loads: Promise<unknown>[] = []
    for (let i = 1; i < parts.length; i++) {
      const ancestor = parts.slice(0, i).join('/')
      if (!next.has(ancestor)) {
        next.add(ancestor)
        loads.push(ensureChildren(ancestor).catch(() => {}))
      }
    }
    opts.expanded.value = next
    await Promise.all(loads)
  }

  /**
   * Bring the selected row into view after it was opened programmatically
   * (terminal link, recent list, history). Rows are identified by `data-rel`
   * rather than index because expansions shift the flat DOM order.
   */
  async function scrollSelectedIntoView(): Promise<void> {
    await nextTick()
    const rel = opts.selectedRel.value
    const wrap = opts.treeWrapRef.value
    if (!rel || !wrap) return
    const rows = wrap.querySelectorAll<HTMLElement>('[data-rel]')
    for (const row of rows) {
      if (row.dataset.rel === rel) {
        row.scrollIntoView({ block: 'nearest' })
        return
      }
    }
  }

  return {
    refreshBusy,
    fetchList,
    fetchGitStatus,
    ensureChildren,
    onToggle,
    collapseAll,
    refreshTree,
    ensureParentsExpanded,
    scrollSelectedIntoView,
  }
}
