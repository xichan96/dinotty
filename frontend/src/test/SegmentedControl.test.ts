import { describe, expect, it } from 'vitest'
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
  })

  it('emits the clicked option value', async () => {
    const wrapper = mount(SegmentedControl, { props: { modelValue: 'off', options } })

    await wrapper.findAll('button')[2].trigger('click')

    expect(wrapper.emitted('update:modelValue')).toEqual([['icon']])
  })

  it('marks only the selected option with aria-selected', () => {
    const wrapper = mount(SegmentedControl, { props: { modelValue: 'tab', options } })

    expect(wrapper.findAll('button').map((button) => button.attributes('aria-selected'))).toEqual([
      'false',
      'true',
      'false',
      'false',
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

  it('moves left and right without wrapping at the ends', async () => {
    const wrapper = mount(SegmentedControl, { props: { modelValue: 'tab', options } })
    const buttons = wrapper.findAll('button')

    await buttons[1].trigger('keydown', { key: 'ArrowLeft' })
    await buttons[1].trigger('keydown', { key: 'ArrowRight' })
    expect(wrapper.emitted('update:modelValue')).toEqual([['off'], ['icon']])

    await wrapper.setProps({ modelValue: 'off' })
    await buttons[0].trigger('keydown', { key: 'ArrowLeft' })
    await wrapper.setProps({ modelValue: 'both' })
    await buttons[3].trigger('keydown', { key: 'ArrowRight' })
    expect(wrapper.emitted('update:modelValue')).toEqual([['off'], ['icon']])
  })
})
