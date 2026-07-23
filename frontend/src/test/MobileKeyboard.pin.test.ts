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

const { selectedPath } = useSelectedPath()
let wrapper: VueWrapper | undefined

function mountKeyboard() {
  wrapper = mount(MobileKeyboard, {
    props: { visible: true, paneId: 'p1', getSendFn: () => null },
    global: {
      stubs: {
        SuggestionBar: true,
        MkbRow: true,
        HistoryPanel: true,
        FilePickerModal: true,
      },
    },
  })
  return wrapper
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
    const mounted = mountKeyboard()

    document.dispatchEvent(new CustomEvent('terminal-scroll'))
    await nextTick()

    expect(mounted.emitted('update:visible')).toBeUndefined()
  })

  it('does not collapse on path selection in collapse_only mode', async () => {
    settings.keyboard_guard_mode = 'collapse_only'
    const mounted = mountKeyboard()

    selectedPath.value = '/tmp/pinned.txt'
    await nextTick()

    expect(mounted.emitted('update:visible')).toBeUndefined()
  })

  it('preserves path-selection collapse in off mode', async () => {
    const mounted = mountKeyboard()

    selectedPath.value = '/tmp/collapse.txt'
    await nextTick()

    expect(mounted.emitted('update:visible')).toEqual([[false]])
  })
})
