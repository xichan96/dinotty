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

  it('converts a sticky Ctrl key once and preserves Ctrl across non-ASCII composition text', () => {
    const nonAscii = applyMobileTerminalModifiers('中文', { ctrl: true, alt: false })
    expect(nonAscii).toEqual({
      data: '中文',
      modifiers: { ctrl: true, alt: false },
      consumed: false,
    })

    const control = applyMobileTerminalModifiers('c', nonAscii.modifiers)
    expect(control).toEqual({
      data: '\x03',
      modifiers: { ctrl: false, alt: false },
      consumed: true,
    })
  })

  it('prefixes Alt text with Escape and releases the modifier', () => {
    expect(applyMobileTerminalModifiers('word', { ctrl: false, alt: true })).toEqual({
      data: '\x1bword',
      modifiers: { ctrl: false, alt: false },
      consumed: true,
    })
  })
})
