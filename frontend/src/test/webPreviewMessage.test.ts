import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import { describe, expect, it, vi } from 'vitest'

vi.mock('../composables/useDevTools', async () => {
  const { ref, computed } = await import('vue')
  return {
    useDevTools: () => ({
      consoleEntries: ref([]),
      networkEntries: ref([]),
      errorCount: computed(() => 0),
      clearConsole: vi.fn(),
      clearNetwork: vi.fn(),
      allowOrigin: vi.fn(),
      isAllowedOrigin: () => true,
    }),
  }
})

import WebPreview from '../components/preview/WebPreview.vue'

function sendFocusMessage() {
  window.dispatchEvent(
    new MessageEvent('message', {
      data: { type: 'preview-focus' },
      origin: window.location.origin,
    })
  )
}

describe('WebPreview iframe focus bridge', () => {
  it('emits focus on an iframe click only while the pane is inactive', async () => {
    const wrapper = mount(WebPreview, {
      props: { visible: true, url: 'http://localhost:3000', isActive: false },
    })

    sendFocusMessage()
    await nextTick()
    expect(wrapper.emitted('focus')).toHaveLength(1)

    await wrapper.setProps({ isActive: true })
    sendFocusMessage()
    await nextTick()
    expect(wrapper.emitted('focus')).toHaveLength(1)
    wrapper.unmount()
  })

  it('exposes a focus method for pane activation', () => {
    const wrapper = mount(WebPreview, {
      props: { visible: true, url: 'http://localhost:3000', inLeaf: true },
    })
    expect(typeof (wrapper.vm as any).focus).toBe('function')
    wrapper.unmount()
  })
})
