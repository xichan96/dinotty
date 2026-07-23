import { type Ref, nextTick } from 'vue'
import type { Tab, TerminalTab } from '../types/pane'
import type { LoadedPlugin } from './usePluginLoader'
import { apiCreatePluginTab } from './useTabApi'

export interface PluginLauncherOptions {
  tabs: Ref<Tab[]>
  activeWorkspaceId: Ref<string | null>
  loadedPlugins: Map<string, LoadedPlugin>
  syncWs: { sendSync: (msg: any) => void }
  ensureSplitRoot: (layout: any) => any
  activateTab: (paneId: string) => Promise<boolean> | boolean
  commitLocalActivePane: (paneId: string) => void
  persist: () => void
  focusActive: () => void
}

export interface PluginLauncherState {
  openPlugin: (pluginId: string) => Promise<void>
}

export function usePluginLauncher(opts: PluginLauncherOptions): PluginLauncherState {
  const {
    tabs,
    activeWorkspaceId,
    loadedPlugins,
    syncWs,
    ensureSplitRoot,
    activateTab,
    commitLocalActivePane,
    persist,
    focusActive,
  } = opts

  async function openPlugin(pluginId: string) {
    try {
      const wsId = activeWorkspaceId.value ?? ''
      const paneId = `plugin:${pluginId}:${wsId}`
      const existing = tabs.value.find((t) => t.paneId === paneId)
      if (existing) {
        activateTab(paneId)
        return
      }

      const plugin = loadedPlugins.get(pluginId)
      if (!plugin || plugin.state !== 'active') {
        const msg =
          plugin?.state === 'error'
            ? `Plugin "${pluginId}" failed to load: ${plugin.error ?? 'unknown error'}`
            : `Plugin "${pluginId}" is not loaded.`
        console.warn('[openPlugin]', msg)
        window.__dinotty_ui_notify?.(msg, 'error')
        return
      }

      const result = await apiCreatePluginTab(pluginId, {
        title: plugin.manifest.name,
        tabId: paneId,
      })

      const existingTab = tabs.value.find(
        (t) => t.type === 'terminal' && t.paneId === result.tab_id,
      ) as TerminalTab | undefined
      if (existingTab) {
        const wsIdVal = wsId || undefined
        if (wsIdVal && !existingTab.workspaceId) existingTab.workspaceId = wsIdVal
      } else {
        tabs.value.push({
          type: 'terminal',
          paneId: result.tab_id,
          layout: ensureSplitRoot(result.layout),
          activePaneId: result.pane_id,
          paneMru: [result.pane_id],
          broadcastMode: false,
          broadcastActivity: 0,
          previewVisible: false,
          previewAddress: '',
          previewUrl: '',
          previewKind: 'web',
          workspaceId: wsId || undefined,
        })
      }
      commitLocalActivePane(result.tab_id)
      syncWs.sendSync({ type: 'activate_tab', pane_id: result.pane_id })
      persist()
      nextTick(() => focusActive())
    } catch (err) {
      console.error('[openPlugin] error:', err)
    }
  }

  return { openPlugin }
}
