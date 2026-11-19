import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const hook = vi.hoisted(() => ({
  bookmarks: [] as { id: string; url: string; name: string }[],
}))

vi.mock('../composables/useI18n', () => ({ useI18n: () => ({ t: (k: string) => k }) }))
vi.mock('../composables/usePrompt', () => ({ uiPrompt: vi.fn(async () => null) }))
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
vi.mock('../composables/useWebBookmarks', async () => {
  const { ref } = await import('vue')
  return {
    useWebBookmarks: () => ({
      bookmarks: ref(hook.bookmarks),
      removeBookmark: vi.fn(),
      renameBookmark: vi.fn(),
      addBookmark: vi.fn(),
    }),
  }
})
vi.mock('../composables/useRecentAccess', () => ({
  useRecentUrls: () => ({ removeUrl: vi.fn(), recordUrl: vi.fn() }),
}))

vi.mock('../components/preview/WebPreview.vue', () => ({
  default: {
    name: 'WebPreview',
    props: ['visible', 'url', 'sourcePaneId', 'isActive'],
    emits: ['focus', 'close'],
    methods: { openFromWebUrl() {}, getCurrentUrl() {}, focus() {} },
    template: `<button class="web-stub" @click="$emit('focus')">web</button>`,
  },
}))

import PaneContent from '../components/split/PaneContent.vue'
import AddressDropdown from '../components/preview/AddressDropdown.vue'
import { settings } from '../composables/useSettings'

describe('web pane focus bridge', () => {
  beforeEach(() => {
    settings.recent_urls = [
      { path_or_url: 'http://localhost:3000', name: 'local', visited_at: 1 },
    ]
    hook.bookmarks.length = 0
  })

  it('forwards a focus request from the preview to the split pane', async () => {
    const wrapper = mount(PaneContent, {
      props: {
        leaf: { type: 'leaf', paneId: 'web-1', title: 'Web', ratio: 1, zoomed: false, kind: 'web' },
        isVisible: true,
        isFocused: true,
      },
    })
    expect(wrapper.findComponent({ name: 'WebPreview' }).props('isActive')).toBe(true)

    await wrapper.find('.web-stub').trigger('click')

    expect(wrapper.emitted('focus')).toEqual([['web-1']])
    wrapper.unmount()
  })

  it('keeps the address input focused when a recent link is clicked', async () => {
    const wrapper = mount(AddressDropdown, { props: { visible: true } })
    const item = wrapper.find('.address-dropdown-item')
    expect(item.exists()).toBe(true)

    const event = new MouseEvent('mousedown', { bubbles: true, cancelable: true })
    item.element.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)

    await item.trigger('click')
    expect(wrapper.emitted('select')).toEqual([['http://localhost:3000']])
    wrapper.unmount()
  })

})
