import { describe, expect, it, vi } from 'vitest'
import {
  observeSwipePanelHeightTargets,
  resolveSwipePanelHeight,
} from '../composables/useSwipePanel'

describe('swipe panel height', () => {
  it('uses the active panel height instead of reserving the taller panel', () => {
    expect(resolveSwipePanelHeight('default', 420, 180)).toBe(422)
    expect(resolveSwipePanelHeight('action', 420, 180)).toBe(182)
  })

  it('observes both intrinsic panels so active content changes update the height', () => {
    const main = document.createElement('div')
    main.id = 'mkb-main-panel'
    const action = document.createElement('div')
    action.id = 'mkb-action-panel'
    const bar = document.createElement('div')
    bar.append(main, action)
    const observe = vi.fn()

    observeSwipePanelHeightTargets({ observe } as unknown as ResizeObserver, bar)

    expect(observe.mock.calls.map(([target]) => target)).toEqual([bar, main, action])
  })
})
