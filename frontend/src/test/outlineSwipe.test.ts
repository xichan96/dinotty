import { describe, expect, it } from 'vitest'
import {
  SWIPE_CLOSE_DISTANCE,
  SWIPE_CLOSE_VELOCITY,
  shouldCloseOnSwipe,
} from '../utils/outlineSwipe'

describe('shouldCloseOnSwipe', () => {
  it('closes after a long downward drag', () => {
    expect(shouldCloseOnSwipe(SWIPE_CLOSE_DISTANCE + 1, 0.1)).toBe(true)
  })

  it('closes on a short fast flick', () => {
    expect(shouldCloseOnSwipe(40, SWIPE_CLOSE_VELOCITY + 0.1)).toBe(true)
  })

  it('keeps the sheet for a short slow drag', () => {
    expect(shouldCloseOnSwipe(40, 0.1)).toBe(false)
  })

  it('never closes on upward motion', () => {
    expect(shouldCloseOnSwipe(-200, 5)).toBe(false)
    expect(shouldCloseOnSwipe(0, 5)).toBe(false)
  })

  it('rejects non-finite input', () => {
    expect(shouldCloseOnSwipe(Number.NaN, 1)).toBe(false)
    expect(shouldCloseOnSwipe(200, Number.NaN)).toBe(false)
  })

  it('accepts a custom distance threshold', () => {
    expect(shouldCloseOnSwipe(60, 0.1, 50)).toBe(true)
    expect(shouldCloseOnSwipe(60, 0.1, 100)).toBe(false)
  })
})
