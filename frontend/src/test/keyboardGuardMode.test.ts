import { describe, expect, it } from 'vitest'
import {
  hasCollapseGuard,
  hasOpenGuard,
  type KeyboardGuardMode,
} from '../utils/keyboardGuardMode'

describe('keyboard guard mode predicates', () => {
  it.each<[KeyboardGuardMode, boolean, boolean]>([
    ['off', false, false],
    ['collapse_only', true, false],
    ['open_only', false, true],
    ['both', true, true],
  ])('%s maps to collapse=%s and open=%s', (mode, collapse, open) => {
    expect(hasCollapseGuard(mode)).toBe(collapse)
    expect(hasOpenGuard(mode)).toBe(open)
  })

  it('keeps every changed expression equivalent to upstream in off mode', () => {
    const booleans = [false, true]
    const pairs = booleans.flatMap((first) => booleans.map((second) => [first, second] as const))

    // onTerminalTouch: scrollGestureDetected branch.
    expect(booleans.map((visible) => visible && !hasCollapseGuard('off'))).toEqual(booleans)
    // onTerminalTouch: term.touchMoved branch.
    expect(booleans.map((visible) => visible && !hasCollapseGuard('off'))).toEqual(booleans)
    // onTerminalTouch: plain-tap open was unconditional.
    expect(!hasOpenGuard('off')).toBe(true)
    // onTerminalScroll: the upstream default never returned early.
    expect(hasCollapseGuard('off')).toBe(false)
    // MobileKeyboard: path-selection collapse watcher.
    expect(
      pairs.map(([pathSelected, visible]) =>
        Boolean(pathSelected && visible && !hasCollapseGuard('off'))
      )
    ).toEqual(pairs.map(([pathSelected, visible]) => Boolean(pathSelected && visible)))
    // KbToggleButton: v-show for both show_virtual_keyboard states.
    expect(
      pairs.map(([showVirtualKeyboard, visible]) =>
        Boolean((showVirtualKeyboard || hasOpenGuard('off')) && !visible)
      )
    ).toEqual(
      pairs.map(([showVirtualKeyboard, visible]) => Boolean(showVirtualKeyboard && !visible))
    )
  })
})
