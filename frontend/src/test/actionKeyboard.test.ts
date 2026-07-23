import { describe, expect, it } from 'vitest'
import { Bell, ClipboardPaste, Columns3, Globe } from 'lucide-vue-next'
import {
  cloneWithoutIcons,
  DEFAULT_ACTION_BOTTOM,
  DEFAULT_ACTION_KEYBOARD,
  effectiveActionKeyboard,
  ensureBottom,
  normalizeActionKeyboard,
  resetActionKeyboard,
  restoreActionKeyboardUserDefault,
  restoreActionIcons,
  saveActionKeyboardUserDefault,
  settings,
  type ActionKey,
  type ActionKeyboardConfig,
} from '../composables/useSettings'
import { actionKeyToKeyDef } from '../utils/actionKeyDef'
import {
  APP_ACTIONS,
  getAppAction,
  isDispatchableAppAction,
} from '../utils/appActionCatalog'
import { akDropGripThreshold, akResolveDropIndex } from '../components/settings/KeyboardTab.vue'

function normalize(cfg: ActionKeyboardConfig): ActionKeyboardConfig {
  return normalizeActionKeyboard(cfg) as ActionKeyboardConfig
}

describe('app action catalog', () => {
  it('appends pasteTerminal and the four terminal sequences after the app registry entries', () => {
    expect(APP_ACTIONS.map(({ id }) => id)).toEqual([
      'togglePalette',
      'openBookmarks',
      'newTab',
      'closeTab',
      'splitHorizontal',
      'splitVertical',
      'toggleBroadcast',
      'toggleZoom',
      'equalizePanes',
      'focusNextPane',
      'focusPrevPane',
      'searchTerminal',
      'addCursorsInFiles',
      'missionControl',
      'superviseTabs',
      'sshConnect',
      'fontSizeUp',
      'fontSizeDown',
      'reloadApp',
      'fontSizeReset',
      'pasteTerminal',
      'term.newline',
      'term.lineStart',
      'term.lineEnd',
      'term.deleteToLineStart',
    ])
    expect(APP_ACTIONS).toHaveLength(25)
  })

  it('uses the registry icons for actions whose old catalog icons differed', () => {
    expect(getAppAction('superviseTabs')?.icon).toBe(Bell)
    expect(getAppAction('sshConnect')?.icon).toBe(Globe)
    expect(getAppAction('equalizePanes')?.icon).toBe(Columns3)
    expect(getAppAction('pasteTerminal')?.icon).toBe(ClipboardPaste)
  })

  it('allows selector actions through the dispatch gate and no-ops unknown ids', () => {
    for (const id of [
      'pasteTerminal',
      'term.newline',
      'term.lineStart',
      'term.lineEnd',
      'term.deleteToLineStart',
    ]) {
      expect(isDispatchableAppAction(id), id).toBe(true)
      expect(APP_ACTIONS.some((action) => action.id === id), id).toBe(true)
    }
    expect(isDispatchableAppAction('searchTerminal')).toBe(true)
    expect(isDispatchableAppAction('unknown-action')).toBe(false)
    expect(getAppAction('pasteTerminal')?.labelKey).toBe('mobileKb.pasteTerminal')
    expect(getAppAction('term.newline')?.labelKey).toBe('keybinding.term.newline')
  })
})

describe('actionKeyToKeyDef action display', () => {
  it('renders icon mode with the registry icon and an empty label', () => {
    const def = actionKeyToKeyDef({
      label: 'Ignored label',
      kind: 'action',
      action: 'newTab',
      display: 'icon',
    })

    expect(def.l).toBe('')
    expect(def.icon).toBe(getAppAction('newTab')?.icon)
  })

  it('renders text mode with the user label and no icon', () => {
    const def = actionKeyToKeyDef({
      label: 'My New Tab',
      kind: 'action',
      action: 'newTab',
      display: 'text',
    })

    expect(def.l).toBe('My New Tab')
    expect(def).not.toHaveProperty('icon')
  })

  it.each([true, false])('carries pasteTerminal auto_enter=%s into its key definition', (autoEnter) => {
    const def = actionKeyToKeyDef({
      label: 'Paste',
      kind: 'action',
      action: 'pasteTerminal',
      display: 'icon',
      auto_enter: autoEnter,
    })

    expect(def.act).toBe('pasteTerminal')
    expect(def.autoEnter).toBe(autoEnter)
  })

  it.each([
    'searchTerminal',
    'newTab',
    'term.newline',
    'term.lineStart',
    'term.lineEnd',
    'term.deleteToLineStart',
  ])('omits autoEnter from %s key definitions', (action) => {
    const def = actionKeyToKeyDef({
      label: action,
      kind: 'action',
      action,
      auto_enter: true,
    })

    expect(def.act).toBe(action)
    expect(def).not.toHaveProperty('autoEnter')
  })

  it('marks an unsupported action key as disabled with the action id in the label', () => {
    const def = actionKeyToKeyDef({
      label: 'Ignored',
      kind: 'action',
      action: 'no-such-action',
    })

    expect(def.disabled).toBe(true)
    expect(def.cls).toContain('mkb-disabled')
    expect(def.l).toContain('no-such-action')
  })

  it('marks an action key with no action id as disabled', () => {
    const def = actionKeyToKeyDef({ label: '', kind: 'action' })

    expect(def.disabled).toBe(true)
    expect(def.cls).toContain('mkb-disabled')
  })
})

describe('action keyboard drop threshold', () => {
  it('uses the 16px grip width and degrades to midpoint for narrow keys', () => {
    expect(akDropGripThreshold(80)).toBe(16)
    expect(akDropGripThreshold(32)).toBe(16)
    expect(akDropGripThreshold(20)).toBe(10)
  })

  it('commits after a right-side target at its left grip threshold', () => {
    const rect = { left: 0, right: 100, width: 100 }
    expect(akResolveDropIndex(15, rect, 4, 'after')).toBe(4)
    expect(akResolveDropIndex(17, rect, 4, 'after')).toBe(5)
  })

  it('commits before a left-side target at the mirrored right grip threshold', () => {
    const rect = { left: 0, right: 100, width: 100 }
    expect(akResolveDropIndex(85, rect, 4, 'before')).toBe(5)
    expect(akResolveDropIndex(83, rect, 4, 'before')).toBe(4)
  })

  it('uses the midpoint when target direction is unknown', () => {
    const rect = { left: 0, right: 100, width: 100 }
    expect(akResolveDropIndex(49, rect, 4, 'unknown')).toBe(4)
    expect(akResolveDropIndex(51, rect, 4, 'unknown')).toBe(5)
  })

  it('limits both directional thresholds to the center of narrow keys', () => {
    const rect = { left: 0, right: 20, width: 20 }
    expect(akResolveDropIndex(9, rect, 4, 'after')).toBe(4)
    expect(akResolveDropIndex(10, rect, 4, 'after')).toBe(5)
    expect(akResolveDropIndex(11, rect, 4, 'before')).toBe(5)
    expect(akResolveDropIndex(10, rect, 4, 'before')).toBe(4)
  })
})

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
        { label: 'high', grow: 20 },
        { label: 'nan', grow: Number.NaN },
      ]],
      bottom: {
        rows: [[{ label: 'infinite', grow: Number.NEGATIVE_INFINITY }]],
        enter: { label: '↵', kind: 'send', send: '\r', grow: 20 },
      },
    })

    expect(cfg.rows[0].map((key) => key.grow)).toEqual([0.5, 1.75, 12, undefined])
    expect(cfg.bottom?.rows[0][0]).not.toHaveProperty('grow')
    expect(cfg.bottom?.enter.grow).toBe(12)
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

  it('keeps valid display modes and drops bogus or absent values without defaults', () => {
    const keys = [
      { label: 'icon', kind: 'action', action: 'newTab', display: 'icon' },
      { label: 'text', kind: 'action', action: 'newTab', display: 'text' },
      { label: 'bogus', kind: 'action', action: 'newTab', display: 'bogus' },
      { label: 'absent', kind: 'action', action: 'newTab' },
    ] as unknown as ActionKey[]

    normalize({ rows: [keys] })

    expect(keys.map((key) => key.display)).toEqual(['icon', 'text', undefined, undefined])
    expect(keys[2]).not.toHaveProperty('display')
    expect(keys[3]).not.toHaveProperty('display')
  })

  it('keeps valid shape values and drops bogus or absent values without defaults', () => {
    const keys = [
      { label: 'arrow', send: '\x1b[A', shape: 'arrow' },
      { label: 'button', send: 'yes\r', shape: 'button' },
      { label: 'bogus', send: 'no\r', shape: 'wide' },
      { label: 'absent', send: 'go\r' },
    ] as unknown as ActionKey[]

    normalize({ rows: [keys] })

    expect(keys.map((key) => key.shape)).toEqual(['arrow', 'button', undefined, undefined])
    expect(keys[2]).not.toHaveProperty('shape')
    expect(keys[3]).not.toHaveProperty('shape')
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

  it('defaults and preserves per-key auto_enter only for pasteTerminal actions', () => {
    const defaulted: ActionKey = {
      label: 'Paste', kind: 'action', action: 'pasteTerminal',
    }
    const disabled: ActionKey = {
      label: 'Paste without Enter', kind: 'action', action: 'pasteTerminal', auto_enter: false,
    }
    const unrelated: ActionKey = {
      label: 'Search', kind: 'action', action: 'searchTerminal', auto_enter: true,
    }

    normalize({ rows: [[defaulted, disabled, unrelated]] })

    expect(defaulted.auto_enter).toBe(true)
    expect(disabled.auto_enter).toBe(false)
    expect(unrelated).not.toHaveProperty('auto_enter')
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
        rows: [[{ label: 'Snapshot', grow: 20 }]],
        bottom: { rows: [], enter: { label: 'Snapshot Enter', kind: 'action', action: 'newTab' } },
      }

      for (const slot of ['action_keyboard', 'action_keyboard_user_default'] as const) {
        settings[slot] = normalizeActionKeyboard(settings[slot] ?? null)
        const once = JSON.stringify(settings[slot])
        settings[slot] = normalizeActionKeyboard(settings[slot] ?? null)
        expect(JSON.stringify(settings[slot])).toBe(once)
      }

      expect(settings.action_keyboard?.rows[0][0]).not.toHaveProperty('send')
      expect(settings.action_keyboard_user_default?.rows[0][0].grow).toBe(12)
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

  it('restores factory send-key icons without adding them to action keys', () => {
    const previousActive = settings.action_keyboard
    const previousSnapshot = settings.action_keyboard_user_default
    const factoryKey = DEFAULT_ACTION_KEYBOARD.rows[0][1]
    try {
      settings.action_keyboard = cloneWithoutIcons({
        rows: [[
          factoryKey,
          { label: 'Action', kind: 'action', action: 'newTab', send: factoryKey.send },
        ]],
      })
      settings.action_keyboard_user_default = null

      restoreActionIcons()

      expect(settings.action_keyboard.rows[0][0].icon).toEqual(factoryKey.icon)
      expect(settings.action_keyboard.rows[0][1]).not.toHaveProperty('icon')
    } finally {
      settings.action_keyboard = previousActive
      settings.action_keyboard_user_default = previousSnapshot
    }
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

describe('action keyboard user defaults', () => {
  it('saves the effective config, then restores later live mutations with icons', () => {
    const previousActive = settings.action_keyboard
    const previousSnapshot = settings.action_keyboard_user_default
    const factoryKey = DEFAULT_ACTION_KEYBOARD.rows[0][1]
    try {
      settings.action_keyboard = null

      saveActionKeyboardUserDefault()
      const saved = cloneWithoutIcons(settings.action_keyboard_user_default!)
      expect(saved).toEqual(cloneWithoutIcons(DEFAULT_ACTION_KEYBOARD))
      expect(saved.bottom).toEqual(cloneWithoutIcons(DEFAULT_ACTION_KEYBOARD).bottom)
      expect(settings.action_keyboard_user_default?.rows[0][1]).not.toHaveProperty('icon')

      settings.action_keyboard = cloneWithoutIcons(settings.action_keyboard_user_default!)
      settings.action_keyboard.rows[0][1].label = 'Mutated main'
      settings.action_keyboard.bottom!.rows[0][0].label = 'Mutated bottom'
      settings.action_keyboard.bottom!.enter_width = 0.5

      restoreActionKeyboardUserDefault()

      expect(cloneWithoutIcons(settings.action_keyboard!)).toEqual(saved)
      expect(settings.action_keyboard?.rows[0][1].icon).toEqual(factoryKey.icon)
    } finally {
      settings.action_keyboard = previousActive
      settings.action_keyboard_user_default = previousSnapshot
    }
  })

  it('resets the live config to factory inheritance without clearing the snapshot', () => {
    const previousActive = settings.action_keyboard
    const previousSnapshot = settings.action_keyboard_user_default
    try {
      settings.action_keyboard = { rows: [[{ label: 'Live', send: 'live' }]] }
      settings.action_keyboard_user_default = {
        rows: [[{ label: 'Snapshot', send: 'snapshot' }]],
      }
      const snapshot = settings.action_keyboard_user_default

      resetActionKeyboard()

      expect(settings.action_keyboard).toBeNull()
      expect(settings.action_keyboard_user_default).toBe(snapshot)
    } finally {
      settings.action_keyboard = previousActive
      settings.action_keyboard_user_default = previousSnapshot
    }
  })

  it('restores a deep clone that does not alias the saved snapshot', () => {
    const previousActive = settings.action_keyboard
    const previousSnapshot = settings.action_keyboard_user_default
    try {
      settings.action_keyboard_user_default = {
        rows: [[{ label: 'Snapshot main', send: 'main' }]],
        bottom: {
          rows: [[{ label: 'Snapshot bottom', send: 'bottom' }]],
          enter: { label: 'Snapshot enter', kind: 'send', send: '\r' },
        },
      }

      restoreActionKeyboardUserDefault()
      const live = settings.action_keyboard!
      const snapshot = settings.action_keyboard_user_default!

      expect(live).not.toBe(snapshot)
      expect(live.rows).not.toBe(snapshot.rows)
      expect(live.rows[0]).not.toBe(snapshot.rows[0])
      expect(live.rows[0][0]).not.toBe(snapshot.rows[0][0])
      expect(live.bottom).not.toBe(snapshot.bottom)
      expect(live.bottom?.rows[0][0]).not.toBe(snapshot.bottom?.rows[0][0])

      live.rows[0][0].label = 'Mutated live main'
      live.bottom!.rows[0][0].label = 'Mutated live bottom'

      expect(snapshot.rows[0][0].label).toBe('Snapshot main')
      expect(snapshot.bottom?.rows[0][0].label).toBe('Snapshot bottom')
    } finally {
      settings.action_keyboard = previousActive
      settings.action_keyboard_user_default = previousSnapshot
    }
  })
})
