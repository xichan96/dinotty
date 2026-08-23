import { mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../composables/useUpload', () => ({
  formatMB: () => '0.0',
  useUpload: () => ({ uploadFiles: vi.fn(), uploadErrorStatus: vi.fn() }),
}))

vi.mock('../composables/useTransport', () => ({ isTauri: () => false }))

vi.mock('vue-toastification', () => ({
  POSITION: { BOTTOM_CENTER: 'bottom-center' },
  useToast: () => ({ error: vi.fn(), success: vi.fn() }),
}))

vi.mock('../composables/useHistory', async () => {
  const { ref } = await vi.importActual<typeof import('vue')>('vue')
  return {
    useHistory: () => ({
      suggestions: ref([]),
      fetchSuggestions: vi.fn(),
      fetchDebounced: vi.fn(),
    }),
  }
})

vi.mock('../composables/apiBase', () => ({
  apiUrl: (path: string) => path,
  authFetch: vi.fn(async () => ({ ok: true, json: async () => [] })),
  getApiBase: vi.fn(async () => 'http://127.0.0.1:7681'),
  hasAuthToken: vi.fn(() => false),
}))

import MobileKeyboard from '../components/keyboard/MobileKeyboard.vue'
import { settings } from '../composables/useSettings'
import { makeMobileKeyboardCtx } from './helpers/makeMobileKeyboardCtx'

let wrapper: VueWrapper | undefined

beforeEach(() => {
  settings.action_keyboard = {
    rows: [
      [
        { label: 'Ctrl once', kind: 'send', special: 'ctrl', display: 'text' },
        { label: 'Shift hold', kind: 'send', special: 'shift:lock', display: 'text' },
        { label: 'c', kind: 'send', send: 'c' },
      ],
    ],
    bottom: { rows: [], enter: { label: 'Enter', kind: 'send', send: '\r' } },
  }
})

afterEach(() => {
  wrapper?.unmount()
  wrapper = undefined
  settings.action_keyboard = null
})

function mountKeyboard(send: (...args: unknown[]) => unknown) {
  const harness = makeMobileKeyboardCtx({
    visible: true,
    sendActive: (data) => Promise.resolve(send(data)) as Promise<void>,
  })
  wrapper = mount(MobileKeyboard, {
    props: { ctx: harness.ctx },
    global: {
      stubs: {
        SuggestionBar: true,
        HistoryPanel: true,
        FilePickerModal: true,
      },
    },
  })
  return wrapper
}

describe('MobileKeyboard modifier buttons', () => {
  it('releases once modifiers after a combination and keeps persistent modifiers held', async () => {
    const send = vi.fn()
    wrapper = mountKeyboard(send)

    const buttons = wrapper.findAll('#mkb-action-panel .mkb-btn')
    expect(buttons.map((button) => button.text())).toEqual([
      '',
      'Ctrl once',
      'Shift hold',
      'c',
      'Enter',
    ])
    const [ctrlHold, shiftHold, c] = buttons.slice(1)

    await ctrlHold.trigger('mousedown')
    await shiftHold.trigger('mousedown')
    expect(ctrlHold.classes()).toContain('mkb-active')
    expect(shiftHold.classes()).toContain('mkb-active')
    expect(ctrlHold.classes()).not.toContain('mkb-locked')
    expect(shiftHold.classes()).toContain('mkb-locked')
    expect(ctrlHold.attributes('aria-pressed')).toBe('true')
    expect(shiftHold.attributes('aria-pressed')).toBe('true')

    await c.trigger('mousedown')
    expect(send).toHaveBeenLastCalledWith('\x03')
    expect(ctrlHold.classes()).not.toContain('mkb-active')
    expect(shiftHold.classes()).toContain('mkb-active')

    await shiftHold.trigger('mousedown')
    expect(shiftHold.classes()).not.toContain('mkb-active')
  })

  it('highlights the chosen Cmd/Win alias without activating its sibling', async () => {
    settings.action_keyboard = {
      rows: [
        [
          { label: 'Cmd', kind: 'send', special: 'cmd:lock', display: 'text' },
          { label: 'Win', kind: 'send', special: 'win:lock', display: 'text' },
        ],
      ],
      bottom: { rows: [], enter: { label: 'Enter', kind: 'send', send: '\r' } },
    }
    wrapper = mountKeyboard(() => {})
    const buttons = wrapper.findAll('#mkb-action-panel .mkb-btn')
    const cmd = buttons.find((button) => button.text() === 'Cmd')!
    const win = buttons.find((button) => button.text() === 'Win')!

    await cmd.trigger('mousedown')
    expect(cmd.classes()).toContain('mkb-active')
    expect(win.classes()).not.toContain('mkb-active')

    await cmd.trigger('mousedown')
    await win.trigger('mousedown')
    expect(cmd.classes()).not.toContain('mkb-active')
    expect(win.classes()).toContain('mkb-active')
  })
})
