import { describe, expect, it } from 'vitest'
import { adjacentTabPaneId } from '../utils/tabNavigation'

const tabs = [{ paneId: 'a' }, { paneId: 'b' }, { paneId: 'c' }]

describe('adjacentTabPaneId', () => {
  it('moves one tab to the right and wraps at the end', () => {
    expect(adjacentTabPaneId(tabs, 'a', 1)).toBe('b')
    expect(adjacentTabPaneId(tabs, 'b', 1)).toBe('c')
    expect(adjacentTabPaneId(tabs, 'c', 1)).toBe('a')
  })

  it('moves one tab to the left and wraps at the start', () => {
    expect(adjacentTabPaneId(tabs, 'c', -1)).toBe('b')
    expect(adjacentTabPaneId(tabs, 'b', -1)).toBe('a')
    expect(adjacentTabPaneId(tabs, 'a', -1)).toBe('c')
  })

  it('starts at the first tab when no tab is active', () => {
    expect(adjacentTabPaneId(tabs, null, 1)).toBe('a')
    expect(adjacentTabPaneId(tabs, undefined, 1)).toBe('a')
  })

  it('starts at the last tab when stepping back with no active tab', () => {
    expect(adjacentTabPaneId(tabs, 'not-in-list', -1)).toBe('c')
  })

  it('does nothing when there is no tab to move to', () => {
    expect(adjacentTabPaneId([], 'a', 1)).toBeNull()
    expect(adjacentTabPaneId([{ paneId: 'only' }], 'only', 1)).toBeNull()
  })
})
