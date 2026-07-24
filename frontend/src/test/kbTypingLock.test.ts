import { afterEach, describe, expect, it } from 'vitest'

import { isKbTypingLocked, setKbTypingLock } from '../composables/useTerminal'

function createHelperTextarea() {
  const textarea = document.createElement('textarea')
  textarea.className = 'xterm-helper-textarea'
  document.body.appendChild(textarea)
  return textarea
}

afterEach(() => {
  document.body.replaceChildren()
  setKbTypingLock(false)
})

describe('setKbTypingLock', () => {
  it('tracks whether keyboard typing is locked', () => {
    expect(isKbTypingLocked()).toBe(false)

    setKbTypingLock(true)
    expect(isKbTypingLocked()).toBe(true)

    setKbTypingLock(false)
    expect(isKbTypingLocked()).toBe(false)
  })

  it('disables every existing xterm helper textarea', () => {
    const first = createHelperTextarea()
    const second = createHelperTextarea()

    setKbTypingLock(true)

    expect(first.disabled).toBe(true)
    expect(second.disabled).toBe(true)
  })

  it('disables a helper added after locking when called again with the same value', () => {
    setKbTypingLock(true)
    const addedWhileLocked = createHelperTextarea()

    setKbTypingLock(true)

    expect(addedWhileLocked.disabled).toBe(true)
  })

  it('re-enables every helper, including one added while locked', () => {
    const existing = createHelperTextarea()
    setKbTypingLock(true)
    const addedWhileLocked = createHelperTextarea()
    setKbTypingLock(true)

    setKbTypingLock(false)

    expect(existing.disabled).toBe(false)
    expect(addedWhileLocked.disabled).toBe(false)
  })

  it('never touches elements that are not xterm helper textareas', () => {
    const enabledNonHelper = document.createElement('textarea')
    const disabledNonHelper = document.createElement('textarea')
    disabledNonHelper.disabled = true
    document.body.append(enabledNonHelper, disabledNonHelper)

    setKbTypingLock(true)
    expect(enabledNonHelper.disabled).toBe(false)
    expect(disabledNonHelper.disabled).toBe(true)

    setKbTypingLock(false)
    expect(enabledNonHelper.disabled).toBe(false)
    expect(disabledNonHelper.disabled).toBe(true)
  })
})
