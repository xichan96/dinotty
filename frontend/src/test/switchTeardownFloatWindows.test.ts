import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { nextTick } from 'vue'

// useAppCore's module graph reaches useSyncWebSocket through useMonitor /
// useEventBridge, which register handlers at module scope. Stub the transport
// so importing the helper below does not drag a live socket into the test.
vi.mock('../composables/useSyncWebSocket', () => ({
  onEvent: () => () => {},
  getClientId: () => null,
  onSuggestions: () => () => {},
  onMonitorData: () => () => {},
  onMonitorHistory: () => () => {},
  onNotification: () => () => {},
  setPluginChangedHandler: () => {},
  sendMarkRead: () => {},
  useSyncWebSocket: () => ({}),
}))

import { closeAllFloatWindows } from '../composables/useAppCore'
import PluginFloatWindowHost from '../components/plugin/PluginFloatWindowHost.vue'
import { loadedPlugins } from '../composables/usePluginLoader'
import { usePluginFloatWindowsStore } from '../stores/pluginFloatWindows'
import type { FloatWindowContent } from '../types/floatWindow'
import type { LoadedPlugin } from '../composables/usePluginLoader'

function activePlugin(id: string): LoadedPlugin {
  return {
    id,
    manifest: { id, name: id, version: '1.0.0' },
    module: { activate: () => ({}) },
    exports: null,
    state: 'active',
  } as LoadedPlugin
}

describe('closeAllFloatWindows', () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
    loadedPlugins.clear()
  })

  it('closes every open window and drops the preview content registry', () => {
    const store = usePluginFloatWindowsStore()
    store.open('p1')
    store.open('float:files')
    store.open('float:web')
    const contents: Record<string, FloatWindowContent> = {
      'float:files': { kind: 'files', sourcePaneId: 'pane-1' },
      'float:web': { kind: 'web', initialUrl: 'https://example.com' },
    }

    closeAllFloatWindows(store, contents)

    expect(store.openIds).toEqual([])
    expect(Object.keys(contents)).toEqual([])
  })

  it('leaves nothing behind when no window is open', () => {
    const store = usePluginFloatWindowsStore()
    const contents: Record<string, FloatWindowContent> = {}

    expect(() => closeAllFloatWindows(store, contents)).not.toThrow()
    expect(store.openIds).toEqual([])
  })

  it('unmounts the window components, so each window runs its own teardown', async () => {
    const store = usePluginFloatWindowsStore()
    loadedPlugins.set('p1', activePlugin('p1'))
    loadedPlugins.set('p2', activePlugin('p2'))
    store.open('p1')
    store.open('p2')
    const wrapper = mount(PluginFloatWindowHost, {
      props: { getPluginContext: () => ({ open: () => {} }) as never, workspaceId: undefined },
    })
    expect(wrapper.findAll('.float-window')).toHaveLength(2)

    closeAllFloatWindows(store, {})
    // Unmount is asynchronous: the old server's windows must be gone before the
    // new server mounts its own, or both sets would write the same global
    // `dinotty:floating-win:<id>` geometry key.
    await nextTick()

    expect(wrapper.findAll('.float-window')).toHaveLength(0)
    expect(wrapper.find('.float-window-layer').exists()).toBe(false)
  })
})
