import { describe, expect, it } from 'vitest'

import {
  MAX_ZOOM,
  MIN_ZOOM,
  clampPan,
  clampScale,
  distance,
  fitScale,
  isValidSize,
  midpoint,
  nextZoom,
  normalizeWheelDelta,
  panBy,
  pinchTransform,
  zoomAt,
  type ImageViewState,
} from '../utils/imageZoom'

const origin: ImageViewState = { scale: 1, tx: 0, ty: 0 }
const bigNatural = { width: 2000, height: 1000 }
const viewport = { width: 1000, height: 800 }

describe('fitScale', () => {
  it('fits the limiting axis without upscaling past 1:1', () => {
    expect(fitScale({ width: 2000, height: 1000 }, viewport)).toBeCloseTo(0.5)
    expect(fitScale({ width: 1000, height: 1600 }, viewport)).toBeCloseTo(0.5)
  })

  it('keeps small images at their natural size by default', () => {
    expect(fitScale({ width: 32, height: 32 }, viewport)).toBe(1)
  })

  it('can upscale when explicitly allowed', () => {
    expect(fitScale({ width: 100, height: 100 }, viewport, 0, true)).toBeCloseTo(8)
  })

  it('subtracts padding from every side', () => {
    expect(fitScale({ width: 2000, height: 1000 }, viewport, 50)).toBeCloseTo(0.45)
  })

  it('falls back to 1 for invalid sizes', () => {
    expect(fitScale({ width: 0, height: 100 }, viewport)).toBe(1)
    expect(fitScale({ width: 100, height: Number.NaN }, viewport)).toBe(1)
    expect(fitScale({ width: -10, height: 10 }, viewport)).toBe(1)
    expect(fitScale(bigNatural, { width: 0, height: 0 })).toBe(1)
  })

  it('returns the minimum zoom when padding consumes the viewport', () => {
    expect(fitScale(bigNatural, { width: 80, height: 80 }, 40)).toBe(MIN_ZOOM)
  })
})

describe('clampScale', () => {
  it('keeps scales inside the supported range', () => {
    expect(clampScale(0)).toBe(MIN_ZOOM)
    expect(clampScale(100)).toBe(MAX_ZOOM)
    expect(clampScale(2)).toBe(2)
    expect(clampScale(Number.NaN)).toBe(MIN_ZOOM)
  })

  it('honours custom bounds', () => {
    expect(clampScale(0.5, 0.75, 3)).toBe(0.75)
    expect(clampScale(5, 0.75, 3)).toBe(3)
  })
})

describe('clampPan', () => {
  it('centres an image smaller than the viewport', () => {
    expect(clampPan({ scale: 1, tx: 300, ty: 300 }, { width: 100, height: 50 }, viewport)).toEqual({
      scale: 1,
      tx: 0,
      ty: 0,
    })
  })

  it('limits each axis to half the overflow', () => {
    expect(clampPan({ scale: 1, tx: 9999, ty: -9999 }, bigNatural, viewport)).toEqual({
      scale: 1,
      tx: 500,
      ty: -100,
    })
    expect(clampPan({ scale: 1, tx: -9999, ty: 9999 }, bigNatural, viewport)).toEqual({
      scale: 1,
      tx: -500,
      ty: 100,
    })
  })

  it('leaves invalid geometry untouched', () => {
    const state = { scale: 2, tx: 10, ty: 20 }
    expect(clampPan(state, { width: 0, height: 0 }, viewport)).toEqual(state)
  })
})

describe('zoomAt', () => {
  it('keeps the image point under the focal point fixed', () => {
    const natural = { width: 4000, height: 4000 }
    const focus = { x: 120, y: -80 }
    const next = zoomAt(origin, focus, 2.5, natural, viewport)

    expect(next.scale).toBe(2.5)
    expect((focus.x - next.tx) / next.scale).toBeCloseTo((focus.x - origin.tx) / origin.scale)
    expect((focus.y - next.ty) / next.scale).toBeCloseTo((focus.y - origin.ty) / origin.scale)
  })

  it('clamps the result to the pan limits', () => {
    const next = zoomAt({ scale: 2, tx: 0, ty: 0 }, { x: 0, y: 0 }, 0.5, bigNatural, viewport)
    expect(next.scale).toBe(0.5)
    expect(next.tx).toBe(0)
    expect(next.ty).toBe(0)
  })

  it('clamps the requested scale', () => {
    expect(zoomAt(origin, { x: 0, y: 0 }, 99, bigNatural, viewport).scale).toBe(MAX_ZOOM)
    expect(zoomAt(origin, { x: 0, y: 0 }, 0, bigNatural, viewport).scale).toBe(MIN_ZOOM)
  })
})

describe('panBy', () => {
  it('converges on the edge limits', () => {
    expect(panBy(origin, 9999, 9999, bigNatural, viewport)).toEqual({
      scale: 1,
      tx: 500,
      ty: 100,
    })
    expect(panBy({ scale: 1, tx: 500, ty: 100 }, -9999, -9999, bigNatural, viewport)).toEqual({
      scale: 1,
      tx: -500,
      ty: -100,
    })
  })
})

describe('pinchTransform', () => {
  it('scales by the distance ratio', () => {
    const natural = { width: 4000, height: 4000 }
    const next = pinchTransform(origin, { x: 0, y: 0 }, 100, { x: 0, y: 0 }, 200, natural, viewport)
    expect(next.scale).toBe(2)
    expect(next.tx).toBe(0)
    expect(next.ty).toBe(0)
  })

  it('moves the image point under the start midpoint to the current midpoint', () => {
    const natural = { width: 4000, height: 4000 }
    const startMid = { x: 100, y: 0 }
    const next = pinchTransform(origin, startMid, 100, startMid, 200, natural, viewport)

    expect(next.scale).toBe(2)
    expect((startMid.x - next.tx) / next.scale).toBeCloseTo(100)
  })

  it('translates with the midpoint when the distance is unchanged', () => {
    const next = pinchTransform(
      origin,
      { x: 0, y: 0 },
      100,
      { x: 30, y: -20 },
      100,
      bigNatural,
      viewport
    )
    expect(next.scale).toBe(1)
    expect(next).toMatchObject({ tx: 30, ty: -20 })
  })

  it('ignores a non-positive start distance', () => {
    const next = pinchTransform(
      origin,
      { x: 0, y: 0 },
      0,
      { x: 10, y: 10 },
      50,
      bigNatural,
      viewport
    )
    expect(next.scale).toBe(1)
    expect(next).toMatchObject({ tx: 10, ty: 10 })
  })
})

describe('nextZoom', () => {
  it('steps in and out by ZOOM_STEP', () => {
    expect(nextZoom(1, 1)).toBeCloseTo(1.25)
    expect(nextZoom(1, -1)).toBeCloseTo(0.8)
  })

  it('stays within the zoom range', () => {
    expect(nextZoom(15, 1)).toBe(MAX_ZOOM)
    expect(nextZoom(0.01, -1)).toBe(MIN_ZOOM)
  })
})

describe('normalizeWheelDelta', () => {
  it('passes pixel deltas through', () => {
    expect(normalizeWheelDelta(120, 0, 800)).toBe(120)
  })

  it('converts line deltas to pixels', () => {
    expect(normalizeWheelDelta(3, 1, 800)).toBe(48)
  })

  it('converts page deltas using the viewport height', () => {
    expect(normalizeWheelDelta(2, 2, 500)).toBe(1000)
    expect(normalizeWheelDelta(1, 2, 0)).toBe(800)
    expect(normalizeWheelDelta(1, 2, Number.NaN)).toBe(800)
  })

  it('treats invalid deltas as zero', () => {
    expect(normalizeWheelDelta(Number.NaN, 0, 800)).toBe(0)
    expect(normalizeWheelDelta(0, 1, 800)).toBe(0)
  })
})

describe('geometry helpers', () => {
  it('measures distance and midpoint', () => {
    expect(distance({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5)
    expect(midpoint({ x: 0, y: 0 }, { x: 10, y: -4 })).toEqual({ x: 5, y: -2 })
  })

  it('validates sizes', () => {
    expect(isValidSize({ width: 10, height: 10 })).toBe(true)
    expect(isValidSize({ width: 0, height: 10 })).toBe(false)
    expect(isValidSize(null)).toBe(false)
  })
})
