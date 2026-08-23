import { mount, type VueWrapper } from '@vue/test-utils'
import { nextTick } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../composables/useUpload', () => ({
  formatMB: (bytes: number) => (bytes / 1048576).toFixed(1),
  useUpload: () => ({
    uploadFiles: vi.fn(),
    uploadErrorStatus: vi.fn(),
  }),
}))

vi.mock('../composables/useTransport', () => ({
  isTauri: () => false,
}))

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

vi.mock('../composables/apiBase', () => ({
  apiUrl: (path: string) => path,
  authFetch: vi.fn(async () => ({ ok: true, json: async () => [] })),
  getApiBase: vi.fn(async () => 'http://127.0.0.1:7681'),
  hasAuthToken: vi.fn(() => false),
}))

import MobileKeyboard from '../components/keyboard/MobileKeyboard.vue'
import { useSelectedPath } from '../composables/useFileNavigation'
import { settings } from '../composables/useSettings'
import { makeMobileKeyboardCtx } from './helpers/makeMobileKeyboardCtx'

const { selectedPath } = useSelectedPath()
let wrapper: VueWrapper | undefined

function mountKeyboard() {
  const harness = makeMobileKeyboardCtx({ visible: true })
  wrapper = mount(MobileKeyboard, {
    props: { ctx: harness.ctx },
    global: {
      stubs: {
        SuggestionBar: true,
        MkbRow: true,
        HistoryPanel: true,
        FilePickerModal: true,
      },
    },
  })
  return { wrapper, harness }
}

beforeEach(() => {
  settings.keyboard_guard_mode = 'off'
  selectedPath.value = null
})

afterEach(() => {
  wrapper?.unmount()
  wrapper = undefined
  selectedPath.value = null
})

describe('MobileKeyboard guarded visibility', () => {
  it('does not collapse from a terminal-scroll document event', async () => {
    const { harness } = mountKeyboard()

    document.dispatchEvent(new CustomEvent('terminal-scroll'))
    await nextTick()

    expect(harness.visible.value).toBe(true)
  })

  it('does not collapse on path selection in collapse_only mode', async () => {
    settings.keyboard_guard_mode = 'collapse_only'
    const { harness } = mountKeyboard()

    selectedPath.value = '/tmp/pinned.txt'
    await nextTick()

    expect(harness.visible.value).toBe(true)
  })

  it('preserves path-selection collapse in off mode', async () => {
    const { harness } = mountKeyboard()

    selectedPath.value = '/tmp/collapse.txt'
    await nextTick()

    expect(harness.visible.value).toBe(false)
  })
})
