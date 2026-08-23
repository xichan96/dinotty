import { getAllLeaves } from '../types/pane'
import { usePluginNotifyBridge } from './usePluginNotifyBridge'
import {
  pushNotification,
  mintNotificationRequestId,
  getNotificationClientId,
} from './useNotification'
import { uiConfirm } from './useConfirm'
import { toActiveWorkspaceId } from './useWorkspaces'
import type { useAppCore } from './useAppCore'

export interface PluginBridgeOptions {
  core: ReturnType<typeof useAppCore>
}

/**
 * Window-global plugin-facing host contract (C32). Kept together so the
 * __dinotty_* surface is defined in one place, not scattered per hook.
 */
export function usePluginBridge(options: PluginBridgeOptions) {
  const {
    termRefs,
    tabs,
    activePaneId,
    lastTerminalCwd,
    activeWorkspacePath,
    outputListeners,
    pluginActivePaneId,
    pluginActivePaneListeners,
    matchWorkspace,
    activateWorkspace,
    activeWorkspaceId,
    newTab,
    splitPane,
    openPlugin,
    focusActive,
  } = options.core

  // Window globals for plugin context
  window.__dinotty_terminal_api = {
    send(paneId: string, data: string) {
      termRefs[paneId]?.sendData(data)
    },
    activePaneId() {
      return pluginActivePaneId.value
    },
    onDidChangeActivePane(callback: (paneId: string | null) => void) {
      pluginActivePaneListeners.add(callback)
      return {
        dispose() {
          pluginActivePaneListeners.delete(callback)
        },
      }
    },
    activeCwd() {
      const tab = tabs.value.find((t) => t.paneId === activePaneId.value)
      if (tab?.type === 'terminal' && tab.cwd) return tab.cwd
      if (lastTerminalCwd.value) return lastTerminalCwd.value
      const wsPath = activeWorkspacePath.value
      return wsPath ?? null
    },
    listPanes() {
      const result: { id: string; title: string; active: boolean }[] = []
      for (const t of tabs.value) {
        if (t.type !== 'terminal') continue
        for (const leaf of getAllLeaves(t.layout)) {
          result.push({
            id: leaf.paneId,
            title: leaf.title,
            active: t.paneId === activePaneId.value && leaf.paneId === t.activePaneId,
          })
        }
      }
      return result
    },
    onOutput(callback: (paneId: string, data: string) => void) {
      outputListeners.add(callback)
      return {
        dispose() {
          outputListeners.delete(callback)
        },
      }
    },
    async createTab(command?: string) {
      newTab()
      const tab = tabs.value.find((t) => t.paneId === activePaneId.value)
      return tab?.type === 'terminal' ? tab.activePaneId : ''
    },
    async createTerminalTab(opts: { cwd: string; argv: string[]; title?: string }) {
      const ws = matchWorkspace(opts.cwd)
      const targetId = toActiveWorkspaceId(ws?.id)
      if (targetId !== activeWorkspaceId.value) {
        const committed = await activateWorkspace(targetId)
        if (!committed) return ''
      }
      return newTab(opts.cwd, opts.argv, opts.title)
    },
    async splitTerminalPane(opts?: {
      direction?: 'horizontal' | 'vertical'
      cwd?: string
    }): Promise<string | null> {
      const direction = opts?.direction ?? 'vertical'
      return splitPane.splitPane(direction, false, opts?.cwd)
    },
  }
  // Test hooks for P3 verification (focusActive + isComposing guard).
  window.__dinotty_test_focus_active = focusActive
  window.__dinotty_test_is_composing = (paneId: string) => termRefs[paneId]?.isComposing() ?? false

  const pluginNotifyBridge = usePluginNotifyBridge({
    pushNotification,
  })

  window.__dinotty_ui_notify = (
    message: string,
    level?: 'info' | 'warn' | 'error',
    title?: string
  ) => {
    const type = level === 'error' ? 'error' : level === 'warn' ? 'warning' : 'info'
    const requestId = mintNotificationRequestId()
    const job = Object.freeze({
      requestId,
      body: JSON.stringify({
        clientId: getNotificationClientId(),
        requestId,
        source: 'plugin',
        type,
        title: title ?? 'Plugin',
        body: message,
      }),
    })

    pluginNotifyBridge.enqueueJob(job)
  }
  window.__dinotty_ui_confirm = (message: string) => uiConfirm(message)
  window.__dinotty_open_plugin = openPlugin

  return { pluginNotifyBridge }
}
