import { describe, it, expect, vi } from 'vitest'
import { createFrozenSendFn, type SendDataFn } from '../frozenSend'

// Contract test for host invariant §二 #6 (keyboard-plugin-design.md):
// broadcast semantics - ctx.send('broadcast', data) must deliver the same
// payload to every pane sender, and the returned promise resolves only after
// all senders have settled their synchronous phase.

describe('createFrozenSendFn (contract: broadcast semantics, §二 #6)', () => {
  it('delivers the same payload to every sender', () => {
    const a = vi.fn()
    const b = vi.fn()
    const send = createFrozenSendFn([a, b])
    send('ls -la\r')
    expect(a).toHaveBeenCalledWith('ls -la\r')
    expect(b).toHaveBeenCalledWith('ls -la\r')
  })

  it('notifies onDispatch once per dispatch', () => {
    const onDispatch = vi.fn()
    const send = createFrozenSendFn([() => {}], onDispatch)
    send('a')
    send('b')
    expect(onDispatch).toHaveBeenCalledTimes(2)
  })

  it('returns a promise that resolves after async senders complete', async () => {
    let resolveSender: () => void = () => {}
    const slow: SendDataFn = () =>
      new Promise<void>((resolve) => {
        resolveSender = resolve
      })
    const send = createFrozenSendFn([slow])
    const p = send('x')
    let settled = false
    void Promise.resolve(p).then(() => {
      settled = true
    })
    expect(settled).toBe(false)
    resolveSender()
    await p
    expect(settled).toBe(true)
  })

  it('still delivers to remaining senders when one throws synchronously', () => {
    const ok = vi.fn()
    const send = createFrozenSendFn([
      () => {
        throw new Error('boom')
      },
      ok,
    ])
    send('data')
    expect(ok).toHaveBeenCalledWith('data')
  })
})
