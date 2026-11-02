import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The detached window shares its panes with the main window. Tauri IPC is
 * single-owner per pane, so a detached TerminalPane must construct its
 * transport with `forceWebSocket: true`. This pins the prop -> constructor
 * hand-off; `useTransportSelection.test.ts` pins the transport dispatch.
 */

const paneMocks = vi.hoisted(() => {
  const constructorArgs: Array<[string, unknown]> = []
  const TerminalInstance = vi.fn(function (this: any, paneId: string, opts?: unknown) {
    constructorArgs.push([paneId, opts])
    this.paneId = paneId
    this.attach = vi.fn()
    this.focus = vi.fn()
    this.blur = vi.fn()
    this.fit = vi.fn()
    this.destroy = vi.fn()
    this.sendData = vi.fn()
    this.setOutputListener = vi.fn()
  })
  return { constructorArgs, TerminalInstance }
})

vi.mock('../composables/useTerminal', () => ({
  TerminalInstance: paneMocks.TerminalInstance,
  setKbTypingLock: () => {},
}))
vi.mock('../composables/useAppForeground', () => ({ getIsAppForeground: () => false }))
vi.mock('../composables/useNotification', () => ({ markPaneReadIfUnread: vi.fn() }))
vi.mock('../composables/useTransport', () => ({
  isTauri: () => false,
  tauriInvoke: vi.fn(),
  createTransport: vi.fn(),
}))
vi.mock('../utils/clipboard', () => ({
  copyToClipboard: vi.fn(),
  readHostClipboard: vi.fn(),
}))
vi.mock('@tauri-apps/plugin-clipboard-manager', () => ({ readText: vi.fn() }))
vi.mock('../utils/openExternalUrl', () => ({ openUrlInSystemBrowser: vi.fn() }))
vi.mock('vue-toastification', () => ({
  POSITION: { BOTTOM_CENTER: 'bottom-center' },
  useToast: () => ({ error: vi.fn(), info: vi.fn(), success: vi.fn() }),
}))

import TerminalPane from '../components/terminal/TerminalPane.vue'

function mountPane(props: { paneId: string; forceWebSocket?: boolean }) {
  return mount(TerminalPane, {
    props,
    global: { stubs: { SearchBar: true, TerminalContextMenu: true, SelectionHandles: true } },
  })
}

beforeEach(() => {
  paneMocks.constructorArgs.length = 0
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('TerminalPane forceWebSocket', () => {
  it('passes forceWebSocket: true to TerminalInstance', () => {
    const wrapper = mountPane({ paneId: 'pane-1', forceWebSocket: true })

    expect(paneMocks.constructorArgs).toEqual([['pane-1', { forceWebSocket: true }]])
    wrapper.unmount()
  })

  it('leaves the transport default untouched without the prop', () => {
    const wrapper = mountPane({ paneId: 'pane-1' })

    expect(paneMocks.constructorArgs).toEqual([['pane-1', { forceWebSocket: false }]])
    wrapper.unmount()
  })
})
