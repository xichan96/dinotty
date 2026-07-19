import { describe, expect, it } from 'vitest'
import {
  cloneWithoutIcons,
  DEFAULT_ACTION_BOTTOM,
  DEFAULT_ACTION_KEYBOARD,
  effectiveActionKeyboard,
  ensureBottom,
  normalizeActionKeyboard,
  settings,
  type ActionKey,
  type ActionKeyboardConfig,
} from '../composables/useSettings'

function normalize(cfg: ActionKeyboardConfig): ActionKeyboardConfig {
  return normalizeActionKeyboard(cfg) as ActionKeyboardConfig
}

describe('normalizeActionKeyboard', () => {
  it('keeps null distinct from an explicitly empty config', () => {
    expect(normalizeActionKeyboard(null)).toBeNull()
    expect(normalize({ rows: [] })).toEqual({ rows: [] })
  })

  it('leaves an absent bottom absent and an empty bottom.rows empty', () => {
    const legacy = normalize({ rows: [] })
    expect(legacy).not.toHaveProperty('bottom')

    const explicitEmpty = normalize({
      rows: [],
      bottom: { rows: [], enter: { label: 'Go', kind: 'send', send: '\r' } },
    })
    expect(explicitEmpty.bottom?.rows).toEqual([])
  })

  it('repairs every invalid Enter form and preserves only a non-blank label', () => {
    const cases: Array<{ enter?: ActionKey; expectedLabel: string }> = [
      { enter: undefined, expectedLabel: '↵' },
      { enter: { label: 'Custom', kind: 'action', action: 'newTab' }, expectedLabel: 'Custom' },
      { enter: { label: 'No kind', send: '\r' }, expectedLabel: 'No kind' },
      { enter: { label: 'Wrong bytes', kind: 'send', send: '\n' }, expectedLabel: 'Wrong bytes' },
      { enter: { label: '   ', kind: 'send' }, expectedLabel: '↵' },
    ]

    for (const { enter, expectedLabel } of cases) {
      const cfg = { rows: [], bottom: { rows: [], enter } } as unknown as ActionKeyboardConfig
      const repaired = normalize(cfg).bottom?.enter
      expect(repaired).toEqual({ label: expectedLabel, kind: 'send', send: '\r' })
    }
  })

  it('leaves absent enter_width absent, clamps finite values, and drops non-finite values', () => {
    const widths = [
      { input: undefined, expected: undefined },
      { input: -1, expected: 0.15 },
      { input: 0.3, expected: 0.3 },
      { input: 0.9, expected: 0.5 },
      { input: Number.NaN, expected: undefined },
      { input: Number.POSITIVE_INFINITY, expected: undefined },
    ]

    for (const { input, expected } of widths) {
      const cfg: ActionKeyboardConfig = {
        rows: [],
        bottom: {
          rows: [],
          enter: { label: '↵', kind: 'send', send: '\r' },
          ...(input === undefined ? {} : { enter_width: input }),
        },
      }
      expect(normalize(cfg).bottom?.enter_width).toBe(expected)
    }
  })

  it('clamps grow recursively without rounding and drops non-finite values', () => {
    const cfg = normalize({
      rows: [[
        { label: 'low', grow: -1 },
        { label: 'fractional', grow: 1.75 },
        { label: 'high', grow: 8 },
        { label: 'nan', grow: Number.NaN },
      ]],
      bottom: {
        rows: [[{ label: 'infinite', grow: Number.NEGATIVE_INFINITY }]],
        enter: { label: '↵', kind: 'send', send: '\r', grow: 9 },
      },
    })

    expect(cfg.rows[0].map((key) => key.grow)).toEqual([0.5, 1.75, 6, undefined])
    expect(cfg.bottom?.rows[0][0]).not.toHaveProperty('grow')
    expect(cfg.bottom?.enter.grow).toBe(6)
  })

  it('treats an unknown kind string as send-kind without rejecting the key', () => {
    const key = {
      label: 'future',
      kind: 'future-kind',
      action: 'newTab',
      send: 'kept',
      special: 'bookmarks',
    } as unknown as ActionKey
    normalize({ rows: [[key]] })
    expect(key).toEqual({
      label: 'future',
      kind: 'send',
      action: 'newTab',
      send: 'kept',
      special: 'bookmarks',
    })
  })

  it('keeps action-kind keys with missing or blank action unchanged', () => {
    const keys: ActionKey[] = [
      { label: 'missing', kind: 'action', send: 'keep', repeat: true },
      { label: 'blank', kind: 'action', action: '  ', send: 'keep', auto_enter: true },
    ]
    const before = keys.map((key) => ({ ...key }))
    normalize({ rows: [keys] })
    expect(keys).toEqual(before)
  })

  it('purges send-only fields and stored icons from a valid action key', () => {
    const icon = { render: () => null }
    const key: ActionKey = {
      label: 'New tab',
      kind: 'action',
      action: 'newTab',
      send: 'bad',
      special: 'bookmarks',
      repeat: true,
      auto_enter: true,
      icon,
      style: 'danger',
      grow: 1.5,
    }
    normalize({ rows: [[key]] })
    expect(key).toEqual({
      label: 'New tab',
      kind: 'action',
      action: 'newTab',
      style: 'danger',
      grow: 1.5,
    })
  })

  it('keeps a send-kind key with no send, including special-only keys', () => {
    const key: ActionKey = { label: 'Bookmarks', special: 'bookmarks' }
    normalize({ rows: [[key]] })
    expect(key).toEqual({ label: 'Bookmarks', special: 'bookmarks' })
  })

  it('normalizes active and snapshot slots identically and is idempotent in both', () => {
    const previousActive = settings.action_keyboard
    const previousSnapshot = settings.action_keyboard_user_default
    try {
      settings.action_keyboard = {
        rows: [[{
          label: 'Active', kind: 'action', action: 'newTab', send: 'remove', repeat: true,
        }]],
      }
      settings.action_keyboard_user_default = {
        rows: [[{ label: 'Snapshot', grow: 9 }]],
        bottom: { rows: [], enter: { label: 'Snapshot Enter', kind: 'action', action: 'newTab' } },
      }

      for (const slot of ['action_keyboard', 'action_keyboard_user_default'] as const) {
        settings[slot] = normalizeActionKeyboard(settings[slot] ?? null)
        const once = JSON.stringify(settings[slot])
        settings[slot] = normalizeActionKeyboard(settings[slot] ?? null)
        expect(JSON.stringify(settings[slot])).toBe(once)
      }

      expect(settings.action_keyboard?.rows[0][0]).not.toHaveProperty('send')
      expect(settings.action_keyboard_user_default?.rows[0][0].grow).toBe(6)
      expect(settings.action_keyboard_user_default?.bottom?.enter).toEqual({
        label: 'Snapshot Enter', kind: 'send', send: '\r',
      })
    } finally {
      settings.action_keyboard = previousActive
      settings.action_keyboard_user_default = previousSnapshot
    }
  })
})

describe('cloneWithoutIcons', () => {
  it('removes icons recursively without flattening component objects', () => {
    const icon = { name: 'IconComponent', render: () => null }
    const cfg: ActionKeyboardConfig = {
      rows: [[{ label: 'main', send: 'main', icon }]],
      bottom: {
        rows: [[{ label: 'bottom', send: 'bottom', icon }]],
        enter: { label: 'enter', kind: 'send', send: '\r', icon },
      },
    }

    const clone = cloneWithoutIcons(cfg)
    const clonedKeys = [clone.rows[0][0], clone.bottom!.rows[0][0], clone.bottom!.enter]
    for (const key of clonedKeys) {
      expect(key).not.toHaveProperty('icon')
      expect(Object.values(key)).not.toContain(icon)
      expect(Object.values(key)).not.toContainEqual({})
    }
    expect(cfg.rows[0][0].icon).toBe(icon)
    expect(cfg.bottom?.rows[0][0].icon).toBe(icon)
    expect(cfg.bottom?.enter.icon).toBe(icon)
  })
})

describe('effectiveActionKeyboard', () => {
  it('inherits the whole factory config for null', () => {
    const previous = settings.action_keyboard
    try {
      settings.action_keyboard = null
      expect(effectiveActionKeyboard()).toBe(DEFAULT_ACTION_KEYBOARD)
      expect(effectiveActionKeyboard().bottom).toBe(DEFAULT_ACTION_BOTTOM)
    } finally {
      settings.action_keyboard = previous
    }
  })

  it('adds only the factory bottom to a legacy rows-only config', () => {
    const previous = settings.action_keyboard
    try {
      const rows = [[{ label: 'legacy', send: 'legacy' }]]
      settings.action_keyboard = { rows }
      expect(effectiveActionKeyboard()).toEqual({ rows, bottom: DEFAULT_ACTION_BOTTOM })
    } finally {
      settings.action_keyboard = previous
    }
  })

  it('preserves explicitly empty upper rows', () => {
    const previous = settings.action_keyboard
    try {
      settings.action_keyboard = { rows: [] }
      expect(effectiveActionKeyboard().rows).toEqual([])
    } finally {
      settings.action_keyboard = previous
    }
  })

  it('preserves a present partial bottom without filling its optional width', () => {
    const previous = settings.action_keyboard
    try {
      const bottom = { rows: [], enter: { label: 'Go', kind: 'send' as const, send: '\r' } }
      settings.action_keyboard = { rows: [], bottom }
      const effective = effectiveActionKeyboard()
      expect(effective.bottom).toEqual(bottom)
      expect(effective.bottom).not.toBe(DEFAULT_ACTION_BOTTOM)
      expect(effective.bottom).not.toHaveProperty('enter_width')
    } finally {
      settings.action_keyboard = previous
    }
  })
})

describe('ensureBottom', () => {
  it('materializes a mutable deep clone without corrupting the factory footer', () => {
    const previous = settings.action_keyboard
    const freshFactoryCopy = structuredClone(DEFAULT_ACTION_BOTTOM)
    try {
      settings.action_keyboard = { rows: [] }
      const bottom = ensureBottom()
      bottom.rows[0][0].label = 'changed'
      bottom.enter.label = 'changed enter'

      expect(bottom).not.toBe(DEFAULT_ACTION_BOTTOM)
      expect(bottom.rows).not.toBe(DEFAULT_ACTION_BOTTOM.rows)
      expect(JSON.stringify(DEFAULT_ACTION_BOTTOM)).toBe(JSON.stringify(freshFactoryCopy))
    } finally {
      settings.action_keyboard = previous
    }
  })
})
