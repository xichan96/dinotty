import { mount, type VueWrapper } from '@vue/test-utils'
import { nextTick } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import KeyboardTab from '../components/settings/KeyboardTab.vue'
import { settings } from '../composables/useSettings'
import { handleTerminalShortcutKeydown } from '../composables/useTerminal'
import {
  keyBindingDefs,
  keyEventMatchesBinding,
  useKeybindings,
} from '../composables/useKeybindings'

vi.mock('../composables/apiBase', () => ({
  apiUrl: (path: string) => path,
  authFetch: vi.fn(async () => ({ ok: true, json: async () => ({}) })),
  getApiBase: async () => 'http://127.0.0.1:7681',
  hasAuthToken: () => false,
  wsUrlWithToken: (url: string) => url,
}))

const APP_DEFAULTS = [
  ['togglePalette', 'k', false, false],
  ['openBookmarks', 'b', true, false],
  ['newTab', 't', false, false],
  ['closeTab', 'w', false, false],
  ['splitHorizontal', 'd', false, false],
  ['splitVertical', 'd', true, false],
  ['toggleBroadcast', 'i', true, false],
  ['toggleZoom', 'Enter', true, false],
  ['equalizePanes', '=', false, false],
  ['focusNextPane', ']', false, false],
  ['focusPrevPane', '[', false, false],
  ['searchTerminal', 'f', false, false],
  ['addCursorsInFiles', 'l', true, false],
  ['switchTab', '1', false, true],
  ['missionControl', 'm', true, false],
  ['superviseTabs', '`', false, false],
  ['sshConnect', 'n', true, false],
  ['fontSizeUp', '=', true, false],
  ['fontSizeDown', '-', false, false],
  ['reloadApp', 'r', false, false],
  ['fontSizeReset', '0', false, false],
] as const

const mountedWrappers: VueWrapper[] = []

function trackWrapper(wrapper: VueWrapper) {
  mountedWrappers.push(wrapper)
  return wrapper
}

function resetKeybindings() {
  settings.keybindings = {}
  settings.locale = 'en'
  settings.windowsAltAsCmd = false
}

function keyEvent(key: string, init: KeyboardEventInit = {}) {
  return new KeyboardEvent('keydown', {
    key,
    bubbles: true,
    cancelable: true,
    ...init,
  })
}

function dispatchAppBinding(event: KeyboardEvent, id: string, action: () => void) {
  const binding = useKeybindings().getBinding(id)
  const appCommand =
    (event.metaKey || event.ctrlKey || (settings.windowsAltAsCmd && event.altKey)) &&
    !(event.ctrlKey && event.altKey)
  if (appCommand && keyEventMatchesBinding(event, binding)) action()
}

async function recordKey(id: string, event: KeyboardEvent) {
  const wrapper = trackWrapper(mount(KeyboardTab))
  await wrapper.find(`[data-kb-id="${id}"] [data-kb-action="record"]`).trigger('click')
  await nextTick()
  window.dispatchEvent(event)
  await nextTick()
  return wrapper
}

describe('unified keybindings', () => {
  beforeEach(() => {
    resetKeybindings()
  })

  afterEach(() => {
    for (const wrapper of mountedWrappers.splice(0)) wrapper.unmount()
    vi.restoreAllMocks()
  })

  it('keeps the 21 app defaults and persisted shape unchanged', () => {
    const appDefs = keyBindingDefs.filter((def) => (def.kind ?? 'app') === 'app')

    expect(appDefs).toHaveLength(21)
    expect(
      appDefs.map((def) => [
        def.id,
        def.defaultBinding.key,
        def.defaultBinding.shift,
        def.readonly === true,
      ])
    ).toEqual(APP_DEFAULTS)
    expect(appDefs.every((def) => def.sequence === undefined)).toBe(true)
    expect(appDefs.every((def) => Object.keys(def.defaultBinding).join(',') === 'key,shift')).toBe(
      true
    )
  })

  it('keeps pasteTerminal out of the keybinding registry', () => {
    expect(useKeybindings().defs.some((def) => def.id === 'pasteTerminal')).toBe(false)
  })

  it('ignores a persisted pasteTerminal keybinding override', () => {
    settings.keybindings.pasteTerminal = { key: 'v', shift: false }

    const binding = useKeybindings().getBinding('pasteTerminal')
    expect(binding).toEqual({ key: '', shift: false })
    expect(keyEventMatchesBinding(keyEvent('v', { metaKey: true }), binding)).toBe(false)
    expect(keyEventMatchesBinding(keyEvent('v', { ctrlKey: true }), binding)).toBe(false)
  })

  it.each([
    ['Cmd', { metaKey: true }],
    ['Ctrl', { ctrlKey: true }],
  ])('does not dispatch pasteTerminal for %s+V', (_modifier, init) => {
    settings.keybindings.pasteTerminal = { key: 'v', shift: false }
    const dispatch = vi.fn()
    const event = keyEvent('v', init)

    dispatchAppBinding(event, 'pasteTerminal', dispatch)

    expect(dispatch).not.toHaveBeenCalled()
    expect(event.defaultPrevented).toBe(false)
  })

  it('offers pasteTerminal in the action-key selector with its own default-on auto_enter', async () => {
    const previous = settings.action_keyboard
    try {
      settings.action_keyboard = { rows: [[{ label: 'new', send: '', auto_enter: true }]] }
      const wrapper = trackWrapper(mount(KeyboardTab))

      expect(wrapper.find('[data-kb-id="pasteTerminal"]').exists()).toBe(false)
      await wrapper.get('.ak-wyg-label').trigger('click')
      const kindSelect = wrapper
        .findAll('.ak-modal select')
        .find((select) => select.find('option[value="action"]').exists())!
      await kindSelect.setValue('action')
      await nextTick()

      const actionSelect = wrapper
        .findAll('.ak-modal select')
        .find((select) => select.find('option[value="pasteTerminal"]').exists())!
      const pasteOption = actionSelect.find('option[value="pasteTerminal"]')
      expect(pasteOption.text()).toBe('Paste')

      await actionSelect.setValue('pasteTerminal')
      await nextTick()
      const autoEnter = wrapper.get<HTMLInputElement>(
        '.ak-modal .shortcut-check input[type="checkbox"]',
      )
      expect(autoEnter.element.checked).toBe(true)
      await autoEnter.setValue(false)
      await wrapper.get('.ak-modal .settings-save').trigger('click')

      expect(settings.action_keyboard.rows[0][0]).toMatchObject({
        kind: 'action',
        action: 'pasteTerminal',
        auto_enter: false,
      })
    } finally {
      settings.action_keyboard = previous
    }
  })

  it.each([
    ['term.newline', 'Newline (do not send)'],
    ['term.lineStart', 'Jump to Line Start'],
    ['term.lineEnd', 'Jump to Line End'],
    ['term.deleteToLineStart', 'Delete path or to Line Start'],
  ])('offers %s in the action-key selector without auto_enter', async (id, label) => {
    const previous = settings.action_keyboard
    try {
      settings.action_keyboard = { rows: [[{ label: 'new', send: '', auto_enter: true }]] }
      const wrapper = trackWrapper(mount(KeyboardTab))

      await wrapper.get('.ak-wyg-label').trigger('click')
      const kindSelect = wrapper
        .findAll('.ak-modal select')
        .find((select) => select.find('option[value="action"]').exists())!
      await kindSelect.setValue('action')
      await nextTick()

      const actionSelect = wrapper
        .findAll('.ak-modal select')
        .find((select) => select.find(`option[value="${id}"]`).exists())!
      expect(actionSelect.find(`option[value="${id}"]`).text()).toBe(label)

      await actionSelect.setValue(id)
      await nextTick()
      expect(wrapper.find('.ak-modal .shortcut-check input[type="checkbox"]').exists()).toBe(false)

      await wrapper.get('.ak-modal .settings-save').trigger('click')
      expect(settings.action_keyboard.rows[0][0]).toMatchObject({ kind: 'action', action: id })
      expect(settings.action_keyboard.rows[0][0]).not.toHaveProperty('auto_enter')
    } finally {
      settings.action_keyboard = previous
    }
  })

  it('formats app bindings exactly as before and terminal bindings with literal modifiers', () => {
    const { formatBinding } = useKeybindings()

    expect(formatBinding({ key: 'b', shift: true })).toEqual(['⌘', '⇧', 'B'])
    expect(formatBinding({ key: 'enter', shift: true, meta: false }, 'terminal')).toEqual([
      '⇧',
      '⏎',
    ])
    expect(formatBinding({ key: 'arrowleft', shift: false, meta: true }, 'terminal')).toEqual([
      '⌘',
      '←',
    ])
    expect(formatBinding({ key: 'x', shift: true, ctrl: true, alt: true }, 'terminal')).toEqual([
      '⌃',
      '⌥',
      '⇧',
      'X',
    ])
  })

  it('sends the four terminal default byte sequences', () => {
    const cases = [
      [keyEvent('Enter', { shiftKey: true }), '\x1b\r'],
      [keyEvent('ArrowLeft', { metaKey: true }), '\x01'],
      [keyEvent('ArrowRight', { metaKey: true }), '\x05'],
      [keyEvent('Backspace', { metaKey: true }), '\x15'],
    ] as const

    for (const [event, sequence] of cases) {
      const sendData = vi.fn()
      const stopPropagation = vi.spyOn(event, 'stopPropagation')

      expect(handleTerminalShortcutKeydown(event, sendData)).toBe(true)
      expect(sendData).toHaveBeenCalledWith(sequence)
      expect(event.defaultPrevented).toBe(true)
      expect(stopPropagation).toHaveBeenCalled()
    }
  })

  it('prefers trailing path deletion for terminal delete-to-line-start', () => {
    const pathEvent = keyEvent('Backspace', { metaKey: true })
    const pathSendData = vi.fn()

    expect(
      handleTerminalShortcutKeydown(pathEvent, pathSendData, false, () => 'ls /Users/a/b')
    ).toBe(true)
    expect(pathSendData).toHaveBeenCalledWith('\x7f'.repeat(11))

    const nonPathEvent = keyEvent('Backspace', { metaKey: true })
    const nonPathSendData = vi.fn()

    expect(
      handleTerminalShortcutKeydown(nonPathEvent, nonPathSendData, false, () => 'echo hello')
    ).toBe(true)
    expect(nonPathSendData).toHaveBeenCalledWith('\x15')

    const noGetterEvent = keyEvent('Backspace', { metaKey: true })
    const noGetterSendData = vi.fn()

    expect(handleTerminalShortcutKeydown(noGetterEvent, noGetterSendData)).toBe(true)
    expect(noGetterSendData).toHaveBeenCalledWith('\x15')
  })

  it('keeps terminal Meta shortcuts explicit unless Windows Alt-as-Cmd is active', () => {
    const altLeft = keyEvent('ArrowLeft', { altKey: true })
    const sendWithoutVirtualMeta = vi.fn()

    expect(handleTerminalShortcutKeydown(altLeft, sendWithoutVirtualMeta)).toBe(false)
    expect(sendWithoutVirtualMeta).not.toHaveBeenCalled()

    const windowsAltLeft = keyEvent('ArrowLeft', { altKey: true })
    const sendWithVirtualMeta = vi.fn()
    const stopPropagation = vi.spyOn(windowsAltLeft, 'stopPropagation')

    expect(handleTerminalShortcutKeydown(windowsAltLeft, sendWithVirtualMeta, true)).toBe(true)
    expect(sendWithVirtualMeta).toHaveBeenCalledWith('\x01')
    expect(windowsAltLeft.defaultPrevented).toBe(true)
    expect(stopPropagation).toHaveBeenCalled()
  })

  it('matches shifted physical keys for app shortcuts such as font size up', () => {
    const binding = useKeybindings().getBinding('fontSizeUp')

    expect(keyEventMatchesBinding(keyEvent('+', { code: 'Equal', shiftKey: true }), binding)).toBe(
      true
    )
    expect(
      keyEventMatchesBinding(keyEvent('+', { code: 'NumpadAdd', shiftKey: true }), binding)
    ).toBe(false)
  })

  it('maps Backquote to the unshifted supervise-tabs binding with app modifiers', () => {
    const binding = useKeybindings().getBinding('superviseTabs')

    expect(binding).toEqual({ key: '`', shift: false })
    expect(
      keyEventMatchesBinding(keyEvent('Dead', { code: 'Backquote', metaKey: true }), binding)
    ).toBe(true)
    expect(
      keyEventMatchesBinding(keyEvent('~', { code: 'Backquote', metaKey: true, shiftKey: true }), binding)
    ).toBe(false)
  })

  it('dispatches the supervise-tabs binding through Windows app modifiers', () => {
    settings.windowsAltAsCmd = true
    const dispatch = vi.fn()

    dispatchAppBinding(
      keyEvent('`', { code: 'Backquote', altKey: true }),
      'superviseTabs',
      dispatch
    )
    dispatchAppBinding(
      keyEvent('`', { code: 'Backquote', ctrlKey: true }),
      'superviseTabs',
      dispatch
    )
    dispatchAppBinding(keyEvent('`', { code: 'Backquote' }), 'superviseTabs', dispatch)

    expect(dispatch).toHaveBeenCalledTimes(2)
  })

  it('rejects Windows Ctrl+Alt AltGr while preserving plain Ctrl app shortcuts', () => {
    settings.windowsAltAsCmd = false
    const dispatch = vi.fn()

    dispatchAppBinding(
      keyEvent('t', { ctrlKey: true, altKey: true }),
      'newTab',
      dispatch
    )
    dispatchAppBinding(keyEvent('t', { ctrlKey: true }), 'newTab', dispatch)
    dispatchAppBinding(keyEvent('t', { altKey: true }), 'newTab', dispatch)

    expect(dispatch).toHaveBeenCalledOnce()
  })

  it('does not match terminal bindings hand-edited to reserved Ctrl+Shift+C/V', () => {
    const cases = [
      ['term.lineStart', keyEvent('C', { ctrlKey: true, shiftKey: true })],
      ['term.lineEnd', keyEvent('V', { ctrlKey: true, shiftKey: true })],
    ] as const

    for (const [id, event] of cases) {
      settings.keybindings[id] = {
        key: event.key.toLowerCase(),
        shift: true,
        meta: false,
        ctrl: true,
        alt: false,
      }
      const sendData = vi.fn()
      const stopPropagation = vi.spyOn(event, 'stopPropagation')

      expect(handleTerminalShortcutKeydown(event, sendData)).toBe(false)
      expect(sendData).not.toHaveBeenCalled()
      expect(event.defaultPrevented).toBe(false)
      expect(stopPropagation).not.toHaveBeenCalled()
    }
  })

  it('records literal modifiers for terminal shortcuts', async () => {
    await recordKey(
      'term.lineStart',
      keyEvent('x', { shiftKey: true, metaKey: true, ctrlKey: true, altKey: true })
    )

    expect(settings.keybindings['term.lineStart']).toEqual({
      key: 'x',
      shift: true,
      meta: true,
      ctrl: true,
      alt: true,
    })
  })

  it('records app shortcuts with only key and shift', async () => {
    await recordKey(
      'newTab',
      keyEvent('x', { shiftKey: true, metaKey: true, ctrlKey: true, altKey: true })
    )

    expect(settings.keybindings.newTab).toEqual({ key: 'x', shift: true })
  })

  it('rejects bare modifier presses while recording terminal shortcuts', async () => {
    const wrapper = await recordKey('term.lineEnd', keyEvent('Shift', { shiftKey: true }))

    expect(settings.keybindings['term.lineEnd']).toBeUndefined()
    expect(wrapper.find(`[data-kb-id="term.lineEnd"] [data-kb-action="stop"]`).exists()).toBe(true)
  })

  it('rejects terminal bindings reserved for Ctrl+Shift+C/V copy and paste', async () => {
    const wrapper = trackWrapper(mount(KeyboardTab))
    await wrapper.find(`[data-kb-id="term.lineEnd"] [data-kb-action="record"]`).trigger('click')
    await nextTick()

    window.dispatchEvent(keyEvent('C', { ctrlKey: true, shiftKey: true }))
    await nextTick()
    expect(settings.keybindings['term.lineEnd']).toBeUndefined()
    expect(wrapper.text()).toContain('Ctrl+Shift+C/V are reserved')

    window.dispatchEvent(keyEvent('V', { ctrlKey: true, shiftKey: true }))
    await nextTick()
    expect(settings.keybindings['term.lineEnd']).toBeUndefined()
  })

  it('accepts terminal reserved combos when another literal modifier is present', async () => {
    const wrapper = await recordKey(
      'term.lineEnd',
      keyEvent('C', { ctrlKey: true, altKey: true, shiftKey: true })
    )

    expect(settings.keybindings['term.lineEnd']).toEqual({
      key: 'c',
      shift: true,
      meta: false,
      ctrl: true,
      alt: true,
    })
    expect(wrapper.find(`[data-kb-id="term.lineEnd"] [data-kb-action="stop"]`).exists()).toBe(false)
  })

  it('reset restores the terminal default binding', async () => {
    settings.keybindings['term.lineStart'] = {
      key: 'x',
      shift: true,
      meta: false,
      ctrl: true,
      alt: false,
    }
    const wrapper = trackWrapper(mount(KeyboardTab))

    await wrapper.find(`[data-kb-id="term.lineStart"] [data-kb-action="reset"]`).trigger('click')
    await nextTick()

    expect(settings.keybindings['term.lineStart']).toBeUndefined()
    expect(useKeybindings().getBinding('term.lineStart')).toEqual({
      key: 'arrowleft',
      shift: false,
      meta: true,
    })
  })
})
