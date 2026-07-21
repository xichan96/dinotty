import { nextTick } from 'vue'
import { storeToRefs } from 'pinia'
import type { SyncServerMsg, SyncClientMsg } from '../types/protocol'
import type { TerminalTab } from '../types/pane'
import { getAllLeaves, findLeaf, migrateTab, migratePreviewToLeaf, ensureSplitRoot } from '../types/pane'
import {
  initializePaneMru,
  reconcilePaneMru,
  removePaneFromMru,
  touchPaneMru,
} from '../types/paneMru'
import { useSessionStore } from '../stores/sessionStore'
import { useUiStore } from '../stores/uiStore'
import {
  getApiBase,
  wsUrlWithToken,
  hasAuthToken,
} from './apiBase'
import { isTauri } from './useTransport'
import { handlePluginChanged } from './usePluginLoader'
import { useWorkspaces } from './useWorkspaces'
import { apiCreatePluginTab } from './useTabApi'
import type TerminalPane from '../components/terminal/TerminalPane.vue'

export function useSyncWebSocket(opts: {
  termRefs: Record<string, InstanceType<typeof TerminalPane>>
  persist: () => void
  focusActive: () => void
  newTab: () => Promise<void>
}) {
  const { termRefs, persist, focusActive, newTab } = opts
  const session = useSessionStore()
  const { tabs, activePaneId } = storeToRefs(session)
  const ui = useUiStore()
  const { syncConnected } = storeToRefs(ui)
  const { workspaces, activeWorkspaceId } = useWorkspaces()

  let syncWs: WebSocket | null = null
  let suppressSync = false
  let syncReconnectDelay = 1000

  // Grace period: tabs created within the last 5s are protected from tab_list pruning.
  // This prevents a race where tab_list arrives before the REST-driven tab_created.
  const recentlyCreated = new Map<string, number>()
  const GRACE_MS = 5000

  function markRecentlyCreated(tabId: string) {
    recentlyCreated.set(tabId, Date.now())
  }

  function pruneStaleEntries() {
    const now = Date.now()
    for (const [id, ts] of recentlyCreated) {
      if (now - ts > GRACE_MS) recentlyCreated.delete(id)
    }
  }

  function sendSync(msg: SyncClientMsg) {
    if (suppressSync) return
    if (syncWs && syncWs.readyState === WebSocket.OPEN) {
      syncWs.send(JSON.stringify(msg))
    }
  }

  function sendLayoutSync(tabPaneId: string, layout: any, activePaneIdVal: string) {
    sendSync({ type: 'update_layout', pane_id: tabPaneId, layout, active_pane_id: activePaneIdVal })
  }

  // SSH keyboard-interactive auth callback
  let onSshAuthPrompt: ((paneId: string, prompts: Array<{ prompt: string; echo: boolean }>) => void) | null = null

  function setSshAuthPromptHandler(handler: (paneId: string, prompts: Array<{ prompt: string; echo: boolean }>) => void) {
    onSshAuthPrompt = handler
  }

  function sendSshAuthResponse(paneId: string, responses: string[]) {
    sendSync({ type: 'ssh_auth_response', pane_id: paneId, responses })
  }

  function getSavedTab(paneId: string): any {
    try {
      const raw = localStorage.getItem('dinotty_tabs')
      if (!raw) return null
      const { tabs: savedTabs } = JSON.parse(raw)
      const direct = savedTabs?.find((t: any) => t.paneId === paneId)
      if (direct) return direct
      return (
        savedTabs?.find((t: any) => {
          if (!t.layout) return false
          const leaves = getAllLeaves(t.layout)
          return leaves.some((l: any) => l.paneId === paneId)
        }) ?? null
      )
    } catch {
      return null
    }
  }

  async function connectSyncWS() {
    let url: string
    if (isTauri()) {
      const origin = await getApiBase()
      url = `${origin.replace(/^http/, 'ws')}/ws/sync`
    } else {
      const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
      url = `${proto}//${location.host}/ws/sync`
    }
    const wsUrl = wsUrlWithToken(url)
    if (wsUrl === url && hasAuthToken()) {
      console.warn('[sync] token available but not appended to WS URL')
    }
    syncWs = new WebSocket(wsUrl)

    syncWs.onopen = () => {
      console.log('[sync] connected')
      syncConnected.value = true
      syncReconnectDelay = 1000
    }

    function handleMsg(e: { data: string }) {
      let msg: SyncServerMsg
      try {
        msg = JSON.parse(e.data)
      } catch {
        return
      }

      if (msg.type === 'tab_list') {
        const localLeafIds = new Set<string>()
        const localTabIds = new Set<string>()
        for (const t of tabs.value) {
          if (t.type === 'terminal') {
            localTabIds.add(t.paneId)
            for (const leaf of getAllLeaves(t.layout)) {
              localLeafIds.add(leaf.paneId)
            }
          }
        }

        for (const tab of msg.tabs) {
          if (
            !localLeafIds.has(tab.pane_id) &&
            !localTabIds.has(tab.pane_id) &&
            !localTabIds.has(tab.tab_id)
          ) {
            const serverLayout = tab.layout ?? null
            // Always look up the saved entry so we can restore fields the
            // backend does not track (workspaceId, customTitle, preview
            // state). The server layout still takes precedence for the
            // layout itself when present.
            const saved = getSavedTab(tab.pane_id)
            const migratedRaw = saved ? migrateTab(saved) : null
            const migrated = migratedRaw ? migratePreviewToLeaf(migratedRaw) : null
            tabs.value.push({
              type: 'terminal',
              paneId: tab.tab_id,
              layout: ensureSplitRoot(
                serverLayout ??
                  migrated?.layout ?? {
                    type: 'leaf',
                    paneId: tab.pane_id,
                    title: 'Terminal',
                    ratio: 1,
                    zoomed: false,
                  }
              ),
              activePaneId: tab.active_pane_id ?? migrated?.activePaneId ?? tab.pane_id,
              paneMru: initializePaneMru(
                getAllLeaves(
                  ensureSplitRoot(
                    serverLayout ??
                      migrated?.layout ?? {
                        type: 'leaf',
                        paneId: tab.pane_id,
                        title: 'Terminal',
                        ratio: 1,
                        zoomed: false,
                      }
                  )
                ).map((leaf) => leaf.paneId),
                tab.active_pane_id ?? migrated?.activePaneId ?? tab.pane_id
              ),
              broadcastMode: false,
              broadcastActivity: 0,
              previewVisible: migrated?.previewVisible ?? false,
              previewAddress: migrated?.previewAddress ?? '',
              previewUrl: migrated?.previewUrl ?? '',
              previewKind: migrated?.previewKind ?? 'web',
              customTitle: migrated?.customTitle,
              cwd: tab.cwd,
              connectionId: tab.connection_id,
              workspaceId: migrated?.workspaceId,
            })
          }
        }

        // Migrate legacy plugin tabs from localStorage: convert to TerminalTab
        // with a plugin leaf and register with the backend so they gain a
        // `tab_layouts` entry (required for Mode A drag-and-drop merge).
        try {
          const raw = localStorage.getItem('dinotty_tabs')
          if (raw) {
            const { tabs: savedTabs } = JSON.parse(raw)
            for (const st of savedTabs) {
              if (st.type !== 'plugin') continue
              if (tabs.value.some((t) => t.paneId === st.paneId)) continue
              const migrated = migrateTab(st)
              tabs.value.push(migrated)
              // Fire-and-forget: the backend `insert_tab` is idempotent, so
              // re-registering an already-tracked plugin tab is a no-op.
              void apiCreatePluginTab(st.pluginId, {
                title: st.title ?? st.pluginId,
                tabId: st.paneId,
              }).catch((e) => console.warn('[sync] plugin tab register failed:', e))
            }
          }
        } catch {
          /* noop */
        }

        // Remove terminal tabs whose leaf paneIds are no longer on the server
        const serverTabIds = new Set(msg.tabs.map((t) => t.tab_id))
        const serverLeafIds = new Set(
          msg.tabs.flatMap((t) => (t.layout ? getAllLeaves(t.layout).map((l) => l.paneId) : []))
        )
        pruneStaleEntries()
        tabs.value = tabs.value.filter((t) => {
          if (t.type === 'plugin') return true
          // Protect recently-created tabs from being pruned (race with REST response)
          if (recentlyCreated.has(t.paneId)) return true
          return (
            serverTabIds.has(t.paneId) ||
            getAllLeaves(t.layout).some((l) => serverLeafIds.has(l.paneId))
          )
        })

        if (msg.active_pane_id) {
          const cur = tabs.value.find((t) => t.paneId === activePaneId.value)
          if (!cur || cur.type !== 'plugin') {
            const targetTab = tabs.value.find((t) => {
              if (t.type !== 'terminal') return false
              return !!findLeaf(t.layout, msg.active_pane_id!)
            }) as TerminalTab | undefined
            if (targetTab) {
              suppressSync = true
              targetTab.activePaneId = msg.active_pane_id
              activePaneId.value = targetTab.paneId
              suppressSync = false
            }
          }
        }

        if (msg.tabs.length === 0 && tabs.value.length === 0) {
          newTab()
        }

        if (!activePaneId.value || !tabs.value.some((t) => t.paneId === activePaneId.value)) {
          if (tabs.value.length > 0) {
            activePaneId.value = tabs.value[0].paneId
          }
        }

        persist()
        nextTick(() => focusActive())
      } else if (msg.type === 'tab_created') {
        const existing = tabs.value.find((t) => {
          if (t.type !== 'terminal') return false
          return t.paneId === msg.tab_id || !!findLeaf(t.layout, msg.pane_id)
        })
        if (existing) {
          // Update cwd if sync message has it and existing tab doesn't
          if (msg.cwd && existing.type === 'terminal' && !existing.cwd) {
            existing.cwd = msg.cwd
          }
          // Update connectionId if sync message has it and existing tab doesn't
          if (msg.connection_id && existing.type === 'terminal' && !existing.connectionId) {
            existing.connectionId = msg.connection_id
          }
        }
        if (!existing) {
          const layout = msg.layout
            ? ensureSplitRoot(msg.layout)
            : ensureSplitRoot({
                type: 'leaf',
                paneId: msg.pane_id,
                title: 'Terminal',
                ratio: 1,
                zoomed: false,
              })
          tabs.value.push({
            type: 'terminal',
            paneId: msg.tab_id,
            layout,
            activePaneId: msg.pane_id,
            paneMru: [msg.pane_id],
            broadcastMode: false,
            broadcastActivity: 0,
            previewVisible: false,
            previewAddress: '',
            previewUrl: '',
            previewKind: 'web',
            cwd: msg.cwd,
            connectionId: msg.connection_id,
          })
          markRecentlyCreated(msg.tab_id)
          activePaneId.value = msg.tab_id
          persist()
          nextTick(() => focusActive())
        }
      } else if (msg.type === 'tab_closed') {
        // Match by tab paneId only. The backend always broadcasts
        // `tab_closed` with the tab's paneId (a.k.a. tab_id), never a leaf
        // paneId. A previous fallback that searched layouts by leaf paneId
        // was liable to remove the wrong tab after a Mode A merge: the src
        // plugin tab's paneId equals its leaf paneId, so once the plugin leaf
        // was inserted into the dst tab the fallback would find and destroy
        // the dst tab.
        const tabIdx = tabs.value.findIndex(
          (t) => t.type === 'terminal' && t.paneId === msg.pane_id
        )
        if (tabIdx !== -1) {
          const tab = tabs.value[tabIdx] as TerminalTab
          for (const leaf of getAllLeaves(tab.layout)) {
            delete termRefs[leaf.paneId]
          }
          tabs.value.splice(tabIdx, 1)
          if (tabs.value.length === 0) {
            newTab()
          } else if (activePaneId.value === tab.paneId) {
            activePaneId.value = tabs.value[Math.min(tabIdx, tabs.value.length - 1)].paneId
            persist()
            nextTick(() => focusActive())
          }
        }
      } else if (msg.type === 'tab_activated') {
        const cur = tabs.value.find((t) => t.paneId === activePaneId.value)
        if (!cur || cur.type !== 'plugin') {
          const targetTab = tabs.value.find((t) => {
            if (t.type !== 'terminal') return false
            return !!findLeaf(t.layout, msg.pane_id)
          }) as TerminalTab | undefined
          if (targetTab) {
            suppressSync = true
            targetTab.paneMru = touchPaneMru(targetTab.paneMru, msg.pane_id)
            targetTab.activePaneId = msg.pane_id
            activePaneId.value = targetTab.paneId
            suppressSync = false
          }
        }
      } else if (msg.type === 'layout_updated') {
        // Two-pass match: prefer paneId, fall back to leaf overlap only if no
        // paneId match. A single-pass `find()` with OR-ed conditions can pick
        // the wrong tab during Mode A merge: after the src tab's leaves are
        // spliced into dst, src also matches the leaf-overlap check. If src
        // is iterated first, it gets selected as `targetTab`, and the filter
        // below then removes dst (its leaves are now in src). When
        // `TabClosed(src)` arrives next, src is also removed - both tabs
        // vanish. Prioritizing paneId match avoids this.
        let targetTab = tabs.value.find(
          (t): t is TerminalTab => t.type === 'terminal' && t.paneId === msg.pane_id
        )
        if (!targetTab) {
          const incomingLeafIds = getAllLeaves(msg.layout).map((l: any) => l.paneId)
          targetTab = tabs.value.find((t): t is TerminalTab => {
            if (t.type !== 'terminal') return false
            const localLeafIds = getAllLeaves(t.layout).map((l) => l.paneId)
            return incomingLeafIds.some((id: string) => localLeafIds.includes(id))
          })
        }
        if (targetTab) {
          const incomingLeafIds = getAllLeaves(msg.layout).map((l: any) => l.paneId)
          const localLeafIds = getAllLeaves(targetTab.layout).map((l) => l.paneId)
          const sameLeaves =
            incomingLeafIds.length === localLeafIds.length &&
            incomingLeafIds.every((id: string) => localLeafIds.includes(id))
          const removedPaneIds = localLeafIds.filter((id) => !incomingLeafIds.includes(id))
          const previousActivePaneId = targetTab.activePaneId
          const activePaneWasRemoved = removedPaneIds.includes(previousActivePaneId)

          suppressSync = true
          if (!sameLeaves) {
            targetTab.layout = ensureSplitRoot(msg.layout)
          }
          for (const removedPaneId of removedPaneIds) {
            targetTab.paneMru = removePaneFromMru(
              targetTab.paneMru,
              removedPaneId
            ).paneMru
          }
          targetTab.paneMru = reconcilePaneMru(
            targetTab.paneMru,
            incomingLeafIds,
            previousActivePaneId
          )
          if (activePaneWasRemoved) {
            targetTab.activePaneId = targetTab.paneMru[0] ?? msg.active_pane_id
          } else if (incomingLeafIds.includes(msg.active_pane_id)) {
            targetTab.activePaneId = msg.active_pane_id
            targetTab.paneMru = touchPaneMru(targetTab.paneMru, msg.active_pane_id)
          } else {
            targetTab.activePaneId = previousActivePaneId
          }
          suppressSync = false

          if (activePaneWasRemoved && targetTab.activePaneId !== msg.active_pane_id) {
            sendLayoutSync(targetTab.paneId, targetTab.layout, targetTab.activePaneId)
          }

          const updatedLeafIds = new Set(getAllLeaves(targetTab.layout).map((l) => l.paneId))
          tabs.value = tabs.value.filter((t) => {
            if (t.type !== 'terminal') return true
            if (t.paneId === targetTab.paneId) return true
            const leaves = getAllLeaves(t.layout)
            return !leaves.every((l) => updatedLeafIds.has(l.paneId))
          })

          persist()
          nextTick(() => {
            getAllLeaves(targetTab.layout).forEach((l) => termRefs[l.paneId]?.fit())
            if (activePaneId.value === targetTab.paneId) {
              focusActive()
            }
          })
        }
      } else if (msg.type === 'plugin_changed') {
        handlePluginChanged(msg.plugin_id, msg.change)
      } else if (msg.type === 'ssh_auth_prompt') {
        // SSH keyboard-interactive auth prompt from backend
        // Emit event for the SSH auth dialog to handle
        onSshAuthPrompt?.(msg.pane_id, msg.prompts)
      } else if (msg.type === 'workspace_list') {
        workspaces.value = msg.workspaces
        activeWorkspaceId.value = msg.active_workspace_id
      } else if (msg.type === 'workspace_created') {
        if (!workspaces.value.find((w) => w.id === msg.workspace.id)) {
          workspaces.value.push(msg.workspace)
        }
      } else if (msg.type === 'workspace_updated') {
        const idx = workspaces.value.findIndex((w) => w.id === msg.workspace.id)
        if (idx >= 0) workspaces.value[idx] = msg.workspace
      } else if (msg.type === 'workspace_deleted') {
        workspaces.value = workspaces.value.filter((w) => w.id !== msg.id)
        if (activeWorkspaceId.value === msg.id) {
          activeWorkspaceId.value = null
        }
        for (const tab of tabs.value) {
          if (tab.type === 'plugin' && tab.workspaceId === msg.id) {
            tab.workspaceId = undefined
          }
        }
      } else if (msg.type === 'workspace_activated') {
        activeWorkspaceId.value = msg.id
      } else if (msg.type === 'workspace_reordered') {
        for (let i = 0; i < msg.ids.length; i++) {
          const ws = workspaces.value.find((w) => w.id === msg.ids[i])
          if (ws) ws.order = i
        }
        workspaces.value.sort((a, b) => a.order - b.order)
      }
    }

    syncWs.onmessage = (e) => handleMsg(e)

    syncWs.onclose = (e) => {
      console.warn('[sync] disconnected', e.code, e.reason)
      syncWs = null
      syncConnected.value = false
      setTimeout(connectSyncWS, syncReconnectDelay)
      syncReconnectDelay = Math.min(syncReconnectDelay * 2, 30000)
    }

    syncWs.onerror = (e) => {
      console.error('[sync] error', e)
    }
  }

  function closeWs() {
    if (syncWs) {
      syncWs.close()
      syncWs = null
    }
  }

  function isConnected(): boolean {
    return !!syncWs && syncWs.readyState === WebSocket.OPEN
  }

  return {
    sendSync,
    sendLayoutSync,
    connectSyncWS,
    closeWs,
    isConnected,
    markRecentlyCreated,
    setSshAuthPromptHandler,
    sendSshAuthResponse,
    get suppressSync() {
      return suppressSync
    },
    set suppressSync(v: boolean) {
      suppressSync = v
    },
  }
}
