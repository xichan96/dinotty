import { defineStore } from 'pinia'
import { nextTick, ref } from 'vue'
import { isTauri, tauriInvoke } from '../composables/useTransport'

/** Shape of the Rust registry entry (`list_detached_tab_windows`). */
export interface DetachedWindowInfo {
  tab_id: string
  label: string
  title?: string | null
}

/**
 * Local, per-client view of which tabs live in their own native window.
 *
 * This is display-layer state only: the tab itself stays in the server session
 * store. It is never synced, never persisted and never sent to the server. On
 * Web/mobile every operation is a no-op so shared call sites do not need to
 * branch — the Rust commands do not exist there.
 */
export const useDetachedWindowsStore = defineStore('detachedWindows', () => {
  const detachedTabIds = ref<Set<string>>(new Set())
  /** Per-window registry copy, used for labels/tooltips in Mission Control. */
  const detachedWindows = ref<Map<string, DetachedWindowInfo>>(new Map())

  function isDetached(tabId: string): boolean {
    return detachedTabIds.value.has(tabId)
  }

  /** Native window title for a detached tab, when the registry knows one. */
  function windowTitleOf(tabId: string): string | null {
    return detachedWindows.value.get(tabId)?.title ?? null
  }

  /** Drop ids that used to be detached from `items`, keeping the input order. */
  function withoutDetached<T extends { paneId: string }>(items: readonly T[]): T[] {
    return items.filter((item) => !detachedTabIds.value.has(item.paneId))
  }

  // Replacing the Set/Map (instead of mutating them) keeps every computed that
  // reads this store's state invalidated without relying on deep collection
  // tracking.
  function setDetached(tabId: string, detached: boolean, info?: DetachedWindowInfo) {
    const next = new Set(detachedTabIds.value)
    const nextWindows = new Map(detachedWindows.value)
    if (detached) {
      next.add(tabId)
      if (info) nextWindows.set(tabId, info)
    } else {
      next.delete(tabId)
      nextWindows.delete(tabId)
    }
    detachedTabIds.value = next
    detachedWindows.value = nextWindows
  }

  async function focusDetached(tabId: string): Promise<boolean> {
    if (!isTauri()) return false
    try {
      await tauriInvoke('focus_tab_window', { tabId })
      return true
    } catch (error) {
      console.warn('[detached] failed to focus window', tabId, error)
      return false
    }
  }

  /**
   * Detach `tabId` into its own window.
   *
   * The order matters: marking the tab detached first makes the main window
   * unmount its TerminalPane on the next tick, and only then do we create the
   * window. Opening first would briefly attach both clients to the same PTY.
   * A failed create rolls the mark back so the pane remounts.
   */
  async function openDetached(tabId: string, title?: string): Promise<boolean> {
    if (!isTauri()) return false
    if (detachedTabIds.value.has(tabId)) return focusDetached(tabId)

    setDetached(tabId, true, { tab_id: tabId, label: `tab-${tabId}`, title: title ?? null })
    await nextTick()

    const args: Record<string, unknown> = { tabId }
    if (title) args.title = title

    try {
      await tauriInvoke('open_tab_window', args)
      return true
    } catch (error) {
      console.warn('[detached] failed to open window', tabId, error)
      setDetached(tabId, false)
      return false
    }
  }

  /** Programmatically recall a window. The window's close event is what
   *  actually remounts the tab in the main window (`handleClosed`). */
  async function closeDetached(tabId: string): Promise<boolean> {
    if (!isTauri()) return false
    try {
      await tauriInvoke('close_tab_window', { tabId })
      return true
    } catch (error) {
      console.warn('[detached] failed to close window', tabId, error)
      return false
    }
  }

  /** Rebuild the local set from the Rust registry. Called after a main-window
   *  reload, when the Rust process still owns windows the webview forgot. */
  async function refreshFromRust(): Promise<void> {
    if (!isTauri()) return
    try {
      const list = await tauriInvoke('list_detached_tab_windows')
      const entries = Array.isArray(list) ? (list as DetachedWindowInfo[]) : []
      const valid = entries.filter((entry) => typeof entry?.tab_id === 'string')
      detachedTabIds.value = new Set(valid.map((entry) => entry.tab_id))
      detachedWindows.value = new Map(valid.map((entry) => [entry.tab_id, entry]))
    } catch (error) {
      console.warn('[detached] failed to list windows', error)
    }
  }

  /** A detached window closed: the tab belongs to the main window again. */
  function handleClosed(tabId: string): void {
    if (!detachedTabIds.value.has(tabId)) return
    setDetached(tabId, false)
  }

  return {
    detachedTabIds,
    detachedWindows,
    isDetached,
    windowTitleOf,
    withoutDetached,
    focusDetached,
    openDetached,
    closeDetached,
    refreshFromRust,
    handleClosed,
  }
})
