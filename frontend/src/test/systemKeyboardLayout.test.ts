import { describe, expect, it } from 'vitest'
import type { ActionKey, SystemKeyboardConfig } from '../composables/useSettings'
import {
  MAX_SYSTEM_PINNED,
  MAX_SYSTEM_PAGES,
  UPPER_USER_UNITS,
  autoSystemKeyUnits,
  canonicalLowerKeys,
  packSystemKeys,
  systemKeyboardLayoutStatus,
  systemKeyboardCandidateAllowed,
  systemKeyUnits,
} from '../utils/systemKeyboardLayout'

function key(label: string, grow?: number): ActionKey {
  return { label, kind: 'send', send: label, grow }
}

describe('system keyboard whole-unit layout', () => {
  it('uses Auto for absent width and rounds explicit values to bounded whole units', () => {
    expect(autoSystemKeyUnits('A')).toBe(1)
    expect(autoSystemKeyUnits('Claude Code')).toBeGreaterThan(1)
    expect(autoSystemKeyUnits('这是很长的中文标题')).toBeGreaterThan(2)
    expect(systemKeyUnits(key('x', 2.7), 10)).toBe(3)
    expect(systemKeyUnits(key('x', 99), 10)).toBe(10)
    expect(systemKeyUnits(key('x', Number.NaN), 10)).toBe(1)
    expect(
      systemKeyUnits({ label: 'Upload file', kind: 'action', action: 'uploadMobileFile' }, 10)
    ).toBe(1)
    expect(
      systemKeyUnits(
        { label: 'Upload file', kind: 'action', action: 'uploadMobileFile', grow: 3 },
        10
      )
    ).toBe(3)
    expect(systemKeyUnits({ label: 'Codex', kind: 'send', send: 'codex', grow: 2 }, 10)).toBe(2)
    expect(
      systemKeyUnits(
        { label: 'Upload file', kind: 'action', action: 'uploadMobileFile', display: 'text' },
        10
      )
    ).toBe(3)
  })

  it('greedily packs complete keys without splitting or reordering them', () => {
    const keys = [key('a', 6), key('b', 5), key('c', 2), key('d', 8)]
    const pages = packSystemKeys(keys, 10)

    expect(pages.map((page) => page.map((item) => item.key.label))).toEqual([
      ['a'],
      ['b', 'c'],
      ['d'],
    ])
    expect(pages.flat().map((item) => item.units)).toEqual([6, 5, 2, 8])
  })

  it('flattens every legacy lower page in stable order without truncation', () => {
    const config = {
      upper: [],
      pages: [[key('1')], [key('2'), key('3')], [], [key('4')]],
      lower_enabled: true,
      upper_pinned: 0,
    } satisfies SystemKeyboardConfig

    expect(canonicalLowerKeys(config).map((item) => item.label)).toEqual(['1', '2', '3', '4'])
  })

  it('subtracts the pinned prefix from the upper pager and reserves the IME toggle', () => {
    const config = {
      upper: [key('p1', 2), key('p2', 2), key('a', 3), key('b', 3), key('c', 3)],
      pages: [[]],
      lower_enabled: false,
      upper_pinned: 2,
    } satisfies SystemKeyboardConfig

    const status = systemKeyboardLayoutStatus(config)
    expect(UPPER_USER_UNITS).toBe(9)
    expect(status.upperCapacity).toBe(5)
    expect(status.upperPages).toBe(3)
    expect(status.valid).toBe(true)
  })

  it('pins independent five-key prefixes and packs only each remaining stream', () => {
    const config = {
      upper: Array.from({ length: 7 }, (_, index) => key(`u${index}`, 1)),
      pages: [Array.from({ length: 12 }, (_, index) => key(`l${index}`, 1))],
      lower_enabled: true,
      upper_pinned: 9,
      lower_pinned: 9,
    } satisfies SystemKeyboardConfig

    expect(MAX_SYSTEM_PINNED).toBe(5)
    expect(systemKeyboardLayoutStatus(config)).toMatchObject({
      upperPinned: 5,
      lowerPinned: 5,
      upperCapacity: 4,
      lowerCapacity: 5,
      upperPages: 1,
      lowerPages: 2,
      valid: true,
    })
  })

  it('allows five pages, rejects a newly-created sixth, and reports legacy over-limit intact', () => {
    const five = {
      upper: [],
      pages: [[...Array.from({ length: 5 }, (_, i) => key(String(i), 10))]],
      lower_enabled: true,
      upper_pinned: 0,
    } satisfies SystemKeyboardConfig
    const six = {
      ...five,
      pages: [[...five.pages[0], key('six', 10)]],
    } satisfies SystemKeyboardConfig

    expect(systemKeyboardLayoutStatus(five)).toMatchObject({
      lowerPages: MAX_SYSTEM_PAGES,
      valid: true,
    })
    expect(systemKeyboardLayoutStatus(six)).toMatchObject({ lowerPages: 6, valid: false })
    expect(canonicalLowerKeys(six)).toHaveLength(6)
  })

  it('retains lower data while disabled and validates an oversized pinned prefix', () => {
    const disabled = {
      upper: [key('pinned', 9), key('pageable')],
      pages: [[key('saved', 10)]],
      lower_enabled: false,
      upper_pinned: 1,
    } satisfies SystemKeyboardConfig

    const status = systemKeyboardLayoutStatus(disabled)
    expect(status.lowerPages).toBe(0)
    expect(status.storedLowerPages).toBe(1)
    expect(status.valid).toBe(false)
    expect(canonicalLowerKeys(disabled)[0].label).toBe('saved')
  })

  it('allows an invalid layout to recover but never regress either pageable capacity', () => {
    const before = {
      upper: Array.from({ length: 6 }, (_, index) => key(`u${index}`, 9)),
      pages: [[key('pin', 5), key('pageable')]],
      lower_enabled: true,
      upper_pinned: 0,
      lower_pinned: 1,
    } satisfies SystemKeyboardConfig
    const worse = structuredClone(before)
    worse.pages[0][0].grow = 6
    const better = structuredClone(before)
    better.pages[0][0].grow = 4

    expect(systemKeyboardLayoutStatus(before).valid).toBe(false)
    expect(systemKeyboardCandidateAllowed(before, worse)).toBe(false)
    expect(systemKeyboardCandidateAllowed(before, better)).toBe(true)
  })
})
