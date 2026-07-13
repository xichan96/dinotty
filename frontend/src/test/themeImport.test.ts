import { describe, expect, it } from 'vitest'
import { normalizeColor, parseThemeFile } from '../utils/themeImport'
import { buildBlankTemplate } from '../utils/themeTemplate'

const GHOSTTY_FIXTURE = `
# Some Ghostty theme
palette = 0=#1e1e2e
palette = 1=#f38ba8
palette = 2=#a6e3a1
palette = 3=#f9e2af
palette = 4=#89b4fa
palette = 5=#f5c2e7
palette = 6=#94e2d5
palette = 7=#bac2de
palette = 8=#585b70
palette = 9=#f37799
palette = 10=#89d88b
palette = 11=#ebd391
palette = 12=#74a8fc
palette = 13=#f2aede
palette = 14=#6bd7ca
palette = 15=#a6adc8
background = 1e1e2e
foreground = cdd6f4
cursor-color = f5e0dc
`

const ANSI = Array.from({ length: 16 }, (_, index) =>
  `#${index.toString(16).padStart(6, '0')}`,
)

describe('normalizeColor', () => {
  it('expands #RGB colors', () => expect(normalizeColor('#abc')).toBe('#aabbcc'))
  it('accepts bare six-digit hex colors', () => expect(normalizeColor('1d1f21')).toBe('#1d1f21'))
})

describe('parseThemeFile', () => {
  it('imports a canonical Ghostty theme', () => {
    const result = parseThemeFile(GHOSTTY_FIXTURE)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.colors.background).toBe('#1e1e2e')
    expect(result.colors.foreground).toBe('#cdd6f4')
    expect(result.colors.cursor).toBe('#f5e0dc')
    expect(result.colors.ansi[1]).toBe('#f38ba8')
    expect(result.colors.ansi).toHaveLength(16)
    expect(Object.values(result.colors).flat()).toEqual(
      expect.arrayContaining([expect.stringMatching(/^#[0-9a-f]{6}$/)]),
    )
    expect([result.colors.foreground, result.colors.background, result.colors.cursor, ...result.colors.ansi])
      .toSatisfy((colors: string[]) => colors.every((color) => /^#[0-9a-f]{6}$/.test(color)))
  })

  it('imports and normalizes flat JSON', () => {
    const result = parseThemeFile(
      JSON.stringify({ foreground: '#FFFFFF', background: '#000000', cursor: '#ff00ff', ansi: ANSI }),
    )
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.colors.foreground).toBe('#ffffff')
  })

  it('imports nested JSON colors', () => {
    const result = parseThemeFile(
      JSON.stringify({ colors: { foreground: '#FFFFFF', background: '#000000', cursor: '#ff00ff', ansi: ANSI } }),
    )
    expect(result.ok).toBe(true)
  })

  it.each([
    ['rgb(0,0,0)', 'foreground'],
    ['red', 'background'],
  ])('rejects invalid color %s', (value, field) => {
    const theme = { foreground: '#ffffff', background: '#000000', cursor: '#ff00ff', ansi: ANSI }
    Object.assign(theme, { [field]: value })
    const result = parseThemeFile(JSON.stringify(theme))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors.some((error) => error.includes(field))).toBe(true)
  })

  it('reports a missing palette index', () => {
    const result = parseThemeFile(GHOSTTY_FIXTURE.replace('palette = 7=#bac2de\n', ''))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors).toContain('Missing palette 7')
  })

  it('rejects duplicate palette indexes', () => {
    const result = parseThemeFile(`${GHOSTTY_FIXTURE}\npalette = 3=#000000`)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors).toContain('Duplicate palette 3')
  })

  it('ignores palette indexes above 15', () => {
    expect(parseThemeFile(`${GHOSTTY_FIXTURE}\npalette = 16=#000000`).ok).toBe(true)
  })

  it('ignores unknown keys', () => {
    expect(parseThemeFile(`${GHOSTTY_FIXTURE}\nfont-family = Menlo`).ok).toBe(true)
  })

  it('produces a blank template that is not yet importable', () => {
    const template = buildBlankTemplate()
    const result = parseThemeFile(template)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors.every((error) => /^(Missing|Invalid)/.test(error))).toBe(true)
    expect(template).toContain('palette = 15=')
    expect(template).toContain('foreground')
  })

  it('does not hang on a long whitespace line without = (ReDoS guard)', () => {
    // Exact codex ReDoS vector: non-empty, whitespace-heavy, no '='. The old
    // /^([^=]+?)\s*=\s*(.*)$/ backtracked quadratically (80k chars ~3.8s); the
    // indexOf-based parser is linear, so this must complete well under the 5s
    // vitest timeout. Completion itself is the assertion.
    const huge = `x${' '.repeat(200_000)}y`
    const result = parseThemeFile(`${GHOSTTY_FIXTURE}
${huge}`)
    expect(result.ok).toBe(true)
  })

  it('rejects a malformed palette entry atomically', () => {
    for (const bad of ['palette = bad', 'palette = x=#ffffff', 'palette = -1=#ffffff']) {
      const result = parseThemeFile(`${GHOSTTY_FIXTURE}
${bad}`)
      expect(result.ok).toBe(false)
    }
  })
})
