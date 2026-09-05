import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { defineComponent } from 'vue'

// saveSettings performs a full settings PUT; no-op it so toggles don't hit the
// network. Keep the rest of the module (settings is read by useI18n).
vi.mock('../composables/useSettings', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../composables/useSettings')>()
  return { ...actual, saveSettings: vi.fn() }
})

import PluginView from '../components/plugin/PluginView.vue'
import { usePluginOverlaysStore } from '../stores/pluginOverlays'
import type { LoadedPlugin, PluginContext } from '../composables/usePluginLoader'
import type { OverlayContribution } from '../../../plugin-api/index'

const fakeApi = {} as PluginContext

function mountView(plugin: LoadedPlugin) {
  return mount(PluginView, {
    props: {
      plugin,
      api: fakeApi,
      paneId: 'p1',
      workspaceId: 'w1',
      isVisible: true,
      isFocused: true,
    },
  })
}

function activePlugin(id: string): LoadedPlugin {
  return {
    id,
    manifest: { id, name: id, version: '1.0.0' },
    module: { activate: () => ({}) },
    exports: null,
    state: 'active',
  }
}

const Widget = defineComponent({ template: '<div class="ov-widget" />' })

function overlay(id: string, partial: Partial<OverlayContribution> = {}): OverlayContribution {
  return { component: Widget, ...partial, id }
}

describe('PluginView overlay management section', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('renders a toggle and an adjust-position button per registered overlay', () => {
    const store = usePluginOverlaysStore()
    store.register('overlay-demo', [overlay('overlay-demo:fab')])
    const wrapper = mountView(activePlugin('overlay-demo'))

    expect(wrapper.find('.plugin-overlays').exists()).toBe(true)
    const rows = wrapper.findAll('.overlay-row')
    expect(rows).toHaveLength(1)
    expect(rows[0].text()).toContain('Fab')
    const cb = rows[0].find('input[type="checkbox"]').element as HTMLInputElement
    expect(cb.checked).toBe(true)
    expect(rows[0].text()).toContain('Adjust position')
    wrapper.unmount()
  })

  it('lists a defaultHidden overlay unchecked and lets the user re-enable it', async () => {
    const store = usePluginOverlaysStore()
    store.register('overlay-demo', [overlay('overlay-demo:status', { defaultVisible: false })])
    const wrapper = mountView(activePlugin('overlay-demo'))

    const cb = wrapper.find('input[type="checkbox"]').element as HTMLInputElement
    expect(cb.checked).toBe(false)
    await wrapper.find('input[type="checkbox"]').setValue(true)
    expect(store.isVisible(store.overlays[0])).toBe(true)
    wrapper.unmount()
  })

  it('shows no overlay section for plugins without overlay contributions', () => {
    const wrapper = mountView(activePlugin('mini-keyboard'))
    expect(wrapper.find('.plugin-overlays').exists()).toBe(false)
    wrapper.unmount()
  })

  it('toggles reposition mode via the adjust-position button', async () => {
    const store = usePluginOverlaysStore()
    store.register('overlay-demo', [overlay('overlay-demo:status')])
    const wrapper = mountView(activePlugin('overlay-demo'))

    const btn = wrapper.find('button.overlay-reposition')
    await btn.trigger('click')
    expect(store.repositionId).toBe('overlay-demo:status')
    expect(btn.classes()).toContain('active')
    expect(wrapper.text()).toContain('Done')
    await btn.trigger('click')
    expect(store.repositionId).toBeNull()
    wrapper.unmount()
  })

  it('disables adjust position while the overlay is hidden', () => {
    const store = usePluginOverlaysStore()
    store.register('overlay-demo', [overlay('overlay-demo:status', { defaultVisible: false })])
    const wrapper = mountView(activePlugin('overlay-demo'))

    const btn = wrapper.find('button.overlay-reposition')
    expect(btn.attributes('disabled')).toBeDefined()
    wrapper.unmount()
  })

  it('hides the overlay section with showOverlays=false even when overlays exist', () => {
    const store = usePluginOverlaysStore()
    store.register('overlay-demo', [overlay('overlay-demo:fab')])
    const wrapper = mount(PluginView, {
      props: {
        plugin: activePlugin('overlay-demo'),
        api: fakeApi,
        paneId: 'plugin:overlay-demo:float',
        workspaceId: undefined,
        isVisible: true,
        isFocused: true,
        showOverlays: false,
      },
    })
    expect(wrapper.find('.plugin-overlays').exists()).toBe(false)
    wrapper.unmount()
  })
})
