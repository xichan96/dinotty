import { ref, computed } from 'vue'
import type { Workspace } from '../types/workspace'
import type { TerminalTab } from '../types/pane'
import {
  apiListWorkspaces,
  apiCreateWorkspace,
  apiUpdateWorkspace,
  apiDeleteWorkspace,
  apiActivateWorkspace,
  apiDeactivateWorkspace,
  apiReorderWorkspaces,
} from './useWorkspaceApi'

const workspaces = ref<Workspace[]>([])
const activeWorkspaceId = ref<string | null>(null)
let wsNavGen = 0

export function useWorkspaces() {
  async function loadWorkspaces() {
    try {
      workspaces.value = await apiListWorkspaces()
    } catch (e) {
      console.error('Failed to load workspaces:', e)
    }
  }

  async function createWorkspace(path: string, name?: string, connectionId?: string) {
    const ws = await apiCreateWorkspace(path, name, connectionId)
    // Optimistic add; sync will reconcile if needed
    if (ws && ws.id && !workspaces.value.find((w) => w.id === ws.id)) {
      workspaces.value.push(ws)
    }
    return ws
  }

  async function updateWorkspace(id: string, data: Partial<Workspace>) {
    const ws = await apiUpdateWorkspace(id, data)
    const idx = workspaces.value.findIndex((w) => w.id === id)
    if (idx >= 0) workspaces.value[idx] = ws
    return ws
  }

  async function deleteWorkspace(id: string) {
    await apiDeleteWorkspace(id)
    workspaces.value = workspaces.value.filter((w) => w.id !== id)
    if (activeWorkspaceId.value === id) {
      activeWorkspaceId.value = null
    }
  }

  async function activateWorkspace(id: string | null): Promise<boolean> {
    const gen = ++wsNavGen
    if (id) {
      await apiActivateWorkspace(id)
    } else {
      await apiDeactivateWorkspace()
    }
    if (gen !== wsNavGen) return false
    activeWorkspaceId.value = id
    return true
  }

  function cancelPendingWorkspaceActivation() {
    wsNavGen++
  }

  async function reorderWorkspaces(ids: string[]) {
    await apiReorderWorkspaces(ids)
    // Update local order
    for (let i = 0; i < ids.length; i++) {
      const ws = workspaces.value.find((w) => w.id === ids[i])
      if (ws) ws.order = i
    }
    workspaces.value.sort((a, b) => a.order - b.order)
  }

  /**
   * Match a CWD to the best (longest prefix) workspace.
   * Both cwd and workspace.path are assumed to be canonicalized absolute paths from the backend.
   * For SSH tabs, pass `connectionId` to prefer matching by SSH profile ID.
   */
  function matchWorkspace(cwd: string, connectionId?: string, workspaceId?: string): Workspace | null {
    // Explicit workspace assignment takes priority
    if (workspaceId) {
      const explicit = workspaces.value.find((w) => w.id === workspaceId)
      if (explicit) return explicit
    }
    // SSH tab: match only by connection_id, never by path prefix
    if (connectionId) {
      return workspaces.value.find((w) => w.connection_id === connectionId) ?? null
    }

    if (!cwd) return null

    // Local tab: path-prefix match
    let best: Workspace | null = null
    let bestLen = 0
    for (const ws of workspaces.value) {
      if (ws.connection_id) continue // skip remote workspaces for path matching
      if (cwd === ws.path || (cwd.startsWith(ws.path) && cwd[ws.path.length] === '/')) {
        if (ws.path.length > bestLen) {
          best = ws
          bestLen = ws.path.length
        }
      }
    }
    return best
  }

  /**
   * Filter tabs to only those belonging to the given workspace.
   */
  function filterTabs(tabs: TerminalTab[], workspaceId: string): TerminalTab[] {
    const ws = workspaces.value.find((w) => w.id === workspaceId)
    if (!ws) return []
    if (ws.connection_id) {
      // Remote workspace: match by connection_id on the tab
      return tabs.filter((tab) => tab.connectionId === ws.connection_id)
    }
    // Local workspace: match by path prefix
    return tabs.filter((tab) => {
      if (!tab.cwd) return false
      const matched = matchWorkspace(tab.cwd, undefined, tab.workspaceId)
      return matched?.id === workspaceId
    })
  }

  const activeWorkspacePath = computed(
    () => workspaces.value.find((w) => w.id === activeWorkspaceId.value)?.path
  )

  const activeWorkspaceName = computed(
    () => workspaces.value.find((w) => w.id === activeWorkspaceId.value)?.name
  )

  return {
    workspaces,
    activeWorkspaceId,
    activeWorkspacePath,
    activeWorkspaceName,
    loadWorkspaces,
    createWorkspace,
    updateWorkspace,
    deleteWorkspace,
    activateWorkspace,
    cancelPendingWorkspaceActivation,
    reorderWorkspaces,
    matchWorkspace,
    filterTabs,
  }
}
