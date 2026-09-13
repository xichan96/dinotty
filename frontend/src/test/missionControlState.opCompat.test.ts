import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { McOp } from '../types/protocol'

// What the active server says it understands is the subject of this file, so it
// is injected rather than fetched. `vi.hoisted` is what puts the knob in scope
// before the mock factory runs.
const caps = vi.hoisted(() => ({ current: null as Set<string> | null }))

vi.mock('../composables/serverCapabilities', () => ({
  cachedCapabilities: () => caps.current,
  ensureCapabilities: async () => caps.current,
}))

import {
  markMcSnapshot,
  sendMcOp,
  setMcSender,
  useMissionControlState,
} from '../composables/useMissionControlState'

const mcState = useMissionControlState()
const sent: McOp[] = []

setMcSender((op) => sent.push(op))

/// A server that answered "I do not know `set`" - an older build.
const OLD_SERVER = new Set<string>()
/// A server that answered "I understand `set`".
const NEW_SERVER = new Set(['mc_op_set'])

/// Let the not-yet-cached path's lookup settle.
const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

beforeEach(() => {
  sent.length = 0
  mcState.open = false
  mcState.synced = false
  caps.current = NEW_SERVER
})

describe('sending a Mission Control op to a server that knows `set`', () => {
  it('passes the op through unchanged', () => {
    sendMcOp({ kind: 'set', open: true })
    expect(sent).toEqual([{ kind: 'set', open: true }])
  })

  it('needs no synced mirror, because `set` is idempotent', () => {
    sendMcOp({ kind: 'set', open: true })
    expect(sent).toEqual([{ kind: 'set', open: true }])
  })
})

describe('sending a Mission Control op to a server that only knows `toggle`', () => {
  beforeEach(() => {
    caps.current = OLD_SERVER
  })

  // `toggle` is the only op that server has, so it is the only way to open the
  // overview there at all - and it may be sent only when the mirror is a
  // reading of *that* server and disagrees with the target.
  it('drives open with a toggle once the mirror describes the server', () => {
    markMcSnapshot()
    sendMcOp({ kind: 'set', open: true })
    expect(sent).toEqual([{ kind: 'toggle' }])
  })

  it('drives closed with a toggle too', () => {
    mcState.open = true
    markMcSnapshot()
    sendMcOp({ kind: 'set', open: false })
    expect(sent).toEqual([{ kind: 'toggle' }])
  })

  // The switch case: the mirror was cleared on the way over, so a click that
  // races the new server's `mc_snapshot` must decline. A `toggle` on a guess
  // would close the overview for every *other* device on that server, which is
  // the whole reason `set` exists.
  it('declines while the mirror is a leftover from the previous server', () => {
    sendMcOp({ kind: 'set', open: true })
    expect(sent).toEqual([])
  })

  it('sends nothing when the server is already in the state asked for', () => {
    mcState.open = true
    markMcSnapshot()
    sendMcOp({ kind: 'set', open: true })
    expect(sent).toEqual([])
  })
})

describe('when the server could not be asked', () => {
  beforeEach(() => {
    caps.current = null
  })

  // "We could not ask" is not evidence the server is old. Sending the intent
  // unchanged is exactly what a client that never asked would do, so a
  // transient failure cannot silently change which op goes out.
  it('sends the op unchanged rather than guessing', async () => {
    sendMcOp({ kind: 'set', open: true })
    await flush()
    expect(sent).toEqual([{ kind: 'set', open: true }])
  })
})

describe('ops other than `set`', () => {
  it('are never held back, whatever the capability answer', () => {
    caps.current = OLD_SERVER
    sendMcOp({ kind: 'navigate', dir: 'down' })
    sendMcOp({ kind: 'cancel' })
    sendMcOp({ kind: 'jump', workspace_id: null })
    expect(sent).toEqual([
      { kind: 'navigate', dir: 'down' },
      { kind: 'cancel' },
      { kind: 'jump', workspace_id: null },
    ])
  })
})
