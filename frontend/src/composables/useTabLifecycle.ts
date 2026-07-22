import { type Ref, type ShallowRef, nextTick } from 'vue'
import type { Tab, TerminalTab } from '../types/pane'
import { getAllLeaves, findLeaf, ensureSplitRoot } from '../types/pane'
import type { Workspace } from '../types/workspace'
import { nextRevealNavGen, currentRevealNavGen } from '../utils/navGen'
import { pickSuccessorTab } from '../utils/tabSuccessor'
import { isTouchDevice } from './useTerminal'
import { clearFileWorkspaceState } from './useFileWorkspaceState'
import { invalidatePluginPreview } from './useTabPreview'
import { apiActivatePane, apiCloseTab, apiCreateTab, apiCreateSshTab } from './useTabApi'
import type { SshConnectResult } from './useSshConnectFlow'
import type { MarkReadReason } from './useNotification'

export interface TabLifecycleOptions {
  tabs: Ref<Tab[]>
  activePaneId: Ref<string | null>
  session: { reorderTab: (fromId: string, toId: string) => void; renameTab: (paneId: string, title: string) => void }
  ui: {
    requestCloseTab: (tabId: string) => void
    requestClosePane: (tabId: string, paneId: string) => void
    cancelClose: () => void
  }
  appSettings: { confirm_before_close_tab?: boolean }
  activeWorkspaceId: Ref<string | null>
  workspaces: Ref<Workspace[]>
  matchWorkspace: (cwd: string, connectionId: string | undefined, workspaceId: string | undefined) => Workspace | null
  activateWorkspace: (id: string | null) => Promise<boolean>
  cancelPendingWorkspaceActivation: () => void
  workspaceIdOfTab: (tab: Tab) => string | null
  activeWorkspacePath: Ref<string | undefined>
  notif: { clearForPaneIds: (paneIds: string[], reason: MarkReadReason) => void }
  termRefs: Record<string, any>
  isMobile: Ref<boolean>
  tabBarRef: Ref<{ scrollTabIntoView: (paneId: string) => boolean; hasTab: (paneId: string) => boolean } | null | undefined>
  kbVisible: Ref<boolean>
  persist: () => void
  persistNow: () => void
  onSshConnectRef: ShallowRef<(result: SshConnectResult) => Promise<void>>
}

export interface TabLifecycleState {
  newTab: {
    (cwd?: string): Promise<void>
    (cwd: string, argv: string[], title?: string): Promise<string>
  }
  resolveTab: (tabId: string) => Tab | undefined
  resolveTabWorkspace: (tab: Tab) => Workspace | null
  clearResolvedTabNotifications: (tab: Tab, reason?: MarkReadReason) => void
  commitLocalActivePane: (paneId: string) => void
  scrollActiveTabIntoView: (targetPaneId: string, navGen: number) => Promise<void>
  activateTab: (tabId: string, opts?: { defer?: boolean }) => Promise<boolean>
  revealPane: (paneId: string) => Promise<boolean>
  reorderTab: (fromId: string, toId: string) => void
  onRenameTab: (paneId: string, title: string) => void
  requestCloseTab: (tabId: string) => Promise<void>
  closeTab: (tabId: string) => Promise<void>
  focusActive: () => void
}

export function useTabLifecycle(opts: TabLifecycleOptions): TabLifecycleState {
  const {
    tabs,
    activePaneId,
    session,
    ui,
    appSettings,
    activeWorkspaceId,
    workspaces,
    matchWorkspace,
    activateWorkspace,
    cancelPendingWorkspaceActivation,
    workspaceIdOfTab,
    activeWorkspacePath,
    notif,
    termRefs,
    isMobile,
    tabBarRef,
    kbVisible,
    persist,
    persistNow,
    onSshConnectRef,
  } = opts

  function newTab(cwd?: string): Promise<void>
  function newTab(cwd: string, argv: string[], title?: string): Promise<string>
  async function newTab(cwd?: string, argv?: string[], title?: string): Promise<string | void> {
    try {
      const activeWs = workspaces.value.find((w) => w.id === activeWorkspaceId.value)
      if (!argv && activeWs?.connection_id) {
        const result = await apiCreateSshTab(activeWs.connection_id, activeWs.path)
        await onSshConnectRef.value(result)
        return result.pane_id
      }
      const effectiveCwd = cwd ?? activeWorkspacePath.value
      const result = await apiCreateTab(effectiveCwd, argv, title)
      const existing = tabs.value.find((t) => t.type === 'terminal' && t.paneId === result.tab_id)
      if (existing) {
        if (result.cwd && existing.type === 'terminal' && !existing.cwd) {
          existing.cwd = result.cwd
        }
        if (title && existing.type === 'terminal') existing.customTitle = title
        commitLocalActivePane(result.tab_id)
        persist()
        nextTick(() => focusActive())
        return result.pane_id
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
        customTitle: title,
        cwd: result.cwd,
      })
      commitLocalActivePane(result.tab_id)
      persist()
      nextTick(() => focusActive())
      return result.pane_id
    } catch (e) {
      console.error('Failed to create tab:', e)
      if (argv) throw e
      return ''
    }
  }

  function resolveTab(tabId: string): Tab | undefined {
    let tab = tabs.value.find((t) => t.paneId === tabId)
    if (!tab) {
      tab = tabs.value.find((t) => {
        if (t.type !== 'terminal') return false
        return !!findLeaf(t.layout, tabId)
      })
    }
    return tab
  }

  function resolveTabWorkspace(tab: Tab) {
    return tab.type === 'terminal'
      ? matchWorkspace(tab.cwd ?? '', tab.connectionId, tab.workspaceId)
      : tab.workspaceId ? workspaces.value.find((w) => w.id === tab.workspaceId) ?? null : null
  }

  function clearResolvedTabNotifications(tab: Tab, reason: MarkReadReason = 'tab_activate') {
    const activatedPaneIds = tab.type === 'terminal'
      ? [tab.paneId, ...getAllLeaves(tab.layout).map((l) => l.paneId)]
      : [tab.paneId]
    notif.clearForPaneIds(activatedPaneIds, reason)
  }

  function commitLocalActivePane(paneId: string) {
    nextRevealNavGen()
    activePaneId.value = paneId
  }

  async function scrollActiveTabIntoView(targetPaneId: string, navGen: number) {
    await nextTick()
    if (navGen !== currentRevealNavGen()) return
    if (tabBarRef.value?.scrollTabIntoView(targetPaneId)) return
    await nextTick()
    if (navGen !== currentRevealNavGen()) return
    tabBarRef.value?.scrollTabIntoView(targetPaneId)
  }

  async function activateTab(tabId: string, opts?: { defer?: boolean }): Promise<boolean> {
    const gen = nextRevealNavGen()
    const defer = opts?.defer === true
    let tab = resolveTab(tabId)
    if (!tab) return false

    const targetWs = resolveTabWorkspace(tab)
    const needsSwitch = tab.type === 'terminal'
      ? (targetWs?.id ?? null) !== activeWorkspaceId.value
      : targetWs && targetWs.id !== activeWorkspaceId.value
    if (needsSwitch) {
      try {
        const committed = await activateWorkspace(targetWs?.id ?? null)
        if (!committed) return false
      } catch {
        return false
      }
      if (gen !== currentRevealNavGen()) return false
      tab = resolveTab(tabId)
      if (!tab) return false
    } else {
      cancelPendingWorkspaceActivation()
    }

    if (!defer) {
      activePaneId.value = tab.paneId
      clearResolvedTabNotifications(tab)
    }

    if (tab.type === 'terminal') {
      try {
        await apiActivatePane(tab.paneId, tab.activePaneId)
      } catch (e) {
        if (defer) return false
        console.error('Failed to activate pane:', e)
      }
      if (gen !== currentRevealNavGen()) return false
    }

    if (!defer) {
      persist()
      nextTick(() => focusActive())
      void scrollActiveTabIntoView(tab.paneId, gen)
      return gen === currentRevealNavGen()
    }

    if (gen !== currentRevealNavGen()) return false
    const live = resolveTab(tabId)
    if (!live) return false
    activePaneId.value = live.paneId
    clearResolvedTabNotifications(live)
    persist()
    nextTick(() => focusActive())
    void scrollActiveTabIntoView(live.paneId, gen)
    return true
  }

  async function revealPane(paneId: string): Promise<boolean> {
    const gen = nextRevealNavGen()
    let tab = resolveTab(paneId)
    if (!tab) return false

    const targetWs = resolveTabWorkspace(tab)
    const needsSwitch = tab.type === 'terminal'
      ? (targetWs?.id ?? null) !== activeWorkspaceId.value
      : targetWs && targetWs.id !== activeWorkspaceId.value
    if (needsSwitch) {
      try {
        const committed = await activateWorkspace(targetWs?.id ?? null)
        if (!committed) return false
      } catch {
        return false
      }
      if (gen !== currentRevealNavGen()) return false
      tab = resolveTab(paneId)
      if (!tab) return false
    } else {
      cancelPendingWorkspaceActivation()
    }

    await nextTick()
    if (gen !== currentRevealNavGen()) return false
    tab = resolveTab(paneId)
    if (!tab) return false

    if (!isMobile.value) {
      let tabElementFound = false
      for (let attempt = 0; attempt < 5; attempt++) {
        if (tabBarRef.value?.hasTab(tab.paneId)) {
          tabElementFound = true
          break
        }
        if (attempt < 4) {
          await new Promise((resolve) => setTimeout(resolve, 50))
          if (gen !== currentRevealNavGen()) return false
        }
      }
      if (!tabElementFound) return false
      if (gen !== currentRevealNavGen()) return false
      tab = resolveTab(paneId)
      if (!tab) return false
    }

    if (tab.type === 'terminal') {
      try {
        await apiActivatePane(tab.paneId, tab.activePaneId)
      } catch {
        return false
      }
      if (gen !== currentRevealNavGen()) return false
    }

    tab = resolveTab(paneId)
    if (!tab) return false

    activePaneId.value = tab.paneId
    clearResolvedTabNotifications(tab, 'goto')
    persist()
    nextTick(() => focusActive())

    tabBarRef.value?.scrollTabIntoView(tab.paneId)
    return true
  }

  function reorderTab(fromId: string, toId: string) {
    session.reorderTab(fromId, toId)
    persist()
  }

  function onRenameTab(paneId: string, title: string) {
    session.renameTab(paneId, title)
    persist()
  }

  async function requestCloseTab(tabId: string) {
    const tab = tabs.value.find((t) => t.paneId === tabId)
    if (!tab) return

    if (tab.type !== 'terminal') {
      await closeTab(tabId)
      return
    }

    if (appSettings.confirm_before_close_tab === false) {
      await closeTab(tabId)
      return
    }

    ui.requestCloseTab(tabId)
  }


  async function closeTab(tabId: string) {
    const tab = tabs.value.find((t) => t.paneId === tabId)
    if (!tab) return

    const closedPaneIds = tab.type === 'terminal'
      ? [tab.paneId, ...getAllLeaves(tab.layout).map((l) => l.paneId)]
      : [tab.paneId]
    if (tab.type === 'plugin') {
      invalidatePluginPreview(tab.paneId)
    } else if (tab.type === 'terminal') {
      for (const leaf of getAllLeaves(tab.layout)) {
        if (leaf.kind === 'plugin') invalidatePluginPreview(leaf.paneId)
      }
    }

    if (tab.type === 'terminal') {
      for (const leaf of getAllLeaves(tab.layout)) {
        delete termRefs[leaf.paneId]
        clearFileWorkspaceState(leaf.paneId)
      }

      try {
        await apiCloseTab(tabId)
      } catch (e) {
        console.error('Failed to close tab:', e)
        return
      }
    }

    notif.clearForPaneIds(closedPaneIds, 'tab_close')

    const idx = tabs.value.findIndex((t) => t.paneId === tabId)
    if (idx === -1) return

    const closedWorkspaceId = workspaceIdOfTab(tab)
    const workspaceIdxBefore = tabs.value
      .slice(0, idx)
      .filter((candidate) => workspaceIdOfTab(candidate) === closedWorkspaceId).length

    tabs.value.splice(idx, 1)
    if (tab.type === 'plugin') persistNow()

    if (tabs.value.length === 0) {
      await newTab()
      return
    }

    if (activePaneId.value === tabId) {
      let successor = pickSuccessorTab(
        tabs.value,
        closedWorkspaceId,
        workspaceIdxBefore,
        idx,
        workspaceIdOfTab,
      )
      // Close-induced reselection is the newest navigation: supersede any in-flight
      // deferred/supervised hop so a late older-generation commit cannot clobber it.
      const gen = nextRevealNavGen()
      const successorWorkspaceId = successor ? workspaceIdOfTab(successor) : null
      if (successor && successorWorkspaceId !== activeWorkspaceId.value) {
        let workspaceCommitted = false
        try {
          workspaceCommitted = await activateWorkspace(successorWorkspaceId)
        } catch {
          // Keep the current workspace and select one of its remaining tabs below.
        }
        if (!workspaceCommitted || gen !== currentRevealNavGen()) {
          successor = tabs.value.find(
            (candidate) => workspaceIdOfTab(candidate) === activeWorkspaceId.value
          ) ?? tabs.value[Math.min(idx, tabs.value.length - 1)]
          const fallbackWorkspaceId = successor ? workspaceIdOfTab(successor) : null
          if (successor && fallbackWorkspaceId !== activeWorkspaceId.value) {
            try {
              await activateWorkspace(fallbackWorkspaceId)
            } catch {
              // Keep the positional fallback selected if its workspace hop also fails.
            }
          }
        }
      } else {
        cancelPendingWorkspaceActivation()
      }
      if (gen === currentRevealNavGen()) {
        activePaneId.value = successor?.paneId ?? null
      }
    }

    if (tab.type !== 'plugin') persist()
    nextTick(() => focusActive())
  }

  function focusActive() {
    if (!activePaneId.value) return
    const tab = tabs.value.find((t) => t.paneId === activePaneId.value)
    if (!tab) return
    if (tab.type === 'terminal') {
      const paneId = tab.activePaneId
      for (const leaf of getAllLeaves(tab.layout)) {
        if (termRefs[leaf.paneId]?.isComposing()) return
      }
      if (!(isTouchDevice() && kbVisible.value)) {
        for (const leaf of getAllLeaves(tab.layout)) {
          if (leaf.paneId !== paneId) {
            termRefs[leaf.paneId]?.blur()
          }
        }
        termRefs[paneId]?.focus()
      }
      termRefs[paneId]?.fit()
    }
  }

  return {
    newTab,
    resolveTab,
    resolveTabWorkspace,
    clearResolvedTabNotifications,
    commitLocalActivePane,
    scrollActiveTabIntoView,
    activateTab,
    revealPane,
    reorderTab,
    onRenameTab,
    requestCloseTab,
    closeTab,
    focusActive,
  }
}
