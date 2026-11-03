import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
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

// The composable pulls the translator itself; keep assertions on keys.
vi.mock('../composables/useI18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}))

import { useOverviewCallbacks } from '../composables/useOverviewCallbacks'
import { useDetachedWindowsStore } from '../stores/detachedWindowsStore'
import { setMcSender, useMissionControlState } from '../composables/useMissionControlState'
import type { SyncClientMsg } from '../types/protocol'

const mcState = useMissionControlState()
let sent: SyncClientMsg[] = []

function setup(toast = { error: vi.fn() }) {
  const activateTab = vi.fn(async () => true)
  const closeTab = vi.fn(async () => {})
  const requestCloseTab = vi.fn()
  const termFocus = vi.fn()
  const callbacks = useOverviewCallbacks({
    tabs: ref([]) as never,
    activePaneId: ref<string | null>(null),
    activeWorkspaceId: ref<string | null>(null),
    termRefs: { a: { focus: termFocus } },
    session: { renameTab: vi.fn() },
    activateTab,
    activateWorkspace: vi.fn(async () => true),
    closeTab,
    requestCloseTab,
    newTab: vi.fn(async () => {}),
    persist: vi.fn(),
    commitLocalActivePane: vi.fn(),
    focusActive: vi.fn(),
    sendSync: (msg: SyncClientMsg) => sent.push(msg),
    toast,
  })
  return { callbacks, activateTab, closeTab, requestCloseTab, toast, termFocus }
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

  async function detachInStore(store: ReturnType<typeof useDetachedWindowsStore>, title?: string) {
    mocks.invoke.mockResolvedValueOnce([
      { tab_id: 'a', label: 'tab-a', title: title ?? null },
    ])
    await store.refreshFromRust()
    mocks.invoke.mockReset()
  }

  it('refreshes the registry and activates normally when the window is gone', async () => {
    const store = useDetachedWindowsStore()
    await detachInStore(store, 'Alpha')
    mocks.invoke.mockImplementation(async (command: string) => {
      if (command === 'focus_tab_window') throw new Error('no such window')
      if (command === 'list_detached_tab_windows') return []
      return undefined
    })
    mcState.open = true

    const { callbacks, activateTab, toast, termFocus } = setup()
    callbacks.onOverviewActivate('a')
    await flushPromises()

    expect(store.isDetached('a')).toBe(false)
    expect(activateTab).toHaveBeenCalledWith('a')
    expect(toast.error).toHaveBeenCalledWith('detached.focusFailed')
    expect(termFocus).toHaveBeenCalled()
  })

  it('reports a failed focus without activating when the window still exists', async () => {
    const store = useDetachedWindowsStore()
    await detachInStore(store)
    mocks.invoke.mockImplementation(async (command: string) => {
      if (command === 'focus_tab_window') throw new Error('display asleep')
      if (command === 'list_detached_tab_windows')
        return [{ tab_id: 'a', label: 'tab-a', title: null }]
      return undefined
    })
    mcState.open = true

    const { callbacks, activateTab, toast } = setup()
    callbacks.onOverviewActivate('a')
    await flushPromises()

    expect(store.isDetached('a')).toBe(true)
    expect(activateTab).not.toHaveBeenCalled()
    expect(toast.error).toHaveBeenCalledWith('detached.focusFailed')
  })

  it('closes a terminal through closeTab without the generic prompt', () => {
    const { callbacks, closeTab, requestCloseTab } = setup()

    callbacks.onOverviewCloseTerminal('a')

    expect(closeTab).toHaveBeenCalledWith('a')
    expect(requestCloseTab).not.toHaveBeenCalled()
  })
})
