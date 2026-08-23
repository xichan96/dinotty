import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// Regression contract for the system-mode tap-open gate in onTerminalTouch.
// terminalImeFocused can go stale-true while kbVisible stays false (e.g. the
// focusin handler sets it on programmatic refocus after window focus, which
// never opens the iOS software keyboard). When that happens armTerminalTouchOpen
// never arms, so an un-armed tap must still be allowed to request the keyboard
// as long as the toolbar is not already up - otherwise the native tap focuses
// the textarea, the system keyboard opens, but kbVisible never turns true and
// the SystemKeyboardToolbar (v-show="kbVisible || persistent") never appears.
// v0.22.0 opened unconditionally; the #256-259 gating must only suppress
// caret-repositioning taps while the toolbar is visible.

const source = readFileSync(join(process.cwd(), 'src/composables/useAppKeyboard.ts'), 'utf8')

describe('system-mode terminal tap-open gate contract', () => {
  it('only suppresses un-armed taps while the keyboard is already visible', () => {
    expect(source).toMatch(
      /heldFor >= TERMINAL_LONG_PRESS_MS \|\| \(!openPending && kbVisible\.value\)/
    )
  })

  it('does not blanket-suppress every un-armed tap', () => {
    expect(source).not.toMatch(/\(!openPending \|\| heldFor >= TERMINAL_LONG_PRESS_MS\)/)
  })
})
