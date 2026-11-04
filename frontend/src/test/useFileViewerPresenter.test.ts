import { flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { effectScope } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SyncOpenFileViewer } from '../types/protocol'
import { useFileViewerStore } from '../stores/fileViewerStore'
import { useFileViewerPresenter } from '../composables/useFileViewerPresenter'

/**
 * The presenter is the only place that decides *how* a viewer request is
 * presented. These tests pin the delivery contract: desktop asks Rust for the
 * native window, any failure (or a non-Tauri runtime) falls back to the
 * in-app overlay, and the subscription dies with its setup scope.
 */

const mocks = vi.hoisted(() => ({
  handlers: new Set<(msg: SyncOpenFileViewer) => void>(),
  unsubscribe: vi.fn(),
  tauriInvoke: vi.fn(),
  isTauri: vi.fn(() => true),
}))

vi.mock('../composables/useSyncWebSocket', () => ({
  onOpenFileViewer: (handler: (msg: SyncOpenFileViewer) => void) => {
    mocks.handlers.add(handler)
    return () => {
      mocks.handlers.delete(handler)
      mocks.unsubscribe()
    }
  },
}))

vi.mock('../composables/useTransport', () => ({
  isTauri: () => mocks.isTauri(),
  tauriInvoke: (...args: unknown[]) => mocks.tauriInvoke(...args),
}))

function request(overrides: Partial<SyncOpenFileViewer> = {}): SyncOpenFileViewer {
  return {
    type: 'open_file_viewer',
    request_id: 'req-1',
    pane_id: 'pane-1',
    path: '/tmp/docs/readme.md',
    ...overrides,
  }
}

async function dispatch(msg: SyncOpenFileViewer) {
  for (const handler of mocks.handlers) handler(msg)
  await flushPromises()
}

function setupPresenter() {
  const scope = effectScope()
  let presenter!: ReturnType<typeof useFileViewerPresenter>
  scope.run(() => {
    presenter = useFileViewerPresenter()
  })
  return { scope, presenter }
}

beforeEach(() => {
  setActivePinia(createPinia())
  mocks.handlers.clear()
  vi.clearAllMocks()
  mocks.isTauri.mockReturnValue(true)
  mocks.tauriInvoke.mockResolvedValue(undefined)
})

describe('useFileViewerPresenter', () => {
  it('opens the native window with the request and a basename title', async () => {
    const { scope } = setupPresenter()
    await dispatch(request())

    expect(mocks.tauriInvoke).toHaveBeenCalledWith('open_preview_window', {
      kind: 'file',
      sourcePaneId: 'pane-1',
      path: '/tmp/docs/readme.md',
      title: 'readme.md',
    })
    expect(useFileViewerStore().request).toBeNull()

    scope.stop()
  })

  it('keeps an explicit title instead of the basename', async () => {
    const { scope } = setupPresenter()
    await dispatch(request({ title: '  Release notes  ' }))

    expect(mocks.tauriInvoke).toHaveBeenCalledWith(
      'open_preview_window',
      expect.objectContaining({ title: 'Release notes' })
    )
    scope.stop()
  })

  it('falls back to the overlay when the native window cannot open', async () => {
    mocks.tauriInvoke.mockRejectedValue(new Error('no window'))
    const { scope } = setupPresenter()
    const msg = request()
    await dispatch(msg)

    expect(useFileViewerStore().request).toEqual(msg)
    scope.stop()
  })

  it('uses the overlay directly outside Tauri', async () => {
    mocks.isTauri.mockReturnValue(false)
    const { scope } = setupPresenter()
    const msg = request()
    await dispatch(msg)

    expect(mocks.tauriInvoke).not.toHaveBeenCalled()
    expect(useFileViewerStore().request).toEqual(msg)
    scope.stop()
  })

  it('exposes the pending overlay request', async () => {
    mocks.isTauri.mockReturnValue(false)
    const { scope, presenter } = setupPresenter()
    expect(presenter.request.value).toBeNull()

    await dispatch(request())
    expect(presenter.request.value?.request_id).toBe('req-1')

    scope.stop()
  })

  it('unsubscribes when its setup scope is disposed', () => {
    const { scope } = setupPresenter()
    expect(mocks.handlers.size).toBe(1)

    scope.stop()
    expect(mocks.handlers.size).toBe(0)
    expect(mocks.unsubscribe).toHaveBeenCalledTimes(1)
  })
})
