import { beforeEach, describe, expect, it, vi } from 'vitest'
import { settings } from '../composables/useSettings'
import {
  FONT_SIZE_MAX,
  getEffectiveText,
  reloadOverrides,
  resetAllOverrides,
  resetOverride,
  setOverride,
  useDeviceTextSettings,
} from '../composables/useDeviceTextSettings'

const KEY = 'dinotty_device_text_overrides_v1'

class MemoryStorage implements Storage {
  private data = new Map<string, string>()
  get length() { return this.data.size }
  clear() { this.data.clear() }
  getItem(key: string) { return this.data.get(key) ?? null }
  key(index: number) { return [...this.data.keys()][index] ?? null }
  removeItem(key: string) { this.data.delete(key) }
  setItem(key: string, value: string) { this.data.set(key, String(value)) }
}

describe('useDeviceTextSettings', () => {
  beforeEach(() => {
    const storage = new MemoryStorage()
    Object.defineProperty(window, 'localStorage', { value: storage, configurable: true })
    vi.stubGlobal('localStorage', storage)
    localStorage.clear()
    resetAllOverrides()
    settings.text.font_size = 14
    settings.text.font_family = 'server-font'
    settings.text.line_height = 1.2
    settings.text.letter_spacing = 1
  })

  it('inherits server text without an override and performs no storage write', () => {
    const setItem = vi.spyOn(localStorage, 'setItem')
    reloadOverrides()
    expect(getEffectiveText()).toMatchObject(settings.text)
    expect(setItem).not.toHaveBeenCalled()
  })

  it('supports partial overrides, local precedence, reset, and valid falsy values', () => {
    const device = useDeviceTextSettings()
    setOverride('font_size', 50)
    setOverride('font_family', '')
    setOverride('letter_spacing', 0)
    expect(getEffectiveText()).toMatchObject({ font_size: 50, font_family: '', letter_spacing: 0 })

    settings.text.font_size = 16
    settings.text.line_height = 1.5
    expect(getEffectiveText()).toMatchObject({ font_size: 50, line_height: 1.5 })
    expect(device.hasOverride('font_size')).toBe(true)

    resetOverride('font_size')
    expect(getEffectiveText().font_size).toBe(16)
    expect(JSON.parse(localStorage.getItem(KEY)!)).toEqual({
      version: 1,
      overrides: { font_family: '', letter_spacing: 0 },
    })
    resetAllOverrides()
    expect(localStorage.getItem(KEY)).toBeNull()
  })

  it('clamps valid numeric fields and ignores invalid siblings and unknown keys', () => {
    localStorage.setItem(KEY, JSON.stringify({
      version: 1,
      overrides: {
        font_size: 500,
        font_family: ['bad'],
        line_height: '1.5',
        letter_spacing: 2,
        unknown: 123,
      },
    }))
    reloadOverrides()
    expect(getEffectiveText()).toMatchObject({
      font_size: FONT_SIZE_MAX,
      font_family: 'server-font',
      line_height: 1.2,
      letter_spacing: 2,
    })
    expect(JSON.parse(localStorage.getItem(KEY)!)).toEqual({
      version: 1,
      overrides: { font_size: FONT_SIZE_MAX, letter_spacing: 2 },
    })
  })

  it.each([
    '{',
    JSON.stringify({ version: 2, overrides: {} }),
    JSON.stringify([]),
    JSON.stringify({ version: 1, overrides: null }),
  ])('drops a malformed root/key: %s', (raw) => {
    localStorage.setItem(KEY, raw)
    reloadOverrides()
    expect(getEffectiveText()).toMatchObject(settings.text)
    expect(localStorage.getItem(KEY)).toBeNull()
  })

  it('rejects non-finite and wrong-type setter values', () => {
    const unsafeSet = setOverride as (field: string, value: unknown) => void
    for (const value of [NaN, Infinity, '18', [], {}, null, true]) {
      unsafeSet('font_size', value)
    }
    for (const value of [1, [], {}, null, true]) unsafeSet('font_family', value)
    expect(localStorage.getItem(KEY)).toBeNull()
    expect(getEffectiveText()).toMatchObject(settings.text)
  })

  it('continues in memory when storage reads and writes throw', () => {
    const getItem = vi.spyOn(localStorage, 'getItem').mockImplementation(() => {
      throw new Error('disabled')
    })
    const setItem = vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new Error('disabled')
    })
    expect(() => reloadOverrides()).not.toThrow()
    expect(() => setOverride('font_size', 22)).not.toThrow()
    expect(getEffectiveText().font_size).toBe(22)
    getItem.mockRestore()
    setItem.mockRestore()
  })
})
