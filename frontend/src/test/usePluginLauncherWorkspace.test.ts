import { describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import type { LoadedPlugin } from '../composables/usePluginLoader'
import type { PaneLayout, Tab, TerminalTab } from '../types/pane'

const mocks = vi.hoisted(() => ({
  apiCreatePluginTab: vi.fn(),
}))

vi.mock('../composables/useTabApi', () => ({
  apiCreatePluginTab: mocks.apiCreatePluginTab,
}))

import { usePluginLauncher } from '../composables/usePluginLauncher'

function leaf(paneId: string): PaneLayout {
  return { type: 'leaf', paneId, title: paneId, ratio: 1, zoomed: false }
}

function plugin(): LoadedPlugin {
  return {
    id: 'session-browser',
    manifest: { id: 'session-browser', name: 'Session Browser', version: '1.0.0' },
    module: { activate: vi.fn() },
    exports: null,
    state: 'active',
  }
}

function terminal(paneId: string): TerminalTab {
  return {
    type: 'terminal',
    paneId,
    layout: leaf(paneId),
    activePaneId: paneId,
    paneMru: [paneId],
    broadcastMode: false,
    broadcastActivity: 0,
    previewVisible: false,
    previewAddress: '',
    previewUrl: '',
    previewKind: 'web',
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function setup(tabsValue: Tab[]) {
  const tabs = ref<Tab[]>(tabsValue)
  const activeWorkspaceId = ref<string | null>('workspace-a')
  const persist = vi.fn()
  const subject = usePluginLauncher({
    tabs,
    activeWorkspaceId,
    loadedPlugins: new Map([['session-browser', plugin()]]),
    syncWs: { sendSync: vi.fn() },
    ensureSplitRoot: (layout) => layout,
    activateTab: vi.fn(),
    commitLocalActivePane: vi.fn(),
    persist,
    focusActive: vi.fn(),
  })
  return { tabs, activeWorkspaceId, persist, subject }
}

describe('usePluginLauncher workspace snapshot', () => {
  it('scenario 5: backfills a tab_created winner from the pre-await workspace snapshot', async () => {
    const pending = deferred<{ tab_id: string; pane_id: string; layout: PaneLayout }>()
    mocks.apiCreatePluginTab.mockReturnValueOnce(pending.promise)
    const { tabs, activeWorkspaceId, subject } = setup([])
    const opening = subject.openPlugin('session-browser')

    const paneId = 'plugin:session-browser:workspace-a'
    const racedTab = terminal(paneId)
    tabs.value.push(racedTab)
    activeWorkspaceId.value = null
    pending.resolve({ tab_id: paneId, pane_id: paneId, layout: leaf(paneId) })
    await opening

    expect(racedTab.workspaceId).toBe('workspace-a')
  })

  it('scenario 5: assigns a newly pushed tab from the pre-await workspace snapshot', async () => {
    const pending = deferred<{ tab_id: string; pane_id: string; layout: PaneLayout }>()
    mocks.apiCreatePluginTab.mockReturnValueOnce(pending.promise)
    const { tabs, activeWorkspaceId, subject } = setup([])
    const opening = subject.openPlugin('session-browser')

    const paneId = 'plugin:session-browser:workspace-a'
    activeWorkspaceId.value = null
    pending.resolve({ tab_id: paneId, pane_id: paneId, layout: leaf(paneId) })
    await opening

    expect(tabs.value).toHaveLength(1)
    expect((tabs.value[0] as TerminalTab).workspaceId).toBe('workspace-a')
  })
})
