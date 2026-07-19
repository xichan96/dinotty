import { describe, expect, it } from 'vitest'
import { computeDropdownPlacement } from '../utils/dropdownPlacement'

describe('dropdown placement', () => {
  it('uses the preferred height when there is ample space below', () => {
    expect(computeDropdownPlacement(
      { top: 100, bottom: 130 },
      { top: 0, bottom: 500 },
      260,
    )).toEqual({ dropUp: false, maxHeight: 260 })
  })

  it('drops up and clamps to the space above when it exceeds the space below', () => {
    expect(computeDropdownPlacement(
      { top: 200, bottom: 230 },
      { top: 0, bottom: 300 },
      260,
    )).toEqual({ dropUp: true, maxHeight: 188 })
  })

  it('drops down and clamps to the space below when it exceeds the space above', () => {
    expect(computeDropdownPlacement(
      { top: 50, bottom: 80 },
      { top: 0, bottom: 200 },
      260,
    )).toEqual({ dropUp: false, maxHeight: 108 })
  })

  it('drops down on a cramped equal-space tie', () => {
    expect(computeDropdownPlacement(
      { top: 30, bottom: 50 },
      { top: 0, bottom: 80 },
      260,
    )).toEqual({ dropUp: false, maxHeight: 18 })
  })

  it('clamps an equal negative-space tie to zero', () => {
    expect(computeDropdownPlacement(
      { top: 2, bottom: 18 },
      { top: 0, bottom: 20 },
      260,
    )).toEqual({ dropUp: false, maxHeight: 0 })
  })

  it('drops up and clamps unequal negative space to zero', () => {
    expect(computeDropdownPlacement(
      { top: 10, bottom: 38 },
      { top: 0, bottom: 20 },
      260,
    )).toEqual({ dropUp: true, maxHeight: 0 })
  })

  it('exact-fit below wins even with more space above', () => {
    expect(computeDropdownPlacement(
      { top: 400, bottom: 728 },
      { top: 0, bottom: 1000 },
      260,
    )).toEqual({ dropUp: false, maxHeight: 260 })
  })
})
