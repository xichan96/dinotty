import { describe, expect, it } from 'vitest'
import { nextTick } from 'vue'
import { mountWithTabs, mocks, SplitContainerStub, localStorageMock } from './_setup'
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
