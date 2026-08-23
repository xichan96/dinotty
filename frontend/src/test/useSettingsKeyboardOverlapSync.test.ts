import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import KeyboardTab from '../components/settings/KeyboardTab.vue'

const apiMocks = vi.hoisted(() => ({ authFetch: vi.fn() }))

vi.mock('../composables/apiBase', () => ({
  apiUrl: (path: string) => path,
  authFetch: apiMocks.authFetch,
  getApiBase: vi.fn(async () => ''),
  hasAuthToken: () => true,
}))

import {
  __resetSettingsLoadStateForTest,
  imeKeyboardOverlapPx,
  loadSettings,
  saveSettings,
  settings,
} from '../composables/useSettings'

const V1_KEY = 'dinotty.device-keyboard.v1'
const V2_KEY = 'dinotty.device-keyboard.v2'

class MemoryStorage implements Storage {
  private data = new Map<string, string>()
  get length() {
    return this.data.size
  }
  clear() {
    this.data.clear()
  }
  getItem(key: string) {
    return this.data.get(key) ?? null
  }
  key(index: number) {
    return [...this.data.keys()][index] ?? null
  }
  removeItem(key: string) {
    this.data.delete(key)
  }
  setItem(key: string, value: string) {
    this.data.set(key, String(value))
  }
}

function response(body: object = {}, status = 200) {
  return new Response(JSON.stringify(body), { status })
}

function serverSettings(overlap: number | null) {
  return {
    settings_version: 13,
    ime_keyboard_overlap_px: overlap,
    notification: { channels: {}, sounds: {} },
  }
}

describe('synchronized IME keyboard overlap', () => {
  beforeEach(() => {
    const storage = new MemoryStorage()
    Object.defineProperty(window, 'localStorage', { value: storage, configurable: true })
    vi.stubGlobal('localStorage', storage)
    settings.ime_keyboard_overlap_px = null
    __resetSettingsLoadStateForTest()
    apiMocks.authFetch.mockReset()
  })

  it('seeds an uninitialized server from v2 local storage and clears it after server confirmation', async () => {
    localStorage.setItem(
      V2_KEY,
      JSON.stringify({ version: 2, settings: { ime_keyboard_overlap_px: 72 } })
    )
    apiMocks.authFetch
      .mockResolvedValueOnce(response(serverSettings(null)))
      .mockResolvedValueOnce(response())
      .mockResolvedValueOnce(response(serverSettings(72)))

    await loadSettings()
    await saveSettings()

    const put = apiMocks.authFetch.mock.calls.find(([, init]) => init?.method === 'PUT')
    expect(JSON.parse(String(put?.[1]?.body))).toMatchObject({
      settings_version: 13,
      client_settings_version: 13,
      ime_keyboard_overlap_px: 72,
    })
    expect(settings.ime_keyboard_overlap_px).toBe(72)
    expect(localStorage.getItem(V2_KEY)).not.toBeNull()

    await loadSettings()

    expect(settings.ime_keyboard_overlap_px).toBe(72)
    expect(localStorage.getItem(V1_KEY)).toBeNull()
    expect(localStorage.getItem(V2_KEY)).toBeNull()
  })

  it('lets an initialized server zero win over a stale local value without another PUT', async () => {
    localStorage.setItem(
      V2_KEY,
      JSON.stringify({ version: 2, settings: { ime_keyboard_overlap_px: 72 } })
    )
    apiMocks.authFetch.mockResolvedValueOnce(response(serverSettings(0)))

    await loadSettings()

    expect(imeKeyboardOverlapPx.value).toBe(0)
    expect(localStorage.getItem(V2_KEY)).toBeNull()
    expect(apiMocks.authFetch).toHaveBeenCalledTimes(1)
  })

  it('does not let a client without a legacy value claim initialization before another device', async () => {
    apiMocks.authFetch.mockResolvedValueOnce(response(serverSettings(null)))

    await loadSettings()

    expect(imeKeyboardOverlapPx.value).toBe(0)
    expect(settings.ime_keyboard_overlap_px).toBeNull()
    expect(apiMocks.authFetch).toHaveBeenCalledTimes(1)
  })

  it('retains the local seed when persistence fails so a later load can retry', async () => {
    localStorage.setItem(
      V1_KEY,
      JSON.stringify({ version: 1, settings: { ime_keyboard_overlap_px: 48 } })
    )
    apiMocks.authFetch
      .mockResolvedValueOnce(response(serverSettings(null)))
      .mockResolvedValueOnce(response({}, 500))
    vi.spyOn(console, 'error').mockImplementation(() => {})

    await loadSettings()
    await saveSettings()

    expect(settings.ime_keyboard_overlap_px).toBe(48)
    expect(localStorage.getItem(V1_KEY)).not.toBeNull()
  })

  it('normalizes edits to integer pixels in the supported range', () => {
    imeKeyboardOverlapPx.value = 999
    expect(settings.ime_keyboard_overlap_px).toBe(300)

    imeKeyboardOverlapPx.value = -4
    expect(settings.ime_keyboard_overlap_px).toBe(0)

    imeKeyboardOverlapPx.value = 18.6
    expect(settings.ime_keyboard_overlap_px).toBe(19)
  })

  it('persists a settings-panel overlap edit through the shared server settings channel', async () => {
    settings.locale = 'en'
    settings.ime_keyboard_overlap_px = 0
    apiMocks.authFetch.mockResolvedValue(response())
    const wrapper = mount(KeyboardTab)
    const input = wrapper.get<HTMLInputElement>('[data-setting="ime-keyboard-overlap-px"]')

    await input.setValue('64')
    await flushPromises()

    const puts = apiMocks.authFetch.mock.calls.filter(([, init]) => init?.method === 'PUT')
    expect(puts).toHaveLength(1)
    const put = puts[0]
    expect(JSON.parse(String(put?.[1]?.body))).toMatchObject({
      settings_version: 13,
      client_settings_version: 13,
      ime_keyboard_overlap_px: 64,
    })
    wrapper.unmount()
  })
})
