import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref, shallowRef } from 'vue'
import type { Tab } from '../types/pane'
import type { Workspace } from '../types/workspace'

const mocks = vi.hoisted(() => ({
  apiCloseTab: vi.fn(),
  clearFileWorkspaceState: vi.fn(),
  invalidatePluginPreview: vi.fn(),
}))

vi.mock('../composables/useTabApi', () => ({
  apiActivatePane: vi.fn(),
  apiCloseTab: mocks.apiCloseTab,
  apiCreateTab: vi.fn(),
  apiCreateSshTab: vi.fn(),
}))
vi.mock('../composables/useTemplateApi', () => ({ apiApplyTemplate: vi.fn() }))
vi.mock('../composables/useTerminal', () => ({ isKbTypingLocked: () => false }))
vi.mock('../composables/useFileWorkspaceState', () => ({
  clearFileWorkspaceState: mocks.clearFileWorkspaceState,
}))
vi.mock('../composables/useTabPreview', () => ({
  invalidatePluginPreview: mocks.invalidatePluginPreview,
}))

import { useTabLifecycle } from '../composables/useTabLifecycle'

function terminalTab(tabId: string, paneId: string): Tab {
  return {
    type: 'terminal',
    paneId: tabId,
    layout: { type: 'leaf', paneId, title: 'Terminal', ratio: 1, zoomed: false },
    activePaneId: paneId,
    paneMru: [paneId],
    broadcastMode: false,
    broadcastActivity: 0,
  }
}

function setup() {
  const tabs = ref<Tab[]>([
    terminalTab('tab-closing', 'pane-closing'),
    terminalTab('tab-remaining', 'pane-remaining'),
  ])
  const activePaneId = ref<string | null>('tab-closing')
  const termRef = { focus: vi.fn() }
  const termRefs: Record<string, unknown> = { 'pane-closing': termRef }
  const clearForPaneIds = vi.fn()
  const lifecycle = useTabLifecycle({
    tabs,
    activePaneId,
    session: { reorderTab: vi.fn(), renameTab: vi.fn() },
    ui: { requestCloseTab: vi.fn(), requestClosePane: vi.fn(), cancelClose: vi.fn() },
    appSettings: {},
    activeWorkspaceId: ref<string | null>(null),
    workspaces: ref<Workspace[]>([]),
    matchWorkspace: () => null,
    activateWorkspace: vi.fn(async () => true),
    cancelPendingWorkspaceActivation: vi.fn(),
    workspaceIdOfTab: () => null,
    activeWorkspacePath: ref<string | undefined>(undefined),
    notif: { clearForPaneIds },
    termRefs,
    isMobile: ref(false),
    tabBarRef: ref(null),
    persist: vi.fn(),
    persistNow: vi.fn(),
    onSshConnectRef: shallowRef(async () => {}),
    sendSync: vi.fn(),
    showCreateTerminalError: vi.fn(),
  })
  return { lifecycle, tabs, termRefs, termRef, clearForPaneIds }
}

describe('useTabLifecycle close consistency', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  it('keeps terminal state intact when the close request fails', async () => {
    mocks.apiCloseTab.mockRejectedValueOnce(new Error('network failure'))
    const { lifecycle, tabs, termRefs, termRef, clearForPaneIds } = setup()

    await lifecycle.closeTab('tab-closing')

    expect(tabs.value.map((tab) => tab.paneId)).toContain('tab-closing')
    expect(termRefs['pane-closing']).toBe(termRef)
    expect(mocks.clearFileWorkspaceState).not.toHaveBeenCalled()
    expect(clearForPaneIds).not.toHaveBeenCalled()
  })

  it('cleans terminal state after the close request succeeds', async () => {
    mocks.apiCloseTab.mockResolvedValueOnce(undefined)
    const { lifecycle, tabs, termRefs, clearForPaneIds } = setup()

    await lifecycle.closeTab('tab-closing')

    expect(tabs.value.map((tab) => tab.paneId)).toEqual(['tab-remaining'])
    expect(termRefs).not.toHaveProperty('pane-closing')
    expect(mocks.clearFileWorkspaceState).toHaveBeenCalledWith('pane-closing')
    expect(clearForPaneIds).toHaveBeenCalledWith(['tab-closing', 'pane-closing'], 'tab_close')
  })
})
