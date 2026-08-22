import { describe, expect, it } from 'vitest'
import { migrateTab } from '../types/pane'
import {
  initializePaneMru,
  reconcilePaneMru,
  removePaneFromMru,
  touchPaneMru,
} from '../types/paneMru'

describe('pane MRU', () => {
  it('initializes active first and preserves layout order for the rest', () => {
    expect(initializePaneMru(['a', 'b', 'c'], 'b')).toEqual(['b', 'a', 'c'])
  })

  it('moves an existing pane to the head without duplication', () => {
    expect(touchPaneMru(['a', 'c', 'b'], 'b')).toEqual(['b', 'a', 'c'])
  })

  it('prepends a newly created pane', () => {
    expect(touchPaneMru(['a'], 'b')).toEqual(['b', 'a'])
  })

  it('returns the new head when the focused pane is removed', () => {
    expect(removePaneFromMru(['b', 'a', 'c'], 'b')).toEqual({
      paneMru: ['a', 'c'],
      nextPaneId: 'a',
    })
  })

  it('preserves the head when a non-focused pane is removed', () => {
    expect(removePaneFromMru(['b', 'a', 'c'], 'c')).toEqual({
      paneMru: ['b', 'a'],
      nextPaneId: 'b',
    })
  })

  it('reconciles duplicates, stale IDs, and missing layout IDs', () => {
    expect(reconcilePaneMru(['b', 'b', 'gone'], ['a', 'b', 'c'], 'b')).toEqual(['b', 'a', 'c'])
  })

  it('rebuilds an empty queue with the active pane first', () => {
    expect(reconcilePaneMru([], ['a', 'b', 'c'], 'c')).toEqual(['c', 'a', 'b'])
  })

  it('reinitializes MRU instead of restoring serialized MRU state', () => {
    const tab = migrateTab({
      type: 'terminal',
      paneId: 'tab-1',
      layout: {
        type: 'split',
        id: 's1',
        direction: 'horizontal',
        ratios: [0.5, 0.5],
        children: [
          { type: 'leaf', paneId: 'a', title: 'A', ratio: 1, zoomed: false },
          { type: 'leaf', paneId: 'b', title: 'B', ratio: 1, zoomed: false },
        ],
      },
      activePaneId: 'b',
      paneMru: ['a', 'b'],
    })

    expect(tab.paneMru).toEqual(['b', 'a'])
  })
})
