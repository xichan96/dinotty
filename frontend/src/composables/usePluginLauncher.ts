import { type Ref, nextTick } from 'vue'
import type { Tab, TerminalTab } from '../types/pane'
import type { LoadedPlugin } from './usePluginLoader'
import { apiCreatePluginTab } from './useTabApi'
import { isTouchDevice } from './useIsMobile'

export type PluginOpenMode = 'tab' | 'floating'

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
  /** Floating-window store facade: open() is idempotent and brings to front. */
  floatWindows?: { open: (pluginId: string) => void }
  /** Configured open mode for the plugin; absent/unknown values → 'tab'. */
  openModePref?: (pluginId: string) => PluginOpenMode
}

export interface PluginLauncherState {
  openPlugin: (pluginId: string, mode?: PluginOpenMode) => Promise<void>
}

/** Explicit mode wins over the pref; touch devices force the tab path
 *  (floating windows are desktop-only). */
export function resolvePluginOpenMode(
  explicit: PluginOpenMode | undefined,
  pref: PluginOpenMode,
  touch: boolean
): PluginOpenMode {
  const mode = explicit ?? pref
  if (touch) return 'tab'
  return mode
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

  async function openPlugin(pluginId: string, mode?: PluginOpenMode) {
    try {
      const pref = opts.openModePref ? opts.openModePref(pluginId) : 'tab'
      const resolved = resolvePluginOpenMode(mode, pref, isTouchDevice())
      if (resolved === 'floating') {
        const plugin = loadedPlugins.get(pluginId)
        if (!plugin || plugin.state !== 'active') {
          const msg =
            plugin?.state === 'error'
              ? `Plugin "${pluginId}" failed to load: ${plugin.error ?? 'unknown'}`
              : `Plugin "${pluginId}" is not loaded.`
          console.warn('[openPlugin]', msg)
          window.__dinotty_ui_notify?.(msg, 'error')
          return
        }
        opts.floatWindows?.open(pluginId)
        return
      }

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
        (t) => t.type === 'terminal' && t.paneId === result.tab_id
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
