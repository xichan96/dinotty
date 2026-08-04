import { type Ref, nextTick } from 'vue'
import type { Tab, TerminalTab } from '../types/pane'
import type { Workspace } from '../types/workspace'

export interface SshConnectResult {
  tab_id: string
  pane_id: string
  layout: any
  connection_id?: string
  workspace_id?: string
}

export interface SshConnectFlowOptions {
  tabs: Ref<Tab[]>
  activeWorkspaceId: Ref<string | null>
  workspaces: Ref<Workspace[]>
  syncWs: { markRecentlyCreated: (id: string) => void }
  sshAuth: { submit: (responses: string[]) => void; cancel: () => void }
  sshPanelRef: Ref<{ open: () => void } | null | undefined>
  ensureSplitRoot: (layout: any) => any
  commitLocalActivePane: (paneId: string) => void
  persist: () => void
  focusActive: () => void
}

export interface SshConnectFlowState {
  onServerConnect: (host: string, port: number) => void
  onSshConnect: (result: SshConnectResult) => Promise<void>
  onSshReconnect: () => void
  onSshAuthSubmit: (responses: string[]) => void
  onSshAuthCancel: () => void
}

export function useSshConnectFlow(opts: SshConnectFlowOptions): SshConnectFlowState {
  const {
    tabs,
    activeWorkspaceId,
    workspaces,
    syncWs,
    sshAuth,
    sshPanelRef,
    ensureSplitRoot,
    commitLocalActivePane,
    persist,
    focusActive,
  } = opts

  function onServerConnect(host: string, port: number) {
    const proto = location.protocol
    window.location.href = `${proto}//${host}:${port}/`
  }

  async function onSshConnect(result: SshConnectResult) {
    const resolvedConnectionId = result.connection_id
      ?? workspaces.value.find((w) => w.id === activeWorkspaceId.value)?.connection_id
    const resolvedWorkspaceId = result.workspace_id ?? activeWorkspaceId.value ?? undefined

    const existing = tabs.value.find((t) => t.paneId === result.tab_id)
    if (existing) {
      if (existing.type === 'terminal') {
        if (resolvedConnectionId && !existing.connectionId) {
          existing.connectionId = resolvedConnectionId
        }
        if (resolvedWorkspaceId) {
          existing.workspaceId = resolvedWorkspaceId
        }
      }
      commitLocalActivePane(result.tab_id)
      persist()
      nextTick(() => focusActive())
      return
    }
    syncWs.markRecentlyCreated(result.tab_id)
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
      connectionId: resolvedConnectionId,
      workspaceId: resolvedWorkspaceId,
    })
    commitLocalActivePane(result.tab_id)
    persist()
    nextTick(() => focusActive())
  }

  function onSshReconnect() {
    sshPanelRef.value?.open()
  }

  const onSshAuthSubmit = (responses: string[]) => sshAuth.submit(responses)
  const onSshAuthCancel = () => sshAuth.cancel()

  return { onServerConnect, onSshConnect, onSshReconnect, onSshAuthSubmit, onSshAuthCancel }
}
