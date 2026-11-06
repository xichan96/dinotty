import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

/**
 * The detached window routes every layout mutation — split, close, focus,
 * resize — through `useSplitPane`'s `sendLayoutSync`. All of them must carry
 * `activate: false` so the main window's global focus is never moved.
 */

const mocks = vi.hoisted(() => ({
  sendLayoutSync: vi.fn(),
  sendSync: vi.fn(),
  setSshAuthPromptHandler: vi.fn(),
  connectSyncWS: vi.fn(async () => {}),
  isConnected: vi.fn(() => true),
  splitOpts: undefined as
    | {
        sendLayoutSync: (tabPaneId: string, layout: unknown, activePaneId: string) => void
      }
    | undefined,
}))

vi.mock('../composables/apiBase', () => ({
  getApiBase: async () => '',
  wsUrl: (path: string) => `ws://localhost${path}`,
  apiUrl: (path: string) => path,
  authFetch: async () => ({ ok: true }),
  hasAuthToken: () => false,
}))

vi.mock('../composables/useSyncWebSocket', () => ({
  useSyncWebSocket: () => ({
    sendLayoutSync: mocks.sendLayoutSync,
    sendSync: mocks.sendSync,
    setSshAuthPromptHandler: mocks.setSshAuthPromptHandler,
    connectSyncWS: mocks.connectSyncWS,
    isConnected: mocks.isConnected,
  }),
}))

vi.mock('../composables/useSplitPane', () => ({
  useSplitPane: (opts: {
    sendLayoutSync: (tabPaneId: string, layout: unknown, activePaneId: string) => void
  }) => {
    mocks.splitOpts = opts
    return {
      focusPane: vi.fn(),
      closePane: vi.fn(async () => true),
      reorderPane: vi.fn(),
      onTerminalInput: vi.fn(),
      splitPane: vi.fn(async () => null),
      toggleBroadcast: vi.fn(),
    }
  },
}))

vi.mock('../composables/useTransport', () => ({
  isTauri: () => false,
  tauriInvoke: vi.fn(async () => undefined),
}))

vi.mock('../composables/useTerminal', () => ({
  setActivePaneId: vi.fn(),
}))

import { useDetachedTab } from '../composables/useDetachedTab'
import { useSessionStore } from '../stores/sessionStore'
import type { TerminalTab } from '../types/pane'

function seedTab(): TerminalTab {
  const tab: TerminalTab = {
    type: 'terminal',
    paneId: 'tab-1',
    layout: { type: 'leaf', paneId: 'pane-1', title: 'Terminal', ratio: 1, zoomed: false },
    activePaneId: 'pane-1',
    paneMru: ['pane-1'],
    broadcastMode: false,
    broadcastActivity: 0,
  }
  useSessionStore().setTabs([tab])
  return tab
}

describe('useDetachedTab layout activation', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    mocks.splitOpts = undefined
  })

  it('passes activate:false to splits, closes, and focus changes', () => {
    seedTab()
    useDetachedTab('tab-1')

    expect(mocks.splitOpts).toBeDefined()
    mocks.splitOpts!.sendLayoutSync('tab-1', { type: 'leaf', paneId: 'pane-1' }, 'pane-1')

    expect(mocks.sendLayoutSync).toHaveBeenCalledWith(
      'tab-1',
      { type: 'leaf', paneId: 'pane-1' },
      'pane-1',
      { activate: false }
    )
  })

  it('passes activate:false on divider resize', () => {
    const tab = seedTab()
    const detached = useDetachedTab('tab-1')

    detached.onDividerDragEnd()

    expect(mocks.sendLayoutSync).toHaveBeenCalledWith(tab.paneId, tab.layout, tab.activePaneId, {
      activate: false,
    })
  })
})
