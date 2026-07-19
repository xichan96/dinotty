import { describe, expect, it } from 'vitest'
import {
  WORKSPACE_COLORS,
  autoMonogram,
  capMonogram,
  contrastRatio,
  fnv1a32,
  isValidHex,
  outlineColor,
  paletteColorFor,
  resolveAbbr,
  resolveColor,
} from '../utils/workspaceIcon'

describe('workspace icon helpers', () => {
  it('computes FNV-1a 32-bit hashes', () => {
    expect(fnv1a32('a')).toBe(0xe40c292c)
    expect(fnv1a32('')).toBe(0x811c9dc5)
    expect(fnv1a32('hello')).toBe(0x4f9f2cab)
  })

  it.each([
    ['a', 5],
    ['workspace', 3],
    ['dinotty', 3],
    ['00000000-0000-4000-8000-000000000000', 2],
    ['11111111-2222-4333-8444-555555555555', 4],
    ['ws-abc', 2],
    ['hello', 2],
    ['', 2],
    ['z', 0],
  ])('maps %s to palette index %i', (id, index) => {
    expect(fnv1a32(id) % 7).toBe(index)
  })

  it('selects a palette color from an id', () => {
    expect(paletteColorFor('dinotty')).toBe('#98C379')
  })

  it.each([
    ['workspace', 'WOR'],
    ['工作区项目', '工作'],
    ['ＡＢＣ', 'ＡＢ'],
    ['ß', 'SS'],
    ['   ', '?'],
    ['\u200B\u200B', '?'],
    ['a', 'A'],
  ])('derives a monogram from %j', (name, expected) => {
    expect(autoMonogram(name)).toBe(expected)
  })

  it.each([
    ['ﬁnance', 'FIN'],
    ['straße', 'STR'],
    ['工作区', '工作'],
    ['abcd', 'ABC'],
    ['  ', ''],
  ])('caps %j to a width-aware monogram', (value, expected) => {
    expect(capMonogram(value)).toBe(expected)
  })

  it('keeps the CJK auto-monogram cap at two grapheme clusters', () => {
    expect(autoMonogram('工作区')).toBe('工作')
  })

  it('resolves meaningful abbreviations and falls back for empty ones', () => {
    expect(resolveAbbr({ abbr: '\u200B\u200B', name: 'hello' })).toBe('HEL')
    expect(resolveAbbr({ abbr: 'XY', name: 'hello' })).toBe('XY')
    expect(resolveAbbr({ abbr: 'abcd', name: 'x' })).toBe('ABC')
    expect(resolveAbbr({ abbr: '工作区', name: 'x' })).toBe('工作')
    expect(resolveAbbr({ abbr: 'ab', name: 'ignored' })).toBe('AB')
    expect(resolveAbbr({ abbr: '', name: 'Dinotty' })).toBe('DIN')
  })

  it('resolves valid colors and deterministic fallbacks', () => {
    expect(resolveColor({ color: '#123456', id: 'x' })).toBe('#123456')
    expect(resolveColor({ color: undefined, id: 'dinotty' })).toBe('#98C379')
    expect(resolveColor({ color: 'bad', id: 'a' })).toBe(WORKSPACE_COLORS[5])
  })

  it.each([
    ['#FF5D5D', true],
    ['#ff5d5d', true],
    ['#FF5D5D80', false],
    ['FF5D5D', false],
    [undefined, false],
  ])('validates %s as %s', (color, expected) => {
    expect(isValidHex(color)).toBe(expected)
  })

  it('keeps an outline that already contrasts against a dark background', () => {
    expect(outlineColor('#FF5D5D', '#121212')).toBe('#FF5D5D')
  })

  it('darkens a yellow outline until it contrasts against a light background', () => {
    const result = outlineColor('#FFD23F', '#FFFFFF')
    expect(result).toBe('#997E26')
    expect(contrastRatio(result, '#FFFFFF')).toBeGreaterThanOrEqual(3)
  })

  it('chooses a contrasting outline direction for a mid-tone background', () => {
    const result = outlineColor('#999999', '#999999')
    expect(result).toBe('#3D3D3D')
    expect(contrastRatio(result, '#999999')).toBeGreaterThanOrEqual(3)
  })
})
