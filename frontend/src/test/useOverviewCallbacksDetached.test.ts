import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { createPinia, setActivePinia } from 'pinia'

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
}))

vi.mock('../composables/useTransport', () => ({
  isTauri: () => true,
  tauriInvoke: mocks.invoke,
}))

vi.mock('../composables/useTabApi', () => ({ apiCreateSshTab: vi.fn() }))

// Pin the capability answer so `sendMcOp` takes the ordinary `set` path.
vi.mock('../composables/serverCapabilities', () => ({
  cachedCapabilities: () => new Set(['mc_op_set']),
  ensureCapabilities: async () => new Set(['mc_op_set']),
}))

import { useOverviewCallbacks } from '../composables/useOverviewCallbacks'
import { useDetachedWindowsStore } from '../stores/detachedWindowsStore'
import { setMcSender, useMissionControlState } from '../composables/useMissionControlState'
import type { SyncClientMsg } from '../types/protocol'

const mcState = useMissionControlState()
let sent: SyncClientMsg[] = []

function setup() {
  const activateTab = vi.fn(async () => true)
  const callbacks = useOverviewCallbacks({
    tabs: ref([]) as never,
    activePaneId: ref<string | null>(null),
    activeWorkspaceId: ref<string | null>(null),
    termRefs: {},
    session: { renameTab: vi.fn() },
    activateTab,
    activateWorkspace: vi.fn(async () => true),
    closeTab: vi.fn(async () => {}),
    requestCloseTab: vi.fn(),
    newTab: vi.fn(async () => {}),
    persist: vi.fn(),
    commitLocalActivePane: vi.fn(),
    focusActive: vi.fn(),
    sendSync: (msg: SyncClientMsg) => sent.push(msg),
  })
  return { callbacks, activateTab }
}

beforeEach(() => {
  setActivePinia(createPinia())
  mocks.invoke.mockReset()
  mcState.open = false
  sent = []
  setMcSender((op) => sent.push({ type: 'mission_control_op', op }))
})

describe('useOverviewCallbacks activating a detached tab', () => {
  it('focuses the detached window and never activates the tab', async () => {
    const store = useDetachedWindowsStore()
    mocks.invoke.mockResolvedValue([{ tab_id: 'a', label: 'tab-a', title: null }])
    await store.refreshFromRust()
    mocks.invoke.mockClear()
    mocks.invoke.mockResolvedValue(undefined)
    mcState.open = true

    const { callbacks, activateTab } = setup()
    callbacks.onOverviewActivate('a')

    expect(mocks.invoke).toHaveBeenCalledWith('focus_tab_window', { tabId: 'a' })
    expect(activateTab).not.toHaveBeenCalled()
    expect(sent).toContainEqual({
      type: 'mission_control_op',
      op: { kind: 'set', open: false },
    })
  })

  it('keeps the ordinary activation path for a tab that is not detached', () => {
    const { callbacks, activateTab } = setup()

    callbacks.onOverviewActivate('a')

    expect(activateTab).toHaveBeenCalledWith('a')
    expect(mocks.invoke).not.toHaveBeenCalledWith('focus_tab_window', expect.anything())
  })
})
