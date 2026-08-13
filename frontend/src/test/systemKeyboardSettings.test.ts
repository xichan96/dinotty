import { beforeEach, describe, expect, it } from 'vitest'
import {
  DEFAULT_SYSTEM_KEYBOARD,
  cloneSystemKeyboardWithoutIcons,
  effectiveSystemKeyboard,
  resetSystemKeyboard,
  settings,
} from '../composables/useSettings'

describe('system keyboard settings model', () => {
  beforeEach(() => {
    settings.system_keyboard = null
    settings.system_toolbar_mode = 'follow_ime'
  })

  it('uses the complete resettable factory preset when custom layout is null', () => {
    const effective = effectiveSystemKeyboard()

    expect(effective.upper.map((key) => key.action)).toEqual([
      'system.history',
      'openBookmarks',
      'system.extended',
      'system.actions',
    ])
    expect(effective.pages.flat().map((key) => key.label)).toEqual([
      'Esc',
      'Tab',
      'Ctrl',
      'Alt',
      '/',
      '|',
      '~',
      '-',
      '^C',
      '^I',
      '^S',
      '^Z',
    ])
    expect(effective).toBe(DEFAULT_SYSTEM_KEYBOARD)
    expect(effective).toMatchObject({ upper_pinned: 0, lower_pinned: 0 })
  })

  it('preserves intentionally empty regions and reset returns to null sentinel', () => {
    settings.system_keyboard = { upper: [], pages: [[]] }
    expect(effectiveSystemKeyboard()).toEqual({ upper: [], pages: [[]] })

    resetSystemKeyboard()

    expect(settings.system_keyboard).toBeNull()
    expect(effectiveSystemKeyboard()).toBe(DEFAULT_SYSTEM_KEYBOARD)
  })

  it('strips runtime icons from every synchronized region', () => {
    const icon = {}
    const clone = cloneSystemKeyboardWithoutIcons({
      upper: [{ label: 'upper', kind: 'action', action: 'openBookmarks', icon }],
      pages: [[{ label: 'lower', send: 'l', icon }]],
      upper_pinned: 1,
      lower_pinned: 1,
    })

    expect(clone.upper[0].icon).toBeUndefined()
    expect(clone.pages[0][0].icon).toBeUndefined()
    expect(clone).toMatchObject({ upper_pinned: 1, lower_pinned: 1 })
  })
})
