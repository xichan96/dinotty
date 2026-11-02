import { describe, expect, it } from 'vitest'
import {
  OUTLINE_ROW_HEIGHT,
  OUTLINE_ROW_HEIGHT_MOBILE,
  OUTLINE_VIRTUALIZE_THRESHOLD,
  virtualWindow,
} from '../utils/outlineVirtual'

describe('virtualWindow', () => {
  it('renders the visible slice plus overscan on both sides', () => {
    const window = virtualWindow(1000, 2600, 520, 26, 8)

    expect(window).toEqual({
      start: 92,
      end: 128,
      topPad: 92 * 26,
      bottomPad: (1000 - 128) * 26,
    })
  })

  it('clamps at the top of the list', () => {
    expect(virtualWindow(1000, 0, 260, 26, 8)).toEqual({
      start: 0,
      end: 18,
      topPad: 0,
      bottomPad: (1000 - 18) * 26,
    })
  })

  it('clamps past the end of the list', () => {
    expect(virtualWindow(100, 99999, 260, 26, 8)).toEqual({
      start: 100,
      end: 100,
      topPad: 2600,
      bottomPad: 0,
    })
  })

  it('returns a zero window for an empty list', () => {
    expect(virtualWindow(0, 0, 0, 26)).toEqual({
      start: 0,
      end: 0,
      topPad: 0,
      bottomPad: 0,
    })
  })

  it('is safe for invalid input', () => {
    expect(virtualWindow(-5, -10, 0, 26)).toEqual({
      start: 0,
      end: 0,
      topPad: 0,
      bottomPad: 0,
    })
    expect(virtualWindow(10, Number.NaN, 0, 26)).toEqual({
      start: 0,
      end: 8,
      topPad: 0,
      bottomPad: 2 * 26,
    })
    // Unusable row height renders the whole list rather than nothing.
    expect(virtualWindow(10, 0, 0, 0)).toEqual({
      start: 0,
      end: 10,
      topPad: 0,
      bottomPad: 0,
    })
  })

  it('keeps the row-height constants in sync with the panel CSS', () => {
    expect(OUTLINE_ROW_HEIGHT).toBe(26)
    expect(OUTLINE_ROW_HEIGHT_MOBILE).toBe(32)
    expect(OUTLINE_VIRTUALIZE_THRESHOLD).toBe(2000)
  })
})
