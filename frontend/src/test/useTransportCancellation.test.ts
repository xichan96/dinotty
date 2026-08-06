import { afterEach, describe, expect, it, vi } from 'vitest'
import { TauriIpcTransport } from '../composables/useTransport'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

afterEach(() => {
  delete (window as any).__TAURI__
  vi.restoreAllMocks()
})

describe('TauriIpcTransport cancellation', () => {
  it('stops initialization when disconnected during listener registration', async () => {
    const pendingListener = deferred<() => void>()
    const unlisten = vi.fn()
    const listen = vi.fn().mockReturnValueOnce(pendingListener.promise)
    const invoke = vi.fn().mockResolvedValue(undefined)
    ;(window as any).__TAURI__ = {
      core: { invoke },
      event: { listen },
    }

    const transport = new TauriIpcTransport('closing-pane')
    await vi.waitFor(() => expect(listen).toHaveBeenCalledOnce())

    transport.disconnect()
    pendingListener.resolve(unlisten)

    await vi.waitFor(() => expect(unlisten).toHaveBeenCalledOnce())
    expect(listen).toHaveBeenCalledOnce()
    expect(invoke.mock.calls.some(([command]) => command === 'pty_spawn')).toBe(false)
  })

  it('ignores a pty_spawn result that arrives after disconnect', async () => {
    const pendingSpawn = deferred<string>()
    const unlisteners = Array.from({ length: 7 }, () => vi.fn())
    let listenerIndex = 0
    const listen = vi.fn(async () => unlisteners[listenerIndex++])
    const invoke = vi.fn((command: string) => {
      if (command === 'pty_spawn') return pendingSpawn.promise
      return Promise.resolve(undefined)
    })
    ;(window as any).__TAURI__ = {
      core: { invoke },
      event: { listen },
    }

    const transport = new TauriIpcTransport('closing-pane')
    const onConnect = vi.fn()
    const onMessage = vi.fn()
    transport.onConnect(onConnect)
    transport.onMessage(onMessage)
    await vi.waitFor(() =>
      expect(invoke.mock.calls.some(([command]) => command === 'pty_spawn')).toBe(true)
    )

    transport.disconnect()
    pendingSpawn.resolve('pwsh')

    await vi.waitFor(() =>
      expect(invoke.mock.calls.filter(([command]) => command === 'pty_detach')).toHaveLength(2)
    )
    expect(onConnect).not.toHaveBeenCalled()
    expect(onMessage).not.toHaveBeenCalled()
    for (const unlisten of unlisteners) expect(unlisten).toHaveBeenCalledOnce()
  })
})
