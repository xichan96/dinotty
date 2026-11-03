import { describe, expect, it } from 'vitest'
import { overlapRatio, titleBarRect } from '../utils/windowDock'

describe('titleBarRect', () => {
  const rect = { x: 100, y: 200, width: 600, height: 400 }

  it('keeps the top strip of the window', () => {
    expect(titleBarRect(rect, 28)).toEqual({ x: 100, y: 200, width: 600, height: 28 })
  })

  it('never escapes the window', () => {
    expect(titleBarRect(rect, 900).height).toBe(400)
    expect(titleBarRect(rect, -4).height).toBe(0)
  })
})

describe('overlapRatio', () => {
  const main = { x: 100, y: 100, width: 800, height: 600 }

  it('is zero for disjoint windows', () => {
    expect(overlapRatio({ x: 0, y: 0, width: 100, height: 100 }, main)).toBe(0)
  })

  it('is zero when edges only touch', () => {
    expect(overlapRatio({ x: 0, y: 100, width: 100, height: 100 }, main)).toBe(0)
  })

  it('is one when the dragged window is fully inside the main window', () => {
    expect(overlapRatio({ x: 200, y: 200, width: 300, height: 200 }, main)).toBe(1)
  })

  it('measures the share of the dragged window, not of the target', () => {
    // Half of the dragged window (100px of its 200px width) is over main.
    expect(overlapRatio({ x: 0, y: 150, width: 200, height: 100 }, main)).toBe(0.5)
  })

  it('ignores empty rectangles', () => {
    expect(overlapRatio({ x: 200, y: 200, width: 0, height: 100 }, main)).toBe(0)
  })
})
