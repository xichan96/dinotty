import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  reloadDeviceKeyboardSettings,
  useDeviceKeyboardSettings,
} from '../composables/useDeviceKeyboardSettings'

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

describe('useDeviceKeyboardSettings', () => {
  beforeEach(() => {
    const storage = new MemoryStorage()
    Object.defineProperty(window, 'localStorage', { value: storage, configurable: true })
    vi.stubGlobal('localStorage', storage)
    document.body.replaceChildren()
    reloadDeviceKeyboardSettings()
  })

  it('migrates v1 overlap settings', () => {
    localStorage.setItem(
      V1_KEY,
      JSON.stringify({ version: 1, settings: { ime_keyboard_overlap_px: 48 } })
    )

    reloadDeviceKeyboardSettings()

    const device = useDeviceKeyboardSettings()
    expect(device.imeKeyboardOverlapPx.value).toBe(48)
    expect(localStorage.getItem(V1_KEY)).toBeNull()
    expect(JSON.parse(localStorage.getItem(V2_KEY)!)).toEqual({
      version: 2,
      settings: { ime_keyboard_overlap_px: 48 },
    })
  })

  it('removes a legacy local mode while preserving the v2 overlap setting', () => {
    localStorage.setItem(
      V2_KEY,
      JSON.stringify({
        version: 2,
        settings: { ime_keyboard_overlap_px: 72, mobile_input_mode: 'system' },
      })
    )

    reloadDeviceKeyboardSettings()

    expect(useDeviceKeyboardSettings().imeKeyboardOverlapPx.value).toBe(72)
    expect(JSON.parse(localStorage.getItem(V2_KEY)!)).toEqual({
      version: 2,
      settings: { ime_keyboard_overlap_px: 72 },
    })
  })

  it('removes v2 storage when the removed mode was its only non-default value', () => {
    localStorage.setItem(
      V2_KEY,
      JSON.stringify({
        version: 2,
        settings: { ime_keyboard_overlap_px: 0, mobile_input_mode: 'system' },
      })
    )

    reloadDeviceKeyboardSettings()

    expect(useDeviceKeyboardSettings().imeKeyboardOverlapPx.value).toBe(0)
    expect(localStorage.getItem(V2_KEY)).toBeNull()
  })
})
