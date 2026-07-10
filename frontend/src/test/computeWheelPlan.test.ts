import { describe, it, expect } from 'vitest'
import { computeWheelPlan, type WheelPlanInput } from '../composables/computeWheelPlan'

function input(overrides: Partial<WheelPlanInput> = {}): WheelPlanInput {
  return {
    deltaY: 3,
    deltaX: 0,
    deltaMode: 1,
    shiftKey: false,
    ctrlKey: false,
    altKey: false,
    metaKey: false,
    velocity: 0,
    isAltScreen: false,
    isMouseTracking: false,
    ...overrides,
  }
}

describe('computeWheelPlan', () => {
  it('keeps identity settings native at low and high velocity', () => {
    expect(computeWheelPlan(input({ velocity: 0 }), 1, 0)).toEqual({
      action: 'native',
      deltaMode: 1,
      deltaY: 3,
      count: 0,
    })
    expect(computeWheelPlan(input({ velocity: 100 }), 1, 0)).toEqual({
      action: 'native',
      deltaMode: 1,
      deltaY: 3,
      count: 0,
    })
  })

  it.each(['shiftKey', 'ctrlKey', 'altKey', 'metaKey'] as const)(
    'passes through modified %s wheels natively',
    (key) => {
      expect(computeWheelPlan(input({ [key]: true }), 2, 1).action).toBe('native')
    }
  )

  it('passes through horizontal wheels natively', () => {
    expect(computeWheelPlan(input({ deltaX: 3, deltaY: 3 }), 2, 1).action).toBe('native')
    expect(computeWheelPlan(input({ deltaX: 4, deltaY: 3 }), 2, 1).action).toBe('native')
  })

  it('amplifies pixel-mode wheels', () => {
    expect(
      computeWheelPlan(input({ deltaMode: 0, deltaY: 120 }), 2, 0)
    ).toEqual({
      action: 'amplify',
      deltaMode: 0,
      deltaY: 240,
      count: 1,
    })
  })

  it('preserves fractional pixel-mode amplification', () => {
    expect(computeWheelPlan(input({ deltaMode: 0, deltaY: 5 }), 1.5, 0)).toEqual({
      action: 'amplify',
      deltaMode: 0,
      deltaY: 7.5,
      count: 1,
    })
  })

  it('de-amplifies pixel-mode wheels below native sensitivity', () => {
    expect(
      computeWheelPlan(input({ deltaMode: 0, deltaY: 100, velocity: 0 }), 0.5, 0)
    ).toEqual({
      action: 'amplify',
      deltaMode: 0,
      deltaY: 50,
      count: 1,
    })
  })

  it('acceleration lifts sub-1 base', () => {
    expect(
      computeWheelPlan(input({ deltaMode: 0, deltaY: 100, velocity: 0.1 }), 0.5, 2)
    ).toEqual({
      action: 'amplify',
      deltaMode: 0,
      deltaY: 52.5,
      count: 1,
    })
  })

  it('applies level 5 acceleration with the highest coefficient', () => {
    expect(
      computeWheelPlan(input({ deltaMode: 0, deltaY: 100, velocity: 0.25 }), 1, 5)
    ).toEqual({
      action: 'amplify',
      deltaMode: 0,
      deltaY: 200,
      count: 1,
    })
  })

  it('rounds legacy float acceleration to the nearest level', () => {
    const p = computeWheelPlan(input({ deltaMode: 0, deltaY: 100, velocity: 0.25 }), 1, 0.5)

    expect(p.action).toBe('amplify')
    expect(p.deltaMode).toBe(0)
    expect(p.deltaY).toBeCloseTo(105)
    expect(p.count).toBe(1)
  })

  it('allows sensitivity at the lowered floor', () => {
    const p = computeWheelPlan(input({ deltaMode: 0, deltaY: 100, velocity: 0 }), 0.1, 0)

    expect(p.action).toBe('amplify')
    expect(p.deltaMode).toBe(0)
    expect(p.deltaY).toBeCloseTo(10)
    expect(p.count).toBe(1)
  })

  it('passes through page-mode wheels natively', () => {
    expect(computeWheelPlan(input({ deltaMode: 2, deltaY: 1 }), 3, 0).action).toBe('native')
  })

  it('passes through alt-screen wheels natively', () => {
    expect(computeWheelPlan(input({ isAltScreen: true }), 2, 1).action).toBe('native')
  })

  it('passes through mouse-tracking wheels natively', () => {
    expect(computeWheelPlan(input({ isMouseTracking: true }), 2, 1).action).toBe('native')
  })

  it('amplifies base line wheels', () => {
    expect(computeWheelPlan(input({ deltaY: 3 }), 2, 0)).toEqual({
      action: 'amplify',
      deltaMode: 1,
      deltaY: 6,
      count: 1,
    })
  })

  it('preserves amplified wheel sign', () => {
    expect(computeWheelPlan(input({ deltaY: -3 }), 2, 0)).toEqual({
      action: 'amplify',
      deltaMode: 1,
      deltaY: -6,
      count: 1,
    })
  })

  it('clamps amplification at the ceiling', () => {
    expect(computeWheelPlan(input({ deltaY: 3, velocity: 100 }), 3, 10)).toEqual({
      action: 'amplify',
      deltaMode: 1,
      deltaY: 12,
      count: 1,
    })
  })

  it('ramps monotonically with acceleration', () => {
    const slow = computeWheelPlan(input({ deltaY: 10, velocity: 0.01 }), 1.1, 0.5)
    const fast = computeWheelPlan(input({ deltaY: 10, velocity: 0.2 }), 1.1, 0.5)

    expect(slow.action).toBe('amplify')
    expect(fast.action).toBe('amplify')
    expect(slow.deltaMode).toBe(1)
    expect(fast.deltaMode).toBe(1)
    expect(fast.deltaY).toBeGreaterThanOrEqual(slow.deltaY)
  })

  it('falls back to native when the amplified line-delta rounds to zero', () => {
    const p = computeWheelPlan(input({ deltaY: 0.2, deltaMode: 1 }), 2, 0)
    expect(p.action).toBe('native')
  })

  it('keeps identity native even with non-finite velocity', () => {
    const p = computeWheelPlan(input({ velocity: Infinity }), 1, 0)
    expect(p.action).toBe('native')
    expect(Number.isNaN(p.deltaY)).toBe(false)
  })
})
