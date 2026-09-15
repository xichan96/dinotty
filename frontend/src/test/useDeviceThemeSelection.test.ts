import { describe, expect, it } from 'vitest'
import { getThemeByName, getThemeByNameStrict } from '../themes'
import {
  buildCustomThemeColors,
  resolveTheme,
  type SavedTheme,
  type Selection,
} from '../composables/useDeviceThemeSelection'

const ANSI_KEYS = [
  '--color-black',
  '--color-red',
  '--color-green',
  '--color-yellow',
  '--color-blue',
  '--color-magenta',
  '--color-cyan',
  '--color-white',
  '--color-bright-black',
  '--color-bright-red',
  '--color-bright-green',
  '--color-bright-yellow',
  '--color-bright-blue',
  '--color-bright-magenta',
  '--color-bright-cyan',
  '--color-bright-white',
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
    installedThemes: [],
    hiddenBuiltins: [],
    ...overrides,
  })
}

/** A theme installed from a file on the server, which has no uuid. */
function installedTheme() {
  return {
    id: 'dracula-soft',
    name: 'Dracula Soft',
    colors: {
      foreground: '#f8f8f2',
      background: '#282a36',
      cursor: '#6272a4',
      ansi: Array.from({ length: 16 }, (_, i) => `#${(i + 1).toString(16).padStart(6, '0')}`),
    },
  }
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
    expect(resolve({ selection: { kind: 'custom', uuid: 'missing' } }).source).toBe(
      'server-default'
    )
  })

  // An installed theme is identified by the file it came from, not by a uuid,
  // because that is what the delete route takes.
  it('resolves an installed theme in the same variable set as a custom one', () => {
    const installed = installedTheme()
    const selection: Selection = { kind: 'installed', id: installed.id }
    const result = resolve({ selection, installedThemes: [installed] })

    expect(result.source).toBe(selection)
    expect(result.colors['--bg']).toBe(installed.colors.background)
    expect(result.colors['--fg']).toBe(installed.colors.foreground)
    expect(result.colors['--cursor']).toBe(installed.colors.cursor)
    expect(result.colors['--color-red']).toBe(installed.colors.ansi[1])
    for (const key of ['--bg-surface', '--border', '--tab-bg', '--fg-muted']) {
      expect(result.colors).toHaveProperty(key)
    }
  })

  it('falls back when the selected installed theme does not exist', () => {
    expect(resolve({ selection: { kind: 'installed', id: 'gone' } }).source).toBe('server-default')
  })

  // The list arrives after first paint, so the very first resolution of an
  // installed selection is against an empty list. It has to be a fallback, not
  // a crash — the reactive re-resolve is what then applies the real theme.
  it('falls back before the installed list has loaded, rather than throwing', () => {
    expect(resolve({ selection: { kind: 'installed', id: 'dracula-soft' } }).source).toBe(
      'server-default'
    )
  })

  it('does not confuse an installed id with a custom uuid', () => {
    const saved = sampleTheme()
    // Same string on both sides: the kinds must not be interchangeable.
    const result = resolve({
      selection: { kind: 'installed', id: saved.uuid },
      customThemes: [saved],
    })
    expect(result.source).toBe('server-default')
  })

  it('maps cursor and all ANSI colors in order', () => {
    const saved = sampleTheme()
    const colors = buildCustomThemeColors(saved)
    expect(colors['--cursor']).toBe(saved.colors.cursor)
    ANSI_KEYS.forEach((key, i) => expect(colors[key]).toBe(saved.colors.ansi[i]))
  })
})
