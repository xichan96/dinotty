import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const paneMocks = vi.hoisted(() => {
  const state: {
    instances: any[]
    TerminalInstance: any
    uploadFiles: any
    error: any
    success: any
  } = {
    instances: [],
    TerminalInstance: undefined,
    uploadFiles: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
  }
  state.TerminalInstance = vi.fn(function (this: any, paneId: string) {
    this.paneId = paneId
    this.sendData = vi.fn()
    this.attach = vi.fn()
    this.focus = vi.fn()
    this.destroy = vi.fn()
    state.instances.push(this)
  })
  return state
})

vi.mock('../composables/useTerminal', () => ({
  TerminalInstance: paneMocks.TerminalInstance,
  setKbTypingLock: () => {},
}))

vi.mock('../composables/useUpload', () => ({
  formatMB: (bytes: number) => (bytes / 1048576).toFixed(1),
  useUpload: () => ({
    uploadFiles: paneMocks.uploadFiles,
    uploadErrorStatus: (err: unknown) =>
      typeof err === 'object' && err && 'status' in err ? Number((err as any).status) : undefined,
  }),
}))

vi.mock('vue-toastification', () => ({
  POSITION: { BOTTOM_CENTER: 'bottom-center' },
  useToast: () => ({ error: paneMocks.error, success: paneMocks.success }),
}))

vi.mock('../composables/useI18n', () => ({
  useI18n: () => ({
    t: (key: string) =>
      ({
        'mobileKb.uploadDone': 'File path inserted',
        'mobileKb.uploadFailed': 'Upload failed',
        'mobileKb.uploadTooLarge': 'Upload rejected: file exceeds the size limit',
        'settings.uploads.processing': 'Processing...',
        'settings.uploads.toastDiskFull': 'Upload failed: not enough disk space',
      })[key] ?? key,
  }),
}))

import TerminalPane from '../components/terminal/TerminalPane.vue'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

function mountPane() {
  return mount(TerminalPane, {
    props: { paneId: 'p1' },
    global: {
      stubs: {
        SearchBar: true,
        TerminalContextMenu: true,
        SelectionHandles: true,
      },
    },
  })
}

describe('TerminalPane file upload wiring', () => {
  beforeEach(() => {
    paneMocks.instances.length = 0
    paneMocks.TerminalInstance.mockClear()
    paneMocks.uploadFiles.mockReset()
    paneMocks.error.mockReset()
    paneMocks.success.mockReset()
  })

  it('maps 413 upload errors to the too-large toast', async () => {
    paneMocks.uploadFiles.mockRejectedValue({ status: 413 })
    const wrapper = mountPane()
    const terminal = paneMocks.instances[0]

    await terminal.onFileUpload([new File(['x'], 'x.bin')])

    expect(paneMocks.error).toHaveBeenCalledWith('Upload rejected: file exceeds the size limit', {
      position: 'bottom-center',
    })
    wrapper.unmount()
  })

  it('maps 507 upload errors to the disk-full toast', async () => {
    paneMocks.uploadFiles.mockRejectedValue({ status: 507 })
    const wrapper = mountPane()
    const terminal = paneMocks.instances[0]

    await terminal.onFileUpload([new File(['x'], 'x.bin')])

    expect(paneMocks.error).toHaveBeenCalledWith('Upload failed: not enough disk space', {
      position: 'bottom-center',
    })
    wrapper.unmount()
  })

  it('preserves saved path insertion order while uploads resolve concurrently', async () => {
    const first = deferred<{ ok: boolean; saved: string[] }>()
    const second = deferred<{ ok: boolean; saved: string[] }>()
    paneMocks.uploadFiles.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    const wrapper = mountPane()
    const terminal = paneMocks.instances[0]

    const p1 = terminal.onFileUpload([new File(['1'], '1.txt')])
    const p2 = terminal.onFileUpload([new File(['2'], '2.txt')])
    expect(paneMocks.uploadFiles).toHaveBeenCalledWith([expect.any(File)], {
      synthesizeNames: true,
      onProgress: expect.any(Function),
    })
    second.resolve({ ok: true, saved: ['/tmp/second.txt'] })
    await Promise.resolve()
    expect(terminal.sendData).not.toHaveBeenCalled()
    first.resolve({ ok: true, saved: ['/tmp/first.txt'] })
    await Promise.all([p1, p2])

    expect(terminal.sendData.mock.calls.map((call: unknown[]) => call[0])).toEqual([
      '/tmp/first.txt ',
      '/tmp/second.txt ',
    ])
    expect(terminal.sendData.mock.calls.every((call: unknown[]) => call[1] === true)).toBe(true)
    wrapper.unmount()
  })

  it('does not insert or toast when upload resolves after unmount', async () => {
    const upload = deferred<{ ok: boolean; saved: string[] }>()
    paneMocks.uploadFiles.mockReturnValue(upload.promise)
    const wrapper = mountPane()
    const terminal = paneMocks.instances[0]
    const done = terminal.onFileUpload([new File(['x'], 'x.txt')])

    wrapper.unmount()
    upload.resolve({ ok: true, saved: ['/tmp/x.txt'] })
    await done

    expect(terminal.sendData).not.toHaveBeenCalled()
    expect(paneMocks.success).not.toHaveBeenCalled()
    expect(paneMocks.error).not.toHaveBeenCalled()
  })
})
