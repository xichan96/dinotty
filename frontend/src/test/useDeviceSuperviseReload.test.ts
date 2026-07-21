import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import KeyboardTab from '../components/settings/KeyboardTab.vue'

const apiMocks = vi.hoisted(() => ({ authFetch: vi.fn() }))

vi.mock('../composables/apiBase', () => ({
  apiUrl: (path: string) => path,
  authFetch: apiMocks.authFetch,
  getApiBase: vi.fn(async () => ''),
  hasAuthToken: () => true,
  wsUrlWithToken: (url: string) => url,
}))

import {
  __resetSettingsLoadStateForTest,
  loadSettings,
  saveSettings,
  settings,
} from '../composables/useSettings'
import {
  getEffectiveSuperviseReload,
  reloadOverrides,
  resetOverride,
  setOverride,
} from '../composables/useDeviceSuperviseReload'

const KEY = 'dinotty_device_supervise_reload_v1'

class MemoryStorage implements Storage {
  private data = new Map<string, string>()
  get length() { return this.data.size }
  clear() { this.data.clear() }
  getItem(key: string) { return this.data.get(key) ?? null }
  key(index: number) { return [...this.data.keys()][index] ?? null }
  removeItem(key: string) { this.data.delete(key) }
  setItem(key: string, value: string) { this.data.set(key, String(value)) }
}

describe('useDeviceSuperviseReload', () => {
  beforeEach(async () => {
    const storage = new MemoryStorage()
    Object.defineProperty(window, 'localStorage', { value: storage, configurable: true })
    vi.stubGlobal('localStorage', storage)
    localStorage.clear()
    resetOverride()
    settings.locale = 'en'
    settings.reload_after_supervise_tabs = false
    __resetSettingsLoadStateForTest()
    apiMocks.authFetch.mockReset()
    apiMocks.authFetch.mockImplementation(async (_url, init?: RequestInit) => new Response(
      init?.method === 'PUT'
        ? '{}'
        : JSON.stringify({ reload_after_supervise_tabs: settings.reload_after_supervise_tabs }),
      { status: 200 },
    ))
    await loadSettings()
    apiMocks.authFetch.mockClear()
    reloadOverrides()
  })

  it('uses the server value when there is no local override', () => {
    settings.reload_after_supervise_tabs = true
    expect(getEffectiveSuperviseReload()).toBe(true)

    settings.reload_after_supervise_tabs = false
    expect(getEffectiveSuperviseReload()).toBe(false)
    expect(localStorage.getItem(KEY)).toBeNull()
  })

  it('writes a local override from the device-labeled checkbox without changing the server field or issuing a PUT', async () => {
    const wrapper = mount(KeyboardTab)
    await flushPromises()
    apiMocks.authFetch.mockClear()

    const input = wrapper.find<HTMLInputElement>('[data-setting="reload-after-supervise-tabs"]')
    expect(input.element.checked).toBe(false)
    expect(wrapper.find('[data-hint="reload-after-supervise-tabs"]').text()).toContain('device')

    await input.setValue(true)
    await flushPromises()

    expect(getEffectiveSuperviseReload()).toBe(true)
    expect(settings.reload_after_supervise_tabs).toBe(false)
    expect(JSON.parse(localStorage.getItem(KEY)!)).toEqual({
      version: 1,
      overrides: { reload_after_supervise_tabs: true },
    })
    expect(apiMocks.authFetch.mock.calls.some(
      ([url, init]) => url === '/api/settings' && init?.method === 'PUT',
    )).toBe(false)
    wrapper.unmount()
  })

  it('does not show reset to default when no device override is set', () => {
    const wrapper = mount(KeyboardTab)

    expect(wrapper.find('[aria-label="reset to default"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('shows reset to default when a device override is set', () => {
    setOverride(true)
    const wrapper = mount(KeyboardTab)

    expect(wrapper.find('[aria-label="reset to default"]').exists()).toBe(true)
    wrapper.unmount()
  })

  it('clears the override and falls back to the server default from reset to default', async () => {
    settings.reload_after_supervise_tabs = true
    setOverride(false)
    const wrapper = mount(KeyboardTab)
    const input = wrapper.find<HTMLInputElement>('[data-setting="reload-after-supervise-tabs"]')

    expect(input.element.checked).toBe(false)
    await wrapper.find('[aria-label="reset to default"]').trigger('click')

    expect(input.element.checked).toBe(true)
    expect(localStorage.getItem(KEY)).toBeNull()
    expect(wrapper.find('[aria-label="reset to default"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('falls back to the current server value after clearing the local override', () => {
    settings.reload_after_supervise_tabs = true
    setOverride(false)
    expect(getEffectiveSuperviseReload()).toBe(false)

    resetOverride()
    expect(getEffectiveSuperviseReload()).toBe(true)
    expect(localStorage.getItem(KEY)).toBeNull()
  })

  it('never includes reload_after_supervise_tabs in a saved settings payload', async () => {
    settings.reload_after_supervise_tabs = true
    setOverride(false)

    await saveSettings()

    const put = apiMocks.authFetch.mock.calls.find(
      ([url, init]) => url === '/api/settings' && init?.method === 'PUT',
    )
    expect(put).toBeDefined()
    const payload = JSON.parse(String(put![1]?.body))
    expect(payload).not.toHaveProperty('reload_after_supervise_tabs')
  })

  it('does not throw on corrupt localStorage JSON and falls back to the server default', () => {
    settings.reload_after_supervise_tabs = true
    localStorage.setItem(KEY, '{')

    expect(() => reloadOverrides()).not.toThrow()
    expect(getEffectiveSuperviseReload()).toBe(true)
    expect(localStorage.getItem(KEY)).toBeNull()
  })
})
