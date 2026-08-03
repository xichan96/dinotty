import { afterEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import TrayVisibilityDialog from '../components/ui/TrayVisibilityDialog.vue'
import WindowCloseDialog from '../components/ui/WindowCloseDialog.vue'
import {
  TRAY_VISIBILITY_CONFIRM_KEY,
  useDesktopLifecycle,
} from '../composables/useDesktopLifecycle'

afterEach(() => {
  document.body.innerHTML = ''
  window.localStorage.removeItem(TRAY_VISIBILITY_CONFIRM_KEY)
})

describe('desktop lifecycle', () => {
  it('fails closed when the capability query fails', async () => {
    const lifecycle = useDesktopLifecycle({
      persistNow: vi.fn(),
      saveSettings: vi.fn(async () => {}),
      invoke: vi.fn(async () => {
        throw new Error('tray unavailable')
      }),
    })

    await lifecycle.setup()

    expect(lifecycle.capabilities.value.canHideToTray).toBe(false)
    expect(lifecycle.capabilities.value.trayMode).toBe('unavailable')
    expect(lifecycle.capabilities.value.platform).toBe('unknown')
  })

  it('normalizes the platform and opens Windows tray settings', async () => {
    const invoke = vi.fn(async (command: string) => {
      if (command === 'desktop_capabilities') {
        return { platform: 'windows', trayMode: 'full', canHideToTray: true }
      }
    })
    const lifecycle = useDesktopLifecycle({
      persistNow: vi.fn(),
      saveSettings: vi.fn(async () => {}),
      invoke,
    })

    await lifecycle.setup()
    await lifecycle.openSystemTraySettings()

    expect(lifecycle.capabilities.value.platform).toBe('windows')
    expect(invoke).toHaveBeenLastCalledWith('open_system_tray_settings')
  })

  it('requires confirmation before the first Windows hide and remembers it', async () => {
    const invoke = vi.fn(async (command: string) => {
      if (command === 'desktop_capabilities') {
        return { platform: 'windows', trayMode: 'full', canHideToTray: true }
      }
    })
    const lifecycle = useDesktopLifecycle({
      persistNow: vi.fn(),
      saveSettings: vi.fn(async () => {}),
      invoke,
    })

    await lifecycle.setup()
    expect(lifecycle.needsTrayVisibilityConfirmation()).toBe(true)
    expect(invoke).not.toHaveBeenCalledWith('hide_main_window')

    lifecycle.confirmTrayVisibility()
    expect(lifecycle.needsTrayVisibilityConfirmation()).toBe(false)
    expect(window.localStorage.getItem(TRAY_VISIBILITY_CONFIRM_KEY)).toBe('true')

    const nextLifecycle = useDesktopLifecycle({
      persistNow: vi.fn(),
      saveSettings: vi.fn(async () => {}),
      invoke,
    })
    await nextLifecycle.setup()
    expect(nextLifecycle.needsTrayVisibilityConfirmation()).toBe(false)
  })

  it('never requires tray visibility confirmation outside Windows', async () => {
    const lifecycle = useDesktopLifecycle({
      persistNow: vi.fn(),
      saveSettings: vi.fn(async () => {}),
      invoke: vi.fn(async () => ({
        platform: 'linux',
        trayMode: 'full',
        canHideToTray: true,
      })),
    })

    await lifecycle.setup()

    expect(lifecycle.needsTrayVisibilityConfirmation()).toBe(false)
  })

  it('persists and acknowledges each quit request id only once', async () => {
    const persistNow = vi.fn()
    const saveSettings = vi.fn(async () => {})
    const invoke = vi.fn(async (command: string) => {
      if (command === 'desktop_capabilities') {
        return { trayMode: 'full', canHideToTray: true }
      }
    })
    const lifecycle = useDesktopLifecycle({ persistNow, saveSettings, invoke })

    await lifecycle.processQuitRequest({ requestId: 'quit-1', source: 'tray' })
    await lifecycle.processQuitRequest({ requestId: 'quit-1', source: 'window' })

    expect(persistNow).toHaveBeenCalledTimes(1)
    expect(saveSettings).toHaveBeenCalledTimes(1)
    expect(invoke).toHaveBeenCalledWith('desktop_quit_ack', {
      requestId: 'quit-1',
      persistence: 'ok',
    })
  })

  it('reports failed persistence and does not persist when hiding', async () => {
    const persistNow = vi.fn(() => {
      throw new Error('storage full')
    })
    const invoke = vi.fn(async () => {})
    const lifecycle = useDesktopLifecycle({
      persistNow,
      saveSettings: vi.fn(async () => {}),
      invoke,
    })

    await lifecycle.hideToTray()
    expect(persistNow).not.toHaveBeenCalled()

    await lifecycle.processQuitRequest({ requestId: 'quit-2', source: 'system' })
    expect(invoke).toHaveBeenLastCalledWith('desktop_quit_ack', {
      requestId: 'quit-2',
      persistence: 'failed',
    })
  })
})

describe('WindowCloseDialog', () => {
  const baseProps = {
    visible: true,
    canHideToTray: true,
    title: 'Close?',
    message: 'Choose an action',
    hideText: 'Hide',
    quitText: 'Quit',
    cancelText: 'Cancel',
  }

  it('shows three independent actions when hiding is available', async () => {
    const wrapper = mount(WindowCloseDialog, { props: baseProps, attachTo: document.body })
    expect(document.body.querySelectorAll('.close-action')).toHaveLength(3)

    await (document.body.querySelector('.close-action.hide') as HTMLButtonElement).click()
    await (document.body.querySelector('.close-action.quit') as HTMLButtonElement).click()

    expect(wrapper.emitted('hide')).toHaveLength(1)
    expect(wrapper.emitted('quit')).toBeUndefined()
    wrapper.unmount()
  })

  it('omits hide when the tray cannot safely hide the window', () => {
    const wrapper = mount(WindowCloseDialog, {
      props: { ...baseProps, canHideToTray: false },
      attachTo: document.body,
    })
    expect(document.body.querySelector('.close-action.hide')).toBeNull()
    expect(document.body.querySelectorAll('.close-action')).toHaveLength(2)
    wrapper.unmount()
  })
})

describe('TrayVisibilityDialog', () => {
  const baseProps = {
    visible: true,
    title: 'Keep accessible',
    message: 'Enable the tray icon first',
    openSettingsText: 'Open settings',
    confirmText: 'Enabled, hide',
    cancelText: 'Cancel',
  }

  it('allows settings and confirmation as separate actions, each only once', async () => {
    const wrapper = mount(TrayVisibilityDialog, {
      props: baseProps,
      attachTo: document.body,
    })
    const settings = document.body.querySelector('.tray-action.settings') as HTMLButtonElement
    const confirm = document.body.querySelector('.tray-action.confirm') as HTMLButtonElement

    settings.click()
    settings.click()
    confirm.click()
    confirm.click()

    expect(wrapper.emitted('open-settings')).toHaveLength(1)
    expect(wrapper.emitted('confirm')).toHaveLength(1)
    wrapper.unmount()
  })

  it('cancels without confirming', () => {
    const wrapper = mount(TrayVisibilityDialog, {
      props: baseProps,
      attachTo: document.body,
    })

    ;(document.body.querySelector('.tray-action.cancel') as HTMLButtonElement).click()

    expect(wrapper.emitted('cancel')).toHaveLength(1)
    expect(wrapper.emitted('confirm')).toBeUndefined()
    wrapper.unmount()
  })
})
