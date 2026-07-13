import { describe, expect, it } from 'vitest'
import {
  fillDefaults,
  getThemeByName,
  getThemeByNameStrict,
  getXtermTheme,
  themes,
  type ThemeDefinition,
} from '../themes'

const ansiColors = {
  '--color-black': '#000000',
  '--color-red': '#cc0000',
  '--color-green': '#00cc00',
  '--color-yellow': '#cccc00',
  '--color-blue': '#0000cc',
  '--color-magenta': '#cc00cc',
  '--color-cyan': '#00cccc',
  '--color-white': '#cccccc',
  '--color-bright-black': '#666666',
  '--color-bright-red': '#ff0000',
  '--color-bright-green': '#00ff00',
  '--color-bright-yellow': '#ffff00',
  '--color-bright-blue': '#0000ff',
  '--color-bright-magenta': '#ff00ff',
  '--color-bright-cyan': '#00ffff',
  '--color-bright-white': '#ffffff',
}

const derivedVariables = [
  '--bg-surface',
  '--bg-overlay',
  '--bg-input',
  '--bg-hover',
  '--bg-surface-hover',
  '--border',
  '--border-focus',
  '--border-hover',
  '--divider',
  '--fg-bright',
  '--fg-muted',
  '--scrollbar-thumb',
  '--scrollbar-thumb-hover',
  '--accent',
  '--accent-hover',
  '--tab-bg',
  '--tab-active-bg',
  '--tab-hover-bg',
  '--tab-text',
  '--tab-active-text',
  '--palette-bg',
  '--palette-border',
  '--palette-select',
  '--palette-text',
  '--cursor',
]

function minimalTheme(): ThemeDefinition {
  return {
    name: 'minimal',
    label: 'Minimal',
    colors: {
      '--bg': '#202020',
      '--fg': '#e0e0e0',
      ...ansiColors,
      '--cursor': '#abcdef',
    },
  }
}

describe('getThemeByNameStrict', () => {
  it('returns a matching theme without falling back', () => {
    expect(getThemeByNameStrict('dark')?.name).toBe('dark')
    expect(getThemeByNameStrict('nonexistent')).toBeNull()
  })
})

describe('fillDefaults', () => {
  it('fills the complete derived variable set from a minimal theme', () => {
    const filled = fillDefaults(minimalTheme())

    for (const variable of derivedVariables) {
      expect(filled.colors[variable], variable).toBeDefined()
    }
  })

  it('is deterministic', () => {
    const minimal = minimalTheme()
    expect(fillDefaults(minimal).colors).toEqual(fillDefaults(minimal).colors)
  })

  it('preserves explicit built-in values', () => {
    for (const rawTheme of themes) {
      const filledTheme = getThemeByName(rawTheme.name)
      for (const [variable, value] of Object.entries(rawTheme.colors)) {
        expect(filledTheme.colors[variable], `${rawTheme.name} ${variable}`).toBe(value)
      }
    }

    const rawDark = themes.find((theme) => theme.name === 'dark')!
    const filledDark = getThemeByName('dark')

    expect(filledDark.colors['--bg']).toBe(rawDark.colors['--bg'])
    expect(filledDark.colors['--tab-bg']).toBe(rawDark.colors['--tab-bg'])
    expect(filledDark.colors['--color-red']).toBe(rawDark.colors['--color-red'])
  })
})

describe('getXtermTheme', () => {
  it('uses the explicit cursor color', () => {
    expect(getXtermTheme(minimalTheme()).cursor).toBe('#abcdef')
  })

  it('falls back to the muted foreground color', () => {
    const theme = minimalTheme()
    delete theme.colors['--cursor']
    theme.colors['--fg-muted'] = '#123456'

    expect(getXtermTheme(theme).cursor).toBe('#123456')
  })
})
