import { computed, nextTick } from 'vue'
import type { Ref } from 'vue'
import { apiCreateSshTab } from './useTabApi'
import { ensureSplitRoot } from '../types/pane'
import type { TerminalTab, Tab } from '../types/pane'
import type { SyncClientMsg } from '../types/protocol'
import { sendMcOp, useMissionControlState } from './useMissionControlState'
import { toActiveWorkspaceId } from './useWorkspaces'
import { useDetachedWindowsStore } from '../stores/detachedWindowsStore'
import { useI18n } from './useI18n'

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
  newTab: (
    cwd?: string,
    argv?: string[],
    title?: string,
    workspaceId?: string | null
  ) => Promise<string | void>
  persist: () => void
  commitLocalActivePane: (paneId: string) => void
  focusActive: () => void
  sendSync: (msg: SyncClientMsg) => void
  /** Used to report a detached window that could not be focused. */
  toast?: { error: (message: string) => void }
}

export interface OverviewCallbacks {
  overviewOpen: Ref<boolean>
  openOverview: () => void
  closeOverview: () => void
  onOverviewActivate: (paneId: string) => void
  onOverviewCloseTab: (tabId: string) => void
  /** Close the terminal for real (kill the PTY), no further confirmation. */
  onOverviewCloseTerminal: (tabId: string) => void
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
    toast,
  } = opts

  const mcState = useMissionControlState()
  const detachedStore = useDetachedWindowsStore()
  const { t } = useI18n()
  const overviewOpen = computed(() => mcState.open)

  function activateInMainWindow(paneId: string): void {
    void activateTab(paneId)
    nextTick(() => {
      termRefs[paneId]?.focus()
    })
  }

  /**
   * Bring a detached tab's native window forward.
   *
   * When the registry no longer knows the window (it crashed or was destroyed
   * while the event was missed) the tab is already back in this window's render
   * tree, so fall back to a normal activation and tell the user why nothing
   * came forward.
   */
  async function focusDetachedTab(paneId: string): Promise<void> {
    if (await detachedStore.focusDetached(paneId)) return

    await detachedStore.refreshFromRust()
    toast?.error(t('detached.focusFailed'))
    if (detachedStore.isDetached(paneId)) return
    activateInMainWindow(paneId)
  }

  function openOverview(): void {
    // `set` rather than `toggle`: the local `open` bit is only a mirror of the
    // server's, so a stale copy would make a toggle flip the wrong way. Asking
    // for the state we actually want is idempotent, and a duplicate op from a
    // second client is a no-op instead of a close.
    //
    // Through `sendMcOp` rather than `sendSync` so this shares the one place
    // that adapts to a server too old to know `set` - see it for why a peer
    // that only knows `toggle` can be driven there and when it cannot.
    if (!mcState.open) {
      sendMcOp({ kind: 'set', open: true })
    }
  }

  function closeOverview(): void {
    if (mcState.open) {
      sendMcOp({ kind: 'set', open: false })
    }
  }

  function onOverviewActivate(paneId: string): void {
    // A detached tab has no TerminalPane in this window to activate. Bringing
    // its native window forward is the whole action: activating the tab here
    // would move the server-side focus for every client while the pane the
    // user asked for stays in another window.
    if (detachedStore.isDetached(paneId)) {
      closeOverview()
      void focusDetachedTab(paneId)
      return
    }
    activateInMainWindow(paneId)
    closeOverview()
  }

  function onOverviewCloseTab(tabId: string): void {
    void requestCloseTab(tabId)
  }

  function onOverviewCloseTerminal(tabId: string): void {
    // The confirmation lives in the card's context menu (detached.closeTerminal-
    // Confirm); by the time this runs the user has already agreed to kill the
    // PTY, so skip the generic requestCloseTab prompt.
    void closeTab(tabId)
  }

  async function onCloseTabsBulk(paneIds: string[]): Promise<void> {
    for (const id of [...paneIds].reverse()) {
      await closeTab(id)
    }
  }

  async function onOverviewNewTab(cwd?: string, workspaceId?: string | null): Promise<void> {
    closeOverview()
    const targetWorkspaceId = toActiveWorkspaceId(workspaceId)
    if (workspaceId !== undefined && targetWorkspaceId !== activeWorkspaceId.value) {
      try {
        if (!(await activateWorkspace(targetWorkspaceId))) return
      } catch (e) {
        console.error('Failed to activate workspace:', e)
        return
      }
    }
    await newTab(cwd, undefined, undefined, targetWorkspaceId)
  }

  async function onOverviewNewTabSsh(
    connectionId: string,
    initialCwd?: string,
    workspaceId?: string
  ): Promise<void> {
    closeOverview()
    try {
      const targetWorkspaceId = toActiveWorkspaceId(workspaceId)
      if (
        workspaceId !== undefined &&
        targetWorkspaceId !== activeWorkspaceId.value &&
        !(await activateWorkspace(targetWorkspaceId))
      )
        return
      const result = await apiCreateSshTab(connectionId, initialCwd, workspaceId)
      const resolvedWorkspaceId = result.workspace_id ?? workspaceId
      const existing = tabs.value.find((t) => t.type === 'terminal' && t.paneId === result.tab_id)
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
    onOverviewCloseTerminal,
    onCloseTabsBulk,
    onOverviewNewTab,
    onOverviewNewTabSsh,
    onOverviewRenameTab,
  }
}
