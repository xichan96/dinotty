import { describe, it, expect, beforeEach, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  authFetch: vi.fn(),
}))

vi.mock('../composables/apiBase', () => ({
  apiUrl: (path: string) => path,
  authFetch: mocks.authFetch,
  getAuthToken: () => '',
  setAuthToken: () => {},
  getApiBase: async () => 'http://127.0.0.1:7681',
  fetchServerToken: async () => '',
  hasAuthToken: () => true,
}))

vi.mock('../composables/useTransport', () => ({
  isTauri: () => false,
  tauriInvoke: vi.fn(),
}))

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))

vi.mock('qrcode', () => ({
  default: { toCanvas: vi.fn() },
  toCanvas: vi.fn(),
}))

vi.mock('../utils/clipboard', () => ({
  copyToClipboard: vi.fn(async () => true),
}))

vi.mock('../composables/useConfirm', () => ({
  uiConfirm: (message: string) => window.confirm(message),
  confirmState: {
    visible: false,
    title: '',
    message: '',
    confirmText: 'OK',
    cancelText: 'Cancel',
    danger: true,
    resolve: null,
  },
  confirmResolve: vi.fn(),
  confirmCancel: vi.fn(),
}))

// PluginsTab pulls in plugin-market state that is irrelevant here.
vi.mock('../components/settings/PluginsTab.vue', () => ({
  default: { name: 'PluginsTab', template: '<div />' },
}))

import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import SettingsPanel from '../components/SettingsPanel.vue'
import { __resetSettingsLoadStateForTest, loadSettings } from '../composables/useSettings'

// Spec: issue #295 — "电脑重新连接网络后局域网 IP 变更，访问地址未对应更新".
// App.vue lazily mounts SettingsPanel on first open and then keeps it mounted
// (close is CSS-driven), so GeneralTab's own onMounted runs only once. The
// displayed LAN access URL must therefore be re-read from /api/info whenever
// the General tab becomes visible again — otherwise a changed DHCP lease keeps
// showing a dead address.
function infoRequestCount() {
  return mocks.authFetch.mock.calls.filter(([url]) => url === '/api/info').length
}

function response(data: unknown, status = 200) {
  return { ok: status < 400, status, json: async () => data, text: async () => '' } as Response
}

describe('SettingsPanel - LAN access URL refresh', () => {
  beforeEach(async () => {
    setActivePinia(createPinia())
    mocks.authFetch.mockReset()
    mocks.authFetch.mockImplementation(async (url: string) =>
      url === '/api/info'
        ? response({ lan_ip: '192.168.1.100', port: 8999 })
        : response({ saved: [], managed: true, foreign: false, empty: true })
    )
    __resetSettingsLoadStateForTest()
    await loadSettings()
  })

  it('re-reads the access URL when the panel is reopened on the General tab', async () => {
    // Opening for the first time mounts the panel with open=true (App.vue's
    // settingsMounted latch), so the initial read still happens.
    const wrapper = mount(SettingsPanel, { props: { open: true } })
    await flushPromises()

    // Baseline also includes AboutTab, which reads /api/info in its onMounted.
    const afterMount = infoRequestCount()
    expect(afterMount).toBeGreaterThan(0)

    await wrapper.setProps({ open: false })
    await flushPromises()
    await wrapper.setProps({ open: true })
    await flushPromises()

    expect(infoRequestCount()).toBe(afterMount + 1)
  })

  it('holds the refresh until the General tab is shown again', async () => {
    const wrapper = mount(SettingsPanel, { props: { open: true } })
    await flushPromises()
    const afterMount = infoRequestCount()

    // Leave the General tab, then close and reopen the panel.
    await wrapper.find('#settings-tab-about').trigger('click')
    await flushPromises()
    await wrapper.setProps({ open: false })
    await wrapper.setProps({ open: true })
    await flushPromises()

    // Nothing on screen shows the access URL, so no read is owed yet.
    expect(infoRequestCount()).toBe(afterMount)

    await wrapper.find('#settings-tab-general').trigger('click')
    await flushPromises()

    expect(infoRequestCount()).toBe(afterMount + 1)
  })
})
