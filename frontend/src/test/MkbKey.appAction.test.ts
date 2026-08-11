import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import MkbKey from '../components/keyboard/MkbKey.vue'

vi.mock('../composables/useSettings', () => ({
  settings: { keyboard_sound: false },
}))

describe('MkbKey app-action options', () => {
  afterEach(() => vi.useRealTimers())

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

  it('repeats an opted-in app action and stops on release', async () => {
    vi.useFakeTimers()
    const wrapper = mount(MkbKey, {
      props: {
        k: { l: 'New tab', act: 'newTab', repeat: true },
        state: { shift: false, ctrl: false, alt: false },
      },
    })

    await wrapper.trigger('mousedown')
    expect(wrapper.emitted('app-action')).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(560)
    expect(wrapper.emitted('app-action')!.length).toBeGreaterThan(2)

    await wrapper.trigger('mouseup')
    const countAfterRelease = wrapper.emitted('app-action')!.length
    await vi.advanceTimersByTimeAsync(240)
    expect(wrapper.emitted('app-action')).toHaveLength(countAfterRelease)
    wrapper.unmount()
  })

  it('cancels pending action repeat when the key unmounts', async () => {
    vi.useFakeTimers()
    const wrapper = mount(MkbKey, {
      props: {
        k: { l: 'Close tab', act: 'closeTab', repeat: true },
        state: { shift: false, ctrl: false, alt: false },
      },
    })

    await wrapper.trigger('mousedown')
    expect(wrapper.emitted('app-action')).toHaveLength(1)
    const emissions = wrapper.emitted('app-action')!
    wrapper.unmount()
    await vi.advanceTimersByTimeAsync(640)
    expect(emissions).toHaveLength(1)
  })
})
