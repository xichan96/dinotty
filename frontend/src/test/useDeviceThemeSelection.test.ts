import { describe, expect, it } from 'vitest'
import { getThemeByName, getThemeByNameStrict } from '../themes'
import {
  buildCustomThemeColors,
  resolveTheme,
  type SavedTheme,
  type Selection,
} from '../composables/useDeviceThemeSelection'

const ANSI_KEYS = [
  '--color-black', '--color-red', '--color-green', '--color-yellow', '--color-blue',
  '--color-magenta', '--color-cyan', '--color-white', '--color-bright-black', '--color-bright-red',
  '--color-bright-green', '--color-bright-yellow', '--color-bright-blue', '--color-bright-magenta',
  '--color-bright-cyan', '--color-bright-white',
] as const

function sampleTheme(): SavedTheme {
  return {
    uuid: 'u1',
    name: 'Device Custom',
    colors: {
      foreground: '#123456',
      background: '#234567',
      cursor: '#345678',
      ansi: Array.from({ length: 16 }, (_, i) => `#${(i + 1).toString(16).padStart(6, '0')}`),
    },
  }
}

function resolve(overrides: Partial<Parameters<typeof resolveTheme>[0]> = {}) {
  return resolveTheme({
    selection: null,
    preset: 'dark',
    legacyCustom: null,
    customThemes: [],
    hiddenBuiltins: [],
    ...overrides,
  })
}

describe('device theme resolution', () => {
  it('uses the server default when there is no device selection', () => {
    const result = resolve()
    expect(result.source).toBe('server-default')
    expect(result.colors['--bg']).toBe(getThemeByName('dark').colors['--bg'])
  })

  it('applies legacy custom colors to the server default', () => {
    const result = resolve({ legacyCustom: { foreground: '#123456' } })
    expect(result.colors['--fg']).toBe('#123456')
  })

  it('uses a builtin device selection without the legacy overlay', () => {
    const selection: Selection = { kind: 'builtin', name: 'nord' }
    const result = resolve({ selection, legacyCustom: { foreground: '#123456' } })
    expect(result.source).toBe(selection)
    expect(result.colors['--fg']).toBe(getThemeByNameStrict('nord')!.colors['--fg'])
    expect(result.colors['--fg']).not.toBe('#123456')
  })

  it('falls back when the selected builtin is hidden', () => {
    const result = resolve({
      selection: { kind: 'builtin', name: 'nord' },
      hiddenBuiltins: ['nord'],
    })
    expect(result.source).toBe('server-default')
  })

  it('falls back when the selected builtin does not exist', () => {
    expect(resolve({ selection: { kind: 'builtin', name: 'zzz' } }).source).toBe('server-default')
  })

  it('resolves a saved custom theme with the full variable set', () => {
    const saved = sampleTheme()
    const selection: Selection = { kind: 'custom', uuid: 'u1' }
    const result = resolve({ selection, customThemes: [saved] })
    expect(result.source).toBe(selection)
    for (const key of ['--bg-surface', '--border', '--tab-bg', '--fg-muted', '--palette-text']) {
      expect(result.colors).toHaveProperty(key)
    }
    expect(result.colors['--bg']).toBe(saved.colors.background)
    expect(result.colors['--color-red']).toBe(saved.colors.ansi[1])
  })

  it('falls back when the selected custom theme does not exist', () => {
    expect(resolve({ selection: { kind: 'custom', uuid: 'missing' } }).source).toBe('server-default')
  })

  it('maps cursor and all ANSI colors in order', () => {
    const saved = sampleTheme()
    const colors = buildCustomThemeColors(saved)
    expect(colors['--cursor']).toBe(saved.colors.cursor)
    ANSI_KEYS.forEach((key, i) => expect(colors[key]).toBe(saved.colors.ansi[i]))
  })
})
