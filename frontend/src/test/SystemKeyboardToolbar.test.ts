import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../composables/useSyncWebSocket', () => ({
  onEvent: () => () => {},
  getClientId: () => 'test-client',
  onSuggestions: () => () => {},
  sendSuggestionsRequest: vi.fn(),
}))

import SystemKeyboardToolbar from '../components/keyboard/SystemKeyboardToolbar.vue'
import { settings } from '../composables/useSettings'

beforeEach(() => {
  settings.locale = 'en'
  settings.toolbar_quick_keys = []
  settings.system_keyboard = null
})

afterEach(() => {
  document.body.replaceChildren()
  vi.restoreAllMocks()
})

function mountToolbar(actionOpen = false, send = vi.fn()) {
  return mount(SystemKeyboardToolbar, {
    attachTo: document.body,
    props: {
      visible: true,
      paneId: 'pane-1',
      actionOpen,
      imeOpen: true,
      getSendFn: () => send,
    },
    global: {
      stubs: { HistoryPanel: true },
    },
  })
}

describe('SystemKeyboardToolbar', () => {
  it('keeps the existing fixed-toolbar height owner so terminal content is not covered', () => {
    const app = readFileSync(join(process.cwd(), 'src/App.vue'), 'utf8')
    const toolbar = readFileSync(
      join(process.cwd(), 'src/components/keyboard/SystemKeyboardToolbar.vue'),
      'utf8'
    )
    const css = readFileSync(join(process.cwd(), 'src/styles/mobile-keyboard.css'), 'utf8')

    expect(toolbar).toContain("style.setProperty('--mkb-height'")
    expect(toolbar).toContain('new ResizeObserver(updateHeight)')
    expect(css).toMatch(/#system-mobile-kb\s*\{[^}]*position:\s*fixed/s)
    expect(app).toContain('var(--mkb-height, 0px)')
  })

  it('renders the exact custom upper and lower regions without fixed functional slots', () => {
    settings.system_keyboard = {
      upper: [
        { label: 'custom-upper', send: 'u' },
        { label: 'wide-upper', send: 'w', grow: 2 },
      ],
      pages: [[{ label: 'custom-lower', send: 'l' }]],
      lower_enabled: true,
      upper_pinned: 1,
      lower_pinned: 1,
    }

    const wrapper = mountToolbar()

    expect(wrapper.find('.system-kb-upper-shell').text()).toContain('custom-upper')
    expect(wrapper.find('.system-kb-lower-shell').text()).toContain('custom-lower')
    expect(wrapper.find('.system-kb-upper-shell').text()).not.toContain('History')
    expect(wrapper.find('.system-kb-ime-toggle').exists()).toBe(true)
    expect(wrapper.findAll('.system-kb-pinned-key')).toHaveLength(2)
    expect(wrapper.find('.system-kb-pinned-key').attributes('style')).toContain('span 3')
    expect(
      wrapper.find('.system-kb-upper-pager > .system-kb-grid-key').attributes('style')
    ).toContain('span 2')
    wrapper.unmount()
  })

  it('keeps the lower pinned prefix fixed while only the remainder changes page', async () => {
    settings.system_keyboard = {
      upper: [],
      pages: [
        [
          { label: 'lower-pin', send: 'p', grow: 2 },
          { label: 'page-one', send: '1', grow: 8 },
          { label: 'page-two', send: '2', grow: 8 },
        ],
      ],
      lower_enabled: true,
      upper_pinned: 0,
      lower_pinned: 1,
    }
    const wrapper = mountToolbar()

    expect(wrapper.get('.system-kb-lower-shell > .system-kb-pinned-key').text()).toContain(
      'lower-pin'
    )
    expect(wrapper.get('.system-kb-lower-pager').text()).toContain('page-one')
    await wrapper.findAll('.system-kb-page-dot-group.lower .system-kb-page-dot')[1].trigger('click')
    expect(wrapper.get('.system-kb-lower-shell > .system-kb-pinned-key').text()).toContain(
      'lower-pin'
    )
    expect(wrapper.get('.system-kb-lower-pager').text()).toContain('page-two')
    wrapper.unmount()
  })

  it('visually distinguishes runtime pinned upper keys from pageable keys', () => {
    const css = readFileSync(join(process.cwd(), 'src/styles/mobile-keyboard.css'), 'utf8')

    expect(css).toMatch(
      /\.system-kb-pinned-key \.mkb-btn(?:,\s*\.system-kb-ime-toggle)?\s*\{[^}]*border-color:[^}]*var\(--accent\)[^}]*background:[^}]*var\(--accent\)/s
    )
  })

  it('gives the fixed IME toggle the same accent treatment as pinned keys', () => {
    const css = readFileSync(join(process.cwd(), 'src/styles/mobile-keyboard.css'), 'utf8')

    expect(css).toMatch(
      /\.system-kb-pinned-key \.mkb-btn,\s*\.system-kb-ime-toggle\s*\{[^}]*border-color:[^}]*var\(--accent\)[^}]*background:[^}]*var\(--accent\)/s
    )
  })

  it('uses resettable factory actions, keeps only the IME toggle pinned, and retains upload input', () => {
    const wrapper = mountToolbar()
    const controls = wrapper.findAll('.system-kb-upper-pager .mkb-btn')

    expect(controls).toHaveLength(4)
    expect(controls.map((control) => control.attributes('aria-label'))).toEqual([
      'History',
      'Bookmarks',
      'Extended keyboard',
      'Shortcut keyboard',
    ])
    expect(wrapper.findAll('.system-kb-ime-toggle')).toHaveLength(1)
    expect(wrapper.find('input[type="file"]').exists()).toBe(true)
    wrapper.unmount()
  })

  it('opens the Termius-style extended keyboard from the icon button', async () => {
    const send = vi.fn()
    const wrapper = mountToolbar(false, send)
    const extendedButton = wrapper.findAll('.system-kb-upper-pager .mkb-btn')[2]

    await extendedButton.trigger('mousedown')
    expect(wrapper.emitted('update:actionOpen')).toContainEqual([true])

    await wrapper.setProps({ actionOpen: true })
    const backButton = wrapper.find('.system-kb-action-header button')
    expect(backButton.text()).toBe('')
    expect(backButton.attributes('aria-label')).toBe('System keyboard')
    const rows = wrapper.findAll('#system-termius-key-panel .mkb-row')
    expect(rows).toHaveLength(8)
    expect(rows.map((row) => row.findAll('.mkb-btn').map((key) => key.text()))).toEqual([
      ['esc', 'tab', 'ctrl', 'alt', '/', '|', '~', '-'],
      ['^C', '^I', '^S', '^Z', 'shift-tab', '?', '/', '|'],
      ['home', 'pgUp', 'pgDn', 'end', '=', ':', ';', '!'],
      ['*', '$', '%', '^', '<', '>', '(', ')'],
      ['{', '}', '[', ']', 'paste', 'del', 'ins', '@'],
      ['F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8'],
      ['F9', 'F10', 'F11', 'F12', '^_', '^L', 'Alt-r', '^X^X'],
      ['^R', '^G', '^N', '^P', '◀', '▲', '▼', '▶'],
    ])
    expect(wrapper.findAll('#system-termius-key-panel .mkb-btn')).toHaveLength(64)

    await rows[2].findAll('.mkb-btn')[1].trigger('mousedown')
    await rows[5].findAll('.mkb-btn')[4].trigger('mousedown')
    await rows[6].findAll('.mkb-btn')[6].trigger('mousedown')
    await rows[7].findAll('.mkb-btn')[4].trigger('mousedown')
    expect(send.mock.calls.map(([data]) => data)).toEqual([
      '\x1b[5~',
      '\x1b[15~',
      '\x1br',
      '\x1b[D',
    ])
    wrapper.unmount()
  })

  it('renders all factory lower keys across reachable pages', async () => {
    const send = vi.fn()
    const wrapper = mountToolbar(false, send)
    let keys = wrapper.findAll('.system-kb-lower-page .mkb-btn')

    expect(keys.map((key) => key.text())).toEqual([
      'Esc',
      'Tab',
      'Ctrl',
      'Alt',
      '/',
      '|',
      '~',
      '-',
      '^C',
    ])

    for (const index of [0, 1, 4, 5, 6, 7, 8]) {
      await keys[index].trigger('mousedown')
    }
    await wrapper.findAll('.system-kb-page-dot-group.lower .system-kb-page-dot')[1].trigger('click')
    keys = wrapper.findAll('.system-kb-lower-page .mkb-btn')
    expect(keys.map((key) => key.text())).toEqual(['^I', '^S', '^Z'])
    for (const key of keys) await key.trigger('mousedown')
    expect(send.mock.calls.map(([data]) => data)).toEqual([
      '\x1b',
      '\x09',
      '/',
      '|',
      '~',
      '-',
      '\x03',
      '\x09',
      '\x13',
      '\x1a',
    ])
    wrapper.unmount()
  })

  it('switches lower pages with a horizontal swipe', async () => {
    const send = vi.fn()
    const wrapper = mountToolbar(false, send)
    const touchedKey = wrapper.findAll('.system-kb-lower-page .mkb-btn')[0]

    await touchedKey.trigger('touchstart', { touches: [{ clientX: 220, clientY: 20 }] })
    await touchedKey.trigger('touchmove', { touches: [{ clientX: 120, clientY: 20 }] })
    await touchedKey.trigger('touchend', { changedTouches: [{ clientX: 120, clientY: 20 }] })

    expect(wrapper.findAll('.system-kb-lower-page .mkb-btn').map((key) => key.text())).toEqual([
      '^I',
      '^S',
      '^Z',
    ])
    expect(send).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('keeps disabled lower data out of the measured surface and centers upper paging', async () => {
    settings.system_keyboard = {
      upper: [
        { label: 'pin', send: 'p', grow: 2 },
        { label: 'upper-one', send: '1', grow: 7 },
        { label: 'upper-two', send: '2', grow: 7 },
      ],
      pages: [[{ label: 'retained-lower', send: 'l', grow: 10 }]],
      lower_enabled: false,
      upper_pinned: 1,
    }
    const wrapper = mountToolbar()

    expect(wrapper.find('.system-kb-lower-page').exists()).toBe(false)
    expect(wrapper.find('.system-kb-page-dots').classes()).toContain('upper-only')
    expect(wrapper.findAll('.system-kb-page-dot-group.upper .system-kb-page-dot')).toHaveLength(2)
    expect(wrapper.find('.system-kb-upper-pager').text()).toContain('upper-one')

    await wrapper.findAll('.system-kb-page-dot-group.upper .system-kb-page-dot')[1].trigger('click')
    expect(wrapper.find('.system-kb-upper-pager').text()).toContain('upper-two')
    expect(wrapper.find('.system-kb-ime-toggle').exists()).toBe(true)
    expect(settings.system_keyboard.pages[0][0].label).toBe('retained-lower')
    wrapper.unmount()
  })

  it('keeps xterm focus when a toolbar control is pressed', async () => {
    const textarea = document.createElement('textarea')
    textarea.className = 'xterm-helper-textarea'
    document.body.appendChild(textarea)
    textarea.focus()
    const wrapper = mountToolbar()

    await wrapper.findAll('.system-kb-upper-pager .mkb-btn')[3].trigger('pointerdown')

    expect(document.activeElement).toBe(textarea)
    wrapper.unmount()
  })

  it('opens the existing full action keyboard and requests xterm focus when returning', async () => {
    const wrapper = mountToolbar()

    await wrapper.findAll('.system-kb-upper-pager .mkb-btn')[3].trigger('mousedown')
    expect(wrapper.emitted('update:actionOpen')).toContainEqual([true])

    await wrapper.setProps({ actionOpen: true })
    await wrapper.find('.system-kb-action-header button').trigger('click')
    expect(wrapper.emitted('update:actionOpen')).toContainEqual([false])
    expect(wrapper.emitted('focus-xterm')).toHaveLength(1)
    wrapper.unmount()
  })

  it('keeps multiple toggle-held modifiers visibly active across combinations', async () => {
    settings.system_keyboard = {
      upper: [],
      pages: [
        [
          { label: 'Ctrl', kind: 'send', special: 'ctrl:lock', display: 'text' },
          { label: 'Shift', kind: 'send', special: 'shift:lock', display: 'text' },
          { label: 'c', kind: 'send', send: 'c' },
        ],
      ],
      lower_enabled: true,
      upper_pinned: 0,
    }
    const send = vi.fn()
    const wrapper = mountToolbar(false, send)

    const keys = wrapper.findAll('.system-kb-lower-page .mkb-btn')
    await keys[0].trigger('mousedown')
    await keys[1].trigger('mousedown')

    expect(keys[0].classes()).toContain('mkb-active')
    expect(keys[1].classes()).toContain('mkb-active')
    expect(keys[0].classes()).toContain('mkb-locked')
    expect(keys[1].classes()).toContain('mkb-locked')
    expect(keys[0].attributes('aria-pressed')).toBe('true')
    expect(keys[1].attributes('aria-pressed')).toBe('true')
    expect(wrapper.emitted('modifier-change')).toContainEqual([
      { ctrl: 'locked', shift: 'locked', alt: 'off', meta: 'off' },
    ])

    await keys[2].trigger('mousedown')
    expect(send).toHaveBeenCalledWith('\x03')
    expect(keys[0].classes()).toContain('mkb-active')
    expect(keys[1].classes()).toContain('mkb-active')

    await keys[0].trigger('mousedown')
    expect(keys[0].classes()).not.toContain('mkb-active')
    expect(keys[1].classes()).toContain('mkb-active')
    expect(keys[1].classes()).toContain('mkb-locked')
    wrapper.unmount()
  })

  it('uses an unsuffixed modifier once and releases it after the next key', async () => {
    settings.system_keyboard = {
      upper: [],
      pages: [
        [
          { label: 'Legacy Ctrl', kind: 'send', special: 'ctrl', display: 'text' },
          { label: 'c', kind: 'send', send: 'c' },
        ],
      ],
      lower_enabled: true,
      upper_pinned: 0,
    }
    const send = vi.fn()
    const wrapper = mountToolbar(false, send)

    const [ctrl, c] = wrapper.findAll('.system-kb-lower-page .mkb-btn')
    await ctrl.trigger('mousedown')
    expect(ctrl.classes()).toContain('mkb-active')
    expect(ctrl.classes()).not.toContain('mkb-locked')
    await c.trigger('mousedown')

    expect(ctrl.classes()).not.toContain('mkb-active')
    expect(ctrl.attributes('aria-pressed')).toBe('false')
    expect(send).toHaveBeenCalledTimes(1)
    expect(send).toHaveBeenCalledWith('\x03')
    expect(wrapper.emitted('modifier-change')).toContainEqual([
      { ctrl: 'off', shift: 'off', alt: 'off', meta: 'off' },
    ])
    wrapper.unmount()
  })

  it('omits an empty pager so a pinned nine-unit key and fixed toggle stay in ten columns', () => {
    settings.system_keyboard = {
      upper: [{ label: 'wide pin', send: 'x', grow: 9 }],
      pages: [[]],
      lower_enabled: false,
      upper_pinned: 1,
    }

    const wrapper = mountToolbar()

    expect(wrapper.find('.system-kb-upper-pager').exists()).toBe(false)
    expect(wrapper.get('.system-kb-pinned-key').attributes('style')).toContain('span 9')
    expect(wrapper.findAll('.system-kb-ime-toggle')).toHaveLength(1)
    wrapper.unmount()
  })

  it('uses the pinned structural button only to request an IME toggle', async () => {
    const wrapper = mountToolbar()

    await wrapper.get('.system-kb-ime-toggle').trigger('click')

    expect(wrapper.emitted('toggle-ime')).toHaveLength(1)
    expect(wrapper.emitted('dismiss')).toBeUndefined()
    wrapper.unmount()
  })
})
