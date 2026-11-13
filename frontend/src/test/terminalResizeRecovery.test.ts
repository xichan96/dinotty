import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@xterm/xterm', () => ({
  Terminal: class {
    options: Record<string, any> = {}
    constructor() {}
    loadAddon() {}
    open() {}
    attachCustomKeyEventHandler() {}
    registerLinkProvider() {}
    registerOscHandler() {}
    onTitleChange() {}
    onData() {}
    dispose() {}
    focus() {}
    blur() {}
  },
}))
vi.mock('@xterm/addon-fit', () => ({ FitAddon: class {} }))
vi.mock('@xterm/addon-unicode11', () => ({ Unicode11Addon: class {} }))
vi.mock('@xterm/addon-webgl', () => ({ WebglAddon: class {} }))
vi.mock('@xterm/addon-search', () => ({ SearchAddon: class {} }))
vi.mock('../composables/useTransport', () => ({
  isTauri: () => false,
  createTransport: () => ({
    onConnect() {},
    onMessage() {},
    onDisconnect() {},
    connect() {},
    disconnect() {},
    send() {},
  }),
}))
vi.mock('../utils/clientPlatform', () => ({
  hostTarget: () => null,
  isWindowsClient: false,
}))
vi.mock('../composables/useTerminalWheel', () => ({
  createTerminalWheel: () => ({
    setup: vi.fn(),
    cleanup: vi.fn(),
    sendWheelEvent: vi.fn(),
    isBypassActive: () => false,
  }),
}))

import { TerminalInstance } from '../composables/useTerminal'

interface FakeTerm {
  term: any
  xterm: any
  fit: { fit: ReturnType<typeof vi.fn> }
}

/**
 * A TerminalInstance wired to fake xterm/fitAddon/wrapper. Only the resize,
 * snapshot, and transaction state machines are exercised; attach() (WebSocket,
 * DOM, addons) is deliberately skipped.
 */
function makeTerm(localCols = 120, localRows = 40): FakeTerm {
  const term = new TerminalInstance('resize-test') as any
  const xterm: any = {
    cols: localCols,
    rows: localRows,
    resize: vi.fn((cols: number, rows: number) => {
      xterm.cols = cols
      xterm.rows = rows
    }),
    scrollToBottom: vi.fn(),
    write: vi.fn((_data: string, cb?: () => void) => cb?.()),
  }
  const fit = {
    fit: vi.fn(() => {
      xterm.cols = localCols
      xterm.rows = localRows
    }),
  }
  term.xterm = xterm
  term.fitAddon = fit
  term._wrapper = { getBoundingClientRect: () => ({ width: 1000, height: 600 }) }
  term._lastCols = localCols
  term._lastRows = localRows
  term._knownPtyCols = localCols
  term._knownPtyRows = localRows
  term._sendResize = vi.fn(() => true)
  term._scheduleSettleResize = vi.fn()
  return { term, xterm, fit }
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('peer-follow refit', () => {
  it('refits the display to the local wrapper even while the follow cooldown is active', async () => {
    const { term, xterm, fit } = makeTerm(120, 40)
    term._resizeCooldownUntil = Date.now() + 3000

    term._followPeerResize(80, 24)
    expect(xterm.cols).toBe(80)
    expect(xterm.rows).toBe(24)

    await vi.advanceTimersByTimeAsync(500)

    expect(fit.fit).toHaveBeenCalled()
    expect(xterm.cols).toBe(120)
    expect(xterm.rows).toBe(40)
    expect(term._sendResize).not.toHaveBeenCalled()
  })

  it('reclaims the PTY size after a peer follow once the cooldown has expired', async () => {
    const { term } = makeTerm(120, 40)
    term._resizeCooldownUntil = 0

    term._followPeerResize(80, 24)
    await vi.advanceTimersByTimeAsync(500)

    expect(term._sendResize).toHaveBeenCalledTimes(1)
    expect(term._sendResize).toHaveBeenCalledWith(120, 40)
  })
})

describe('snapshot handshake recovery', () => {
  it('retries a snapshot_request that produces no replay', async () => {
    const { term } = makeTerm()
    const send = vi.fn()
    term.ws = { send } as any
    term._snapshotPending = true

    term._maybeSendSnapshotRequest()
    expect(send).toHaveBeenCalledTimes(1)
    expect(String(send.mock.calls[0][0])).toContain('"type":"snapshot_request"')

    await vi.advanceTimersByTimeAsync((TerminalInstance as any).SNAPSHOT_RETRY_MS)

    expect(send).toHaveBeenCalledTimes(2)
    expect(term._snapshotAttempts).toBe(1)
  })

  it('sends a pending snapshot request even when the recovered wrapper has the previous geometry', () => {
    const { term } = makeTerm(120, 40)
    const send = vi.fn()
    term.ws = { send } as any
    term._snapshotPending = true

    // Geometry is unchanged from _lastCols/_lastRows: the old early return
    // here skipped the snapshot request and left the pane blank.
    term._doFitAndResize()

    expect(send).toHaveBeenCalledTimes(1)
  })

  it('re-requests when the wrapper changed during a replay', () => {
    const { term } = makeTerm(120, 40)
    term._snapshotPending = true

    term._handleReplayBegin(80, 24)
    // xterm is now 120x40 (the local fit after the wrapper changed).
    term._handleReplayEnd()

    expect(term._snapshotPending).toBe(true)
    expect(term._snapshotAttempts).toBe(1)
    expect(term._scheduleSettleResize).toHaveBeenCalled()
  })
})

describe('transaction watchdog', () => {
  it('flushes and closes a transaction whose end event never arrives', async () => {
    const { term } = makeTerm()
    const enqueue = vi.spyOn(term, '_enqueueWrite').mockImplementation(() => {})

    term._beginTransaction()
    term._appendToTransaction('partial-snapshot')
    expect(term._transactionDepth).toBe(1)

    await vi.advanceTimersByTimeAsync((TerminalInstance as any).TRANSACTION_WATCHDOG_MS)

    expect(term._transactionDepth).toBe(0)
    expect(enqueue).toHaveBeenCalledWith('partial-snapshot')
  })
})
