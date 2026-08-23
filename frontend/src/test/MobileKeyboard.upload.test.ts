import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mobileMocks = vi.hoisted(() => ({
  uploadFiles: vi.fn(),
  error: vi.fn(),
  success: vi.fn(),
}))

vi.mock('../composables/useUpload', () => ({
  formatMB: (bytes: number) => (bytes / 1048576).toFixed(1),
  useUpload: () => ({
    uploadFiles: mobileMocks.uploadFiles,
    uploadErrorStatus: (err: unknown) =>
      typeof err === 'object' && err && 'status' in err ? Number((err as any).status) : undefined,
  }),
}))

vi.mock('../composables/useTransport', () => ({
  isTauri: () => false,
}))

vi.mock('vue-toastification', () => ({
  POSITION: { BOTTOM_CENTER: 'bottom-center' },
  useToast: () => ({ error: mobileMocks.error, success: mobileMocks.success }),
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

vi.mock('../composables/useFileNavigation', async () => {
  const { ref } = await vi.importActual<typeof import('vue')>('vue')
  return {
    useSelectedPath: () => ({ selectedPath: ref<string | null>(null) }),
  }
})

import MobileKeyboard from '../components/keyboard/MobileKeyboard.vue'
import { trailingPathDeleteLen } from '../utils/shell'
import { makeMobileKeyboardCtx } from './helpers/makeMobileKeyboardCtx'

function setFiles(input: HTMLInputElement, files: File[]) {
  Object.defineProperty(input, 'files', { value: files, configurable: true })
}

async function flush() {
  await Promise.resolve()
  await nextTick()
}

describe('MobileKeyboard upload convergence', () => {
  beforeEach(() => {
    mobileMocks.uploadFiles.mockReset()
    mobileMocks.error.mockReset()
    mobileMocks.success.mockReset()
  })

  function mountKeyboard() {
    const harness = makeMobileKeyboardCtx({ visible: true })
    const wrapper = mount(MobileKeyboard, {
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

  it('dispatches upload status, inserts returned paths, and resets uploading after success', async () => {
    mobileMocks.uploadFiles.mockResolvedValue({ ok: true, saved: ['/tmp/a b.txt', '/tmp/c.txt'] })
    const status = vi.fn()
    window.addEventListener('dinotty-upload-status', status)
    const { wrapper, harness } = mountKeyboard()

    const textarea = wrapper.find('textarea').element as HTMLTextAreaElement
    textarea.focus()
    await nextTick()
    const input = wrapper.find('input[type="file"]').element as HTMLInputElement
    setFiles(input, [new File(['a'], 'a.txt')])
    await wrapper.find('input[type="file"]').trigger('change')
    await flush()

    expect(mobileMocks.uploadFiles).toHaveBeenCalledWith([expect.any(File)], {
      onProgress: expect.any(Function),
    })
    expect((wrapper.find('textarea').element as HTMLTextAreaElement).value).toBe(
      "'/tmp/a b.txt' /tmp/c.txt"
    )
    expect(harness.onHostEvent).toHaveBeenCalledWith('upload-status', expect.anything())
    expect(status).toHaveBeenCalled()
    expect(mobileMocks.success).toHaveBeenCalled()
    expect(wrapper.find('button[disabled]').exists()).toBe(false)
    expect(input.value).toBe('')
    window.removeEventListener('dinotty-upload-status', status)
    wrapper.unmount()
  })

  it('maps 413 to the too-large toast and resets uploading after error', async () => {
    mobileMocks.uploadFiles.mockRejectedValue({ status: 413 })
    const { wrapper } = mountKeyboard()

    const input = wrapper.find('input[type="file"]').element as HTMLInputElement
    setFiles(input, [new File(['a'], 'a.txt')])
    await wrapper.find('input[type="file"]').trigger('change')
    await flush()

    expect(mobileMocks.error.mock.calls[0][0]).toMatch(
      /Upload rejected: file exceeds the size limit|上传被拒:文件超过大小上限/
    )
    expect(mobileMocks.error.mock.calls[0][1]).toEqual({ position: 'bottom-center' })
    expect(wrapper.find('button[disabled]').exists()).toBe(false)
    expect(input.value).toBe('')
    wrapper.unmount()
  })

  it('maps 507 to the disk-full toast and resets uploading after error', async () => {
    mobileMocks.uploadFiles.mockRejectedValue({ status: 507 })
    const { wrapper } = mountKeyboard()

    const input = wrapper.find('input[type="file"]').element as HTMLInputElement
    setFiles(input, [new File(['a'], 'a.txt')])
    await wrapper.find('input[type="file"]').trigger('change')
    await flush()

    expect(mobileMocks.error.mock.calls[0][0]).toMatch(
      /Upload failed: not enough disk space|上传失败：磁盘空间不足/
    )
    expect(mobileMocks.error.mock.calls[0][1]).toEqual({ position: 'bottom-center' })
    expect(wrapper.find('button[disabled]').exists()).toBe(false)
    expect(input.value).toBe('')
    wrapper.unmount()
  })
})

describe('trailingPathDeleteLen', () => {
  it('detects trailing path spans with optional leading space', () => {
    expect(trailingPathDeleteLen('a /x/y')).toBe(5)
    expect(trailingPathDeleteLen("a '/x y/z'")).toBe(" '/x y/z'".length)
    expect(trailingPathDeleteLen('a hello')).toBe(0)
    expect(trailingPathDeleteLen('')).toBe(0)
    expect(trailingPathDeleteLen('/only')).toBe(5)
    expect(trailingPathDeleteLen('a /x /y')).toBe(3)
  })
})
