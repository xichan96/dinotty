import { mount } from '@vue/test-utils'
import { ref } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'

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

vi.mock('../composables/useTerminal', () => ({ TerminalInstance: paneMocks.TerminalInstance }))
vi.mock('../composables/useAppForeground', () => ({ getIsAppForeground: () => false }))
vi.mock('../composables/useNotification', () => ({ markPaneReadIfUnread: vi.fn() }))
vi.mock('vue-toastification', () => ({
  POSITION: { BOTTOM_CENTER: 'bottom-center' },
  useToast: () => ({ error: vi.fn(), info: vi.fn(), success: vi.fn() }),
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
