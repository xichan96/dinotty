import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import AppearanceTab from '../components/settings/AppearanceTab.vue'
import { settings, saveSettings } from '../composables/useSettings'
import {
  getEffectiveText,
  resetAllOverrides,
  setOverride,
} from '../composables/useDeviceTextSettings'

const appearanceMocks = vi.hoisted(() => ({ authFetch: vi.fn(), isFontAvailable: vi.fn(() => true) }))

vi.mock('../composables/apiBase', () => ({
  apiUrl: (path: string) => path,
  authFetch: appearanceMocks.authFetch,
  getApiBase: vi.fn(async () => ''),
  hasAuthToken: () => false,
}))

vi.mock('../utils/fontAvailability', () => ({
  isFontAvailable: appearanceMocks.isFontAvailable,
  clearNegativeFontCache: vi.fn(),
}))

class MemoryStorage implements Storage {
  private data = new Map<string, string>()
  get length() { return this.data.size }
  clear() { this.data.clear() }
  getItem(key: string) { return this.data.get(key) ?? null }
  key(index: number) { return [...this.data.keys()][index] ?? null }
  removeItem(key: string) { this.data.delete(key) }
  setItem(key: string, value: string) { this.data.set(key, String(value)) }
}

describe('AppearanceTab device text overrides', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    const storage = new MemoryStorage()
    Object.defineProperty(window, 'localStorage', { value: storage, configurable: true })
    vi.stubGlobal('localStorage', storage)
    localStorage.clear()
    appearanceMocks.authFetch.mockReset()
    appearanceMocks.isFontAvailable.mockClear()
    appearanceMocks.authFetch.mockResolvedValue(new Response('{}', { status: 200 }))
    resetAllOverrides()
    settings.text.font_size = 14
    settings.text.font_family = 'server-font'
    settings.text.line_height = 1.2
    settings.text.letter_spacing = 1
    settings.text.cursor_style = 'block'
    settings.text.custom_fonts = ['Fira Code']
  })

  it('renders effective values, including a font size above the old max, and writes no PUT on sliders', async () => {
    setOverride('font_size', 50)
    const wrapper = mount(AppearanceTab)
    const ranges = wrapper.findAll<HTMLInputElement>('input[type="range"]')
    expect(ranges[0].element.value).toBe('50')
    expect(ranges[0].attributes('min')).toBe('8')
    expect(ranges[0].attributes('max')).toBe('72')
    expect(wrapper.findAll('.range-val')[0].text()).toBe('50px')

    await ranges[0].setValue(51)
    await ranges[1].setValue(1.5)
    await ranges[2].setValue(2)
    vi.runAllTimers()
    expect(getEffectiveText()).toMatchObject({ font_size: 51, line_height: 1.5, letter_spacing: 2 })
    expect(localStorage.getItem('dinotty_device_text_overrides_v1')).toContain('51')
    expect(appearanceMocks.authFetch).not.toHaveBeenCalled()
  })

  it('selects and highlights the effective font without mutating the server font', async () => {
    setOverride('font_family', 'Fira Code, monospace')
    const wrapper = mount(AppearanceTab)
    await wrapper.find('.font-dropdown-trigger').trigger('click')
    await Promise.resolve()
    const active = wrapper.find('.font-dropdown-item.active')
    expect(active.text()).toContain('Fira Code')
    expect(appearanceMocks.isFontAvailable).toHaveBeenCalledWith('Fira Code')
    expect(settings.text.font_family).toBe('server-font')

    const menlo = wrapper.findAll('.font-dropdown-item').find((item) => item.text().includes('Menlo'))!
    await menlo.trigger('click')
    expect(getEffectiveText().font_family).toContain('Menlo')
    expect(settings.text.font_family).toBe('server-font')
    vi.runAllTimers()
    expect(appearanceMocks.authFetch).not.toHaveBeenCalled()
  })

  it('keeps removeFontItem hybrid: local fallback plus server custom-font save', async () => {
    setOverride('font_family', 'Fira Code, monospace')
    const wrapper = mount(AppearanceTab)
    await wrapper.find('.font-dropdown-trigger').trigger('click')
    await Promise.resolve()
    const row = wrapper.findAll('.font-dropdown-item').find((item) => item.text().includes('Fira Code'))!
    await row.find('.font-item-remove').trigger('click')
    vi.advanceTimersByTime(100)
    await Promise.resolve()
    await Promise.resolve()
    expect(getEffectiveText().font_family).toBe('monospace')
    expect(settings.text.font_family).toBe('server-font')
    expect(settings.text.custom_fonts).toEqual([])
    expect(appearanceMocks.authFetch).toHaveBeenCalledWith(
      '/api/settings',
      expect.objectContaining({ method: 'PUT' }),
    )
  })

  it('keeps server defaults in an unrelated settings PUT', async () => {
    setOverride('font_size', 50)
    setOverride('font_family', 'Fira Code, monospace')
    setOverride('line_height', 1.8)
    setOverride('letter_spacing', 3)
    const defaults = { ...settings.text }
    settings.text.cursor_style = 'bar'
    await saveSettings()
    const put = appearanceMocks.authFetch.mock.calls[appearanceMocks.authFetch.mock.calls.length - 1]!
    const body = JSON.parse(put[1].body as string)
    expect(body.text).toMatchObject({
      font_size: defaults.font_size,
      font_family: defaults.font_family,
      line_height: defaults.line_height,
      letter_spacing: defaults.letter_spacing,
    })
    expect(settings.text).toMatchObject({
      font_size: defaults.font_size,
      font_family: defaults.font_family,
      line_height: defaults.line_height,
      letter_spacing: defaults.letter_spacing,
      cursor_style: 'bar',
    })
  })

  it('reset links return to the current server default and cursor_style still PUTs', async () => {
    setOverride('font_size', 30)
    const wrapper = mount(AppearanceTab)
    settings.text.font_size = 18
    const reset = wrapper.findAll('button.setting-reset').find((button) => button.attributes('title') === 'reset to default')!
    await reset.trigger('click')
    expect(getEffectiveText().font_size).toBe(18)

    const cursorSelect = wrapper.find<HTMLSelectElement>('select')
    await cursorSelect.setValue('underline')
    vi.advanceTimersByTime(100)
    await Promise.resolve()
    await Promise.resolve()
    expect(appearanceMocks.authFetch).toHaveBeenCalledWith(
      '/api/settings',
      expect.objectContaining({ method: 'PUT' }),
    )
  })
})
