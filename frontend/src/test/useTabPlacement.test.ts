import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  SIDEBAR_WIDTH_DEFAULT,
  SIDEBAR_WIDTH_MAX,
  SIDEBAR_WIDTH_MIN,
  clampSidebarWidth,
  getEffectivePlacement,
  hasPlacementOverride,
  isVerticalPlacement,
  reloadPlacement,
  resetPlacement,
  setMode,
  setSidebarWidth,
} from '../composables/useTabPlacement'

const KEY = 'dinotty_device_tab_placement_v1'

class MemoryStorage implements Storage {
  private data = new Map<string, string>()
  get length() {
    return this.data.size
  }
  clear() {
    this.data.clear()
  }
  getItem(key: string) {
    return this.data.get(key) ?? null
  }
  key(index: number) {
    return [...this.data.keys()][index] ?? null
  }
  removeItem(key: string) {
    this.data.delete(key)
  }
  setItem(key: string, value: string) {
    this.data.set(key, String(value))
  }
}

let storage: MemoryStorage

function installStorage(impl: Storage) {
  Object.defineProperty(window, 'localStorage', { value: impl, configurable: true })
  vi.stubGlobal('localStorage', impl)
}

beforeEach(() => {
  storage = new MemoryStorage()
  installStorage(storage)
  // A wide viewport keeps the viewport-relative cap out of the way unless a
  // test opts into a narrow one.
  Object.defineProperty(window, 'innerWidth', { value: 1600, configurable: true })
  reloadPlacement()
})

describe('useTabPlacement defaults', () => {
  it('defaults to the top horizontal bar with no stored value', () => {
    expect(getEffectivePlacement()).toEqual({
      mode: 'top',
      sidebarWidth: SIDEBAR_WIDTH_DEFAULT,
    })
  })

  it('reports no override before anything is chosen', () => {
    expect(hasPlacementOverride()).toBe(false)
  })

  it('treats only left and right as vertical', () => {
    expect(isVerticalPlacement('left')).toBe(true)
    expect(isVerticalPlacement('right')).toBe(true)
    expect(isVerticalPlacement('top')).toBe(false)
    expect(isVerticalPlacement('bottom')).toBe(false)
  })
})

describe('useTabPlacement persistence', () => {
  it('round-trips a chosen mode across a reload', () => {
    setMode('left')
    reloadPlacement()
    expect(getEffectivePlacement().mode).toBe('left')
    expect(hasPlacementOverride()).toBe(true)
  })

  it('round-trips a chosen sidebar width across a reload', () => {
    setSidebarWidth(240)
    reloadPlacement()
    expect(getEffectivePlacement().sidebarWidth).toBe(240)
  })

  it('stores a versioned envelope', () => {
    setMode('right')
    expect(JSON.parse(storage.getItem(KEY)!)).toEqual({
      version: 1,
      placement: { mode: 'right', sidebarWidth: SIDEBAR_WIDTH_DEFAULT },
    })
  })

  it('drops the entry entirely once everything is back to defaults', () => {
    setMode('bottom')
    setSidebarWidth(300)
    expect(storage.getItem(KEY)).not.toBeNull()

    resetPlacement()

    expect(storage.getItem(KEY)).toBeNull()
    expect(hasPlacementOverride()).toBe(false)
    expect(getEffectivePlacement()).toEqual({
      mode: 'top',
      sidebarWidth: SIDEBAR_WIDTH_DEFAULT,
    })
  })

  it('drops the entry when the mode is set back to the default', () => {
    setMode('left')
    setMode('top')
    expect(storage.getItem(KEY)).toBeNull()
  })
})

describe('useTabPlacement validation', () => {
  it('falls back to defaults and clears unparsable JSON', () => {
    storage.setItem(KEY, '{not json')
    reloadPlacement()
    expect(getEffectivePlacement().mode).toBe('top')
    expect(storage.getItem(KEY)).toBeNull()
  })

  it('falls back to defaults and clears a wrong version', () => {
    storage.setItem(KEY, JSON.stringify({ version: 2, placement: { mode: 'left' } }))
    reloadPlacement()
    expect(getEffectivePlacement().mode).toBe('top')
    expect(storage.getItem(KEY)).toBeNull()
  })

  it('falls back to defaults when the envelope is an array', () => {
    storage.setItem(KEY, JSON.stringify([{ mode: 'left' }]))
    reloadPlacement()
    expect(getEffectivePlacement().mode).toBe('top')
    expect(storage.getItem(KEY)).toBeNull()
  })

  it('ignores an unknown mode but keeps a valid width', () => {
    storage.setItem(
      KEY,
      JSON.stringify({ version: 1, placement: { mode: 'diagonal', sidebarWidth: 200 } })
    )
    reloadPlacement()
    expect(getEffectivePlacement()).toEqual({ mode: 'top', sidebarWidth: 200 })
  })

  it('ignores a non-numeric width but keeps a valid mode', () => {
    storage.setItem(
      KEY,
      JSON.stringify({ version: 1, placement: { mode: 'right', sidebarWidth: 'wide' } })
    )
    reloadPlacement()
    expect(getEffectivePlacement()).toEqual({
      mode: 'right',
      sidebarWidth: SIDEBAR_WIDTH_DEFAULT,
    })
  })

  it('rejects a non-finite width', () => {
    setSidebarWidth(Number.NaN)
    expect(getEffectivePlacement().sidebarWidth).toBe(SIDEBAR_WIDTH_DEFAULT)
    setSidebarWidth(Number.POSITIVE_INFINITY)
    expect(getEffectivePlacement().sidebarWidth).toBe(SIDEBAR_WIDTH_DEFAULT)
  })

  it('ignores an unknown mode passed at runtime', () => {
    setMode('sideways' as never)
    expect(getEffectivePlacement().mode).toBe('top')
  })
})

describe('useTabPlacement width clamping', () => {
  it('clamps below the minimum', () => {
    setSidebarWidth(10)
    expect(getEffectivePlacement().sidebarWidth).toBe(SIDEBAR_WIDTH_MIN)
  })

  it('clamps above the maximum', () => {
    setSidebarWidth(9999)
    expect(getEffectivePlacement().sidebarWidth).toBe(SIDEBAR_WIDTH_MAX)
  })

  it('rounds fractional drag positions to whole pixels', () => {
    setSidebarWidth(210.6)
    expect(getEffectivePlacement().sidebarWidth).toBe(211)
  })

  it('caps the sidebar at half the viewport so the terminal keeps room', () => {
    Object.defineProperty(window, 'innerWidth', { value: 400, configurable: true })
    expect(clampSidebarWidth(400)).toBe(200)
  })

  it('never lets the viewport cap push the width under the minimum', () => {
    Object.defineProperty(window, 'innerWidth', { value: 200, configurable: true })
    expect(clampSidebarWidth(400)).toBe(SIDEBAR_WIDTH_MIN)
  })

  it('clamps a stored width that is too wide for this viewport on load', () => {
    storage.setItem(
      KEY,
      JSON.stringify({ version: 1, placement: { mode: 'left', sidebarWidth: 480 } })
    )
    Object.defineProperty(window, 'innerWidth', { value: 600, configurable: true })
    reloadPlacement()
    expect(getEffectivePlacement().sidebarWidth).toBe(300)
  })
})

describe('useTabPlacement storage failures', () => {
  it('keeps working in memory when writes throw', () => {
    installStorage({
      ...storage,
      getItem: () => null,
      setItem: () => {
        throw new Error('quota exceeded')
      },
      removeItem: () => {},
    } as unknown as Storage)
    reloadPlacement()

    expect(() => setMode('left')).not.toThrow()
    expect(getEffectivePlacement().mode).toBe('left')
  })

  it('falls back to defaults when reads throw', () => {
    installStorage({
      ...storage,
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {},
      removeItem: () => {},
    } as unknown as Storage)

    expect(() => reloadPlacement()).not.toThrow()
    expect(getEffectivePlacement().mode).toBe('top')
  })
})
