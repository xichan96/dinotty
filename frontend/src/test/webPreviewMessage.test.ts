import { mount } from '@vue/test-utils'
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

describe('WebPreview iframe focus bridge', () => {
  it('emits focus when the parent detects the iframe took focus', async () => {
    const wrapper = mount(WebPreview, {
      props: { visible: true, url: 'http://localhost:3000', isActive: false },
    })
    const iframe = wrapper.find('iframe').element
    const original = Object.getOwnPropertyDescriptor(document, 'activeElement')
    Object.defineProperty(document, 'activeElement', { configurable: true, get: () => iframe })

    try {
      window.dispatchEvent(new Event('focus'))
      await new Promise((resolve) => setTimeout(resolve, 150))
      expect(wrapper.emitted('focus')).toHaveLength(1)

      await wrapper.setProps({ isActive: true })
      window.dispatchEvent(new Event('focus'))
      await new Promise((resolve) => setTimeout(resolve, 150))
      expect(wrapper.emitted('focus')).toHaveLength(1)
    } finally {
      if (original) Object.defineProperty(document, 'activeElement', original)
      else delete (document as any).activeElement
      wrapper.unmount()
    }
  })

  it('also detects iframe activation from a blur event', async () => {
    const wrapper = mount(WebPreview, {
      props: { visible: true, url: 'http://localhost:3000', isActive: false },
    })
    const iframe = wrapper.find('iframe').element
    const original = Object.getOwnPropertyDescriptor(document, 'activeElement')
    Object.defineProperty(document, 'activeElement', { configurable: true, get: () => iframe })
    try {
      window.dispatchEvent(new Event('blur'))
      await new Promise((resolve) => setTimeout(resolve, 150))
      expect(wrapper.emitted('focus')).toHaveLength(1)
    } finally {
      if (original) Object.defineProperty(document, 'activeElement', original)
      else delete (document as any).activeElement
      wrapper.unmount()
    }
  })

  it('exposes a focus method for pane activation', () => {
    const wrapper = mount(WebPreview, {
      props: { visible: true, url: 'http://localhost:3000', inLeaf: true },
    })
    expect(typeof (wrapper.vm as any).focus).toBe('function')
    wrapper.unmount()
  })
})
