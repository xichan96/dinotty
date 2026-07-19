import { describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import SegmentedControl from '../components/ui/SegmentedControl.vue'

const options = [
  { value: 'off', label: 'Off' },
  { value: 'tab', label: 'Tab' },
  { value: 'icon', label: 'Icon' },
  { value: 'both', label: 'Both' },
]

describe('SegmentedControl', () => {
  it('renders one button for each option', () => {
    const wrapper = mount(SegmentedControl, { props: { modelValue: 'off', options } })

    expect(wrapper.findAll('button').map((button) => button.text())).toEqual([
      'Off',
      'Tab',
      'Icon',
      'Both',
    ])
    expect(wrapper.attributes('role')).toBe('radiogroup')
    expect(wrapper.findAll('button').map((button) => button.attributes('role'))).toEqual([
      'radio',
      'radio',
      'radio',
      'radio',
    ])
  })

  it('emits the clicked option value', async () => {
    const wrapper = mount(SegmentedControl, { props: { modelValue: 'off', options } })

    await wrapper.findAll('button')[2].trigger('click')

    expect(wrapper.emitted('update:modelValue')).toEqual([['icon']])
  })

  it('marks only the selected option with aria-checked', () => {
    const wrapper = mount(SegmentedControl, { props: { modelValue: 'tab', options } })

    expect(wrapper.findAll('button').map((button) => button.attributes('aria-checked'))).toEqual([
      'false',
      'true',
      'false',
      'false',
    ])
  })

  it('uses a roving tabindex for the selected option', () => {
    const wrapper = mount(SegmentedControl, { props: { modelValue: 'icon', options } })

    expect(wrapper.findAll('button').map((button) => button.attributes('tabindex'))).toEqual([
      '-1',
      '-1',
      '0',
      '-1',
    ])
  })

  it('makes the first option focusable when the value matches no option', () => {
    const wrapper = mount(SegmentedControl, { props: { modelValue: 'missing', options } })

    expect(wrapper.findAll('button').map((button) => button.attributes('tabindex'))).toEqual([
      '0',
      '-1',
      '-1',
      '-1',
    ])
  })

  it('applies the selected class only to the selected option', () => {
    const wrapper = mount(SegmentedControl, { props: { modelValue: 'icon', options } })

    expect(wrapper.findAll('button').map((button) => button.classes('selected'))).toEqual([
      false,
      false,
      true,
      false,
    ])
  })

  it('moves with arrow keys without wrapping at the ends', async () => {
    const wrapper = mount(SegmentedControl, { props: { modelValue: 'tab', options } })
    const buttons = wrapper.findAll('button')

    await buttons[1].trigger('keydown', { key: 'ArrowLeft' })
    await buttons[1].trigger('keydown', { key: 'ArrowRight' })
    await buttons[1].trigger('keydown', { key: 'ArrowUp' })
    await buttons[1].trigger('keydown', { key: 'ArrowDown' })
    expect(wrapper.emitted('update:modelValue')).toEqual([['off'], ['icon'], ['off'], ['icon']])

    await wrapper.setProps({ modelValue: 'off' })
    await buttons[0].trigger('keydown', { key: 'ArrowLeft' })
    await wrapper.setProps({ modelValue: 'both' })
    await buttons[3].trigger('keydown', { key: 'ArrowRight' })
    expect(wrapper.emitted('update:modelValue')).toEqual([['off'], ['icon'], ['off'], ['icon']])
  })

  it('moves to the first and last options with Home and End', async () => {
    const wrapper = mount(SegmentedControl, { props: { modelValue: 'tab', options } })
    const buttons = wrapper.findAll('button')

    await buttons[1].trigger('keydown', { key: 'Home' })
    await buttons[1].trigger('keydown', { key: 'End' })

    expect(wrapper.emitted('update:modelValue')).toEqual([['off'], ['both']])
  })

  it('focuses the option selected with the keyboard', async () => {
    const wrapper = mount(SegmentedControl, { props: { modelValue: 'tab', options } })
    const buttons = wrapper.findAll('button')
    const focus = vi.spyOn(buttons[2].element, 'focus')

    await buttons[1].trigger('keydown', { key: 'ArrowRight' })

    expect(wrapper.emitted('update:modelValue')).toEqual([['icon']])
    expect(focus).toHaveBeenCalledOnce()
  })
})
