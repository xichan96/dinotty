import type { Ref } from 'vue'
import { ensureSplitRoot } from '../types/pane'
import { useSshConnectFlow } from './useSshConnectFlow'
import type { useAppCore } from './useAppCore'

export interface AppConnectivityOptions {
  core: ReturnType<typeof useAppCore>
  sshPanelRef: Ref<{ open(): void } | undefined>
  persist: () => void
}

export function useAppConnectivity(options: AppConnectivityOptions) {
  const { core, sshPanelRef, persist } = options
  const {
    tabs,
    activeWorkspaceId,
    workspaces,
    syncWs,
    sshAuth,
    onSshConnectRef,
    commitLocalActivePane,
    focusActive,
    newTab,
    splitPane,
  } = core

  const { onServerConnect, onSshConnect, onSshReconnect, onSshAuthSubmit, onSshAuthCancel } =
    useSshConnectFlow({
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
    })

  onSshConnectRef.value = onSshConnect

  function onNewMenuAction(type: 'new-tab' | 'split-h' | 'split-v' | 'broadcast' | 'ssh-connect') {
    switch (type) {
      case 'new-tab':
        return newTab()
      case 'split-h':
        return splitPane.splitPane('horizontal')
      case 'split-v':
        return splitPane.splitPane('vertical')
      case 'broadcast':
        return splitPane.toggleBroadcast()
      case 'ssh-connect':
        return sshPanelRef.value?.open()
    }
  }

  return {
    onServerConnect,
    onSshConnect,
    onSshReconnect,
    onSshAuthSubmit,
    onSshAuthCancel,
    onNewMenuAction,
  }
}
