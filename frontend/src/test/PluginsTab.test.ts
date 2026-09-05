import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent } from 'vue'
import PluginsTab from '../components/settings/PluginsTab.vue'
import { usePluginOverlaysStore } from '../stores/pluginOverlays'
import { settings } from '../composables/useSettings'

const transportMocks = vi.hoisted(() => ({
  isTauri: vi.fn(),
  tauriInvoke: vi.fn(),
}))

const pluginMocks = vi.hoisted(() => ({
  fetchMarket: vi.fn(),
  fetchReadme: vi.fn(),
  installFromMarket: vi.fn(),
  loadAll: vi.fn(),
  unloadPlugin: vi.fn(),
  loadedPlugins: new Map<string, any>(),
}))

vi.mock('../composables/apiBase', () => ({
  authFetch: vi.fn().mockResolvedValue(new Response(null, { status: 200 })),
  apiUrl: (path: string) => path,
  getApiBase: vi.fn().mockResolvedValue(''),
}))

vi.mock('../composables/useTransport', () => ({
  isTauri: transportMocks.isTauri,
  tauriInvoke: transportMocks.tauriInvoke,
}))

vi.mock('../composables/usePluginLoader', () => ({
  usePluginLoader: () => ({
    loadedPlugins: pluginMocks.loadedPlugins,
    loadAll: pluginMocks.loadAll,
    unloadPlugin: pluginMocks.unloadPlugin,
  }),
}))

vi.mock('../composables/useMarketplace', async () => {
  const { ref } = await import('vue')
  return {
    useMarketplace: () => ({
      plugins: ref([]),
      loading: ref(false),
      error: ref(''),
      installing: ref(new Set<string>()),
      fetchMarket: pluginMocks.fetchMarket,
      fetchReadme: pluginMocks.fetchReadme,
      installFromMarket: pluginMocks.installFromMarket,
    }),
  }
})

describe('PluginsTab folder picker', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setActivePinia(createPinia())
    pluginMocks.loadedPlugins.clear()
    settings.plugin_prefs = { hidden_toolbar: [], hidden_overlays: [], show_incompatible: false }
    transportMocks.isTauri.mockReturnValue(true)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('uses the native system picker when installing a plugin folder in Tauri', async () => {
    transportMocks.tauriInvoke.mockResolvedValue('C:\\plugins\\sample')
    const wrapper = mount(PluginsTab, {
      global: { stubs: { ConfirmModal: true } },
    })

    await wrapper.findAll('.plugin-tab')[1].trigger('click')
    await wrapper.find('.plugin-toolbar .plugin-action-btn').trigger('click')
    await wrapper.get('.plugin-browse-btn').trigger('click')

    expect(transportMocks.tauriInvoke).toHaveBeenCalledWith('pick_workspace_dir', {
      base: undefined,
    })
    expect(wrapper.get('.plugin-browse-btn').text()).toBe('C:\\plugins\\sample')
    expect(wrapper.findComponent({ name: 'FilePickerModal' }).exists()).toBe(false)
    wrapper.unmount()
  })

  it('shows a per-overlay toggle in the installed tab and persists hiding via the pref', async () => {
    const store = usePluginOverlaysStore()
    store.register('overlay-demo', [
      { id: 'overlay-demo:fab', component: defineComponent({ render: () => null }) },
    ])
    pluginMocks.loadedPlugins.set('overlay-demo', {
      id: 'overlay-demo',
      manifest: { name: 'Overlay Demo', version: '0.1.0', description: 'demo', permissions: [] },
      state: 'active',
      exports: {},
      isDevLink: false,
    })

    const wrapper = mount(PluginsTab, {
      global: { stubs: { ConfirmModal: true } },
    })

    await wrapper.findAll('.plugin-tab')[1].trigger('click')

    const toggle = wrapper.get('.plugin-toggle-inline[title="overlay-demo:fab"]')
    expect(toggle.text()).toContain('Fab')
    const input = toggle.get('input[type="checkbox"]')
    expect((input.element as HTMLInputElement).checked).toBe(true)

    await input.setValue(false)

    expect(store.isVisible(store.overlays[0] as Parameters<typeof store.isVisible>[0])).toBe(false)
    expect(settings.plugin_prefs.hidden_overlays).toContain('overlay-demo:fab')
    expect((input.element as HTMLInputElement).checked).toBe(false)
    wrapper.unmount()
  })

  function seedComponentPlugin(id: string, name: string) {
    pluginMocks.loadedPlugins.set(id, {
      id,
      manifest: { name, version: '1.0.0', description: 'd', permissions: [] },
      state: 'active',
      exports: { component: defineComponent({ render: () => null }) },
      isDevLink: false,
    })
  }

  async function mountInstalled() {
    const wrapper = mount(PluginsTab, {
      global: { stubs: { ConfirmModal: true } },
    })
    await wrapper.findAll('.plugin-tab')[1].trigger('click')
    return wrapper
  }

  it('hides the open-mode selector for plugins without a component', async () => {
    pluginMocks.loadedPlugins.set('overlay-demo', {
      id: 'overlay-demo',
      manifest: { name: 'Overlay Demo', version: '0.1.0', description: 'demo', permissions: [] },
      state: 'active',
      exports: {},
      isDevLink: false,
    })
    const wrapper = await mountInstalled()
    expect(wrapper.find('.plugin-open-mode-select').exists()).toBe(false)
    wrapper.unmount()
  })

  it('persists a floating open mode to the pref on change', async () => {
    seedComponentPlugin('json-formatter', 'JSON Formatter')
    const wrapper = await mountInstalled()

    const select = wrapper.get('.plugin-open-mode-select')
    await select.setValue('floating')
    expect(settings.plugin_prefs?.open_modes?.['json-formatter']).toBe('floating')

    await select.setValue('tab')
    expect(settings.plugin_prefs?.open_modes?.['json-formatter']).toBe('tab')
    wrapper.unmount()
  })

  it('reflects a pre-seeded floating pref on mount', async () => {
    seedComponentPlugin('json-formatter', 'JSON Formatter')
    settings.plugin_prefs = {
      hidden_toolbar: [],
      hidden_overlays: [],
      show_incompatible: false,
      open_modes: { 'json-formatter': 'floating' },
    }
    const wrapper = await mountInstalled()
    const select = wrapper.get('.plugin-open-mode-select')
    expect((select.element as HTMLSelectElement).value).toBe('floating')
    wrapper.unmount()
  })
})
