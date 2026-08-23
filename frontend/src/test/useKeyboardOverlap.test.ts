import { describe, expect, it } from 'vitest'
import { computeOverlapPx, type KeyboardOverlapGate } from '../composables/useKeyboardOverlap'

const activeGate: KeyboardOverlapGate = {
  kbVisible: true,
  textInputFocused: true,
  layoutEligible: true,
  hasVerticalPreview: false,
}

describe('computeOverlapPx', () => {
  it('returns the configured overlap when every gate branch passes', () => {
    expect(computeOverlapPx(80, activeGate)).toBe(80)
  })

  it('keeps the default setting disabled', () => {
    expect(computeOverlapPx(0, activeGate)).toBe(0)
  })

  it.each([
    ['kbVisible', false],
    ['textInputFocused', false],
    ['layoutEligible', false],
    ['hasVerticalPreview', true],
  ] as const)('returns zero when %s is %s', (field, value) => {
    expect(computeOverlapPx(80, { ...activeGate, [field]: value })).toBe(0)
  })
})
