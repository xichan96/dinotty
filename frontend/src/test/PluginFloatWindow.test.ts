import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { defineComponent, h, nextTick } from 'vue'

// useEventBridge -> useSyncWebSocket -> usePluginLoader -> createKeyboardContext
// -> useHistory -> useSyncWebSocket forms a circular import; useHistory calls
// onSuggestions at module scope, so the real useSyncWebSocket is in a temporal
// dead zone by the time it is reached. Stub the module to break the cycle.
vi.mock('../composables/useSyncWebSocket', () => ({
  onEvent: () => () => {},
  getClientId: () => null,
  onSuggestions: () => () => {},
}))

// saveSettings performs a full settings PUT; no-op it (PluginView imports it).
vi.mock('../composables/useSettings', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../composables/useSettings')>()
  return { ...actual, saveSettings: vi.fn() }
})

import PluginFloatWindow from '../components/plugin/PluginFloatWindow.vue'
import PluginView from '../components/plugin/PluginView.vue'
import { loadedPlugins } from '../composables/usePluginLoader'
import { usePluginFloatWindowsStore } from '../stores/pluginFloatWindows'
import type { LoadedPlugin, PluginContext } from '../composables/usePluginLoader'

const raf = () => new Promise((r) => requestAnimationFrame(r))
const fakeApi = {} as PluginContext

function activePlugin(id: string, name = id): LoadedPlugin {
  return {
    id,
    manifest: { id, name, version: '1.0.0' },
    module: { activate: () => ({}) },
    exports: { component: defineComponent({ render: () => h('div', 'plugin-body') }) },
    state: 'active',
  } as LoadedPlugin
}

function mountWindow(plugin: LoadedPlugin) {
  return mount(PluginFloatWindow, {
    props: { plugin, api: fakeApi, workspaceId: undefined },
  })
}

describe('PluginFloatWindow', () => {
  beforeEach(() => {
    localStorage.clear()
    window.innerWidth = 1280
    window.innerHeight = 800
    setActivePinia(createPinia())
    loadedPlugins.clear()
  })

  it('renders PluginView with the float paneId and visibility props', () => {
    const store = usePluginFloatWindowsStore()
    store.open('p1')
    loadedPlugins.set('p1', activePlugin('p1', 'My Tool'))
    const wrapper = mountWindow(loadedPlugins.get('p1')!)

    const view = wrapper.findComponent(PluginView)
    expect(view.exists()).toBe(true)
    expect(view.props('paneId')).toBe('plugin:p1:float')
    expect(view.props('isVisible')).toBe(true)
    expect(view.props('isFocused')).toBe(true)
    expect(view.props('showOverlays')).toBe(false)
    expect(wrapper.find('.float-title').text()).toBe('My Tool')
  })

  it('close button empties the store entry', async () => {
    const store = usePluginFloatWindowsStore()
    store.open('p1')
    loadedPlugins.set('p1', activePlugin('p1'))
    const wrapper = mountWindow(loadedPlugins.get('p1')!)

    await wrapper.find('.float-close').trigger('click')
    expect(store.isOpen('p1')).toBe(false)
  })

  it('persists geometry to localStorage after a title-bar drag settles', async () => {
    const store = usePluginFloatWindowsStore()
    store.open('p1')
    loadedPlugins.set('p1', activePlugin('p1'))
    const wrapper = mountWindow(loadedPlugins.get('p1')!)

    const bar = wrapper.find('.float-titlebar').element
    bar.dispatchEvent(
      new PointerEvent('pointerdown', {
        button: 0,
        pointerId: 1,
        bubbles: true,
        clientX: 100,
        clientY: 15,
      })
    )
    window.dispatchEvent(
      new PointerEvent('pointermove', { pointerId: 1, clientX: 260, clientY: 115 })
    )
    await raf()
    window.dispatchEvent(
      new PointerEvent('pointerup', { pointerId: 1, clientX: 260, clientY: 115 })
    )

    const raw = localStorage.getItem('dinotty:floating-win:p1')
    expect(raw).toBeTruthy()
    const geom = JSON.parse(raw!)
    expect(geom.x).toBeGreaterThan(0)
    expect(geom.y).toBeGreaterThan(0)
    expect(geom.w).toBeGreaterThan(0)
    expect(geom.h).toBeGreaterThan(0)
  })

  it('restores saved geometry on mount', () => {
    localStorage.setItem(
      'dinotty:floating-win:p1',
      JSON.stringify({ x: 40, y: 50, w: 600, h: 400 })
    )
    const store = usePluginFloatWindowsStore()
    store.open('p1')
    loadedPlugins.set('p1', activePlugin('p1'))
    const wrapper = mountWindow(loadedPlugins.get('p1')!)

    expect(wrapper.find('.float-window').attributes('style')).toContain('width: 600px')
    expect(wrapper.find('.float-window').attributes('style')).toContain('height: 400px')
  })

  it('clamps an oversized saved size to the viewport on mount', async () => {
    localStorage.setItem(
      'dinotty:floating-win:p1',
      JSON.stringify({ x: 0, y: 0, w: 5000, h: 4000 })
    )
    const store = usePluginFloatWindowsStore()
    store.open('p1')
    loadedPlugins.set('p1', activePlugin('p1'))
    const wrapper = mountWindow(loadedPlugins.get('p1')!)
    await nextTick()

    const style = wrapper.find('.float-window').attributes('style')
    expect(style).toContain(`width: ${window.innerWidth}px`)
    expect(style).not.toContain('height: 4000px')
  })
})
