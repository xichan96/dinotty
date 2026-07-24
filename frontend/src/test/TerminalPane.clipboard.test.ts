import { mount } from '@vue/test-utils'
import { ref } from 'vue'
import { beforeEach, describe, expect, it, vi, afterEach } from 'vitest'

const paneMocks = vi.hoisted(() => {
  const instances: any[] = []
  const TerminalInstance = vi.fn(function (this: any, paneId: string) {
    this.paneId = paneId
    this.sendData = vi.fn()
    this.sendInput = vi.fn((data: string) => this.onInput?.(data))
    this.pasteText = vi.fn((data: string) => this.onInput?.(data))
    this.attach = vi.fn()
    this.focus = vi.fn()
    this.destroy = vi.fn()
    instances.push(this)
  })
  return { instances, TerminalInstance }
})

const toastMocks = vi.hoisted(() => ({
  error: vi.fn(),
  info: vi.fn(),
  success: vi.fn(),
}))

const clipboardMocks = vi.hoisted(() => ({
  readHostClipboard: vi.fn(),
  isTauri: vi.fn(() => false),
  readClipboardText: vi.fn(),
}))

vi.mock('../composables/useTerminal', () => ({
  TerminalInstance: paneMocks.TerminalInstance,
  setKbTypingLock: () => {},
}))
vi.mock('../composables/useAppForeground', () => ({ getIsAppForeground: () => false }))
vi.mock('../composables/useNotification', () => ({ markPaneReadIfUnread: vi.fn() }))
vi.mock('../composables/useTransport', () => ({
  isTauri: clipboardMocks.isTauri,
  createTransport: vi.fn(),
}))
vi.mock('../utils/clipboard', () => ({
  copyToClipboard: vi.fn(),
  readHostClipboard: clipboardMocks.readHostClipboard,
}))
vi.mock('@tauri-apps/plugin-clipboard-manager', () => ({
  readText: clipboardMocks.readClipboardText,
}))
vi.mock('vue-toastification', () => ({
  POSITION: { BOTTOM_CENTER: 'bottom-center' },
  useToast: () => toastMocks,
}))

import TerminalPane from '../components/terminal/TerminalPane.vue'
import { useSplitPane } from '../composables/useSplitPane'
import type { Tab } from '../types/pane'

function mountPane() {
  return mount(TerminalPane, {
    props: { paneId: 'p1' },
    global: { stubs: { SearchBar: true, TerminalContextMenu: true, SelectionHandles: true } },
  })
}

beforeEach(() => {
  paneMocks.instances.length = 0
  clipboardMocks.readHostClipboard.mockReset()
  clipboardMocks.isTauri.mockReturnValue(false)
  clipboardMocks.readClipboardText.mockReset()
  toastMocks.error.mockReset()
  toastMocks.info.mockReset()
  toastMocks.success.mockReset()
})

describe('TerminalPane host clipboard input path', () => {
  it('sends single-line text and exactly one Enter through the same input event path', () => {
    const wrapper = mountPane()
    const terminal = paneMocks.instances[0]
    expect((wrapper.vm as any).pasteFromClipboard('echo ok', true)).toBe(true)
    expect(terminal.pasteText).toHaveBeenCalledWith('echo ok')
    expect(terminal.sendInput).toHaveBeenCalledOnce()
    expect(terminal.sendInput).toHaveBeenCalledWith('\r')
    expect(wrapper.emitted('input')).toEqual([['echo ok'], ['\r']])
    wrapper.unmount()
  })

  it('never auto-enters multiline text even when the key enables auto_enter', () => {
    const wrapper = mountPane()
    const terminal = paneMocks.instances[0]
    ;(wrapper.vm as any).pasteFromClipboard('one\ntwo', true)
    expect(terminal.sendInput).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('does not auto-enter single-line text when the key disables auto_enter', () => {
    const wrapper = mountPane()
    const terminal = paneMocks.instances[0]
    ;(wrapper.vm as any).pasteFromClipboard('single', false)
    expect(terminal.sendInput).not.toHaveBeenCalled()
    expect(terminal.pasteText).toHaveBeenCalledWith('single')
    wrapper.unmount()
  })

  it('fans both pasted text and Enter out to broadcast peers', () => {
    const peer = { sendData: vi.fn() }
    const tabs = ref<Tab[]>([
      {
        type: 'terminal',
        paneId: 'tab-1',
        activePaneId: 'p1',
        title: 'Terminal',
        layout: {
          type: 'split',
          id: 'split-1',
          direction: 'horizontal',
          ratios: [0.5, 0.5],
          children: [
            { type: 'leaf', paneId: 'p1', title: 'P1' },
            { type: 'leaf', paneId: 'p2', title: 'P2' },
          ],
        },
        broadcastMode: true,
        broadcastActivity: 0,
        paneMru: ['p1', 'p2'],
        previewVisible: false,
        previewAddress: '',
        previewKind: 'web',
        previewUrl: '',
      } as any,
    ])
    const split = useSplitPane({
      tabs,
      activePaneId: ref('tab-1'),
      termRefs: { p1: {} as any, p2: peer as any },
      genPaneId: () => 'new',
      sendSync: vi.fn(),
      sendLayoutSync: vi.fn(),
      persist: vi.fn(),
    })

    split.onTerminalInput('p1', 'echo ok')
    split.onTerminalInput('p1', '\r')
    expect(peer.sendData.mock.calls).toEqual([
      ['echo ok', true],
      ['\r', true],
    ])
  })
})

describe('TerminalPane context menu paste', () => {
  const originalClipboard = Object.getOwnPropertyDescriptor(globalThis.navigator, 'clipboard')

  function setNavigatorClipboard(readText: (() => Promise<string>) | undefined) {
    Object.defineProperty(globalThis.navigator, 'clipboard', {
      value: readText ? { readText } : undefined,
      configurable: true,
      writable: true,
    })
  }

  beforeEach(() => {
    setNavigatorClipboard(undefined)
  })

  afterEach(() => {
    if (originalClipboard) {
      Object.defineProperty(globalThis.navigator, 'clipboard', originalClipboard)
    } else {
      Object.defineProperty(globalThis.navigator, 'clipboard', {
        value: undefined,
        configurable: true,
        writable: true,
      })
    }
  })

  it('pastes browser clipboard text when available', async () => {
    setNavigatorClipboard(vi.fn().mockResolvedValue('browser text'))
    const wrapper = mountPane()
    await (wrapper.vm as any).onMenuPaste()
    const terminal = paneMocks.instances[0]
    expect(terminal.focus).toHaveBeenCalled()
    expect(terminal.pasteText).toHaveBeenCalledWith('browser text')
    expect(clipboardMocks.readHostClipboard).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('falls back to host clipboard when browser clipboard read fails', async () => {
    setNavigatorClipboard(vi.fn().mockRejectedValue(new Error('denied')))
    clipboardMocks.readHostClipboard.mockResolvedValue('host text')
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const consoleInfo = vi.spyOn(console, 'info').mockImplementation(() => undefined)
    const wrapper = mountPane()
    await (wrapper.vm as any).onMenuPaste()
    const terminal = paneMocks.instances[0]
    expect(terminal.focus).toHaveBeenCalled()
    expect(clipboardMocks.readHostClipboard).toHaveBeenCalled()
    expect(terminal.pasteText).toHaveBeenCalledWith('host text')
    consoleWarn.mockRestore()
    consoleInfo.mockRestore()
    wrapper.unmount()
  })

  it('prefers Tauri clipboard in desktop builds', async () => {
    clipboardMocks.isTauri.mockReturnValue(true)
    clipboardMocks.readClipboardText.mockResolvedValue('tauri text')
    setNavigatorClipboard(vi.fn().mockResolvedValue('browser text'))
    const wrapper = mountPane()
    await (wrapper.vm as any).onMenuPaste()
    const terminal = paneMocks.instances[0]
    expect(clipboardMocks.readClipboardText).toHaveBeenCalled()
    expect(terminal.pasteText).toHaveBeenCalledWith('tauri text')
    wrapper.unmount()
  })

  it('shows failure toast when all clipboard sources fail', async () => {
    setNavigatorClipboard(vi.fn().mockRejectedValue(new Error('denied')))
    clipboardMocks.readHostClipboard.mockResolvedValue(null)
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const wrapper = mountPane()
    await (wrapper.vm as any).onMenuPaste()
    expect(toastMocks.error).toHaveBeenCalled()
    consoleWarn.mockRestore()
    wrapper.unmount()
  })

  it('shows empty toast when clipboard is empty', async () => {
    setNavigatorClipboard(vi.fn().mockResolvedValue(''))
    const wrapper = mountPane()
    await (wrapper.vm as any).onMenuPaste()
    expect(toastMocks.info).toHaveBeenCalled()
    wrapper.unmount()
  })
})
