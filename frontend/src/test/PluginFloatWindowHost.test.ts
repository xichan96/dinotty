import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { nextTick } from 'vue'

// useEventBridge -> useSyncWebSocket -> usePluginLoader -> createKeyboardContext
// -> useHistory -> useSyncWebSocket forms a circular import; useHistory calls
// onSuggestions at module scope, so the real useSyncWebSocket is in a temporal
// dead zone by the time it is reached. Stub the module to break the cycle.
vi.mock('../composables/useSyncWebSocket', () => ({
  onEvent: () => () => {},
  getClientId: () => null,
  onSuggestions: () => () => {},
}))

vi.mock('../composables/useSettings', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../composables/useSettings')>()
  return { ...actual, saveSettings: vi.fn() }
})

import PluginFloatWindowHost from '../components/plugin/PluginFloatWindowHost.vue'
import PluginFloatWindow from '../components/plugin/PluginFloatWindow.vue'
import { loadedPlugins } from '../composables/usePluginLoader'
import { usePluginFloatWindowsStore } from '../stores/pluginFloatWindows'
import type { LoadedPlugin } from '../composables/usePluginLoader'

const fakeApi = { open: () => {} }

function activePlugin(id: string): LoadedPlugin {
  return {
    id,
    manifest: { id, name: id, version: '1.0.0' },
    module: { activate: () => ({}) },
    exports: null,
    state: 'active',
  } as LoadedPlugin
}

describe('PluginFloatWindowHost', () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
    loadedPlugins.clear()
  })

  it('renders one window per open id with a loaded active plugin', () => {
    const store = usePluginFloatWindowsStore()
    loadedPlugins.set('p1', activePlugin('p1'))
    loadedPlugins.set('p2', activePlugin('p2'))
    store.open('p1')
    store.open('p2')
    const wrapper = mount(PluginFloatWindowHost, {
      props: { getPluginContext: () => fakeApi as never, workspaceId: undefined },
    })
    expect(wrapper.findAllComponents(PluginFloatWindow)).toHaveLength(2)
  })

  it('does not mount the fixed layer when no windows are open', () => {
    const wrapper = mount(PluginFloatWindowHost, {
      props: { getPluginContext: () => fakeApi as never, workspaceId: undefined },
    })
    expect(wrapper.find('.float-window-layer').exists()).toBe(false)
  })

  it('closes the store entry when the plugin is unloaded', async () => {
    const store = usePluginFloatWindowsStore()
    loadedPlugins.set('p1', activePlugin('p1'))
    store.open('p1')
    const wrapper = mount(PluginFloatWindowHost, {
      props: { getPluginContext: () => fakeApi as never, workspaceId: undefined },
    })
    expect(wrapper.find('.float-window-layer').exists()).toBe(true)

    loadedPlugins.delete('p1')
    await nextTick()
    await nextTick()
    expect(store.isOpen('p1')).toBe(false)
    expect(wrapper.find('.float-window-layer').exists()).toBe(false)
  })

  it('closes the store entry when the plugin flips to error state', async () => {
    const store = usePluginFloatWindowsStore()
    loadedPlugins.set('p1', activePlugin('p1'))
    store.open('p1')
    mount(PluginFloatWindowHost, {
      props: { getPluginContext: () => fakeApi as never, workspaceId: undefined },
    })

    const broken = activePlugin('p1')
    broken.state = 'error'
    loadedPlugins.set('p1', broken)
    await nextTick()
    await nextTick()
    expect(store.isOpen('p1')).toBe(false)
  })

  it('passes each window the context created for its plugin', () => {
    const getPluginContext = vi.fn((id: string) => ({ open: () => {}, pluginId: id }))
    const store = usePluginFloatWindowsStore()
    loadedPlugins.set('p1', activePlugin('p1'))
    store.open('p1')
    mount(PluginFloatWindowHost, {
      props: { getPluginContext: getPluginContext as never, workspaceId: undefined },
    })
    expect(getPluginContext).toHaveBeenCalledWith('p1')
  })
})
