import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import { nextTick } from 'vue'
import ConfirmModal from '../components/ui/ConfirmModal.vue'
import { settings } from '../composables/useSettings'

const wrappers: VueWrapper[] = []

function mountModal(visible = true) {
  const wrapper = mount(ConfirmModal, {
    props: {
      visible,
      title: 'Close tab',
      message: 'Close this tab?',
      confirmText: 'Close',
      cancelText: 'Cancel',
    },
  })
  wrappers.push(wrapper)
  return wrapper
}

function dispatchKey(init: KeyboardEventInit & { keyCode?: number }) {
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })
  if (init.keyCode !== undefined) {
    Object.defineProperty(event, 'keyCode', { value: init.keyCode })
  }
  window.dispatchEvent(event)
  return event
}

describe('ConfirmModal keyboard support', () => {
  beforeEach(() => {
    settings.space_confirms_dialogs = false
  })

  afterEach(() => {
    while (wrappers.length > 0) wrappers.pop()!.unmount()
    document.body.innerHTML = ''
    vi.restoreAllMocks()
  })

  it('visible=true + Escape emits cancel', async () => {
    const wrapper = mountModal()

    dispatchKey({ key: 'Escape' })
    await nextTick()

    expect(wrapper.emitted('cancel')).toHaveLength(1)
    expect(wrapper.emitted('confirm')).toBeUndefined()
  })

  it('visible=false + Escape does not emit cancel', async () => {
    const wrapper = mountModal(false)

    dispatchKey({ key: 'Escape' })
    await nextTick()

    expect(wrapper.emitted('cancel')).toBeUndefined()
    expect(wrapper.emitted('confirm')).toBeUndefined()
  })

  it('hidden state ignores Arrow, Tab, Enter, and Escape', async () => {
    const wrapper = mountModal(false)

    for (const key of ['ArrowRight', 'Tab', 'Enter', 'Escape']) dispatchKey({ key })
    await nextTick()

    expect(wrapper.emitted('confirm')).toBeUndefined()
    expect(wrapper.emitted('cancel')).toBeUndefined()
  })

  it('Enter activates the initially highlighted cancel button', async () => {
    const wrapper = mountModal()

    dispatchKey({ key: 'Enter' })
    await nextTick()

    expect(wrapper.emitted('cancel')).toHaveLength(1)
    expect(wrapper.emitted('confirm')).toBeUndefined()
  })

  it('ArrowRight then Enter emits confirm', async () => {
    const wrapper = mountModal()

    dispatchKey({ key: 'ArrowRight' })
    dispatchKey({ key: 'Enter' })
    await nextTick()

    expect(wrapper.emitted('confirm')).toHaveLength(1)
    expect(wrapper.emitted('cancel')).toBeUndefined()
  })

  it('ArrowRight then ArrowLeft then Enter returns to cancel', async () => {
    const wrapper = mountModal()

    dispatchKey({ key: 'ArrowRight' })
    dispatchKey({ key: 'ArrowLeft' })
    dispatchKey({ key: 'Enter' })
    await nextTick()

    expect(wrapper.emitted('cancel')).toHaveLength(1)
    expect(wrapper.emitted('confirm')).toBeUndefined()
  })

  it('Tab toggles from cancel to confirm', async () => {
    const wrapper = mountModal()

    dispatchKey({ key: 'Tab' })
    dispatchKey({ key: 'Enter' })
    await nextTick()

    expect(wrapper.emitted('confirm')).toHaveLength(1)
    expect(wrapper.emitted('cancel')).toBeUndefined()
  })

  it('removes the keydown listener on unmount', () => {
    const removeSpy = vi.spyOn(window, 'removeEventListener')
    const wrapper = mountModal(false)

    wrapper.unmount()
    wrappers.splice(wrappers.indexOf(wrapper), 1)

    expect(removeSpy).toHaveBeenCalledWith('keydown', expect.any(Function), true)
  })

  it('handles Escape after visible changes from false to true', async () => {
    const wrapper = mountModal(false)

    await wrapper.setProps({ visible: true })
    dispatchKey({ key: 'Escape' })
    await nextTick()

    expect(wrapper.emitted('cancel')).toHaveLength(1)
  })

  it('does not intercept Space when the setting is off', () => {
    const wrapper = mountModal()

    const event = dispatchKey({ key: ' ' })

    expect(wrapper.emitted('confirm')).toBeUndefined()
    expect(event.defaultPrevented).toBe(false)
  })

  it('confirms once and prevents every repeated Space while visible', () => {
    settings.space_confirms_dialogs = true
    const wrapper = mountModal()

    const first = dispatchKey({ key: ' ' })
    const repeated = dispatchKey({ key: ' ', repeat: true })

    expect(wrapper.emitted('confirm')).toHaveLength(1)
    expect(first.defaultPrevented).toBe(true)
    expect(repeated.defaultPrevented).toBe(true)
  })

  it('Space confirms directly even when cancel is highlighted', () => {
    settings.space_confirms_dialogs = true
    const wrapper = mountModal()

    dispatchKey({ key: ' ' })

    expect(wrapper.emitted('confirm')).toHaveLength(1)
    expect(wrapper.emitted('cancel')).toBeUndefined()
  })

  it.each([
    ['Shift', { shiftKey: true }],
    ['Control', { ctrlKey: true }],
    ['Alt', { altKey: true }],
    ['Meta', { metaKey: true }],
  ])('does not intercept %s+Space', (_name, modifier) => {
    settings.space_confirms_dialogs = true
    const wrapper = mountModal()

    const event = dispatchKey({ key: ' ', ...modifier })

    expect(wrapper.emitted('confirm')).toBeUndefined()
    expect(event.defaultPrevented).toBe(false)
  })

  it.each([
    ['isComposing', { key: ' ', isComposing: true }],
    ['keyCode 229', { key: ' ', keyCode: 229 }],
    ['Process key', { key: 'Process' }],
  ])('does not intercept Space during IME composition via %s', (_name, keyInit) => {
    settings.space_confirms_dialogs = true
    const wrapper = mountModal()

    const event = dispatchKey(keyInit)

    expect(wrapper.emitted('confirm')).toBeUndefined()
    expect(event.defaultPrevented).toBe(false)
  })

  it('resets the one-shot latch on the next visible cycle', async () => {
    settings.space_confirms_dialogs = true
    const wrapper = mountModal()

    dispatchKey({ key: ' ' })
    await wrapper.setProps({ visible: false })
    await wrapper.setProps({ visible: true })
    dispatchKey({ key: ' ' })

    expect(wrapper.emitted('confirm')).toHaveLength(2)
  })

  it('reads a live setting change while the dialog is open', () => {
    const wrapper = mountModal()

    settings.space_confirms_dialogs = true
    dispatchKey({ key: ' ' })

    expect(wrapper.emitted('confirm')).toHaveLength(1)
  })

  it('only confirms the last-opened visible modal', () => {
    settings.space_confirms_dialogs = true
    const lower = mountModal()
    const top = mountModal()

    dispatchKey({ key: ' ' })

    expect(lower.emitted('confirm')).toBeUndefined()
    expect(top.emitted('confirm')).toHaveLength(1)
  })

  it('confirms the previous modal after the top modal unmounts', () => {
    const lower = mountModal()
    const top = mountModal()

    top.unmount()
    settings.space_confirms_dialogs = true
    dispatchKey({ key: ' ' })

    expect(lower.emitted('confirm')).toHaveLength(1)
  })

  it('does not intercept Space on buttons or editable elements inside the modal', () => {
    settings.space_confirms_dialogs = true
    const wrapper = mountModal()
    const root = document.querySelector<HTMLElement>('.dialog')!
    const editable = document.createElement('div')
    editable.setAttribute('contenteditable', 'true')
    editable.tabIndex = 0
    root.appendChild(editable)

    const controls = [...root.querySelectorAll<HTMLElement>('button'), editable]
    for (const control of controls) {
      control.focus()
      const event = dispatchKey({ key: ' ' })
      expect(event.defaultPrevented).toBe(false)
    }

    expect(wrapper.emitted('confirm')).toBeUndefined()
  })

  it('stops a later competing window capture listener', () => {
    settings.space_confirms_dialogs = true
    const wrapper = mountModal()
    const competingListener = vi.fn()
    window.addEventListener('keydown', competingListener, true)

    dispatchKey({ key: ' ' })

    expect(wrapper.emitted('confirm')).toHaveLength(1)
    expect(competingListener).not.toHaveBeenCalled()
    window.removeEventListener('keydown', competingListener, true)
  })
})
