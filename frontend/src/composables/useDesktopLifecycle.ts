import { ref } from 'vue'
import { isTauri, tauriInvoke } from './useTransport'

export interface DesktopCapabilities {
  platform: 'windows' | 'macos' | 'linux' | 'unknown'
  trayMode: 'full' | 'showOnly' | 'unavailable'
  canHideToTray: boolean
  trayError?: string
}

interface QuitRequest {
  requestId: string
  source: string
}

interface DesktopLifecycleOptions {
  persistNow: () => void
  saveSettings: () => Promise<void>
  invoke?: typeof tauriInvoke
  listen?: (event: string, handler: (event: { payload: unknown }) => void) => Promise<() => void>
}

const unavailable: DesktopCapabilities = {
  platform: 'unknown',
  trayMode: 'unavailable',
  canHideToTray: false,
}

export const TRAY_VISIBILITY_CONFIRM_KEY = 'dinotty_tray_visibility_confirmed_v1'

export function useDesktopLifecycle(options: DesktopLifecycleOptions) {
  const capabilities = ref<DesktopCapabilities>({ ...unavailable })
  const invoke = options.invoke ?? tauriInvoke
  const processedQuitRequests = new Set<string>()
  let unlistenQuit: (() => void) | undefined
  let trayVisibilityConfirmedThisSession = false

  async function processQuitRequest(request: QuitRequest) {
    if (!request.requestId || processedQuitRequests.has(request.requestId)) return
    processedQuitRequests.add(request.requestId)
    let persistence: 'ok' | 'failed' = 'ok'
    try {
      options.persistNow()
      await options.saveSettings()
    } catch (error) {
      persistence = 'failed'
      console.error('[desktop] exit persistence failed:', error)
    }
    await invoke('desktop_quit_ack', { requestId: request.requestId, persistence })
  }

  async function setup() {
    if (!isTauri() && !options.invoke) return
    try {
      const result = (await invoke('desktop_capabilities')) as Partial<DesktopCapabilities>
      capabilities.value = {
        platform:
          result.platform === 'windows' ||
          result.platform === 'macos' ||
          result.platform === 'linux'
            ? result.platform
            : 'unknown',
        trayMode:
          result.trayMode === 'full' || result.trayMode === 'showOnly'
            ? result.trayMode
            : 'unavailable',
        canHideToTray: result.canHideToTray === true && result.trayMode === 'full',
        ...(typeof result.trayError === 'string' ? { trayError: result.trayError } : {}),
      }
    } catch (error) {
      capabilities.value = { ...unavailable, trayError: String(error) }
    }

    const tauriWindow = window as Window & {
      __TAURI__?: { event?: { listen?: DesktopLifecycleOptions['listen'] } }
    }
    const listen = options.listen ?? tauriWindow.__TAURI__?.event?.listen
    if (listen) {
      unlistenQuit = await listen('desktop-quit-requested', (event) => {
        const payload = event.payload as Partial<QuitRequest> | null
        if (
          payload &&
          typeof payload.requestId === 'string' &&
          typeof payload.source === 'string'
        ) {
          void processQuitRequest(payload as QuitRequest)
        }
      })
    }
  }

  async function hideToTray() {
    await invoke('hide_main_window')
  }

  async function openSystemTraySettings() {
    await invoke('open_system_tray_settings')
  }

  function needsTrayVisibilityConfirmation() {
    if (capabilities.value.platform !== 'windows' || trayVisibilityConfirmedThisSession) {
      return false
    }
    try {
      return window.localStorage.getItem(TRAY_VISIBILITY_CONFIRM_KEY) !== 'true'
    } catch {
      return true
    }
  }

  function confirmTrayVisibility() {
    trayVisibilityConfirmedThisSession = true
    try {
      window.localStorage.setItem(TRAY_VISIBILITY_CONFIRM_KEY, 'true')
    } catch (error) {
      console.warn('[desktop] could not persist tray visibility confirmation:', error)
    }
  }

  async function requestQuit(source: string) {
    await invoke('request_desktop_quit', { source })
  }

  function dispose() {
    unlistenQuit?.()
    unlistenQuit = undefined
  }

  return {
    capabilities,
    setup,
    hideToTray,
    openSystemTraySettings,
    needsTrayVisibilityConfirmation,
    confirmTrayVisibility,
    requestQuit,
    processQuitRequest,
    dispose,
  }
}
