import { nextTick, watch, type Ref } from 'vue'
import type { Tab } from '../types/pane'
import { findLeaf } from '../types/pane'
import { useDetachedWindowsStore } from '../stores/detachedWindowsStore'
import { isTauri } from './useTransport'
import { apiSetTabWorkspace } from './useTabApi'
import { DEFAULT_WORKSPACE_ID } from './useWorkspaces'
import { useDetachedWindowFeedback } from './detachedWindowFeedback'
import {
  DETACHED_DOCK_HINT_EVENT,
  DETACHED_WINDOW_CLOSED_EVENT,
} from './detachedWindowBridge'

export interface DetachedWindowsOptions {
  tabs: Ref<Tab[]>
  activePaneId: Ref<string | null>
  /** Workspace the main window is currently showing (`null` = default). A
   *  recalled tab is rehomed here so it lands where the user is looking. */
  activeWorkspaceId: Ref<string | null>
  /** Effective workspace of a tab (`null` = default workspace). */
  workspaceIdOfTab: (tab: Tab) => string | null
  /** Workspace-filtered tab list rendered by the TabBar (detached tabs already
   *  excluded). Used to pick a neighboring tab when the active one leaves. */
  visibleTabList: Ref<Array<{ paneId: string }>>
  /** Local active-tab switch that never calls `apiActivatePane`. */
  commitLocalActivePane: (paneId: string) => void
  focusActive: () => void
  /** Main-window close pipeline, used when a detached window is closed
   *  outright: the tab goes away instead of being remounted. */
  closeTab: (tabId: string) => Promise<void>
  toast: { error: (message: string) => void }
  t: (key: string) => string
}

const CLOSED_EVENT = DETACHED_WINDOW_CLOSED_EVENT
/** Sent by the detached window while its title bar is over the tab bar. */
const DOCK_HINT_EVENT = DETACHED_DOCK_HINT_EVENT

export function useDetachedWindows(options: DetachedWindowsOptions) {
  const {
    tabs,
    activePaneId,
    activeWorkspaceId,
    workspaceIdOfTab,
    visibleTabList,
    commitLocalActivePane,
    focusActive,
    closeTab,
    toast,
    t,
  } = options
  const store = useDetachedWindowsStore()
  const feedback = useDetachedWindowFeedback()

  function titleOf(tab: Tab): string {
    if (tab.type !== 'terminal') return tab.title
    return tab.customTitle ?? findLeaf(tab.layout, tab.activePaneId)?.title ?? 'Terminal'
  }

  /**
   * The tab that should take the detached tab's slot: the next visible tab, or
   * the previous one when it was last. Mirrors `pickSuccessorTab`'s positional
   * rule but stays entirely local — detaching must not activate a pane server-
   * side, which would yank other clients' focus.
   */
  function pickNeighborTabId(tabId: string): string | null {
    const list = visibleTabList.value
    const remaining = list.filter((tab) => tab.paneId !== tabId)
    if (remaining.length === 0) return null
    const idx = list.findIndex((tab) => tab.paneId === tabId)
    if (idx === -1) return remaining[0].paneId
    return remaining[Math.min(idx, remaining.length - 1)].paneId
  }

  /**
   * Move the active tab off the detached one before its pane unmounts, open the
   * window, and restore the selection if the window could not be created.
   */
  async function detachTab(tabId: string): Promise<boolean> {
    if (!isTauri()) return false
    const tab = tabs.value.find((candidate) => candidate.paneId === tabId)
    if (!tab || tab.type !== 'terminal') return false
    if (store.isDetached(tabId)) return store.focusDetached(tabId)

    const wasActive = activePaneId.value === tabId
    const neighborId = wasActive ? pickNeighborTabId(tabId) : null
    if (wasActive) {
      if (neighborId) commitLocalActivePane(neighborId)
      else activePaneId.value = null
    }

    const opened = await store.openDetached(tabId, titleOf(tab))
    if (!opened) {
      if (wasActive) {
        commitLocalActivePane(tabId)
        await nextTick()
        focusActive()
      }
      toast.error(t('tab.detachFailed'))
      return false
    }

    if (wasActive && neighborId) {
      await nextTick()
      focusActive()
    }
    return true
  }

  /**
   * A recalled tab should land in the workspace the main window is showing,
   * not in the one it happened to live in. Move it optimistically so the tab
   * is renderable on the next tick, and let the server broadcast confirm the
   * assignment. `__default__` is explicit: clearing the assignment would let
   * cwd/SSH attribution pull the tab back to its old workspace.
   */
  function rehomeRecalledTab(tab: Tab): void {
    const targetWorkspaceId = activeWorkspaceId.value
    if (workspaceIdOfTab(tab) === targetWorkspaceId) return
    const previous = tab.workspaceId
    const next = targetWorkspaceId ?? DEFAULT_WORKSPACE_ID
    tab.workspaceId = next
    apiSetTabWorkspace(tab.paneId, next).catch((error: unknown) => {
      console.warn('[detached] failed to move recalled tab workspace', error)
      tab.workspaceId = previous
      toast.error(t('tab.recallWorkspaceFailed'))
    })
  }

  /**
   * The window closed (or was destroyed). A plain close kills the terminal —
   * the detached window has no chrome of its own, so the native close button
   * is the only action. A close carrying `reattach` is Mission Control's
   * recall action, or a window dropped onto the main window: the tab returns
   * to the workspace the main window is showing and is re-selected locally.
   */
  async function onTabWindowClosed(tabId: string, reattach = false): Promise<void> {
    if (!store.isDetached(tabId)) return
    if (!reattach) {
      // Close through the main window's pipeline so the tab, its panes and
      // its server-side session are torn down together. When that fails the
      // tab stays in the session and `handleClosed` remounts it here, which
      // is the safe fallback.
      await closeTab(tabId)
      store.handleClosed(tabId)
      return
    }
    store.handleClosed(tabId)
    const tab = tabs.value.find((candidate) => candidate.paneId === tabId)
    if (tab) rehomeRecalledTab(tab)
    feedback.flashRecall(tabId)
    await nextTick()
    if (!visibleTabList.value.some((candidate) => candidate.paneId === tabId)) return
    commitLocalActivePane(tabId)
    await nextTick()
    focusActive()
  }

  /**
   * Bridge the Rust `tab-window-closed` event (and the detached window's
   * `detached-dock-hint` hover signal) into the store. Returns an unlisten
   * callback; a no-op outside the desktop app.
   */
  function setupListener(): () => void {
    if (!isTauri()) return () => {}
    const listen = (window as any).__TAURI__?.event?.listen
    if (!listen) return () => {}

    let disposed = false
    const unlisteners: Array<() => void> = []
    const track = (promise: Promise<() => void>, label: string) => {
      promise
        .then((fn) => {
          if (disposed) fn()
          else unlisteners.push(fn)
        })
        .catch((error: unknown) => {
          console.warn(`[detached] failed to listen for ${label}`, error)
        })
    }

    track(
      listen(CLOSED_EVENT, (event: { payload?: { tab_id?: string; reattach?: boolean } }) => {
        const tabId = event?.payload?.tab_id
        if (typeof tabId !== 'string' || !tabId) return
        feedback.setDockHint(null)
        void onTabWindowClosed(tabId, event?.payload?.reattach === true)
      }),
      'window close'
    )

    track(
      listen(DOCK_HINT_EVENT, (event: { payload?: { tab_id?: string; active?: boolean } }) => {
        const tabId = event?.payload?.tab_id
        feedback.setDockHint(
          event?.payload?.active === true && typeof tabId === 'string' && tabId ? tabId : null
        )
      }),
      'dock hint'
    )

    return () => {
      disposed = true
      for (const fn of unlisteners.splice(0)) fn()
      feedback.setDockHint(null)
    }
  }

  function refresh(): Promise<void> {
    return store.refreshFromRust()
  }

  // A reload can restore the server's global active pane onto a tab that now
  // lives in its own window. Keep the local selection pointing at something
  // the main window actually renders — again without `apiActivatePane`.
  watch(
    [activePaneId, () => store.detachedTabIds],
    () => {
      const tabId = activePaneId.value
      if (!tabId || !store.isDetached(tabId)) return
      const neighborId = pickNeighborTabId(tabId)
      if (neighborId) commitLocalActivePane(neighborId)
      else activePaneId.value = null
    },
    { flush: 'post' }
  )

  return { detachTab, onTabWindowClosed, setupListener, refresh }
}
