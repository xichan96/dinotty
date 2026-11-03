/* eslint-disable vue/one-component-per-file -- test-only stubs */
import { mount, flushPromises } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick, ref } from 'vue'

/**
 * The native preview window is a second, standalone view of one built-in
 * preview. These tests pin the contract with the main window: the kind comes
 * from the entry URL, and reopening the same kind focuses the window and
 * carries the new target over `preview-window-navigate` instead of creating a
 * duplicate.
 */

type NavigateHandler = (event: { payload?: Record<string, unknown> }) => void

const mocks = vi.hoisted(() => ({
  probe: vi.fn(async () => true),
  tauriInvoke: vi.fn(async () => undefined),
  openFromTerminal: vi.fn(async () => undefined),
}))

let navigateHandler: NavigateHandler | null = null

vi.mock('../composables/windowSessionProbe', () => ({
  probeWindowSession: mocks.probe,
}))

vi.mock('../composables/useTransport', () => ({
  tauriInvoke: mocks.tauriInvoke,
  isTauri: () => true,
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
        expose({ openFromTerminal: mocks.openFromTerminal })
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
      setup() {
        return () => h('div', { class: 'web-stub' })
      },
    }),
  }
})

import PreviewWindowApp from '../PreviewWindowApp.vue'

function installTauriEventBridge() {
  navigateHandler = null
  ;(window as unknown as Record<string, unknown>).__TAURI__ = {
    event: {
      listen: vi.fn(async (_event: string, handler: NavigateHandler) => {
        navigateHandler = handler
        return () => {}
      }),
    },
  }
}

async function mountPreview(query: string) {
  window.history.replaceState({}, '', `/preview.html?${query}`)
  installTauriEventBridge()
  const wrapper = mount(PreviewWindowApp)
  await vi.waitFor(() => expect(wrapper.attributes('data-state')).toBe('ready'))
  await vi.waitFor(() => expect(navigateHandler).not.toBeNull())
  return wrapper
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.probe.mockResolvedValue(true)
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

    navigateHandler?.({ payload: { kind: 'files', sourcePaneId: 'pane-1', path: '/tmp/b.md' } })
    expect(mocks.openFromTerminal).toHaveBeenCalledWith('/tmp/b.md')

    wrapper.unmount()
  })

  it('remounts the file browser when the target terminal changes', async () => {
    const wrapper = await mountPreview('kind=files&sourcePaneId=pane-1&path=%2Ftmp%2Fa.md')

    navigateHandler?.({ payload: { kind: 'files', sourcePaneId: 'pane-2', path: '/tmp/c.md' } })
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

    navigateHandler?.({ payload: { kind: 'web', url: 'https://example.org/docs' } })
    await nextTick()

    expect(wrapper.findComponent({ name: 'WebPreview' }).props('url')).toBe(
      'https://example.org/docs'
    )

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
