import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import PluginsTab from '../components/settings/PluginsTab.vue'

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
}))

vi.mock('../composables/useTransport', () => ({
  isTauri: transportMocks.isTauri,
  tauriInvoke: transportMocks.tauriInvoke,
}))

vi.mock('../composables/usePluginLoader', () => ({
  usePluginLoader: () => ({
    loadedPlugins: new Map(),
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
})
