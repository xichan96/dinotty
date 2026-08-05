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
})

afterEach(() => {
  document.body.replaceChildren()
})

function mountToolbar(actionOpen = false, send = vi.fn()) {
  return mount(SystemKeyboardToolbar, {
    attachTo: document.body,
    props: {
      visible: true,
      paneId: 'pane-1',
      actionOpen,
      getSendFn: () => send,
    },
    global: {
      stubs: { HistoryPanel: true },
    },
  })
}

describe('SystemKeyboardToolbar', () => {
  it('shows only history, favorites, extended keys, shortcut keyboard, and dismiss', () => {
    const wrapper = mountToolbar()
    const controls = wrapper.findAll('.system-kb-tool-row > .system-kb-tool')

    expect(controls.map((control) => control.attributes('title'))).toEqual([
      'History',
      'Favorites',
      'Extended keyboard',
      'Shortcut keyboard',
      'Dismiss system keyboard',
    ])
    expect(wrapper.find('.system-kb-extended-icon').classes()).toContain('lucide-layout-grid')
    const actionIcon = wrapper.find('.system-kb-action-icon')
    expect(actionIcon.attributes('width')).toBe('20')
    expect(actionIcon.attributes('height')).toBe('20')
    expect(wrapper.find('input[type="file"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('opens the Termius-style extended keyboard from the icon button', async () => {
    const send = vi.fn()
    const wrapper = mountToolbar(false, send)
    const extendedButton = wrapper.findAll('.system-kb-tool-row > .system-kb-tool')[2]

    await extendedButton.trigger('click')
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

  it('matches the Termius shortcut strip and sends the expected terminal sequences', async () => {
    const send = vi.fn()
    const wrapper = mountToolbar(false, send)
    const keys = wrapper.findAll('.system-kb-shortcut-strip .mkb-btn')

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
      '^I',
      '^S',
      '^Z',
    ])

    for (const index of [0, 1, 4, 5, 6, 7, 8, 9, 10, 11]) {
      await keys[index].trigger('mousedown')
    }
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

  it('keeps xterm focus when a toolbar control is pressed', async () => {
    const textarea = document.createElement('textarea')
    textarea.className = 'xterm-helper-textarea'
    document.body.appendChild(textarea)
    textarea.focus()
    const wrapper = mountToolbar()

    await wrapper.find('.system-kb-action-toggle').trigger('pointerdown')

    expect(document.activeElement).toBe(textarea)
    wrapper.unmount()
  })

  it('opens the existing full action keyboard and requests xterm focus when returning', async () => {
    const wrapper = mountToolbar()

    await wrapper.find('.system-kb-action-toggle').trigger('click')
    expect(wrapper.emitted('update:actionOpen')).toContainEqual([true])

    await wrapper.setProps({ actionOpen: true })
    await wrapper.find('.system-kb-action-header button').trigger('click')
    expect(wrapper.emitted('update:actionOpen')).toContainEqual([false])
    expect(wrapper.emitted('focus-xterm')).toHaveLength(1)
    wrapper.unmount()
  })

  it('publishes sticky Ctrl state for the next system keyboard character', async () => {
    const wrapper = mountToolbar()

    await wrapper.find('#system-kb-ctrl').trigger('mousedown')

    expect(wrapper.emitted('modifier-change')).toContainEqual([{ ctrl: true, alt: false }])
    wrapper.unmount()
  })
})
