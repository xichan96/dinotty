import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { defineComponent, h } from 'vue'

// useEventBridge -> useSyncWebSocket -> usePluginLoader -> createKeyboardContext
// -> useHistory -> useSyncWebSocket forms a circular import; useHistory calls
// onSuggestions at module scope, so the real useSyncWebSocket is in a temporal
// dead zone by the time it is reached. Stub the module to break the cycle.
vi.mock('../composables/useSyncWebSocket', () => ({
  onEvent: () => () => {},
  getClientId: () => null,
  onSuggestions: () => () => {},
}))

import PluginOverlayHost from '../components/plugin/PluginOverlayHost.vue'
import { usePluginOverlaysStore } from '../stores/pluginOverlays'

const Widget = defineComponent({ render: () => h('div', 'ovl') })
const fakeApi = { open: () => {} }

function mountHost() {
  return mount(PluginOverlayHost, {
    props: { getPluginContext: () => fakeApi as never },
  })
}

describe('PluginOverlayHost', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('renders one overlay item per registered visible overlay', () => {
    const store = usePluginOverlaysStore()
    store.register('p1', [
      { id: 'p1:a', component: Widget },
      { id: 'p1:b', component: Widget },
    ])
    const wrapper = mountHost()
    expect(wrapper.findAll('.overlay-item')).toHaveLength(2)
  })

  it('does not mount the fixed layer when no overlays are registered', () => {
    const wrapper = mountHost()
    expect(wrapper.find('.overlay-layer').exists()).toBe(false)
  })

  it('excludes autoHidden overlays from the layer', () => {
    const store = usePluginOverlaysStore()
    store.register('p1', [{ id: 'p1:a', component: Widget }])
    for (let i = 0; i < 5; i++) store.reportError('p1:a', new Error('x'))
    const wrapper = mountHost()
    expect(wrapper.find('.overlay-layer').exists()).toBe(false)
  })

  it('passes each overlay the context created for its plugin', () => {
    const getPluginContext = vi.fn((id: string) => ({ open: () => {}, pluginId: id }))
    const store = usePluginOverlaysStore()
    store.register('p1', [{ id: 'p1:a', component: Widget }])
    mount(PluginOverlayHost, { props: { getPluginContext: getPluginContext as never } })
    expect(getPluginContext).toHaveBeenCalledWith('p1')
  })
})
