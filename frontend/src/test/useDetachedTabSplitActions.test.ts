import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { flushPromises } from '@vue/test-utils'
import { nextTick } from 'vue'

/**
 * Split-pane actions, link handling, SSH auth and persistence guards for the
 * detached terminal window. Every layout mutation must reuse `useSplitPane`
 * with `activate:false` and a no-op persist; the window must never write the
 * main window's `dinotty_tabs` snapshot.
 */

const mocks = vi.hoisted(() => ({
  sendLayoutSync: vi.fn(),
  sendSync: vi.fn(),
  setSshAuthPromptHandler: vi.fn(),
  connectSyncWS: vi.fn(async () => {}),
  isConnected: vi.fn(() => true),
  openUrlInSystemBrowser: vi.fn(async () => true),
  splitPane: vi.fn(async () => null),
  focusPane: vi.fn(),
  closePane: vi.fn(async () => true),
  reorderPane: vi.fn(),
  onTerminalInput: vi.fn(),
  toggleBroadcast: vi.fn(),
  syncOpts: undefined as { persist: () => void } | undefined,
  splitOpts: undefined as { persist: () => void } | undefined,
  sshPromptHandler: undefined as
    | ((paneId: string, prompts: Array<{ prompt: string; echo: boolean }>) => void)
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
  useSyncWebSocket: (opts: { persist: () => void }) => {
    mocks.syncOpts = opts
    return {
      sendLayoutSync: mocks.sendLayoutSync,
      sendSync: mocks.sendSync,
      sendSshAuthResponse: (paneId: string, responses: string[]) =>
        mocks.sendSync({ type: 'ssh_auth_response', pane_id: paneId, responses }),
      setSshAuthPromptHandler: (handler: typeof mocks.sshPromptHandler) => {
        mocks.sshPromptHandler = handler
      },
      connectSyncWS: mocks.connectSyncWS,
      isConnected: mocks.isConnected,
    }
  },
}))

vi.mock('../composables/useSplitPane', () => ({
  useSplitPane: (opts: { persist: () => void }) => {
    mocks.splitOpts = opts
    return {
      focusPane: mocks.focusPane,
      closePane: mocks.closePane,
      reorderPane: mocks.reorderPane,
      onTerminalInput: mocks.onTerminalInput,
      splitPane: mocks.splitPane,
      toggleBroadcast: mocks.toggleBroadcast,
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

vi.mock('../utils/openExternalUrl', () => ({
  openUrlInSystemBrowser: mocks.openUrlInSystemBrowser,
}))

import { useDetachedTab } from '../composables/useDetachedTab'
import { t } from '../composables/useI18n'
import { useSessionStore } from '../stores/sessionStore'
import type { TerminalTab } from '../types/pane'

const TOAST = { info: vi.fn(), error: vi.fn() }

function leaf(paneId: string, title: string) {
  return { type: 'leaf' as const, paneId, title, ratio: 0.5, zoomed: false }
}

function seedTab(split = true): TerminalTab {
  const tab: TerminalTab = {
    type: 'terminal',
    paneId: 'tab-1',
    layout: split
      ? {
          type: 'split',
          id: 'root',
          direction: 'horizontal',
          ratios: [0.5, 0.5],
          children: [leaf('pane-a', 'Alpha'), leaf('pane-b', 'Beta')],
        }
      : leaf('pane-a', 'Alpha'),
    activePaneId: 'pane-a',
    paneMru: split ? ['pane-a', 'pane-b'] : ['pane-a'],
    broadcastMode: false,
    broadcastActivity: 0,
  }
  useSessionStore().setTabs([tab])
  useSessionStore().activePaneId = 'tab-1'
  return tab
}

function mountDetached() {
  return useDetachedTab('tab-1', { toast: TOAST })
}

beforeEach(() => {
  setActivePinia(createPinia())
  vi.clearAllMocks()
  mocks.syncOpts = undefined
  mocks.splitOpts = undefined
  mocks.sshPromptHandler = undefined
  mocks.openUrlInSystemBrowser.mockResolvedValue(true)
})

describe('useDetachedTab split actions', () => {
  it('forwards split, focus, reorder and close to useSplitPane', () => {
    seedTab()
    const detached = mountDetached()

    detached.onSplitHorizontal()
    detached.onSplitVertical()
    detached.onNewLocalTerminal()

    expect(mocks.splitPane).toHaveBeenNthCalledWith(1, 'horizontal')
    expect(mocks.splitPane).toHaveBeenNthCalledWith(2, 'vertical')
    expect(mocks.splitPane).toHaveBeenNthCalledWith(3, 'horizontal', true)

    detached.onFocus('pane-b')
    expect(mocks.focusPane).toHaveBeenCalledWith('pane-b')

    detached.onReorder('pane-a', 'pane-b', 'left')
    expect(mocks.reorderPane).toHaveBeenCalledWith('pane-a', 'pane-b', 'left')

    detached.onClosePane('pane-b')
    expect(mocks.closePane).toHaveBeenCalledWith('pane-b')
  })

  it('exposes close only while the tab is split and refuses to close a lone pane', () => {
    seedTab(true)
    const split = mountDetached()
    expect(split.allowClose.value).toBe(true)

    seedTab(false)
    const single = mountDetached()
    expect(single.allowClose.value).toBe(false)

    single.onClosePane('pane-a')
    expect(mocks.closePane).not.toHaveBeenCalled()
  })

  it('sends layout sync with activate:false and never persists tabs', async () => {
    seedTab()
    const detached = mountDetached()
    const setItem = vi.spyOn(Storage.prototype, 'setItem')

    detached.onDividerDragEnd()
    expect(mocks.sendLayoutSync).toHaveBeenCalledWith(
      'tab-1',
      expect.objectContaining({ type: 'split' }),
      'pane-a',
      { activate: false }
    )

    // Both persistence hooks are no-ops by contract.
    mocks.syncOpts!.persist()
    mocks.splitOpts!.persist()
    await flushPromises()

    const keys = setItem.mock.calls.map((call) => String(call[0]))
    expect(keys.some((key) => key.includes('dinotty_tabs'))).toBe(false)
    setItem.mockRestore()
  })

  it('mirrors the session store broadcast getter', async () => {
    seedTab(true)
    const detached = mountDetached()
    const session = useSessionStore()

    expect(detached.broadcastActive.value).toBe(false)
    // Mutate through the store proxy so the computed sees the change.
    const tab = session.tabs.find((candidate) => candidate.paneId === 'tab-1') as TerminalTab
    tab.broadcastMode = true
    await nextTick()
    expect(session.isBroadcastActive).toBe(true)
    expect(detached.broadcastActive.value).toBe(true)

    // Broadcast needs more than one pane to mean anything.
    seedTab(false)
    const single = mountDetached()
    ;(session.tabs.find((candidate) => candidate.paneId === 'tab-1') as TerminalTab).broadcastMode =
      true
    await nextTick()
    expect(single.broadcastActive.value).toBe(false)
  })
})

describe('useDetachedTab link handling', () => {
  it('opens external URLs with the shell plugin', async () => {
    seedTab()
    const detached = mountDetached()

    detached.onPreviewLink('pane-a', 'https://example.com/docs')
    await flushPromises()

    expect(mocks.openUrlInSystemBrowser).toHaveBeenCalledWith('https://example.com/docs')
    expect(TOAST.info).not.toHaveBeenCalled()
  })

  it('toasts unsupported preview links instead of opening them', async () => {
    seedTab()
    const detached = mountDetached()

    detached.onPreviewLink('pane-a', 'file:///tmp/readme.md')
    await flushPromises()

    expect(mocks.openUrlInSystemBrowser).not.toHaveBeenCalled()
    expect(TOAST.info).toHaveBeenCalledWith(t('detached.previewPlaceholder'))
  })

  it('documents the file-link gap with a toast', () => {
    seedTab()
    const detached = mountDetached()

    detached.onFileClick('/tmp/main.ts', 3, 4)
    detached.onLinkActivate()

    expect(TOAST.info).toHaveBeenCalledWith(t('detached.fileLinkUnavailable'))
  })
})

describe('useDetachedTab SSH auth', () => {
  it('shows pending auth prompts and sends the response over sync', () => {
    seedTab()
    const detached = mountDetached()

    expect(mocks.sshPromptHandler).toBeDefined()
    mocks.sshPromptHandler!('pane-b', [{ prompt: 'Password:', echo: false }])

    expect(detached.sshAuthVisible.value).toBe(true)
    expect(detached.sshAuthHost.value).toBe('Beta')
    expect(detached.sshAuthPrompts.value).toEqual([{ prompt: 'Password:', echo: false }])

    detached.onSshAuthSubmit(['secret'])
    expect(mocks.sendSync).toHaveBeenCalledWith({
      type: 'ssh_auth_response',
      pane_id: 'pane-b',
      responses: ['secret'],
    })
    expect(detached.sshAuthVisible.value).toBe(false)
  })

  it('hides the dialog on cancel without sending a response', () => {
    seedTab()
    const detached = mountDetached()
    mocks.sshPromptHandler!('pane-a', [{ prompt: 'Password:', echo: false }])

    detached.onSshAuthCancel()

    expect(detached.sshAuthVisible.value).toBe(false)
    expect(mocks.sendSync).not.toHaveBeenCalled()
  })
})
