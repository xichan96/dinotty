import { nextTick, watch, type Ref } from 'vue'
import type { Tab } from '../types/pane'
import { findLeaf } from '../types/pane'
import { useDetachedWindowsStore } from '../stores/detachedWindowsStore'
import { isTauri } from './useTransport'

export interface DetachedWindowsOptions {
  tabs: Ref<Tab[]>
  activePaneId: Ref<string | null>
  /** Workspace-filtered tab list rendered by the TabBar (detached tabs already
   *  excluded). Used to pick a neighboring tab when the active one leaves. */
  visibleTabList: Ref<Array<{ paneId: string }>>
  /** Local active-tab switch that never calls `apiActivatePane`. */
  commitLocalActivePane: (paneId: string) => void
  focusActive: () => void
  toast: { error: (message: string) => void }
  t: (key: string) => string
}

const CLOSED_EVENT = 'tab-window-closed'

export function useDetachedWindows(options: DetachedWindowsOptions) {
  const { tabs, activePaneId, visibleTabList, commitLocalActivePane, focusActive, toast, t } =
    options
  const store = useDetachedWindowsStore()

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
   * The window closed (or was destroyed): the tab returns to the main window.
   * Re-select it locally when it is part of the current view. Tabs in another
   * workspace stay put — the workspace-switch prompt belongs to task F.
   */
  async function onTabWindowClosed(tabId: string): Promise<void> {
    if (!store.isDetached(tabId)) return
    store.handleClosed(tabId)
    await nextTick()
    if (!visibleTabList.value.some((tab) => tab.paneId === tabId)) return
    commitLocalActivePane(tabId)
    await nextTick()
    focusActive()
  }

  /**
   * Bridge the Rust `tab-window-closed` event into the store. Returns an
   * unlisten callback; a no-op outside the desktop app.
   */
  function setupListener(): () => void {
    if (!isTauri()) return () => {}
    const listen = (window as any).__TAURI__?.event?.listen
    if (!listen) return () => {}

    let disposed = false
    let unlisten: (() => void) | undefined
    listen(CLOSED_EVENT, (event: { payload?: { tab_id?: string } }) => {
      const tabId = event?.payload?.tab_id
      if (typeof tabId === 'string' && tabId) void onTabWindowClosed(tabId)
    })
      .then((fn: () => void) => {
        if (disposed) fn()
        else unlisten = fn
      })
      .catch((error: unknown) => {
        console.warn('[detached] failed to listen for window close', error)
      })

    return () => {
      disposed = true
      unlisten?.()
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
