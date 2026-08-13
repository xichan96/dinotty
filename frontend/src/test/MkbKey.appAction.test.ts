import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import MkbKey from '../components/keyboard/MkbKey.vue'

vi.mock('../composables/useSettings', () => ({
  settings: { keyboard_sound: false },
}))

describe('MkbKey app-action options', () => {
  afterEach(() => vi.useRealTimers())

  it.each([true, false])(
    'emits the key autoEnter=%s value with the action id',
    async (autoEnter) => {
      const wrapper = mount(MkbKey, {
        props: {
          k: { l: 'Paste', act: 'pasteTerminal', autoEnter },
          state: { shift: false, ctrl: false, alt: false, meta: false },
        },
      })

      await wrapper.trigger('mousedown')

      expect(wrapper.emitted('app-action')).toEqual([['pasteTerminal', { autoEnter }]])
      wrapper.unmount()
    }
  )

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
        state: { shift: false, ctrl: false, alt: false, meta: false },
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
        state: { shift: false, ctrl: false, alt: false, meta: false },
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

  it('defers a swipe-aware touch until release and cancels it after horizontal movement', async () => {
    const wrapper = mount(MkbKey, {
      props: {
        k: { l: 'Danger', act: 'closeTab' },
        state: { shift: false, ctrl: false, alt: false, meta: false },
        swipeAware: true,
      },
    })

    await wrapper.trigger('touchstart', { touches: [{ clientX: 180, clientY: 20 }] })
    expect(wrapper.emitted('app-action')).toBeUndefined()
    await wrapper.trigger('touchmove', { touches: [{ clientX: 100, clientY: 22 }] })
    await wrapper.trigger('touchend', { changedTouches: [{ clientX: 100, clientY: 22 }] })
    expect(wrapper.emitted('app-action')).toBeUndefined()

    await wrapper.trigger('touchstart', { touches: [{ clientX: 120, clientY: 20 }] })
    await wrapper.trigger('touchend', { changedTouches: [{ clientX: 120, clientY: 20 }] })
    expect(wrapper.emitted('app-action')).toEqual([['closeTab', {}]])
    wrapper.unmount()
  })

  it('starts swipe-aware long-press repeat at the hold threshold and stops on release', async () => {
    vi.useFakeTimers()
    const wrapper = mount(MkbKey, {
      props: {
        k: { l: 'New tab', act: 'newTab', repeat: true },
        state: { shift: false, ctrl: false, alt: false, meta: false },
        swipeAware: true,
      },
    })

    await wrapper.trigger('touchstart', { touches: [{ clientX: 80, clientY: 20 }] })
    expect(wrapper.emitted('app-action')).toBeUndefined()
    await vi.advanceTimersByTimeAsync(400)
    expect(wrapper.emitted('app-action')).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(160)
    expect(wrapper.emitted('app-action')!.length).toBeGreaterThan(2)

    await wrapper.trigger('touchend', { changedTouches: [{ clientX: 80, clientY: 20 }] })
    const countAfterRelease = wrapper.emitted('app-action')!.length
    await vi.advanceTimersByTimeAsync(240)
    expect(wrapper.emitted('app-action')).toHaveLength(countAfterRelease)
    wrapper.unmount()
  })
})
