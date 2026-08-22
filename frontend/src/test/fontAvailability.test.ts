import { describe, expect, it, vi } from 'vitest'
import {
  clearFontCache,
  clearNegativeFontCache,
  computeAvailability,
  isFontAvailable,
} from '../utils/fontAvailability'

describe('computeAvailability', () => {
  it('treats an empty name as available without probing', () => {
    const measure = vi.fn(() => 10)
    expect(computeAvailability('', measure)).toBe(true)
    expect(measure).not.toHaveBeenCalled()
  })

  it('treats monospace as available without probing', () => {
    const measure = vi.fn(() => 10)
    expect(computeAvailability('monospace', measure)).toBe(true)
    expect(measure).not.toHaveBeenCalled()
  })

  it('treats a differing first width as available', () => {
    const measure = vi.fn((stack: string) => (stack === 'monospace' ? 10 : 11))
    expect(computeAvailability('Menlo', measure)).toBe(true)
    expect(measure).toHaveBeenCalledTimes(2)
  })

  it('treats equal widths across all probes as unavailable', () => {
    const measure = vi.fn(() => 10)
    expect(computeAvailability('Missing Font', measure)).toBe(false)
    expect(measure).toHaveBeenCalledTimes(12)
  })

  it('fails open when measure returns zero', () => {
    expect(computeAvailability('Menlo', () => 0)).toBe(true)
  })

  it('fails open when measure returns NaN', () => {
    expect(computeAvailability('Menlo', () => Number.NaN)).toBe(true)
  })

  it('fails open when measure throws', () => {
    expect(
      computeAvailability('Menlo', () => {
        throw new Error('measurement failed')
      })
    ).toBe(true)
  })
})

describe('font availability cache', () => {
  it('fails open when happy-dom has no canvas context', () => {
    expect(isFontAvailable('Menlo')).toBe(true)
  })

  it('clears caches without throwing', () => {
    expect(() => clearNegativeFontCache()).not.toThrow()
    expect(() => clearFontCache()).not.toThrow()
  })
})
