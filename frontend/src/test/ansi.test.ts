import { describe, expect, it } from 'vitest'
import {
  ANSI_DEFAULT_BG,
  ANSI_DEFAULT_FG,
  ansiStyleToCss,
  colorFrom256,
  parseAnsi,
  parseAnsiLines,
} from '../utils/ansi'

const ESC = '\u001b'
const BEL = '\u0007'

function texts(input: string): string[] {
  return parseAnsi(input).map((segment) => segment.text)
}

describe('parseAnsi', () => {
  it('returns plain text untouched', () => {
    const segments = parseAnsi('hello  world')
    expect(segments).toEqual([{ text: 'hello  world', style: {} }])
  })

  it('parses basic foreground and background colours', () => {
    const segments = parseAnsi(`${ESC}[31mred${ESC}[44mblue-bg${ESC}[0m plain`)
    expect(segments.map((segment) => segment.text)).toEqual(['red', 'blue-bg', ' plain'])
    expect(segments[0].style.color).toBe('#cd3131')
    expect(segments[1].style).toMatchObject({ color: '#cd3131', backgroundColor: '#2472c8' })
    expect(segments[2].style).toEqual({})
  })

  it('parses bright colours and default resets', () => {
    const segments = parseAnsi(`${ESC}[91;107mx${ESC}[39;49my`)
    expect(segments[0].style).toMatchObject({ color: '#f14c4c', backgroundColor: '#e5e5e5' })
    expect(segments[1].style).toEqual({})
  })

  it('tracks bold, dim, italic, underline and their resets', () => {
    const segments = parseAnsi(
      `${ESC}[1mA${ESC}[2mB${ESC}[3mC${ESC}[4mD${ESC}[22mE${ESC}[23mF${ESC}[24mG`
    )
    expect(segments.map((segment) => segment.text)).toEqual(['A', 'B', 'C', 'D', 'E', 'F', 'G'])
    expect(segments[0].style).toEqual({ bold: true })
    expect(segments[1].style).toEqual({ bold: true, dim: true })
    expect(segments[2].style).toEqual({ bold: true, dim: true, italic: true })
    expect(segments[3].style).toEqual({
      bold: true,
      dim: true,
      italic: true,
      underline: true,
    })
    expect(segments[4].style).toEqual({ italic: true, underline: true })
    expect(segments[5].style).toEqual({ underline: true })
    expect(segments[6].style).toEqual({})
  })

  it('parses inverse and resets it', () => {
    const segments = parseAnsi(`${ESC}[7minv${ESC}[27mnormal`)
    expect(segments[0].style.inverse).toBe(true)
    expect(segments[1].style).toEqual({})
  })

  it('parses 256-colour foreground and background', () => {
    const segments = parseAnsi(`${ESC}[38;5;196mred${ESC}[48;5;232mblack-bg`)
    expect(segments[0].style.color).toBe('#ff0000')
    expect(segments[1].style).toMatchObject({ color: '#ff0000', backgroundColor: '#080808' })
  })

  it('parses truecolour foreground and background', () => {
    const segments = parseAnsi(`${ESC}[38;2;12;34;56mfg${ESC}[48;2;200;100;50mbg`)
    expect(segments[0].style.color).toBe('#0c2238')
    expect(segments[1].style).toMatchObject({ color: '#0c2238', backgroundColor: '#c86432' })
  })

  it('strips non-SGR CSI and OSC sequences', () => {
    const input = [
      `${ESC}[2K`,
      'kept',
      `${ESC}]0;window title${BEL}`,
      `${ESC}[?25l`,
      ' text',
      `${ESC}]8;;https://example.com${ESC}\\`,
      `${ESC}[1A`,
    ].join('')
    expect(texts(input)).toEqual(['kept text'])
  })

  it('strips an unterminated escape suffix instead of rendering it', () => {
    expect(texts(`before${ESC}[31`)).toEqual(['before'])
  })

  it('treats an empty SGR parameter as reset', () => {
    const segments = parseAnsi(`${ESC}[31mred${ESC}[mplain`)
    expect(segments[1]).toEqual({ text: 'plain', style: {} })
  })

  it('ignores unknown SGR codes', () => {
    const segments = parseAnsi(`${ESC}[31;999;44mx`)
    expect(segments[0].style).toEqual({ color: '#cd3131', backgroundColor: '#2472c8' })
  })

  it('carries style state across newlines', () => {
    const lines = parseAnsiLines(`${ESC}[31mred\nstill red${ESC}[0m\nplain`)
    expect(lines).toHaveLength(3)
    expect(lines[0]).toEqual([{ text: 'red', style: { color: '#cd3131' } }])
    expect(lines[1]).toEqual([{ text: 'still red', style: { color: '#cd3131' } }])
    expect(lines[2]).toEqual([{ text: 'plain', style: {} }])
  })
})

describe('colorFrom256', () => {
  it('maps the 6x6x6 cube and greyscale ramp', () => {
    expect(colorFrom256(16)).toBe('#000000')
    expect(colorFrom256(196)).toBe('#ff0000')
    expect(colorFrom256(231)).toBe('#ffffff')
    expect(colorFrom256(232)).toBe('#080808')
    expect(colorFrom256(255)).toBe('#eeeeee')
    expect(colorFrom256(-1)).toBe('#000000')
    expect(colorFrom256(999)).toBe('#eeeeee')
  })
})

describe('ansiStyleToCss', () => {
  it('maps attributes to CSS properties', () => {
    expect(
      ansiStyleToCss({ color: '#123456', backgroundColor: '#abcdef', bold: true, italic: true })
    ).toEqual({
      color: '#123456',
      backgroundColor: '#abcdef',
      fontWeight: '700',
      fontStyle: 'italic',
    })
    expect(ansiStyleToCss({ underline: true, dim: true })).toEqual({
      textDecoration: 'underline',
      opacity: '0.65',
    })
  })

  it('swaps foreground and background for inverse video', () => {
    expect(ansiStyleToCss({ color: '#ff0000', backgroundColor: '#000000', inverse: true })).toEqual(
      { color: '#000000', backgroundColor: '#ff0000' }
    )
    expect(ansiStyleToCss({ inverse: true })).toEqual({
      color: ANSI_DEFAULT_BG,
      backgroundColor: ANSI_DEFAULT_FG,
    })
  })
})
