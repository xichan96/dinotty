import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import type { SyncClientMsg } from '../types/protocol'

// The open/close paths only need the sender and the MC mirror; every other
// option is an inert stub so importing the module does not drag in transport.
vi.mock('../composables/useTabApi', () => ({ apiCreateSshTab: vi.fn() }))

// These tests are about the callbacks, not about which op a server can take:
// the capability answer is pinned to "understands `set`" so every case below
// exercises the ordinary path. The downgrade has its own file.
vi.mock('../composables/serverCapabilities', () => ({
  cachedCapabilities: () => new Set(['mc_op_set']),
  ensureCapabilities: async () => new Set(['mc_op_set']),
}))

import { useOverviewCallbacks } from '../composables/useOverviewCallbacks'
import { setMcSender, useMissionControlState } from '../composables/useMissionControlState'

const mcState = useMissionControlState()
const sent: SyncClientMsg[] = []

// The callbacks hand their op to `sendMcOp`, which is the one exit every MC op
// leaves by - so the spy belongs on that exit, not on the `sendSync` the
// callbacks happen to be holding.
setMcSender((op) => sent.push({ type: 'mission_control_op', op }))

function setup() {
  return useOverviewCallbacks({
    tabs: ref([]) as never,
    activePaneId: ref(null),
    activeWorkspaceId: ref(null),
    termRefs: {},
    session: { renameTab: vi.fn() },
    activateTab: vi.fn(),
    activateWorkspace: vi.fn(async () => true),
    closeTab: vi.fn(async () => {}),
    requestCloseTab: vi.fn(),
    newTab: vi.fn(async () => {}),
    persist: vi.fn(),
    commitLocalActivePane: vi.fn(),
    focusActive: vi.fn(),
    sendSync: (msg: SyncClientMsg) => sent.push(msg),
  })
}

/** The single MC op the last call pushed, or undefined if it pushed nothing. */
function lastMcOp() {
  const ops = sent.filter((m) => m.type === 'mission_control_op')
  const last = ops[ops.length - 1]
  return last?.type === 'mission_control_op' ? last.op : undefined
}

beforeEach(() => {
  sent.length = 0
  mcState.open = false
})

describe('useOverviewCallbacks mission control ops', () => {
  // `set` carries the target state, so the server can be told what we want
  // rather than how much to change. A `toggle` here would flip the wrong way
  // whenever the local mirror lags the server.
  it('opening asks for open:true', () => {
    setup().openOverview()
    expect(lastMcOp()).toEqual({ kind: 'set', open: true })
  })

  it('closing asks for open:false', () => {
    mcState.open = true
    setup().closeOverview()
    expect(lastMcOp()).toEqual({ kind: 'set', open: false })
  })

  it('never sends a toggle', () => {
    mcState.open = false
    setup().openOverview()
    mcState.open = true
    setup().closeOverview()
    expect(sent.map((m) => JSON.stringify(m)).join()).not.toContain('toggle')
  })

  it('stays quiet when the state already matches', () => {
    mcState.open = false
    setup().closeOverview()
    mcState.open = true
    setup().openOverview()
    expect(sent).toEqual([])
  })
})
