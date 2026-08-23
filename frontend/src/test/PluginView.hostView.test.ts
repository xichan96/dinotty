import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { defineComponent } from 'vue'
import PluginView from '../components/plugin/PluginView.vue'
import type { LoadedPlugin, PluginContext } from '../composables/usePluginLoader'

let wrapper: VueWrapper | null = null

afterEach(() => {
  wrapper?.unmount()
  wrapper = null
})

const fakeApi = {} as PluginContext

beforeEach(() => {
  setActivePinia(createPinia())
})

function mountView(plugin: LoadedPlugin) {
  wrapper = mount(PluginView, {
    props: {
      plugin,
      api: fakeApi,
      paneId: 'p1',
      workspaceId: 'w1',
      isVisible: true,
      isFocused: true,
    },
  })
  return wrapper
}

function activePlugin(id: string, exports: LoadedPlugin['exports']): LoadedPlugin {
  return {
    id,
    manifest: { id, name: id, version: '1.0.0' },
    module: { activate: () => ({}) },
    exports,
    state: 'active',
  }
}

describe('PluginView host view fallback', () => {
  it('renders the builtin-keyboard info card when the plugin exports no component', () => {
    mountView(activePlugin('builtin-keyboard', { keyboard: {} as never }))

    expect(wrapper!.find('.builtin-keyboard-info').exists()).toBe(true)
    expect(wrapper!.text()).not.toContain('This plugin does not provide a UI component')
  })

  it('renders an exported component for plugins that provide one', () => {
    const Component = defineComponent({ template: '<div class="plugin-component" />' })
    mountView(activePlugin('mini-keyboard', { component: Component }))

    expect(wrapper!.find('.plugin-component').exists()).toBe(true)
  })

  it('keeps the empty message for active plugins without a component or host view', () => {
    mountView(activePlugin('mini-keyboard', null))

    expect(wrapper!.text()).toContain('This plugin does not provide a UI component')
  })

  it('shows the load error for plugins in the error state even with a host view', () => {
    const plugin: LoadedPlugin = {
      id: 'builtin-keyboard',
      manifest: { id: 'builtin-keyboard', name: 'builtin-keyboard', version: '1.0.0' },
      module: { activate: () => ({}) },
      exports: null,
      state: 'error',
      error: 'boom',
    }
    mountView(plugin)

    expect(wrapper!.text()).toContain('Plugin load failed: boom')
    expect(wrapper!.find('.builtin-keyboard-info').exists()).toBe(false)
  })
})
