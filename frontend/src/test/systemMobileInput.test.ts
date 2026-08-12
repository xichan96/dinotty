import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  applyAfterTerminalComposition,
  applyMobileTerminalModifiers,
  configureMobileInputTextarea,
  setKbTypingLock,
} from '../composables/useTerminal'

afterEach(() => {
  setKbTypingLock(false)
  document.body.replaceChildren()
})

describe('system mobile input', () => {
  it('configures the xterm textarea for builtin and system input modes', () => {
    const textarea = document.createElement('textarea')

    configureMobileInputTextarea(textarea, 'system')
    expect(textarea.inputMode).toBe('text')
    expect(textarea.getAttribute('virtualkeyboardpolicy')).toBe('auto')
    expect(textarea.enterKeyHint).toBe('enter')

    configureMobileInputTextarea(textarea, 'builtin')
    expect(textarea.inputMode).toBe('none')
    expect(textarea.getAttribute('virtualkeyboardpolicy')).toBe('manual')
    expect(textarea.hasAttribute('enterkeyhint')).toBe(false)
  })

  it('keeps the builtin typing lock authoritative while reconfiguring a textarea', () => {
    setKbTypingLock(true)
    const textarea = document.createElement('textarea')

    configureMobileInputTextarea(textarea, 'system')

    expect(textarea.disabled).toBe(true)
  })

  it('defers a mode application until the active xterm composition ends', () => {
    const textarea = document.createElement('textarea')
    textarea.className = 'xterm-helper-textarea'
    textarea.dataset.dinottyComposing = 'true'
    document.body.appendChild(textarea)
    textarea.focus()
    const apply = vi.fn()

    expect(applyAfterTerminalComposition(apply)).toBe(false)
    expect(apply).not.toHaveBeenCalled()

    textarea.dataset.dinottyComposing = 'false'
    textarea.dispatchEvent(new CompositionEvent('compositionend'))
    expect(apply).toHaveBeenCalledOnce()
  })

  it('keeps a held Ctrl active across multiple combinations until the button releases it', () => {
    const held = { ctrl: 'locked', shift: 'off', alt: 'off', meta: 'off' } as const
    const control = applyMobileTerminalModifiers('c', held)
    expect(control).toEqual({
      data: '\x03',
      modifiers: held,
      consumed: true,
    })
    expect(applyMobileTerminalModifiers('d', control.modifiers)).toMatchObject({
      data: '\x04',
      modifiers: held,
    })
  })

  it('uses a one-shot Alt prefix and releases it after input', () => {
    expect(
      applyMobileTerminalModifiers('word', {
        ctrl: 'off',
        shift: 'off',
        alt: 'once',
        meta: 'off',
      })
    ).toEqual({
      data: '\x1bword',
      modifiers: { ctrl: 'off', shift: 'off', alt: 'off', meta: 'off' },
      consumed: true,
    })
  })
})
