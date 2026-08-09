import { describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import {
  mountWithTabs,
  mocks,
  SplitContainerStub,
  TabBarStub,
  localStorageMock,
} from './_setup'
import { settings } from '../../composables/useSettings'
import { useSessionStore } from '../../stores/sessionStore'
import { useWorkspaces } from '../../composables/useWorkspaces'
import type { Tab } from '../../types/pane'

describe('App.vue - activateTab cross-workspace', () => {
  const terminalTab = (paneId: string, cwd: string): Tab => ({
    type: 'terminal',
    paneId,
    layout: { type: 'leaf', paneId: `${paneId}-leaf`, title: paneId, ratio: 1, zoomed: false },
    activePaneId: `${paneId}-leaf`,
    paneMru: [`${paneId}-leaf`],
    broadcastMode: false,
    broadcastActivity: 0,
    cwd,
  })

  const modernPluginTab = (workspaceId?: string): Tab => ({
    type: 'terminal',
    paneId: `plugin:session-browser:${workspaceId ?? ''}`,
    layout: {
      type: 'leaf',
      kind: 'plugin',
      paneId: `plugin:session-browser:${workspaceId ?? ''}`,
      title: 'Session Browser',
      pluginId: 'session-browser',
      ratio: 1,
      zoomed: false,
    },
    activePaneId: `plugin:session-browser:${workspaceId ?? ''}`,
    paneMru: [`plugin:session-browser:${workspaceId ?? ''}`],
    broadcastMode: false,
    broadcastActivity: 0,
    ...(workspaceId ? { workspaceId } : {}),
  })

  async function seedCrossWorkspaceTabs() {
    const wrapper = await mountWithTabs()
    const session = useSessionStore()
    const workspaceState = useWorkspaces()
    workspaceState.workspaces.value = [
      { id: 'ws-active', name: 'Active', path: '/workspace/active', order: 0 },
      { id: 'ws-other', name: 'Other', path: '/workspace/other', order: 1 },
    ]
    workspaceState.activeWorkspaceId.value = 'ws-active'
    session.setTabs([
      terminalTab('terminal-active', '/workspace/active'),
      terminalTab('terminal-ungrouped', '/outside'),
      terminalTab('terminal-other', '/workspace/other'),
      { type: 'plugin', paneId: 'plugin-ungrouped', title: 'Plugin', pluginId: 'plugin' },
    ])
    session.setActivePane('terminal-active')
    mocks.scrollTabIntoView.mockClear()
    return { wrapper, workspaceState }
  }

  it('keeps the named workspace active for an ungrouped global plugin tab', async () => {
    const { wrapper, workspaceState } = await seedCrossWorkspaceTabs()

    const result = await (wrapper.vm as any).activateTab('plugin-ungrouped')
    await nextTick()

    expect(result).toBe(true)
    expect(mocks.apiDeactivateWorkspace).not.toHaveBeenCalled()
    expect(workspaceState.activeWorkspaceId.value).toBe('ws-active')
  })

  it('keeps a modern plugin scoped to its owning named workspace', async () => {
    const wrapper = await mountWithTabs()
    const session = useSessionStore()
    const workspaceState = useWorkspaces()
    workspaceState.workspaces.value = [
      { id: 'ws-active', name: 'Active', path: '/workspace/active', order: 0 },
      { id: 'ws-other', name: 'Other', path: '/workspace/other', order: 1 },
    ]
    session.setTabs([
      modernPluginTab('ws-active'),
      terminalTab('terminal-active', '/workspace/active'),
      terminalTab('terminal-other', '/workspace/other'),
      { type: 'plugin', paneId: 'legacy-plugin', title: 'Legacy', pluginId: 'legacy' },
    ])

    const visibleTabs = () => wrapper.findComponent(TabBarStub).props('tabs') as any[]

    workspaceState.activeWorkspaceId.value = 'ws-active'
    await nextTick()
    expect(visibleTabs().map((tab) => tab.paneId)).toEqual([
      'plugin:session-browser:ws-active',
      'terminal-active',
      'legacy-plugin',
    ])

    workspaceState.activeWorkspaceId.value = 'ws-other'
    await nextTick()
    expect(visibleTabs().map((tab) => tab.paneId)).toEqual([
      'terminal-other',
      'legacy-plugin',
    ])

    workspaceState.activeWorkspaceId.value = null
    await nextTick()
    expect(visibleTabs().map((tab) => tab.paneId)).toEqual(['legacy-plugin'])
  })

  it('keeps the runtime default workspace stable when activating a default-root terminal', async () => {
    const previousDefaultRoot = settings.default_workspace_root
    settings.default_workspace_root = '/workspace/default'
    try {
      const wrapper = await mountWithTabs()
      const session = useSessionStore()
      const workspaceState = useWorkspaces()
      session.setTabs([
        modernPluginTab(),
        terminalTab('terminal-default', '/workspace/default/project'),
      ])
      session.setActivePane('plugin:session-browser:')
      await nextTick()

      const visibleTabs = () => wrapper.findComponent(TabBarStub).props('tabs') as any[]
      expect(visibleTabs().map((tab) => tab.paneId)).toEqual([
        'plugin:session-browser:',
        'terminal-default',
      ])
      mocks.apiActivateWorkspace.mockClear()
      mocks.apiDeactivateWorkspace.mockClear()

      const result = await (wrapper.vm as any).activateTab('terminal-default')
      await nextTick()

      expect(result).toBe(true)
      expect(workspaceState.activeWorkspaceId.value).toBeNull()
      expect(mocks.apiActivateWorkspace).not.toHaveBeenCalled()
      expect(mocks.apiDeactivateWorkspace).not.toHaveBeenCalled()
      expect(visibleTabs().map((tab) => tab.paneId)).toEqual([
        'plugin:session-browser:',
        'terminal-default',
      ])
    } finally {
      settings.default_workspace_root = previousDefaultRoot
    }
  })

  it('keeps the runtime default workspace stable when revealing a default-root pane', async () => {
    const previousDefaultRoot = settings.default_workspace_root
    settings.default_workspace_root = '/workspace/default'
    try {
      const wrapper = await mountWithTabs()
      const session = useSessionStore()
      const workspaceState = useWorkspaces()
      session.setTabs([
        modernPluginTab(),
        terminalTab('terminal-default', '/workspace/default/project'),
      ])
      session.setActivePane('plugin:session-browser:')
      await nextTick()
      mocks.apiActivateWorkspace.mockClear()
      mocks.apiDeactivateWorkspace.mockClear()

      const result = await (wrapper.vm as any).revealPane('terminal-default-leaf')
      await nextTick()

      expect(result).toBe(true)
      expect(workspaceState.activeWorkspaceId.value).toBeNull()
      expect(mocks.apiActivateWorkspace).not.toHaveBeenCalled()
      expect(mocks.apiDeactivateWorkspace).not.toHaveBeenCalled()
      expect(session.activePaneId).toBe('terminal-default')
    } finally {
      settings.default_workspace_root = previousDefaultRoot
    }
  })

  it('creates a plugin-requested terminal in the current default workspace without a hop', async () => {
    const previousDefaultRoot = settings.default_workspace_root
    settings.default_workspace_root = '/workspace/default'
    try {
      await mountWithTabs()
      const workspaceState = useWorkspaces()
      workspaceState.activeWorkspaceId.value = null
      mocks.apiCreateTab.mockClear()
      mocks.apiActivateWorkspace.mockClear()
      mocks.apiDeactivateWorkspace.mockClear()

      const result = await window.__dinotty_terminal_api!.createTerminalTab({
        cwd: '/workspace/default/plugin-output',
        argv: ['echo', 'ok'],
      })

      expect(result).toBe('p-new')
      expect(mocks.apiActivateWorkspace).not.toHaveBeenCalled()
      expect(mocks.apiDeactivateWorkspace).not.toHaveBeenCalled()
      expect(mocks.apiCreateTab).toHaveBeenCalledOnce()
    } finally {
      settings.default_workspace_root = previousDefaultRoot
    }
  })

  it('abandons plugin terminal creation when its workspace hop is superseded', async () => {
    const previousDefaultRoot = settings.default_workspace_root
    settings.default_workspace_root = '/workspace/default'
    try {
      const wrapper = await mountWithTabs()
      const session = useSessionStore()
      const workspaceState = useWorkspaces()
      workspaceState.workspaces.value = [
        { id: 'workspace-a', name: 'Workspace A', path: '/workspace/a', order: 0 },
      ]
      workspaceState.activeWorkspaceId.value = 'workspace-a'
      session.setTabs([terminalTab('terminal-current', '/workspace/a/project')])
      session.setActivePane('terminal-current')
      let releaseDeactivate!: () => void
      mocks.apiDeactivateWorkspace.mockImplementationOnce(
        () => new Promise<void>((resolve) => (releaseDeactivate = resolve))
      )
      mocks.apiCreateTab.mockClear()

      const createPromise = window.__dinotty_terminal_api!.createTerminalTab({
        cwd: '/workspace/default/plugin-output',
        argv: ['echo', 'stale'],
      })
      await vi.waitFor(() => expect(mocks.apiDeactivateWorkspace).toHaveBeenCalledOnce())
      expect(await (wrapper.vm as any).activateTab('terminal-current')).toBe(true)
      releaseDeactivate()

      expect(await createPromise).toBe('')
      expect(workspaceState.activeWorkspaceId.value).toBe('workspace-a')
      expect(session.activePaneId).toBe('terminal-current')
      expect(mocks.apiCreateTab).not.toHaveBeenCalled()
    } finally {
      settings.default_workspace_root = previousDefaultRoot
    }
  })

  it('switches to the default workspace for an ungrouped terminal tab', async () => {
    const { wrapper, workspaceState } = await seedCrossWorkspaceTabs()

    const result = await (wrapper.vm as any).activateTab('terminal-ungrouped')

    expect(result).toBe(true)
    expect(mocks.apiDeactivateWorkspace).toHaveBeenCalledOnce()
    expect(workspaceState.activeWorkspaceId.value).toBeNull()
  })

  it('activateTab abandons a stale cross-workspace hop superseded during workspace activation', async () => {
    const { wrapper } = await seedCrossWorkspaceTabs()
    let release!: () => void
    mocks.apiActivateWorkspace.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          release = resolve
        })
    )

    const staleActivation = (wrapper.vm as any).activateTab('terminal-other') as Promise<boolean>
    await Promise.resolve()
    const latestResult = await (wrapper.vm as any).activateTab('plugin-ungrouped')
    release()
    const staleResult = await staleActivation
    await nextTick()

    expect(latestResult).toBe(true)
    expect(staleResult).toBe(false)
    expect(mocks.scrollTabIntoView).not.toHaveBeenCalledWith('terminal-other')
  })

  it('scrollActiveTabIntoView abandons a stale scroll superseded after pane activation', async () => {
    const { wrapper } = await seedCrossWorkspaceTabs()
    let releasePane!: () => void
    mocks.apiActivatePane.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          releasePane = resolve
        })
    )

    const staleActivation = (wrapper.vm as any).activateTab('terminal-other') as Promise<boolean>
    await Promise.resolve()
    await Promise.resolve()
    mocks.scrollTabIntoView.mockClear()

    releasePane()
    const supersede = nextTick(
      () => (wrapper.vm as any).activateTab('terminal-active') as Promise<boolean>
    )
    expect(await staleActivation).toBe(true)
    await nextTick()
    await nextTick()
    await supersede

    expect(mocks.scrollTabIntoView).not.toHaveBeenCalledWith('terminal-other')
  })

  it('scrolls the target tab into view after cross-workspace activation', async () => {
    const { wrapper, workspaceState } = await seedCrossWorkspaceTabs()

    const result = await (wrapper.vm as any).activateTab('terminal-other')
    await nextTick()
    await nextTick()

    expect(result).toBe(true)
    expect(mocks.apiActivateWorkspace).toHaveBeenCalledWith('ws-other')
    expect(workspaceState.activeWorkspaceId.value).toBe('ws-other')
    expect(mocks.scrollTabIntoView).toHaveBeenCalledWith('terminal-other')
  })
})

describe('App.vue - plugin tab close persistence', () => {
  const terminalTab = (paneId: string): Tab => ({
    type: 'terminal',
    paneId,
    layout: { type: 'leaf', paneId: `${paneId}-leaf`, title: paneId, ratio: 1, zoomed: false },
    activePaneId: `${paneId}-leaf`,
    paneMru: [`${paneId}-leaf`],
    broadcastMode: false,
    broadcastActivity: 0,
  })

  it('flushes plugin tab closures synchronously to avoid resurrect race', async () => {
    const wrapper = await mountWithTabs()
    const session = useSessionStore()
    const terminal = session.tabs[0]
    if (!terminal || terminal.type !== 'terminal') {
      throw new Error('expected seeded terminal tab')
    }
    session.setTabs([
      terminal,
      { type: 'plugin', paneId: 'plugin:memory', title: 'Memory', pluginId: 'memory' },
    ])
    session.setActivePane('plugin:memory')

    const splitContainer = wrapper.findComponent(SplitContainerStub)
    splitContainer.vm.$emit('divider-drag-end')
    window.dispatchEvent(new Event('beforeunload'))
    expect(JSON.parse(localStorageMock.getItem('dinotty_tabs')!).tabs).toHaveLength(2)

    await (wrapper.vm as any).closeTab('plugin:memory')

    // Synchronous flush: localStorage must reflect the close immediately,
    // not after a 200ms debounce. Otherwise a tab_list arriving in the
    // window would re-read stale storage and resurrect the closed plugin tab.
    const saved = JSON.parse(localStorageMock.getItem('dinotty_tabs')!)
    expect(saved.tabs).toHaveLength(1)
    expect(saved.tabs[0].paneId).toBe(terminal.paneId)
  })
})
