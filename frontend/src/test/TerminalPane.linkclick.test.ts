import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const paneMocks = vi.hoisted(() => {
  const instances: any[] = []
  const TerminalInstance = vi.fn(function (this: any, paneId: string) {
    this.paneId = paneId
    this.sendData = vi.fn()
    this.sendInput = vi.fn((data: string) => this.onInput?.(data))
    this.pasteText = vi.fn((data: string) => this.onInput?.(data))
    this.getSelection = vi.fn(() => '')
    this.isMouseModeEnabled = vi.fn(() => false)
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

const transportMocks = vi.hoisted(() => ({
  isTauri: vi.fn(() => false),
  tauriInvoke: vi.fn(async () => undefined),
}))

const apiBaseMocks = vi.hoisted(() => ({
  getApiBase: vi.fn(async () => {}),
  authFetch: vi.fn(async () => ({ ok: true, json: async () => ({ abs: '/abs/resolved' }) })),
}))

const externalUrlMocks = vi.hoisted(() => ({ openUrlInSystemBrowser: vi.fn() }))

vi.mock('../composables/useTerminal', () => ({
  TerminalInstance: paneMocks.TerminalInstance,
  setKbTypingLock: () => {},
}))
vi.mock('../composables/useAppForeground', () => ({ getIsAppForeground: () => false }))
vi.mock('../composables/useNotification', () => ({ markPaneReadIfUnread: vi.fn() }))
vi.mock('../composables/useTransport', () => ({
  isTauri: transportMocks.isTauri,
  tauriInvoke: transportMocks.tauriInvoke,
  createTransport: vi.fn(),
}))
vi.mock('../composables/apiBase', () => ({
  getApiBase: apiBaseMocks.getApiBase,
  authFetch: apiBaseMocks.authFetch,
  apiUrl: (path: string) => path,
  hasAuthToken: () => false,
}))
vi.mock('../utils/openExternalUrl', () => ({
  openUrlInSystemBrowser: externalUrlMocks.openUrlInSystemBrowser,
}))
vi.mock('vue-toastification', () => ({
  POSITION: { BOTTOM_CENTER: 'bottom-center' },
  useToast: () => toastMocks,
}))

import TerminalPane from '../components/terminal/TerminalPane.vue'
import TerminalContextMenu from '../components/terminal/TerminalContextMenu.vue'

function mountPane() {
  return mount(TerminalPane, {
    props: { paneId: 'p1' },
    global: { stubs: { SearchBar: true, TerminalContextMenu: true, SelectionHandles: true } },
  })
}

function menuProps(wrapper: ReturnType<typeof mountPane>) {
  return wrapper.findComponent(TerminalContextMenu).props() as {
    visible: boolean
    linkType?: string
    linkTarget?: string
  }
}

beforeEach(() => {
  paneMocks.instances.length = 0
  externalUrlMocks.openUrlInSystemBrowser.mockReset()
  apiBaseMocks.authFetch.mockClear()
  transportMocks.tauriInvoke.mockClear()
  toastMocks.error.mockClear()
})

describe('TerminalPane link click behavior (#306)', () => {
  it('opens a primary-activated link in a new browser tab on web', () => {
    transportMocks.isTauri.mockReturnValue(false)
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    const wrapper = mountPane()
    const terminal = paneMocks.instances[0]

    terminal.onPreviewLinkOpen('https://example.com/docs')

    expect(open).toHaveBeenCalledWith('https://example.com/docs', '_blank', 'noopener,noreferrer')
    expect(externalUrlMocks.openUrlInSystemBrowser).not.toHaveBeenCalled()
    expect(wrapper.emitted('linkActivate')).toHaveLength(1)
    expect(menuProps(wrapper).visible).toBe(false)
    open.mockRestore()
    wrapper.unmount()
  })

  it('uses the system-browser helper for a primary-activated link in Tauri', () => {
    transportMocks.isTauri.mockReturnValue(true)
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    const wrapper = mountPane()
    const terminal = paneMocks.instances[0]

    terminal.onPreviewLinkOpen('https://example.com/docs')

    expect(externalUrlMocks.openUrlInSystemBrowser).toHaveBeenCalledWith('https://example.com/docs')
    expect(open).not.toHaveBeenCalled()
    open.mockRestore()
    wrapper.unmount()
  })

  it('does not open a non-HTTP(S) primary-activated link', () => {
    transportMocks.isTauri.mockReturnValue(false)
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    const wrapper = mountPane()
    const terminal = paneMocks.instances[0]

    terminal.onPreviewLinkOpen('javascript:alert(1)')

    expect(open).not.toHaveBeenCalled()
    expect(externalUrlMocks.openUrlInSystemBrowser).not.toHaveBeenCalled()
    open.mockRestore()
    wrapper.unmount()
  })

  it('makes right-click link-aware when the pointer hovered a link', async () => {
    const wrapper = mountPane()
    const terminal = paneMocks.instances[0]

    terminal.onPreviewLinkHover('https://example.com/docs')
    ;(wrapper.vm as any).onContextMenu({ clientX: 120, clientY: 80 })
    await nextTick()

    const props = menuProps(wrapper)
    expect(props.visible).toBe(true)
    expect(props.linkType).toBe('link')
    expect(props.linkTarget).toBe('https://example.com/docs')
    expect(externalUrlMocks.openUrlInSystemBrowser).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('keeps right-click generic when nothing was hovered', async () => {
    const wrapper = mountPane()

    ;(wrapper.vm as any).onContextMenu({ clientX: 120, clientY: 80 })
    await nextTick()

    const props = menuProps(wrapper)
    expect(props.visible).toBe(true)
    expect(props.linkType).toBeUndefined()
    wrapper.unmount()
  })

  it('forgets the hovered link on leave', async () => {
    const wrapper = mountPane()
    const terminal = paneMocks.instances[0]

    terminal.onPreviewLinkHover('https://example.com/docs')
    terminal.onPreviewLinkHover(null)
    ;(wrapper.vm as any).onContextMenu({ clientX: 120, clientY: 80 })
    await nextTick()

    expect(menuProps(wrapper).linkType).toBeUndefined()
    wrapper.unmount()
  })

  it('makes right-click file-aware when the pointer hovered a file path', async () => {
    const wrapper = mountPane()
    const terminal = paneMocks.instances[0]

    terminal.onFileLinkHover('/var/log/system.log')
    ;(wrapper.vm as any).onContextMenu({ clientX: 120, clientY: 80 })
    await nextTick()

    const props = menuProps(wrapper)
    expect(props.visible).toBe(true)
    expect(props.linkType).toBe('file')
    expect(props.linkTarget).toBe('/var/log/system.log')
    wrapper.unmount()
  })

  it('forgets the hovered file path on leave', async () => {
    const wrapper = mountPane()
    const terminal = paneMocks.instances[0]

    terminal.onFileLinkHover('/var/log/system.log')
    terminal.onFileLinkHover(null)
    ;(wrapper.vm as any).onContextMenu({ clientX: 120, clientY: 80 })
    await nextTick()

    expect(menuProps(wrapper).linkType).toBeUndefined()
    wrapper.unmount()
  })

  it('resolves and reveals the path through the Tauri command on revealFile', async () => {
    transportMocks.isTauri.mockReturnValue(true)
    const wrapper = mountPane()

    wrapper.findComponent(TerminalContextMenu).vm.$emit('revealFile', '~/notes.md')
    await vi.waitFor(() => expect(transportMocks.tauriInvoke).toHaveBeenCalled())

    expect(apiBaseMocks.authFetch).toHaveBeenCalledWith(
      '/api/workspace/resolve_abs?' + new URLSearchParams({ pane_id: 'p1', path: '~/notes.md' })
    )
    expect(transportMocks.tauriInvoke).toHaveBeenCalledWith('reveal_path', {
      path: '/abs/resolved',
    })
    expect(toastMocks.error).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('toasts instead of invoking when resolution fails', async () => {
    apiBaseMocks.authFetch.mockResolvedValueOnce({ ok: false, status: 404 } as any)
    const wrapper = mountPane()

    wrapper.findComponent(TerminalContextMenu).vm.$emit('revealFile', '/gone')
    await vi.waitFor(() => expect(toastMocks.error).toHaveBeenCalled())

    expect(transportMocks.tauriInvoke).not.toHaveBeenCalled()
    wrapper.unmount()
  })
})
