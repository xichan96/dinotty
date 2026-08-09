import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref, shallowRef } from 'vue'
import type { Tab } from '../types/pane'
import type { Workspace } from '../types/workspace'

const mocks = vi.hoisted(() => ({
  apiCloseTab: vi.fn(),
  apiApplyTemplate: vi.fn(),
  clearFileWorkspaceState: vi.fn(),
  invalidatePluginPreview: vi.fn(),
}))

vi.mock('../composables/useTabApi', () => ({
  apiActivatePane: vi.fn(),
  apiCloseTab: mocks.apiCloseTab,
  apiCreateTab: vi.fn(),
  apiCreateSshTab: vi.fn(),
}))
vi.mock('../composables/useTemplateApi', () => ({ apiApplyTemplate: mocks.apiApplyTemplate }))
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

function setup(options: {
  activeWorkspaceId?: string | null
  matchWorkspace?: () => Workspace | null
} = {}) {
  const tabs = ref<Tab[]>([
    terminalTab('tab-closing', 'pane-closing'),
    terminalTab('tab-remaining', 'pane-remaining'),
  ])
  const activePaneId = ref<string | null>('tab-closing')
  const termRef = { focus: vi.fn() }
  const termRefs: Record<string, unknown> = { 'pane-closing': termRef }
  const clearForPaneIds = vi.fn()
  const activeWorkspaceId = ref<string | null>(options.activeWorkspaceId ?? null)
  const activateWorkspace = vi.fn(async () => true)
  const lifecycle = useTabLifecycle({
    tabs,
    activePaneId,
    session: { reorderTab: vi.fn(), renameTab: vi.fn() },
    ui: { requestCloseTab: vi.fn(), requestClosePane: vi.fn(), cancelClose: vi.fn() },
    appSettings: {},
    activeWorkspaceId,
    workspaces: ref<Workspace[]>([]),
    matchWorkspace: options.matchWorkspace ?? (() => null),
    activateWorkspace,
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
  return { lifecycle, tabs, termRefs, termRef, clearForPaneIds, activeWorkspaceId, activateWorkspace }
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

describe('useTabLifecycle template workspace identity', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.apiApplyTemplate.mockResolvedValue({
      tab_id: 'template-tab',
      layout: {
        type: 'leaf',
        paneId: 'template-pane',
        title: 'Template',
        ratio: 1,
        zoomed: false,
      },
      cwd: '/workspace/default/project',
      connection_id: null,
      warnings: [],
    })
  })

  const defaultWorkspace: Workspace = {
    id: '__default__',
    name: 'Default',
    path: '/workspace/default',
    order: 0,
  }

  it('stores default template ownership as undefined without a same-workspace hop', async () => {
    const { lifecycle, tabs, activateWorkspace } = setup({
      matchWorkspace: () => defaultWorkspace,
    })

    await lifecycle.applyTemplate('template-default')

    expect(activateWorkspace).not.toHaveBeenCalled()
    expect(tabs.value.find((tab) => tab.paneId === 'template-tab')).toMatchObject({
      workspaceId: undefined,
    })
  })

  it('deactivates to the default workspace before selecting a default template tab', async () => {
    const { lifecycle, tabs, activateWorkspace } = setup({
      activeWorkspaceId: 'workspace-a',
      matchWorkspace: () => defaultWorkspace,
    })

    await lifecycle.applyTemplate('template-default')

    expect(activateWorkspace).toHaveBeenCalledOnce()
    expect(activateWorkspace).toHaveBeenCalledWith(null)
    expect(tabs.value.find((tab) => tab.paneId === 'template-tab')).toMatchObject({
      workspaceId: undefined,
    })
  })
})
