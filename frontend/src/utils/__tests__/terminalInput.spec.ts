import { describe, it, expect, vi } from 'vitest'

// terminalInput.ts pulls in the keybinding catalog at module scope, which has
// a pre-existing circular import that only surfaces under direct test import.
// The composition-timing contract under test does not depend on it.
vi.mock('../../composables/useKeybindings', () => ({
  terminalKeyBindingDefs: [],
  useKeybindings: () => ({ t: (k: string) => k }),
}))
vi.mock('../shell', () => ({ trailingPathDeleteLen: () => 0 }))

import { applyAfterTerminalComposition } from '../terminalInput'

// Contract test for host invariant §二 #4 (keyboard-plugin-design.md):
// composition timing is handled inside the host send pipeline. A payload
// submitted mid-composition must be deferred to compositionend, never
// dropped and never split.

function focusHelperTextarea(composing: boolean): HTMLTextAreaElement {
  const el = document.createElement('textarea')
  el.classList.add('xterm-helper-textarea')
  el.dataset.dinottyComposing = composing ? 'true' : 'false'
  document.body.appendChild(el)
  el.focus()
  return el
}

describe('applyAfterTerminalComposition (contract: composition timing, §二 #4)', () => {
  it('applies immediately when focus is elsewhere', () => {
    const apply = vi.fn()
    const applied = applyAfterTerminalComposition(apply)
    expect(applied).toBe(true)
    expect(apply).toHaveBeenCalledTimes(1)
  })

  it('applies immediately when the terminal textarea is not composing', () => {
    const el = focusHelperTextarea(false)
    const apply = vi.fn()
    const applied = applyAfterTerminalComposition(apply)
    expect(applied).toBe(true)
    expect(apply).toHaveBeenCalledTimes(1)
    el.remove()
  })

  it('defers apply to compositionend while composing, without dropping it', () => {
    const el = focusHelperTextarea(true)
    const apply = vi.fn()
    const applied = applyAfterTerminalComposition(apply)
    expect(applied).toBe(false)
    expect(apply).not.toHaveBeenCalled()
    el.dispatchEvent(new Event('compositionend'))
    expect(apply).toHaveBeenCalledTimes(1)
    el.remove()
  })

  it('submits mid-composition data exactly once after compositionend fires', () => {
    const el = focusHelperTextarea(true)
    const apply = vi.fn()
    applyAfterTerminalComposition(apply)
    el.dispatchEvent(new Event('compositionend'))
    el.dispatchEvent(new Event('compositionend'))
    expect(apply).toHaveBeenCalledTimes(1)
    el.remove()
  })
})
