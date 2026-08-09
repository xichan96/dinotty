import { beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import {
  mountWithTabs,
  mocks,
  localStorageMock,
  SplitContainerStub,
  ConfirmCloseDialogStub,
} from './_setup'
import { settings } from '../../composables/useSettings'
import { useSessionStore } from '../../stores/sessionStore'
import { useWorkspaces } from '../../composables/useWorkspaces'
import { currentRevealNavGen } from '../../utils/navGen'
import type { Tab } from '../../types/pane'

describe('App.vue - onClosePane routes through confirmation gate', () => {
  beforeEach(() => {
    settings.confirm_before_close_tab = true
    settings.windowsAltAsCmd = false
    mocks.closePane.mockReset()
    mocks.splitPane.mockReset()
    mocks.insertNonTerminalPane.mockReset()
    mocks.toggleBroadcast.mockReset()
    mocks.toggleZoom.mockReset()
    mocks.equalizePanes.mockReset()
    mocks.focusPane.mockReset()
    mocks.focusNext.mockReset()
    mocks.focusPrev.mockReset()
    mocks.keyboardResize.mockReset()
    mocks.reorderPane.mockReset()
    mocks.onTerminalInput.mockReset()
    mocks.focusNeighbor.mockReset()
    mocks.apiCreateTab.mockClear()
    mocks.apiCloseTab.mockReset()
    localStorageMock.clear()
  })

  it('terminal tab + setting on + close pane → sets pending state, does NOT close immediately', async () => {
    mocks.closePane.mockResolvedValue(true)

    const wrapper = await mountWithTabs()
    const splitContainer = wrapper.findComponent(SplitContainerStub)
    expect(splitContainer.exists()).toBe(true)

    // Fire the `close` emit that App.vue wires to onClosePane(tab.paneId, id)
    await splitContainer.vm.$emit('close', 'pane-1')
    await nextTick()

    // closePane must NOT have been called yet — we expect the modal gate
    expect(mocks.closePane).not.toHaveBeenCalled()

    // Confirm close dialog must now be visible
    const confirmDialog = wrapper.findComponent(ConfirmCloseDialogStub)
    expect(confirmDialog.exists()).toBe(true)
    expect(confirmDialog.attributes('data-visible')).toBe('true')
  })

  it('onConfirmClose with pendingClosePaneId → calls splitPane.closePane, not closeTab', async () => {
    mocks.closePane.mockResolvedValue(true)

    const wrapper = await mountWithTabs()
    const splitContainer = wrapper.findComponent(SplitContainerStub)
    await splitContainer.vm.$emit('close', 'pane-2')
    await nextTick()

    const confirmDialog = wrapper.findComponent(ConfirmCloseDialogStub)
    await confirmDialog.trigger('click')
    await nextTick()

    // splitPane.closePane should be called with the pane id
    expect(mocks.closePane).toHaveBeenCalledWith('pane-2')

    // apiCloseTab should NOT have been called (closePane returned true)
    expect(mocks.apiCloseTab).not.toHaveBeenCalled()

    // Modal should be closed
    expect(confirmDialog.attributes('data-visible')).toBe('false')
  })

  it('onConfirmClose with pane close cascade (closePane returns false) → calls closeTab fallback', async () => {
    mocks.closePane.mockResolvedValue(false)

    const wrapper = await mountWithTabs()
    const splitContainer = wrapper.findComponent(SplitContainerStub)
    await splitContainer.vm.$emit('close', 'pane-3')
    await nextTick()

    const confirmDialog = wrapper.findComponent(ConfirmCloseDialogStub)
    await confirmDialog.trigger('click')
    await nextTick()

    // splitPane.closePane should be called first
    expect(mocks.closePane).toHaveBeenCalledWith('pane-3')

    // Since closePane returned false, the tab should be closed (cascade fallback)
    expect(mocks.apiCloseTab).toHaveBeenCalled()
  })

  it('bypass with setting off + closePane returns false → falls back to closeTab', async () => {
    settings.confirm_before_close_tab = false
    mocks.closePane.mockResolvedValue(false)

    const wrapper = await mountWithTabs()
    const splitContainer = wrapper.findComponent(SplitContainerStub)
    await splitContainer.vm.$emit('close', 'pane-1')
    await nextTick()

    // closePane should be called directly (bypass)
    expect(mocks.closePane).toHaveBeenCalledWith('pane-1')
    // Since closePane returned false, closeTab should be the fallback
    expect(mocks.apiCloseTab).toHaveBeenCalled()
  })

  it('bypass with setting off + closePane returns true → does NOT call closeTab', async () => {
    settings.confirm_before_close_tab = false
    mocks.closePane.mockResolvedValue(true)

    const wrapper = await mountWithTabs()
    const splitContainer = wrapper.findComponent(SplitContainerStub)
    await splitContainer.vm.$emit('close', 'pane-1')
    await nextTick()

    expect(mocks.closePane).toHaveBeenCalledWith('pane-1')
    expect(mocks.apiCloseTab).not.toHaveBeenCalled()
  })

  it('marks a closed tab read only after the backend close succeeds', async () => {
    settings.confirm_before_close_tab = false
    mocks.closePane.mockResolvedValue(false)
    let resolveClose!: () => void
    mocks.apiCloseTab.mockImplementationOnce(
      () => new Promise<void>((resolve) => (resolveClose = resolve))
    )

    const wrapper = await mountWithTabs()
    mocks.clearForPaneIds.mockClear()
    const splitContainer = wrapper.findComponent(SplitContainerStub)
    splitContainer.vm.$emit('close', 'pane-1')
    await nextTick()

    expect(mocks.apiCloseTab).toHaveBeenCalledWith('tab-1')
    expect(mocks.clearForPaneIds).not.toHaveBeenCalled()

    resolveClose()
    await Promise.resolve()
    await nextTick()
    expect(mocks.clearForPaneIds).toHaveBeenCalledWith(
      expect.arrayContaining(['tab-1', 'pane-1', 'pane-2']),
      'tab_close'
    )
  })

  it('does not mark a tab read when the backend close fails', async () => {
    settings.confirm_before_close_tab = false
    mocks.closePane.mockResolvedValue(false)
    mocks.apiCloseTab.mockRejectedValueOnce(new Error('close failed'))
    vi.spyOn(console, 'error').mockImplementation(() => {})

    const wrapper = await mountWithTabs()
    mocks.clearForPaneIds.mockClear()
    const splitContainer = wrapper.findComponent(SplitContainerStub)
    splitContainer.vm.$emit('close', 'pane-1')
    await Promise.resolve()
    await nextTick()

    expect(mocks.clearForPaneIds).not.toHaveBeenCalled()
  })

  it('advances reveal navigation when closing the active tab selects its replacement', async () => {
    const wrapper = await mountWithTabs()
    const session = useSessionStore()
    session.addTab({ ...session.tabs[0], paneId: 'tab-survivor' }, false)
    const navGenBeforeClose = currentRevealNavGen()

    await (wrapper.vm as any).closeTab('tab-1')
    await nextTick()

    expect(currentRevealNavGen()).toBe(navGenBeforeClose + 1)
    expect(session.activePaneId).toBe('tab-survivor')
  })

  it('selects the same-workspace successor instead of the flat-array neighbour', async () => {
    const wrapper = await mountWithTabs()
    const session = useSessionStore()
    const workspaceState = useWorkspaces()
    workspaceState.workspaces.value = [
      { id: 'workspace-a', name: 'Workspace A', path: '/workspace/a', order: 0 },
      { id: 'workspace-b', name: 'Workspace B', path: '/workspace/b', order: 1 },
    ]
    const terminalTab = (paneId: string, cwd: string): Tab => ({
      type: 'terminal',
      paneId,
      layout: {
        type: 'leaf',
        paneId: `${paneId}-leaf`,
        title: paneId,
        ratio: 1,
        zoomed: false,
      },
      activePaneId: `${paneId}-leaf`,
      paneMru: [`${paneId}-leaf`],
      broadcastMode: false,
      broadcastActivity: 0,
      cwd,
    })
    session.setTabs([
      terminalTab('workspace-a-closed', '/workspace/a'),
      terminalTab('workspace-b-neighbour', '/workspace/b'),
      terminalTab('workspace-a-successor', '/workspace/a'),
    ])
    session.setActivePane('workspace-a-closed')

    const app = wrapper.vm as unknown as { closeTab: (tabId: string) => Promise<void> }
    await app.closeTab('workspace-a-closed')
    await nextTick()

    expect(session.activePaneId).toBe('workspace-a-successor')
  })

  it('moves to the successor workspace when closing its active workspace last tab', async () => {
    const wrapper = await mountWithTabs()
    const session = useSessionStore()
    const workspaceState = useWorkspaces()
    workspaceState.workspaces.value = [
      { id: 'workspace-a', name: 'Workspace A', path: '/workspace/a', order: 0 },
      { id: 'workspace-b', name: 'Workspace B', path: '/workspace/b', order: 1 },
    ]
    workspaceState.activeWorkspaceId.value = 'workspace-a'
    const terminalTab = (paneId: string, cwd: string): Tab => ({
      type: 'terminal',
      paneId,
      layout: {
        type: 'leaf',
        paneId: `${paneId}-leaf`,
        title: paneId,
        ratio: 1,
        zoomed: false,
      },
      activePaneId: `${paneId}-leaf`,
      paneMru: [`${paneId}-leaf`],
      broadcastMode: false,
      broadcastActivity: 0,
      cwd,
    })
    session.setTabs([
      terminalTab('workspace-a-only-tab', '/workspace/a'),
      terminalTab('workspace-b-successor', '/workspace/b'),
    ])
    session.setActivePane('workspace-a-only-tab')

    const app = wrapper.vm as unknown as { closeTab: (tabId: string) => Promise<void> }
    await app.closeTab('workspace-a-only-tab')
    await nextTick()

    expect(mocks.apiActivateWorkspace).toHaveBeenCalledWith('workspace-b')
    expect(workspaceState.activeWorkspaceId.value).toBe('workspace-b')
    expect(session.activePaneId).toBe('workspace-b-successor')
  })

  it('uses a positional fallback when the successor workspace hop fails', async () => {
    const wrapper = await mountWithTabs()
    const session = useSessionStore()
    const workspaceState = useWorkspaces()
    workspaceState.workspaces.value = [
      { id: 'workspace-a', name: 'Workspace A', path: '/workspace/a', order: 0 },
      { id: 'workspace-b', name: 'Workspace B', path: '/workspace/b', order: 1 },
    ]
    workspaceState.activeWorkspaceId.value = 'workspace-a'
    const terminalTab = (paneId: string, cwd: string): Tab => ({
      type: 'terminal',
      paneId,
      layout: {
        type: 'leaf',
        paneId: `${paneId}-leaf`,
        title: paneId,
        ratio: 1,
        zoomed: false,
      },
      activePaneId: `${paneId}-leaf`,
      paneMru: [`${paneId}-leaf`],
      broadcastMode: false,
      broadcastActivity: 0,
      cwd,
    })
    session.setTabs([
      terminalTab('workspace-a-only-tab', '/workspace/a'),
      terminalTab('workspace-b-fallback', '/workspace/b'),
    ])
    session.setActivePane('workspace-a-only-tab')
    mocks.apiActivateWorkspace.mockRejectedValueOnce(new Error('activation failed'))

    const app = wrapper.vm as unknown as { closeTab: (tabId: string) => Promise<void> }
    await app.closeTab('workspace-a-only-tab')
    await nextTick()

    expect(mocks.apiActivateWorkspace).toHaveBeenNthCalledWith(2, 'workspace-b')
    expect(workspaceState.activeWorkspaceId.value).toBe('workspace-b')
    expect(session.activePaneId).toBe('workspace-b-fallback')
  })
})


describe('App.vue - Cmd+W routes through confirmation gate in split-pane mode', () => {
  beforeEach(() => {
    settings.confirm_before_close_tab = true
    settings.windowsAltAsCmd = false
    mocks.closePane.mockReset()
    mocks.splitPane.mockReset()
    mocks.insertNonTerminalPane.mockReset()
    mocks.toggleBroadcast.mockReset()
    mocks.toggleZoom.mockReset()
    mocks.equalizePanes.mockReset()
    mocks.focusPane.mockReset()
    mocks.focusNext.mockReset()
    mocks.focusPrev.mockReset()
    mocks.keyboardResize.mockReset()
    mocks.reorderPane.mockReset()
    mocks.onTerminalInput.mockReset()
    mocks.focusNeighbor.mockReset()
    mocks.apiCreateTab.mockClear()
    mocks.apiCloseTab.mockReset()
    localStorageMock.clear()
  })

  it('Cmd+W on multi-pane layout → does NOT closePane, shows modal', async () => {
    mocks.closePane.mockResolvedValue(true)

    const wrapper = await mountWithTabs()

    // Dispatch Cmd+W (stubbed key 'w' for closeTab binding).
    // App.vue attaches the keydown listener to `document`.
    document.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'w',
        metaKey: true,
        bubbles: true,
      })
    )
    await nextTick()

    // closePane must NOT have been called yet — we expect the modal gate
    expect(mocks.closePane).not.toHaveBeenCalled()

    // Confirm close dialog must now be visible
    const confirmDialog = wrapper.findComponent(ConfirmCloseDialogStub)
    expect(confirmDialog.exists()).toBe(true)
    expect(confirmDialog.attributes('data-visible')).toBe('true')
  })

  it('Cmd+W + confirm in multi-pane mode → calls splitPane.closePane with active pane id', async () => {
    mocks.closePane.mockResolvedValue(true)

    const wrapper = await mountWithTabs()

    document.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'w',
        metaKey: true,
        bubbles: true,
      })
    )
    await nextTick()

    const confirmDialog = wrapper.findComponent(ConfirmCloseDialogStub)
    await confirmDialog.trigger('click')
    await nextTick()

    // closePane should be called with the active pane id (pane-1 in fixture)
    expect(mocks.closePane).toHaveBeenCalledWith('pane-1')
    // apiCloseTab should NOT have been called (closePane returned true)
    expect(mocks.apiCloseTab).not.toHaveBeenCalled()
    // Modal should be closed
    expect(confirmDialog.attributes('data-visible')).toBe('false')
  })

  it('Cmd+W + setting off → bypasses modal and calls closePane directly', async () => {
    settings.confirm_before_close_tab = false
    mocks.closePane.mockResolvedValue(true)

    const wrapper = await mountWithTabs()

    document.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'w',
        metaKey: true,
        bubbles: true,
      })
    )
    await nextTick()

    expect(mocks.closePane).toHaveBeenCalledWith('pane-1')
    // Modal should NOT be visible (bypass)
    const confirmDialog = wrapper.findComponent(ConfirmCloseDialogStub)
    expect(confirmDialog.attributes('data-visible')).toBe('false')
  })

  // 验证 Windows Alt-as-Cmd 不会把 Ctrl+Alt+W 当作应用关闭快捷键。
  it('Windows Alt-as-Cmd enabled + Ctrl+Alt+W → does not trigger app close', async () => {
    settings.windowsAltAsCmd = true
    mocks.closePane.mockResolvedValue(true)

    const wrapper = await mountWithTabs()

    document.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'w',
        ctrlKey: true,
        altKey: true,
        bubbles: true,
      })
    )
    await nextTick()

    expect(mocks.closePane).not.toHaveBeenCalled()
    expect(mocks.apiCloseTab).not.toHaveBeenCalled()
    const confirmDialog = wrapper.findComponent(ConfirmCloseDialogStub)
    expect(confirmDialog.attributes('data-visible')).toBe('false')
  })

  // 验证 Windows Alt-as-Cmd 开启后 Alt+W 会走关闭确认流程。
  it('Windows Alt-as-Cmd enabled + Alt+W → routes through the close confirmation gate', async () => {
    settings.windowsAltAsCmd = true
    mocks.closePane.mockResolvedValue(true)

    const wrapper = await mountWithTabs()

    document.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'w',
        altKey: true,
        bubbles: true,
      })
    )
    await nextTick()

    expect(mocks.closePane).not.toHaveBeenCalled()
    expect(mocks.apiCloseTab).not.toHaveBeenCalled()
    const confirmDialog = wrapper.findComponent(ConfirmCloseDialogStub)
    expect(confirmDialog.attributes('data-visible')).toBe('true')
  })

  // 验证 Windows Alt-as-Cmd 开启后 Alt+T 会创建新 tab。
  it('Windows Alt-as-Cmd enabled + Alt+T → creates a new tab', async () => {
    settings.windowsAltAsCmd = true

    await mountWithTabs()

    document.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 't',
        altKey: true,
        bubbles: true,
      })
    )
    await nextTick()
    await Promise.resolve()

    expect(mocks.apiCreateTab).toHaveBeenCalledTimes(1)
  })

  // 验证未开启 Windows Alt-as-Cmd 时 Alt+W 不会触发应用关闭。
  it('Windows Alt-as-Cmd disabled + Alt+W → does not trigger app close', async () => {
    settings.windowsAltAsCmd = false
    mocks.closePane.mockResolvedValue(true)

    const wrapper = await mountWithTabs()

    document.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'w',
        altKey: true,
        bubbles: true,
      })
    )
    await nextTick()

    expect(mocks.closePane).not.toHaveBeenCalled()
    expect(mocks.apiCloseTab).not.toHaveBeenCalled()
    const confirmDialog = wrapper.findComponent(ConfirmCloseDialogStub)
    expect(confirmDialog.attributes('data-visible')).toBe('false')
  })

  // 验证 Ctrl+Alt+T/W 不会被虚拟 Cmd 处理，避免影响 AltGr 输入。
  it('Windows Alt-as-Cmd enabled + Ctrl+Alt+T/W → does not trigger app shortcuts', async () => {
    settings.windowsAltAsCmd = true
    mocks.closePane.mockResolvedValue(true)

    const wrapper = await mountWithTabs()

    for (const key of ['t', 'w']) {
      document.dispatchEvent(
        new KeyboardEvent('keydown', {
          key,
          ctrlKey: true,
          altKey: true,
          bubbles: true,
        })
      )
      await nextTick()
    }

    expect(mocks.apiCreateTab).not.toHaveBeenCalled()
    expect(mocks.closePane).not.toHaveBeenCalled()
    expect(mocks.apiCloseTab).not.toHaveBeenCalled()
    const confirmDialog = wrapper.findComponent(ConfirmCloseDialogStub)
    expect(confirmDialog.attributes('data-visible')).toBe('false')
  })
})

