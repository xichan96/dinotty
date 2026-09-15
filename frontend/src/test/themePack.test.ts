import { describe, it, expect } from 'vitest'
import {
  buildInstallPayload,
  isValidThemeId,
  MAX_THEME_BYTES,
  themeIdFromFilename,
} from '../utils/themePack'

describe('theme ids', () => {
  it('accepts ordinary ids', () => {
    for (const id of [
      'dracula-soft',
      'catppuccin-mocha',
      'nord',
      'tokyo-night-storm',
      'ayu-dark',
    ]) {
      expect(isValidThemeId(id), id).toBe(true)
    }
  })

  // The id becomes a filename on the server, so a traversal has to be
  // unrepresentable rather than merely unlikely.
  it('rejects anything that could escape the theme directory', () => {
    for (const id of [
      '',
      'a',
      '-nord',
      'nord-',
      'nord--soft',
      '../etc/passwd',
      'a/b',
      'a\\b',
      '..',
      'nord.conf',
      'nord_soft',
      'nord soft',
      'nord.soft',
    ]) {
      expect(isValidThemeId(id), JSON.stringify(id)).toBe(false)
    }
    expect(isValidThemeId('x'.repeat(65))).toBe(false)
    expect(isValidThemeId('x'.repeat(64))).toBe(true)
  })
})

describe('themeIdFromFilename', () => {
  it('strips both readable extensions', () => {
    // `.conf` matters as much as `.json`: it is what "Export theme" writes, so
    // an exported theme that comes back must not get an id of `nord.conf`.
    expect(themeIdFromFilename('nord.json')).toBe('nord')
    expect(themeIdFromFilename('dracula-soft.conf')).toBe('dracula-soft')
    expect(themeIdFromFilename('Dracula-Soft.CONF')).toBe('Dracula-Soft')
    expect(themeIdFromFilename('nord')).toBe('nord')
  })

  it('reduces a path to its basename', () => {
    // Some platforms post a fake path from <input type="file">.
    expect(themeIdFromFilename('C:\\fakepath\\nord.json')).toBe('nord')
    expect(themeIdFromFilename('/tmp/dracula-soft.conf')).toBe('dracula-soft')
    expect(themeIdFromFilename('../../etc/passwd.json')).toBe('passwd')
  })
})

describe('buildInstallPayload', () => {
  const colors = {
    foreground: '#ffffff',
    background: '#000000',
    cursor: '#ff00ff',
    ansi: Array.from({ length: 16 }, (_, i) => `#${(i + 1).toString(16).padStart(6, '0')}`),
  }

  it('carries the id, the name and all 19 colours', () => {
    const payload = buildInstallPayload('dracula-soft', 'Dracula Soft', colors)

    expect(payload.id).toBe('dracula-soft')
    expect(payload.name).toBe('Dracula Soft')
    expect(payload.colors.foreground).toBe('#ffffff')
    expect(payload.colors.background).toBe('#000000')
    expect(payload.colors.cursor).toBe('#ff00ff')
    expect(payload.colors.ansi).toHaveLength(16)
    expect(payload.colors.ansi[1]).toBe('#000002')
  })

  // The server refuses a palette that is not 16, so an over-long one is trimmed
  // rather than sent to be rejected.
  it('sends exactly 16 palette entries even if given more', () => {
    const long = { ...colors, ansi: [...colors.ansi, '#aabbcc', '#ddeeff'] }
    expect(buildInstallPayload('nord', 'Nord', long).colors.ansi).toHaveLength(16)
  })

  it('serializes to the shape the server parses', () => {
    const wire = JSON.parse(JSON.stringify(buildInstallPayload('nord', 'Nord', colors)))
    expect(Object.keys(wire).sort()).toEqual(['colors', 'id', 'name'])
    expect(Object.keys(wire.colors).sort()).toEqual(['ansi', 'background', 'cursor', 'foreground'])
  })
})

describe('size limit', () => {
  it('matches the server bound', () => {
    expect(MAX_THEME_BYTES).toBe(64 * 1024)
  })
})
