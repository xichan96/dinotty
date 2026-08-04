import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { useOverviewCallbacks } from '../composables/useOverviewCallbacks'
import type { Tab } from '../types/pane'

const mocks = vi.hoisted(() => ({
  apiCreateSshTab: vi.fn(),
}))

vi.mock('../composables/useTabApi', () => ({
  apiCreateSshTab: mocks.apiCreateSshTab,
}))

function createOptions() {
  const activeWorkspaceId = ref<string | null>('workspace-current')
  const tabs = ref<Tab[]>([])
  const activateWorkspace = vi.fn(async (workspaceId: string | null) => {
    activeWorkspaceId.value = workspaceId
    return true
  })
  const newTab = vi.fn(async () => '')

  return {
    activeWorkspaceId,
    tabs,
    activateWorkspace,
    newTab,
    options: {
      tabs,
      activePaneId: ref<string | null>(null),
      activeWorkspaceId,
      termRefs: {},
      session: { renameTab: vi.fn() },
      activateTab: vi.fn(async () => true),
      activateWorkspace,
      closeTab: vi.fn(async () => {}),
      requestCloseTab: vi.fn(),
      newTab,
      persist: vi.fn(),
      commitLocalActivePane: vi.fn(),
      focusActive: vi.fn(),
      sendSync: vi.fn(),
    },
  }
}

describe('useOverviewCallbacks workspace activation', () => {
  beforeEach(() => {
    mocks.apiCreateSshTab.mockReset()
  })

  it('activates a selected local workspace before creating its tab', async () => {
    const { options, activateWorkspace, newTab } = createOptions()
    const callbacks = useOverviewCallbacks(options)

    await callbacks.onOverviewNewTab('C:/work/other', 'workspace-other')

    expect(activateWorkspace).toHaveBeenCalledWith('workspace-other')
    expect(newTab).toHaveBeenCalledWith('C:/work/other', undefined, undefined, 'workspace-other')
    expect(activateWorkspace.mock.invocationCallOrder[0]).toBeLessThan(
      newTab.mock.invocationCallOrder[0]
    )
  })

  it('activates the default workspace before creating its tab', async () => {
    const { options, activateWorkspace, newTab } = createOptions()
    const callbacks = useOverviewCallbacks(options)

    await callbacks.onOverviewNewTab('C:/work/default', null)

    expect(activateWorkspace).toHaveBeenCalledWith(null)
    expect(newTab).toHaveBeenCalledOnce()
  })

  it('activates a selected SSH workspace before creating its tab', async () => {
    const { options, activateWorkspace, tabs } = createOptions()
    mocks.apiCreateSshTab.mockResolvedValue({
      tab_id: 'tab-ssh',
      pane_id: 'pane-ssh',
      layout: {
        type: 'leaf',
        paneId: 'pane-ssh',
        title: 'Terminal',
        ratio: 1,
        zoomed: false,
      },
    })
    const callbacks = useOverviewCallbacks(options)

    await callbacks.onOverviewNewTabSsh('connection-1', '/srv/app', 'workspace-ssh')

    expect(activateWorkspace).toHaveBeenCalledWith('workspace-ssh')
    expect(mocks.apiCreateSshTab).toHaveBeenCalledWith(
      'connection-1',
      '/srv/app',
      'workspace-ssh'
    )
    expect(tabs.value).toHaveLength(1)
    expect(tabs.value[0]).toMatchObject({
      connectionId: 'connection-1',
      workspaceId: 'workspace-ssh',
    })
    expect(activateWorkspace.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.apiCreateSshTab.mock.invocationCallOrder[0]
    )
  })

  it('repairs workspace attribution when the SSH tab broadcast wins the race', async () => {
    const { options, tabs } = createOptions()
    tabs.value.push({
      type: 'terminal',
      paneId: 'tab-ssh',
      layout: {
        type: 'leaf',
        paneId: 'pane-ssh',
        title: 'Terminal',
        ratio: 1,
        zoomed: false,
      },
      activePaneId: 'pane-ssh',
      paneMru: ['pane-ssh'],
      broadcastMode: false,
      broadcastActivity: 0,
      previewVisible: false,
      previewAddress: '',
      previewUrl: '',
      previewKind: 'web',
      connectionId: 'connection-1',
    })
    mocks.apiCreateSshTab.mockResolvedValue({
      tab_id: 'tab-ssh',
      pane_id: 'pane-ssh',
      layout: tabs.value[0].type === 'terminal' ? tabs.value[0].layout : undefined,
      workspace_id: 'workspace-ssh',
    })
    const callbacks = useOverviewCallbacks(options)

    await callbacks.onOverviewNewTabSsh('connection-1', '/srv/app', 'workspace-ssh')

    expect(tabs.value).toHaveLength(1)
    expect(tabs.value[0]).toMatchObject({ workspaceId: 'workspace-ssh' })
  })

  it('does not create a tab when workspace activation is superseded', async () => {
    const { options, activateWorkspace, newTab } = createOptions()
    activateWorkspace.mockResolvedValue(false)
    const callbacks = useOverviewCallbacks(options)

    await callbacks.onOverviewNewTab('C:/work/other', 'workspace-other')
    await callbacks.onOverviewNewTabSsh('connection-1', '/srv/app', 'workspace-ssh')

    expect(newTab).not.toHaveBeenCalled()
    expect(mocks.apiCreateSshTab).not.toHaveBeenCalled()
  })
})
