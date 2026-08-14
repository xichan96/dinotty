import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  applyAfterTerminalComposition,
  applyMobileTerminalModifiers,
  configureMobileInputTextarea,
  normalizeTerminalTextareaSelection,
  setKbTypingLock,
  setSystemImeAuthorized,
  terminalTextareaEdit,
} from '../composables/useTerminal'
import { settings } from '../composables/useSettings'

const originalMaxTouchPoints = Object.getOwnPropertyDescriptor(navigator, 'maxTouchPoints')

afterEach(() => {
  setKbTypingLock(false)
  setSystemImeAuthorized(false)
  settings.keyboard_guard_mode = 'off'
  if (originalMaxTouchPoints)
    Object.defineProperty(navigator, 'maxTouchPoints', originalMaxTouchPoints)
  else Reflect.deleteProperty(navigator, 'maxTouchPoints')
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

  it.each(['open_only', 'both'] as const)(
    'keeps terminal focus available while %s suppresses the touch software keyboard',
    (guardMode) => {
      Object.defineProperty(navigator, 'maxTouchPoints', { configurable: true, value: 1 })
      settings.keyboard_guard_mode = guardMode
      const textarea = document.createElement('textarea')

      configureMobileInputTextarea(textarea, 'system')

      expect(textarea.inputMode).toBe('none')
      expect(textarea.getAttribute('virtualkeyboardpolicy')).toBe('manual')
      expect(textarea.disabled).toBe(false)

      setSystemImeAuthorized(true)
      configureMobileInputTextarea(textarea, 'system')
      expect(textarea.inputMode).toBe('text')
      expect(textarea.getAttribute('virtualkeyboardpolicy')).toBe('auto')
    }
  )

  it.each(['off', 'collapse_only'] as const)(
    'keeps touch system input unchanged under %s protection',
    (guardMode) => {
      Object.defineProperty(navigator, 'maxTouchPoints', { configurable: true, value: 1 })
      settings.keyboard_guard_mode = guardMode
      const textarea = document.createElement('textarea')

      configureMobileInputTextarea(textarea, 'system')

      expect(textarea.inputMode).toBe('text')
      expect(textarea.getAttribute('virtualkeyboardpolicy')).toBe('auto')
    }
  )

  it('does not suppress a non-touch system input under manual-open protection', () => {
    Object.defineProperty(navigator, 'maxTouchPoints', { configurable: true, value: 0 })
    settings.keyboard_guard_mode = 'both'
    const textarea = document.createElement('textarea')

    configureMobileInputTextarea(textarea, 'system')

    expect(textarea.inputMode).toBe('text')
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

  it.each([
    [
      { value: '', selectionStart: 0, selectionEnd: 0 },
      { value: '()', selectionStart: 1, selectionEnd: 1 },
      '()\x1b[D',
      null,
    ],
    [
      { value: '()', selectionStart: 1, selectionEnd: 1 },
      { value: '())', selectionStart: 2, selectionEnd: 2 },
      '\x1b[C)',
      ')',
    ],
    [
      { value: 'abXYcd', selectionStart: 4, selectionEnd: 4 },
      { value: 'abZcd', selectionStart: 3, selectionEnd: 3 },
      '\x7f\x7fZ',
      null,
    ],
    [
      { value: '😀', selectionStart: 2, selectionEnd: 2 },
      { value: '😀()', selectionStart: 3, selectionEnd: 3 },
      '()\x1b[D',
      null,
    ],
  ])('derives a caret-aware terminal edit from %j to %j', (before, after, expected, data) => {
    expect(
      terminalTextareaEdit(before, normalizeTerminalTextareaSelection(before, after, data))
    ).toBe(expected)
  })

  it.each([
    ['(abc)', '(abc))', 4, 5, ')', '\x1b[C)'],
    ['[abc]', '[abc]]', 4, 5, ']', '\x1b[C]'],
    ['（中文）', '（中文））', 3, 4, '）', '\x1b[C）'],
    ['“中文”', '“中文””', 3, 4, '”', '\x1b[C”'],
  ])(
    'places a standalone closer after prior auto-pair content: %s -> %s',
    (beforeValue, afterValue, beforeCaret, afterCaret, data, expected) => {
      const before = {
        value: beforeValue,
        selectionStart: beforeCaret,
        selectionEnd: beforeCaret,
      }
      expect(
        terminalTextareaEdit(
          before,
          normalizeTerminalTextareaSelection(
            before,
            { value: afterValue, selectionStart: afterCaret, selectionEnd: afterCaret },
            data
          )
        )
      ).toBe(expected)
    }
  )

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
