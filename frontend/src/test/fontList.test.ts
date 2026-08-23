import { describe, expect, it } from 'vitest'
import { ANCHOR_FAMILIES } from '../utils/fontFamily'
import {
  MAX_CUSTOM_FONTS,
  buildFontList,
  normalizeCustomFonts,
  validateFontName,
} from '../utils/fontList'

describe('buildFontList', () => {
  it('starts with System Default, includes anchors, and appends removable custom fonts', () => {
    const items = buildFontList('', ['Fira Code', 'Iosevka'])

    expect(items[0]).toMatchObject({
      family: '',
      kind: 'default',
      removable: false,
      selected: true,
    })
    expect(items.slice(1, 6).map((item) => item.family)).toEqual([...ANCHOR_FAMILIES])
    expect(items.slice(1, 6).every((item) => !item.removable)).toBe(true)
    expect(items.slice(6)).toMatchObject([
      { family: 'Fira Code', kind: 'removable', removable: true },
      { family: 'Iosevka', kind: 'removable', removable: true },
    ])
  })

  it('selects an anchor by identity without creating an orphan', () => {
    const items = buildFontList('"Courier New", monospace', [])

    expect(items.find((item) => item.family === 'Courier New')).toMatchObject({
      kind: 'anchor',
      selected: true,
    })
    expect(items.some((item) => item.kind === 'orphan')).toBe(false)
  })

  it('puts a selected orphan immediately after System Default', () => {
    const items = buildFontList('SomethingGone, monospace', [])

    expect(items[1]).toMatchObject({ family: 'SomethingGone', kind: 'orphan', selected: true })
  })

  it('selects System Default for an empty font family', () => {
    expect(buildFontList('', [])[0].selected).toBe(true)
  })
})

describe('normalizeCustomFonts', () => {
  it('trims and drops blank, oversized, invalid, duplicate, and anchor names', () => {
    expect(
      normalizeCustomFonts([
        '  Fine  ',
        '',
        '   ',
        'x'.repeat(101),
        'Ev"il',
        'Bad\\Name',
        'Control\nName',
        'Foo',
        'foo',
        'Menlo',
        'monospace',
      ])
    ).toEqual(['Fine', 'Foo'])
  })

  it('keeps first-in insertion order', () => {
    expect(normalizeCustomFonts(['Zulu', 'Alpha', 'Beta', 'alpha'])).toEqual([
      'Zulu',
      'Alpha',
      'Beta',
    ])
  })

  it('normalizes stack forms to their primary-family identity', () => {
    expect(normalizeCustomFonts(['Menlo, monospace'])).toEqual([])
    expect(normalizeCustomFonts(['Foo, Bar'])).toEqual(['Foo'])
    expect(normalizeCustomFonts(['"Fira Code", monospace'])).toEqual(['Fira Code'])
  })

  it('counts Unicode scalar values when enforcing the length limit', () => {
    const emoji = String.fromCodePoint(0x1f600)

    expect(normalizeCustomFonts([emoji.repeat(50)])).toEqual([emoji.repeat(50)])
    expect(normalizeCustomFonts([emoji.repeat(51)])).toEqual([emoji.repeat(51)])
    expect(normalizeCustomFonts(['a'.repeat(101)])).toEqual([])
  })

  it('rejects C1 control characters', () => {
    expect(normalizeCustomFonts([`AB${String.fromCharCode(0x80)}`])).toEqual([])
  })

  it('caps the result at 20 items', () => {
    const result = normalizeCustomFonts(Array.from({ length: 25 }, (_, i) => `Font ${i}`))
    expect(result).toHaveLength(MAX_CUSTOM_FONTS)
    expect(result[result.length - 1]).toBe('Font 19')
  })

  it('drops CSS injection vectors', () => {
    expect(
      normalizeCustomFonts(['Good', 'Evil<script>', 'Evil;drop', 'Evil{bad}', 'Evil>arrow'])
    ).toEqual(['Good'])
  })
})

describe('validateFontName', () => {
  it.each([
    ['', [], 'blank'],
    ['x'.repeat(101), [], 'tooLong'],
    ['Ev"il', [], 'invalidChars'],
    ['Menlo', [], 'duplicate'],
    ['Menlo, monospace', [], 'duplicate'],
    ['Foo, Bar', [], ''],
    [`AB${String.fromCharCode(0x80)}`, [], 'invalidChars'],
    ['Evil<script>', [], 'invalidChars'],
    ['Evil;drop', [], 'invalidChars'],
    ['Evil{bad}', [], 'invalidChars'],
    ['foo', ['Foo'], 'duplicate'],
    ['New Font', Array.from({ length: 20 }, (_, i) => `Font ${i}`), 'limit'],
    ['New Font', ['Existing Font'], ''],
  ])('validates %j as %j', (name, customFonts, expected) => {
    expect(validateFontName(name as string, customFonts as string[])).toBe(expected)
  })
})
