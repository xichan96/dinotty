import { type Ref } from 'vue'
import type { Tab } from '../types/pane'

export interface TabPersistenceOptions {
  tabs: Ref<Tab[]>
  activePaneId: Ref<string | null>
}

export interface TabPersistenceState {
  persist: () => void
  persistNow: () => void
  flushOnUnload: () => void
  dispose: () => void
}

export function useTabPersistence(opts: TabPersistenceOptions): TabPersistenceState {
  const { tabs, activePaneId } = opts

  let persistTimer: ReturnType<typeof setTimeout> | null = null

  function persistNow() {
    if (typeof localStorage === 'undefined') return
    const state = tabs.value.map((t) => {
      if (t.type === 'terminal') {
        return {
          type: t.type,
          paneId: t.paneId,
          layout: t.layout,
          activePaneId: t.activePaneId,
          broadcastMode: t.broadcastMode,
          customTitle: t.customTitle,
          connectionId: t.connectionId,
          cwd: t.cwd,
          workspaceId: t.workspaceId,
        }
      }
      return {
        type: t.type,
        paneId: t.paneId,
        title: t.title,
        pluginId: t.pluginId,
        workspaceId: t.workspaceId,
      }
    })
    const activeIdx = tabs.value.findIndex((t) => t.paneId === activePaneId.value)
    localStorage.setItem('dinotty_tabs', JSON.stringify({ tabs: state, activeIdx }))
  }

  function persist() {
    if (persistTimer) clearTimeout(persistTimer)
    persistTimer = setTimeout(persistNow, 200)
  }

  function flushOnUnload() {
    if (persistTimer) {
      clearTimeout(persistTimer)
      persistNow()
    }
  }

  function onBeforeUnload() {
    flushOnUnload()
  }

  window.addEventListener('beforeunload', onBeforeUnload)

  function dispose() {
    if (persistTimer) {
      clearTimeout(persistTimer)
      persistTimer = null
    }
    window.removeEventListener('beforeunload', onBeforeUnload)
  }

  return { persist, persistNow, flushOnUnload, dispose }
}
