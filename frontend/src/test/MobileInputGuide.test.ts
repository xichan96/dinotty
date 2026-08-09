import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'
import MobileInputGuide from '../components/keyboard/MobileInputGuide.vue'
import { settings } from '../composables/useSettings'

afterEach(() => {
  document.body.replaceChildren()
})

describe('MobileInputGuide', () => {
  it('emits the recommended system mode directly from the choice card click', async () => {
    settings.locale = 'en'
    const wrapper = mount(MobileInputGuide, {
      attachTo: document.body,
      props: { visible: true },
      global: { stubs: { Teleport: true } },
    })

    await wrapper.find('.guide-option.recommended').trigger('click')

    expect(wrapper.emitted('choose')).toEqual([['system']])
    wrapper.unmount()
  })

  it('closes without choosing so the next terminal request can show it again', async () => {
    const wrapper = mount(MobileInputGuide, {
      attachTo: document.body,
      props: { visible: true },
      global: { stubs: { Teleport: true } },
    })

    await wrapper.find('.guide-later').trigger('click')

    expect(wrapper.emitted('close')).toHaveLength(1)
    expect(wrapper.emitted('choose')).toBeUndefined()
    wrapper.unmount()
  })
})
