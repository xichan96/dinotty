import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../composables/useUpload', () => ({
  formatMB: () => '0.0',
  useUpload: () => ({ uploadFiles: vi.fn(), uploadErrorStatus: vi.fn() }),
}))
vi.mock('../composables/useTransport', () => ({ isTauri: () => false }))
vi.mock('vue-toastification', () => ({
  POSITION: { BOTTOM_CENTER: 'bottom-center' },
  useToast: () => ({ error: vi.fn(), success: vi.fn() }),
}))
vi.mock('../composables/useHistory', async () => {
  const { ref } = await vi.importActual<typeof import('vue')>('vue')
  return {
    useHistory: () => ({
      suggestions: ref([]),
      fetchSuggestions: vi.fn(),
      fetchDebounced: vi.fn(),
    }),
  }
})

import MobileKeyboard from '../components/keyboard/MobileKeyboard.vue'
import { settings } from '../composables/useSettings'

beforeEach(() => {
  settings.locale = 'en'
  Object.defineProperty(window, 'isSecureContext', { value: true, configurable: true })
  Object.defineProperty(navigator, 'clipboard', {
    value: { readText: vi.fn(async () => 'phone text') },
    configurable: true,
  })
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('MobileKeyboard phone clipboard toolbar', () => {
  it('keeps phone paste inserting into the textarea without dispatching an app action', async () => {
    const wrapper = mount(MobileKeyboard, {
      props: { visible: true, paneId: 'p1', getSendFn: () => null },
      global: {
        stubs: { SuggestionBar: true, MkbRow: true, HistoryPanel: true, FilePickerModal: true },
      },
    })
    ;(wrapper.find('textarea').element as HTMLTextAreaElement).focus()
    await nextTick()
    const phonePaste = wrapper
      .findAll('.mkb-toolbar .mkb-tool-btn')
      .find((button) => button.attributes('title') === 'Paste from phone')
    expect(phonePaste).toBeDefined()
    await phonePaste!.trigger('mousedown')
    await Promise.resolve()
    await nextTick()
    expect((wrapper.find('textarea').element as HTMLTextAreaElement).value).toBe('phone text')
    expect(wrapper.emitted('app-action')).toBeUndefined()
    wrapper.unmount()
  })
})
