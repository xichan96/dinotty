import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import MkbKey from '../components/keyboard/MkbKey.vue'

vi.mock('../composables/useSettings', () => ({
  settings: { keyboard_sound: false },
}))

describe('MkbKey app-action options', () => {
  it.each([true, false])('emits the key autoEnter=%s value with the action id', async (autoEnter) => {
    const wrapper = mount(MkbKey, {
      props: {
        k: { l: 'Paste', act: 'pasteTerminal', autoEnter },
        state: { shift: false, ctrl: false, alt: false },
      },
    })

    await wrapper.trigger('mousedown')

    expect(wrapper.emitted('app-action')).toEqual([
      ['pasteTerminal', { autoEnter }],
    ])
    wrapper.unmount()
  })

  it.each([
    'searchTerminal',
    'newTab',
    'term.newline',
    'term.lineStart',
    'term.lineEnd',
    'term.deleteToLineStart',
  ])('emits no autoEnter option for %s', async (action) => {
    const wrapper = mount(MkbKey, {
      props: {
        k: { l: action, act: action, autoEnter: true },
        state: { shift: false, ctrl: false, alt: false },
      },
    })

    await wrapper.trigger('mousedown')

    expect(wrapper.emitted('app-action')).toEqual([[action, {}]])
    wrapper.unmount()
  })
})
