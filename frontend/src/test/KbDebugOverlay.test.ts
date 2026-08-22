import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'

import KbDebugOverlay from '../components/keyboard/KbDebugOverlay.vue'

afterEach(() => {
  document.body.replaceChildren()
})

describe('KbDebugOverlay (temporary #kbdebug diagnostics)', () => {
  it('renders viewport, css-var and app-root lines without throwing', async () => {
    const wrapper = mount(KbDebugOverlay)
    await new Promise((r) => setTimeout(r, 20))
    const text = wrapper.text()
    expect(text).toContain('client:')
    expect(text).toContain('win:')
    expect(text).toContain('vv:')
    expect(text).toContain('kbTop(lv):')
    expect(text).toContain('vars:')
    expect(text).toContain('pan=')
    expect(text).toContain('app-root:')
    expect(text).toContain('focus:')
    wrapper.unmount()
  })
})
