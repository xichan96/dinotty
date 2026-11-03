/* eslint-disable vue/one-component-per-file -- test-only stubs */
import { mount, flushPromises } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick, ref } from 'vue'
import type { PreviewWindowDockOptions } from '../composables/usePreviewWindowDock'

/**
 * The native preview window is a standalone view of one built-in preview.
 * These tests pin the contract with the main window: the kind and the window
 * label come from the entry URL, reopening the same file-browser session
 * focuses the window and carries the new target over
 * `preview-window-navigate`, and the in-window close targets this instance
 * rather than its kind.
 */

type NavigateHandler = (event: { payload?: Record<string, unknown> }) => void

const mocks = vi.hoisted(() => ({
  probe: vi.fn(async () => true),
  tauriInvoke: vi.fn(async () => undefined),
  openFromTerminal: vi.fn(async () => undefined),
  currentPath: vi.fn(() => '/tmp/current.md'),
  currentUrl: vi.fn(() => 'https://example.com/current'),
  usePreviewWindowDock: vi.fn((_options: PreviewWindowDockOptions) => () => {}),
}))

let handlers: Map<string, NavigateHandler>

vi.mock('../composables/windowSessionProbe', () => ({
  probeWindowSession: mocks.probe,
}))

vi.mock('../composables/useTransport', () => ({
  tauriInvoke: mocks.tauriInvoke,
  isTauri: () => true,
}))

vi.mock('../composables/usePreviewWindowDock', () => ({
  usePreviewWindowDock: mocks.usePreviewWindowDock,
}))

vi.mock('../stores/settingsStore', () => ({
  useSettingsStore: () => ({ load: vi.fn(async () => {}), applyTheme: vi.fn() }),
}))

vi.mock('../composables/useThemePacks', () => ({
  loadThemePacks: vi.fn(),
}))

vi.mock('../composables/useDeviceThemeSelection', () => ({
  effectiveTheme: ref('dark'),
}))

vi.mock('../components/preview/FileWorkspacePreview.vue', async () => {
  const { defineComponent, h } = await import('vue')
  return {
    default: defineComponent({
      name: 'FileWorkspacePreview',
      props: {
        visible: Boolean,
        paneId: { type: String, default: '' },
        sourcePaneId: { type: String, default: '' },
        initialPath: { type: String, default: '' },
        isWindow: Boolean,
      },
      setup(_props, { expose }) {
        expose({
          openFromTerminal: mocks.openFromTerminal,
          getCurrentPath: mocks.currentPath,
        })
        return () => h('div', { class: 'files-stub' })
      },
    }),
  }
})

vi.mock('../components/preview/WebPreview.vue', async () => {
  const { defineComponent, h } = await import('vue')
  return {
    default: defineComponent({
      name: 'WebPreview',
      props: { visible: Boolean, url: { type: String, default: '' } },
      emits: ['close'],
      setup(_props, { expose }) {
        expose({ getCurrentUrl: mocks.currentUrl })
        return () => h('div', { class: 'web-stub' })
      },
    }),
  }
})

import PreviewWindowApp from '../PreviewWindowApp.vue'

function installTauriEventBridge(label = 'preview-files-test') {
  handlers = new Map()
  ;(window as unknown as Record<string, unknown>).__TAURI__ = {
    window: {
      getCurrentWindow: () => ({ label }),
      getAllWindows: async () => [],
    },
    event: {
      listen: vi.fn(async (event: string, handler: NavigateHandler) => {
        handlers.set(event, handler)
        return () => handlers.delete(event)
      }),
      emitTo: vi.fn(async () => undefined),
    },
  }
}

function fireNavigate(payload: Record<string, unknown>) {
  handlers.get('preview-window-navigate')?.({ payload })
}

async function mountPreview(query: string, label = 'preview-files-test') {
  window.history.replaceState({}, '', `/preview.html?${query}`)
  installTauriEventBridge(label)
  const wrapper = mount(PreviewWindowApp)
  await vi.waitFor(() => expect(wrapper.attributes('data-state')).toBe('ready'))
  await vi.waitFor(() => expect(handlers.has('preview-window-navigate')).toBe(true))
  return wrapper
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.probe.mockResolvedValue(true)
  mocks.currentPath.mockReturnValue('/tmp/current.md')
  mocks.currentUrl.mockReturnValue('https://example.com/current')
  mocks.usePreviewWindowDock.mockImplementation(() => () => {})
  window.history.replaceState({}, '', '/preview.html')
})

describe('PreviewWindowApp', () => {
  it('boots the file browser from the entry URL with a window-scoped state key', async () => {
    const wrapper = await mountPreview('kind=files&sourcePaneId=pane-1&path=%2Ftmp%2Fa.md')

    const files = wrapper.findComponent({ name: 'FileWorkspacePreview' })
    expect(files.props()).toMatchObject({
      visible: true,
      paneId: 'window:files:pane-1',
      sourcePaneId: 'pane-1',
      initialPath: '/tmp/a.md',
      isWindow: true,
    })

    wrapper.unmount()
  })

  it('navigates the open file browser when the main window reopens the preview', async () => {
    const wrapper = await mountPreview('kind=files&sourcePaneId=pane-1&path=%2Ftmp%2Fa.md')

    fireNavigate({ kind: 'files', sourcePaneId: 'pane-1', path: '/tmp/b.md' })
    expect(mocks.openFromTerminal).toHaveBeenCalledWith('/tmp/b.md')

    wrapper.unmount()
  })

  it('remounts the file browser when the target terminal changes', async () => {
    const wrapper = await mountPreview('kind=files&sourcePaneId=pane-1&path=%2Ftmp%2Fa.md')

    fireNavigate({ kind: 'files', sourcePaneId: 'pane-2', path: '/tmp/c.md' })
    await flushPromises()
    await nextTick()

    const files = wrapper.findComponent({ name: 'FileWorkspacePreview' })
    expect(files.props('sourcePaneId')).toBe('pane-2')
    expect(files.props('paneId')).toBe('window:files:pane-2')
    expect(files.props('initialPath')).toBe('/tmp/c.md')

    wrapper.unmount()
  })

  it('follows URL changes for the web preview', async () => {
    const wrapper = await mountPreview('kind=web&url=https%3A%2F%2Fexample.com')

    const web = wrapper.findComponent({ name: 'WebPreview' })
    expect(web.props('url')).toBe('https://example.com')

    fireNavigate({ kind: 'web', url: 'https://example.org/docs' })
    await nextTick()

    expect(wrapper.findComponent({ name: 'WebPreview' }).props('url')).toBe(
      'https://example.org/docs'
    )

    wrapper.unmount()
  })

  it('closes this window instance by label, not by kind', async () => {
    const wrapper = await mountPreview('kind=web&windowLabel=preview-web-7')
    wrapper.findComponent({ name: 'WebPreview' }).vm.$emit('close')
    await flushPromises()

    expect(mocks.tauriInvoke).toHaveBeenCalledWith('close_preview_window', {
      windowLabel: 'preview-web-7',
    })

    wrapper.unmount()
  })

  it('passes the live path, url, label and source to the dock gesture', async () => {
    const wrapper = await mountPreview(
      'kind=files&windowLabel=preview-files-pane-1&sourcePaneId=pane-1'
    )

    const options = mocks.usePreviewWindowDock.mock.calls[0][0]
    expect(options.windowLabel).toBe('preview-files-pane-1')
    expect(options.kind).toBe('files')
    expect(options.sourcePaneId?.()).toBe('pane-1')
    expect(options.getLocation()).toEqual({ path: '/tmp/current.md' })
    expect(mocks.currentPath).toHaveBeenCalled()

    wrapper.unmount()
  })

  it('falls back to the entry URL when the web preview has no live URL yet', async () => {
    mocks.currentUrl.mockReturnValue('')
    const wrapper = await mountPreview(
      'kind=web&windowLabel=preview-web-8&url=https%3A%2F%2Fexample.com'
    )

    const options = mocks.usePreviewWindowDock.mock.calls[0][0]
    expect(options.getLocation()).toEqual({ url: 'https://example.com' })

    wrapper.unmount()
  })

  it('shows an error state when the server session cannot be probed', async () => {
    mocks.probe.mockResolvedValue(false)
    window.history.replaceState({}, '', '/preview.html?kind=web')
    installTauriEventBridge()
    const wrapper = mount(PreviewWindowApp)
    await vi.waitFor(() => expect(wrapper.attributes('data-state')).toBe('error'))

    expect(wrapper.findComponent({ name: 'WebPreview' }).exists()).toBe(false)

    wrapper.unmount()
  })
})
