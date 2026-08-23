import type { Ref } from 'vue'
import { isTauri } from './useTransport'
import { useDesktopLifecycle } from './useDesktopLifecycle'
import type { useToast } from 'vue-toastification'

export interface AppTauriOptions {
  desktopLifecycle: ReturnType<typeof useDesktopLifecycle>
  toast: ReturnType<typeof useToast>
  windowCloseConfirmVisible: Ref<boolean>
  trayVisibilityDialogVisible: Ref<boolean>
  lastTabCloseShortcutAt: Ref<number>
}

export function useAppTauri(options: AppTauriOptions) {
  const {
    desktopLifecycle,
    toast,
    windowCloseConfirmVisible,
    trayVisibilityDialogVisible,
    lastTabCloseShortcutAt,
  } = options

  let unlistenWindowClose: (() => void) | undefined

  // Tauri window close confirmation
  // On macOS, Cmd+W is bound to the native "Close" menu item and fires CloseRequested
  // in addition to the JS keydown handler. Track when the tab-close shortcut fires so
  // the window-close-requested listener can suppress the app-exit path — Cmd+W should
  // close the tab, not quit the app.
  function setupTauriWindowClose() {
    if (!isTauri()) return
    const listen = (window as any).__TAURI__?.event?.listen
    if (!listen) return
    listen('window-close-requested', () => {
      if (Date.now() - lastTabCloseShortcutAt.value < 500) {
        return
      }
      windowCloseConfirmVisible.value = true
    }).then((fn: () => void) => {
      unlistenWindowClose = fn
    })
  }

  async function onWindowCloseHide() {
    windowCloseConfirmVisible.value = false
    if (desktopLifecycle.needsTrayVisibilityConfirmation()) {
      trayVisibilityDialogVisible.value = true
      return
    }
    await performHideToTray()
  }

  async function performHideToTray() {
    try {
      await desktopLifecycle.hideToTray()
    } catch (error) {
      const message =
        typeof error === 'object' && error && 'message' in error
          ? String((error as { message: unknown }).message)
          : String(error)
      toast.error(message)
    }
  }

  async function onOpenSystemTraySettings() {
    try {
      await desktopLifecycle.openSystemTraySettings()
    } catch (error) {
      const message =
        typeof error === 'object' && error && 'message' in error
          ? String((error as { message: unknown }).message)
          : String(error)
      toast.error(message)
    }
  }

  async function onTrayVisibilityConfirmed() {
    desktopLifecycle.confirmTrayVisibility()
    trayVisibilityDialogVisible.value = false
    await performHideToTray()
  }

  function onTrayVisibilityCancel() {
    trayVisibilityDialogVisible.value = false
  }

  function onWindowCloseQuit() {
    windowCloseConfirmVisible.value = false
    void desktopLifecycle.requestQuit('window')
  }

  function onWindowCloseCancel() {
    windowCloseConfirmVisible.value = false
  }

  function disposeTauriWindowClose() {
    unlistenWindowClose?.()
  }

  return {
    setupTauriWindowClose,
    onWindowCloseHide,
    onWindowCloseQuit,
    onWindowCloseCancel,
    onOpenSystemTraySettings,
    onTrayVisibilityConfirmed,
    onTrayVisibilityCancel,
    disposeTauriWindowClose,
  }
}
