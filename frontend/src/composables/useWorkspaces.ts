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
import { settings } from './useSettings'
import { useI18n } from './useI18n'

export const DEFAULT_WORKSPACE_ID = '__default__'

function isWindowsPath(path: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(path) || /^(?:\\\\|\/\/)/.test(path)
}

function normalizeWindowsPath(path: string): string {
  return path
    .replace(/[\\/]+/g, '/')
    .replace(/\/+$/, '')
    .replace(/[A-Z]/g, (char) => char.toLowerCase())
}

export function isPathWithinWorkspace(cwd: string, workspacePath: string): boolean {
  if (!cwd || !workspacePath) return false

  const windowsPath = isWindowsPath(cwd) || isWindowsPath(workspacePath)
  const normalizedCwd = windowsPath ? normalizeWindowsPath(cwd) : cwd.replace(/\/+$/, '')
  const normalizedWorkspace = windowsPath
    ? normalizeWindowsPath(workspacePath)
    : workspacePath.replace(/\/+$/, '')

  return (
    normalizedCwd === normalizedWorkspace ||
    (normalizedCwd.startsWith(normalizedWorkspace) &&
      normalizedCwd[normalizedWorkspace.length] === '/')
  )
}

export function workspaceBasename(path: string): string {
  const trimmed = path.trim().replace(/[\\/]+$/, '')
  if (!trimmed) return ''
  const parts = trimmed.split(/[\\/]/).filter(Boolean)
  const basename = parts[parts.length - 1] ?? ''
  return /^[A-Za-z]:$/.test(basename) ? '' : basename
}

const workspaces = ref<Workspace[]>([])
const activeWorkspaceId = ref<string | null>(null)
const { t } = useI18n()
let wsNavGen = 0

export const defaultWorkspace = computed<Workspace>(() => ({
  id: DEFAULT_WORKSPACE_ID,
  name: settings.default_workspace_name?.trim() || t('workspace.default'),
  path: settings.default_workspace_root?.trim() || '',
  order: 0,
  ...(settings.default_workspace_abbr?.trim()
    ? { abbr: settings.default_workspace_abbr.trim() }
    : {}),
  ...(settings.default_workspace_color?.trim()
    ? { color: settings.default_workspace_color.trim() }
    : {}),
  tab_badge: settings.default_workspace_tab_badge !== false,
}))

export function useWorkspaces() {
  async function loadWorkspaces() {
    try {
      workspaces.value = await apiListWorkspaces()
    } catch (e) {
      console.error('Failed to load workspaces:', e)
    }
  }

  async function createWorkspace(
    path: string,
    name?: string,
    connectionId?: string,
    overrides?: { abbr?: string; color?: string }
  ) {
    const ws = await apiCreateWorkspace(path, name, connectionId, overrides)
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

    // Local tab: path-prefix match. Include the default workspace (`__default__`)
    // in the loop so tabs under its path match it - same rule as any other
    // workspace. Skip if the default has no path configured (empty path would
    // match every absolute cwd, which is not the intent).
    let best: Workspace | null = null
    let bestLen = 0
    const candidates = defaultWorkspace.value.path
      ? [defaultWorkspace.value, ...workspaces.value]
      : workspaces.value
    for (const ws of candidates) {
      if (ws.connection_id) continue // skip remote workspaces for path matching
      if (!ws.path) continue
      if (isPathWithinWorkspace(cwd, ws.path)) {
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
      // Explicit attribution disambiguates workspaces that share one SSH profile.
      // Keep the connection fallback for tabs created by older servers/clients.
      return tabs.filter((tab) =>
        tab.workspaceId ? tab.workspaceId === workspaceId : tab.connectionId === ws.connection_id
      )
    }
    // Local workspace: match by path prefix
    return tabs.filter((tab) => {
      if (!tab.cwd) return false
      const matched = matchWorkspace(tab.cwd, undefined, tab.workspaceId)
      return matched?.id === workspaceId
    })
  }

  const activeWorkspace = computed(() =>
    activeWorkspaceId.value === null
      ? defaultWorkspace.value
      : workspaces.value.find((w) => w.id === activeWorkspaceId.value)
  )

  const activeWorkspacePath = computed(() => activeWorkspace.value?.path || undefined)

  const activeWorkspaceName = computed(() => activeWorkspace.value?.name)

  return {
    workspaces,
    defaultWorkspace,
    activeWorkspaceId,
    activeWorkspace,
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
