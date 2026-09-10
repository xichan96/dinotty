import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref, shallowRef } from 'vue'
import type { Tab } from '../types/pane'
import type { Workspace } from '../types/workspace'

const api = vi.hoisted(() => ({
  activatePane: vi.fn(),
  closeTab: vi.fn(),
  createTab: vi.fn(),
  createSshTab: vi.fn(),
  getPaneCwd: vi.fn(),
  applyTemplate: vi.fn(),
}))

vi.mock('../composables/useTabApi', () => ({
  apiActivatePane: api.activatePane,
  apiCloseTab: api.closeTab,
  apiCreateTab: api.createTab,
  apiCreateSshTab: api.createSshTab,
  apiGetPaneCwd: api.getPaneCwd,
}))
vi.mock('../composables/useTemplateApi', () => ({
  apiApplyTemplate: api.applyTemplate,
}))
vi.mock('../composables/useTerminal', () => ({
  isKbTypingLocked: () => false,
}))

import { useTabLifecycle } from '../composables/useTabLifecycle'

function setup(options: { inheritCwd?: boolean; tabs?: Tab[]; activePaneId?: string | null } = {}) {
  const showCreateTerminalError = vi.fn()
  const subject = useTabLifecycle({
    tabs: ref<Tab[]>(options.tabs ?? []),
    activePaneId: ref<string | null>(options.activePaneId ?? null),
    session: { reorderTab: vi.fn(), renameTab: vi.fn() },
    ui: { requestCloseTab: vi.fn(), requestClosePane: vi.fn(), cancelClose: vi.fn() },
    appSettings: { inherit_cwd_for_new_tab: options.inheritCwd ?? false },
    activeWorkspaceId: ref<string | null>(null),
    workspaces: ref<Workspace[]>([]),
    matchWorkspace: () => null,
    activateWorkspace: vi.fn(async () => true),
    cancelPendingWorkspaceActivation: vi.fn(),
    workspaceIdOfTab: () => null,
    activeWorkspacePath: ref<string | undefined>(undefined),
    notif: { clearForPaneIds: vi.fn() },
    termRefs: {},
    isMobile: ref(false),
    tabBarRef: ref(null),
    persist: vi.fn(),
    persistNow: vi.fn(),
    onSshConnectRef: shallowRef(async () => {}),
    sendSync: vi.fn(),
    showCreateTerminalError,
  })
  return { subject, showCreateTerminalError }
}

describe('useTabLifecycle shell errors', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  it('reports an interactive terminal creation failure', async () => {
    const { subject, showCreateTerminalError } = setup()
    const error = new Error('create failed')
    api.createTab.mockRejectedValue(error)

    await subject.newTab()

    expect(showCreateTerminalError).toHaveBeenCalledWith(error)
  })

  it('keeps argv failures for the caller without showing a shell settings error', async () => {
    const { subject, showCreateTerminalError } = setup()
    const error = new Error('command failed')
    api.createTab.mockRejectedValue(error)

    await expect(subject.newTab('C:\\workspace', ['command'])).rejects.toBe(error)
    expect(showCreateTerminalError).not.toHaveBeenCalled()
  })

  it('uses the active pane live cwd when new-tab inheritance is enabled', async () => {
    api.createTab.mockResolvedValue({
      tab_id: 'new-tab',
      pane_id: 'new-pane',
      layout: { type: 'leaf', paneId: 'new-pane', title: 'Terminal', ratio: 1, zoomed: false },
      cwd: '/tmp/dinotty-current',
    })
    const activeTab: Tab = {
      type: 'terminal',
      paneId: 'active-tab',
      activePaneId: 'active-pane',
      layout: { type: 'leaf', paneId: 'active-pane', title: 'Terminal', ratio: 1, zoomed: false },
      paneMru: ['active-pane'],
      broadcastMode: false,
      broadcastActivity: 0,
    }
    const { subject } = setup({
      inheritCwd: true,
      tabs: [activeTab],
      activePaneId: 'active-tab',
    })

    await subject.newTab()

    expect(api.getPaneCwd).not.toHaveBeenCalled()
    expect(api.createTab).toHaveBeenCalledWith(undefined, undefined, undefined, 'active-pane')
  })
})
