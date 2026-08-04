import { computed, nextTick } from 'vue'
import type { Ref } from 'vue'
import { apiCreateSshTab } from './useTabApi'
import { ensureSplitRoot } from '../types/pane'
import type { TerminalTab, Tab } from '../types/pane'
import type { SyncClientMsg } from '../types/protocol'
import { useMissionControlState } from './useMissionControlState'

export interface OverviewCallbacksOptions {
  tabs: Ref<Tab[]>
  activePaneId: Ref<string | null>
  activeWorkspaceId: Ref<string | null>
  termRefs: Record<string, { focus: () => void }>
  session: {
    renameTab: (tabId: string, title: string) => void
  }
  activateTab: (paneId: string) => Promise<boolean> | boolean
  activateWorkspace: (workspaceId: string | null) => Promise<boolean>
  closeTab: (paneId: string) => Promise<void>
  requestCloseTab: (paneId: string) => Promise<void> | void
  newTab: (cwd?: string, argv?: string[], title?: string, workspaceId?: string | null) => Promise<string | void>
  persist: () => void
  commitLocalActivePane: (paneId: string) => void
  focusActive: () => void
  sendSync: (msg: SyncClientMsg) => void
}

export interface OverviewCallbacks {
  overviewOpen: Ref<boolean>
  openOverview: () => void
  closeOverview: () => void
  onOverviewActivate: (paneId: string) => void
  onOverviewCloseTab: (tabId: string) => void
  onCloseTabsBulk: (paneIds: string[]) => Promise<void>
  onOverviewNewTab: (cwd?: string, workspaceId?: string | null) => Promise<void>
  onOverviewNewTabSsh: (
    connectionId: string,
    initialCwd?: string,
    workspaceId?: string
  ) => Promise<void>
  onOverviewRenameTab: (paneId: string, title: string) => void
}

export function useOverviewCallbacks(opts: OverviewCallbacksOptions): OverviewCallbacks {
  const {
    tabs,
    activeWorkspaceId,
    termRefs,
    session,
    activateTab,
    activateWorkspace,
    closeTab,
    requestCloseTab,
    newTab,
    persist,
    commitLocalActivePane,
    focusActive,
    sendSync,
  } = opts

  const mcState = useMissionControlState()
  const overviewOpen = computed(() => mcState.open)

  function openOverview(): void {
    // Toggle only if currently closed - the hardware keyboard / other
    // client may have opened it; we don't want to flip it back to closed.
    if (!mcState.open) {
      sendSync({ type: 'mission_control_op', op: { kind: 'toggle' } })
    }
  }

  function closeOverview(): void {
    if (mcState.open) {
      sendSync({ type: 'mission_control_op', op: { kind: 'toggle' } })
    }
  }

  function onOverviewActivate(paneId: string): void {
    void activateTab(paneId)
    closeOverview()
    nextTick(() => {
      const ref = termRefs[paneId]
      ref?.focus()
    })
  }

  function onOverviewCloseTab(tabId: string): void {
    void requestCloseTab(tabId)
  }

  async function onCloseTabsBulk(paneIds: string[]): Promise<void> {
    for (const id of [...paneIds].reverse()) {
      await closeTab(id)
    }
  }

  async function onOverviewNewTab(cwd?: string, workspaceId?: string | null): Promise<void> {
    closeOverview()
    if (workspaceId !== undefined && workspaceId !== activeWorkspaceId.value) {
      try {
        if (!(await activateWorkspace(workspaceId))) return
      } catch (e) {
        console.error('Failed to activate workspace:', e)
        return
      }
    }
    await newTab(cwd, undefined, undefined, workspaceId)
  }

  async function onOverviewNewTabSsh(
    connectionId: string,
    initialCwd?: string,
    workspaceId?: string
  ): Promise<void> {
    closeOverview()
    try {
      if (
        workspaceId !== undefined
        && workspaceId !== activeWorkspaceId.value
        && !(await activateWorkspace(workspaceId))
      ) return
      const result = await apiCreateSshTab(connectionId, initialCwd, workspaceId)
      const resolvedWorkspaceId = result.workspace_id ?? workspaceId
      const existing = tabs.value.find(
        (t) => t.type === 'terminal' && t.paneId === result.tab_id,
      )
      if (existing) {
        if (existing.type === 'terminal' && resolvedWorkspaceId) {
          existing.workspaceId = resolvedWorkspaceId
        }
        commitLocalActivePane(result.tab_id)
        persist()
        nextTick(() => focusActive())
        return
      }
      const layout = ensureSplitRoot(result.layout)
      tabs.value.push({
        type: 'terminal',
        paneId: result.tab_id,
        layout,
        activePaneId: result.pane_id,
        paneMru: [result.pane_id],
        broadcastMode: false,
        broadcastActivity: 0,
        previewVisible: false,
        previewAddress: '',
        previewUrl: '',
        previewKind: 'web',
        connectionId,
        workspaceId: resolvedWorkspaceId,
      } as TerminalTab)
      commitLocalActivePane(result.tab_id)
      persist()
      nextTick(() => focusActive())
    } catch (e) {
      console.error('Failed to create SSH tab:', e)
    }
  }

  function onOverviewRenameTab(paneId: string, title: string): void {
    session.renameTab(paneId, title)
    persist()
    sendSync({ type: 'rename_tab', tab_id: paneId, title })
  }

  return {
    overviewOpen,
    openOverview,
    closeOverview,
    onOverviewActivate,
    onOverviewCloseTab,
    onCloseTabsBulk,
    onOverviewNewTab,
    onOverviewNewTabSsh,
    onOverviewRenameTab,
  }
}
