import { describe, it, expect, vi } from 'vitest'
import {
  isDuplicateOnData,
  DEDUP_WINDOW_MS,
  TerminalInstance,
} from '../composables/useTerminal'

// Root cause: 5ms dedup window was too wide — xterm.js macOS modifier
// sequences (Shift+punct) span > 5ms, so the second valid onData was
// being swallowed by the dedup check.

describe('onData dedup helper (useTerminal)', () => {
  it('exposes a small window (<= 2ms)', () => {
    expect(DEDUP_WINDOW_MS).toBeLessThanOrEqual(2)
  })

  it('drops a WKWebView multi-focus replay within the window', () => {
    expect(isDuplicateOnData('?', '?', 1000, 1001)).toBe(true)
  })

  it('allows a real next keystroke after the window expires', () => {
    expect(isDuplicateOnData('?', '?', 1000, 1010)).toBe(false)
  })

  it('allows different data even within the window', () => {
    expect(isDuplicateOnData('!', '?', 1000, 1001)).toBe(false)
  })

  it('regression: Shift+punct modifier sequence is NOT swallowed', () => {
    // First event always passes through (prev === '')
    expect(isDuplicateOnData('', '', 1000, 1001)).toBe(false)
    // Different data (modifier prefix vs real char) is never a duplicate
    expect(isDuplicateOnData('?', '', 1000, 1003)).toBe(false)
  })
})

describe('wheel bypass skips dedup (regression)', () => {
  const mouseReport = '\x1b[<64;10;10M'

  it('emits byte-identical SGR reports sent back-to-back during bypass', () => {
    const instance = Object.create(TerminalInstance.prototype) as any
    instance._wheelBypass = true
    instance._lastInputData = mouseReport
    instance._lastInputTime = performance.now()
    instance._emitInput = vi.fn()

    instance._handleXtermData(mouseReport)
    instance._handleXtermData(mouseReport)

    expect(instance._emitInput).toHaveBeenCalledTimes(2)
    expect(instance._emitInput).toHaveBeenNthCalledWith(1, mouseReport)
    expect(instance._emitInput).toHaveBeenNthCalledWith(2, mouseReport)
  })

  it('leaves the dedup state untouched during bypass', () => {
    const instance = Object.create(TerminalInstance.prototype) as any
    instance._wheelBypass = true
    instance._lastInputData = 'existing input'
    instance._lastInputTime = 1234
    instance._emitInput = vi.fn()

    instance._handleXtermData(mouseReport)

    expect(instance._lastInputData).toBe('existing input')
    expect(instance._lastInputTime).toBe(1234)
  })

  it('drops the second identical input when bypass is disabled', () => {
    const instance = Object.create(TerminalInstance.prototype) as any
    instance._wheelBypass = false
    instance._lastInputData = ''
    instance._lastInputTime = 0
    instance._emitInput = vi.fn()
    const nowSpy = vi.spyOn(performance, 'now').mockReturnValue(2000)

    try {
      instance._handleXtermData(mouseReport)
      instance._handleXtermData(mouseReport)
    } finally {
      nowSpy.mockRestore()
    }

    expect(instance._emitInput).toHaveBeenCalledOnce()
    expect(instance._emitInput).toHaveBeenCalledWith(mouseReport)
  })
})
