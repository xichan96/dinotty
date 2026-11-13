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

import { TerminalInstance, setActivePaneId } from '../composables/useTerminal'

interface FakeTerm {
  term: any
  xterm: any
  fit: { fit: ReturnType<typeof vi.fn>; proposeDimensions: ReturnType<typeof vi.fn> }
  send: ReturnType<typeof vi.fn>
}

/**
 * A TerminalInstance wired to fake xterm/fitAddon/wrapper. Only the resize,
 * ownership, snapshot, and transaction state machines are exercised; attach()
 * (WebSocket, DOM, addons) is deliberately skipped.
 */
function makeTerm(localCols = 120, localRows = 40, visible = true): FakeTerm {
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
    proposeDimensions: vi.fn(() => ({ cols: localCols, rows: localRows })),
  }
  const send = vi.fn()
  term.xterm = xterm
  term.fitAddon = fit
  term._wrapper = {
    getBoundingClientRect: () => (visible ? { width: 1000, height: 600 } : { width: 0, height: 0 }),
  }
  term._lastCols = localCols
  term._lastRows = localRows
  term._knownPtyCols = 80
  term._knownPtyRows = 24
  term._isOwner = true
  term._sendResize = vi.fn(() => true)
  term._scheduleSettleResize = vi.fn()
  term.ws = { send, readyState: 1, close: vi.fn() }
  return { term, xterm, fit, send }
}

function lastSent(send: ReturnType<typeof vi.fn>) {
  return JSON.parse(String(send.mock.calls[send.mock.calls.length - 1][0]))
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('WebSocket', { OPEN: 1 } as any)
  setActivePaneId(null)
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  setActivePaneId(null)
})

describe('size ownership', () => {
  it('a follower adopts the owner grid and does not resize the PTY', async () => {
    const { term, xterm } = makeTerm(120, 40)

    term._followPeerResize(80, 24)
    expect(term._isOwner).toBe(false)
    expect(term._claimNeeded).toBe(true)
    expect(xterm.cols).toBe(80)
    expect(xterm.rows).toBe(24)

    await vi.advanceTimersByTimeAsync(500)

    // Display stays on the owner's grid; no non-owner resize is emitted.
    expect(xterm.cols).toBe(80)
    expect(xterm.rows).toBe(24)
    expect(term._sendResize).not.toHaveBeenCalled()
  })

  it('a standalone claim uses the native wrapper size and takes ownership', () => {
    const { term, xterm, send } = makeTerm(120, 40)
    term._isOwner = false
    term._claimNeeded = true
    xterm.cols = 80
    xterm.rows = 24

    term._maybeSendClaim()

    expect(lastSent(send)).toEqual({ type: 'claim', cols: 120, rows: 40 })
    expect(term._isOwner).toBe(true)
    expect(term._claimNeeded).toBe(false)
    expect(term._knownPtyCols).toBe(120)
    expect(term._knownPtyRows).toBe(40)
  })

  it('carries the claim on the next input so resize-then-write is ordered', () => {
    const { term, send } = makeTerm(120, 40)
    term._isOwner = false
    term._claimNeeded = true

    term.sendData('a')

    expect(lastSent(send)).toEqual({
      type: 'input',
      data: 'a',
      claim: { cols: 120, rows: 40 },
    })
    expect(term._isOwner).toBe(true)
  })

  it('an owner refits locally after claiming without sending a redundant resize', () => {
    const { term, xterm } = makeTerm(120, 40)
    term._isOwner = false
    term._claimNeeded = true
    xterm.cols = 80
    xterm.rows = 24

    term._maybeSendClaim()
    term._settleRefit()

    expect(xterm.cols).toBe(120)
    expect(xterm.rows).toBe(40)
    expect(term._sendResize).not.toHaveBeenCalled()
  })

  it('queues a claim during a replay and sends it after replay_end', () => {
    const { term, send } = makeTerm(120, 40)
    term._isOwner = false
    term._claimNeeded = true
    term._knownPtyCols = 80
    term._knownPtyRows = 24

    term._handleReplayBegin(80, 24)
    term._maybeSendClaim()
    expect(term._claimQueued).toBe(true)
    expect(send).not.toHaveBeenCalled()

    term._handleReplayEnd()

    expect(term._claimQueued).toBe(false)
    expect(term._isOwner).toBe(true)
    expect(lastSent(send)).toEqual({ type: 'claim', cols: 120, rows: 40 })
  })

  it('snapshot request carries the ownership claim', () => {
    const { term, send } = makeTerm(120, 40)
    term._snapshotPending = true
    term._isOwner = true

    term._maybeSendSnapshotRequest()

    expect(lastSent(send)).toMatchObject({
      type: 'snapshot_request',
      cols: 120,
      rows: 40,
      claim: true,
    })
  })

  it('a non-owner snapshot request does not claim', () => {
    const { term, send } = makeTerm(120, 40)
    term._snapshotPending = true
    term._isOwner = false

    term._maybeSendSnapshotRequest()

    expect(lastSent(send)).toMatchObject({
      type: 'snapshot_request',
      cols: 120,
      rows: 40,
      claim: false,
    })
  })
})

describe('peer-follow refit', () => {
  it('a non-owner does not send a resize when its wrapper changes', () => {
    const { term } = makeTerm(120, 40)
    term._isOwner = false

    term._doFitAndResize(true)

    expect(term._sendResize).not.toHaveBeenCalled()
  })
})

describe('hidden panes', () => {
  it('does not resize a hidden xterm when following a peer', () => {
    const { term, xterm } = makeTerm(120, 40, false)
    term._isOwner = true

    term._followPeerResize(80, 24)

    expect(xterm.resize).not.toHaveBeenCalled()
    expect(term._knownPtyCols).toBe(80)
    expect(term._knownPtyRows).toBe(24)
    expect(term._claimNeeded).toBe(true)
  })

  it('does not apply the owner grid to a hidden xterm', () => {
    const { term, xterm } = makeTerm(120, 40, false)
    term._isOwner = false
    term._knownPtyCols = 80
    term._knownPtyRows = 24

    expect(term._applyOwnerGrid()).toBeNull()
    expect(xterm.resize).not.toHaveBeenCalled()
  })

  it('drops a replay received while hidden and keeps a snapshot owed', () => {
    const { term, xterm } = makeTerm(120, 40, false)
    term._snapshotPending = true

    term._handleReplayBegin(80, 24)
    term._appendToTransaction('snapshot-bytes')
    term._handleReplayEnd()

    expect(xterm.resize).not.toHaveBeenCalled()
    expect(term._transactionBuffer).toEqual([])
    expect(term._snapshotPending).toBe(true)
  })

  it('refuses a pathological grid before touching xterm', () => {
    const { term, xterm } = makeTerm(120, 40)
    term.fitAddon.proposeDimensions = vi.fn(() => ({ cols: 5000, rows: 900 }))

    expect(term._fitLocal()).toBeNull()
    expect(xterm.resize).not.toHaveBeenCalled()
    expect(term.fitAddon.fit).not.toHaveBeenCalled()
  })
})

describe('snapshot handshake recovery', () => {
  it('retries a snapshot_request that produces no replay', async () => {
    const { term, send } = makeTerm()
    term._snapshotPending = true
    term._maybeSendSnapshotRequest()
    expect(send).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync((TerminalInstance as any).SNAPSHOT_RETRY_MS)

    expect(send).toHaveBeenCalledTimes(2)
    expect(term._snapshotAttempts).toBe(1)
  })

  it('sends a pending snapshot request even when the recovered wrapper has the previous geometry', () => {
    const { term, send } = makeTerm(120, 40)
    term._snapshotPending = true

    term._doFitAndResize()

    expect(send).toHaveBeenCalledTimes(1)
  })

  it('the owner re-requests when the wrapper changed during a replay', () => {
    const { term } = makeTerm(120, 40)
    term._isOwner = true
    term._snapshotPending = true

    term._handleReplayBegin(80, 24)
    term._handleReplayEnd()

    expect(term._snapshotPending).toBe(true)
    expect(term._snapshotAttempts).toBe(1)
    expect(term._scheduleSettleResize).toHaveBeenCalled()
  })

  it('a non-owner accepts a replay already encoded at the owner grid', () => {
    const { term } = makeTerm(120, 40)
    term._isOwner = false
    term._snapshotPending = true
    term._knownPtyCols = 80
    term._knownPtyRows = 24

    term._handleReplayBegin(80, 24)
    term._handleReplayEnd()

    expect(term._snapshotPending).toBe(false)
    expect(term._snapshotAttempts).toBe(0)
  })

  it('a non-owner re-requests when the owner grid changed during its replay', () => {
    const { term } = makeTerm(120, 40)
    term._isOwner = false
    term._snapshotPending = true
    term._knownPtyCols = 100
    term._knownPtyRows = 30

    term._handleReplayBegin(80, 24)
    term._handleReplayEnd()

    expect(term._snapshotPending).toBe(true)
    expect(term._snapshotAttempts).toBe(1)
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
