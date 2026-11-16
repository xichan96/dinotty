import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick, ref, shallowRef } from 'vue'
import type { Tab } from '../types/pane'
import type { Workspace } from '../types/workspace'

const api = vi.hoisted(() => ({
  activatePane: vi.fn(async () => {}),
}))

vi.mock('../composables/useTabApi', () => ({
  apiActivatePane: api.activatePane,
  apiCloseTab: vi.fn(),
  apiCreateTab: vi.fn(),
  apiCreateSshTab: vi.fn(),
  apiGetPaneCwd: vi.fn(),
}))
vi.mock('../composables/useTemplateApi', () => ({
  apiApplyTemplate: vi.fn(),
}))
vi.mock('../composables/useTerminal', () => ({
  isKbTypingLocked: () => false,
}))

import { useTabLifecycle } from '../composables/useTabLifecycle'
import { TAB_TITLE_INPUT_CLASS } from '../utils/renameFocusGuard'

function terminalTab(): Tab {
  return {
    type: 'terminal',
    paneId: 'tab-1',
    activePaneId: 'pane-1',
    layout: { type: 'leaf', paneId: 'pane-1', title: 'Terminal', ratio: 1, zoomed: false },
    paneMru: ['pane-1'],
    broadcastMode: false,
    broadcastActivity: 0,
  }
}

type TermRefStub = {
  focus: () => void
  blur: () => void
  fit: () => void
  isComposing: () => boolean
}

function setup(termRefs: Record<string, TermRefStub>) {
  return useTabLifecycle({
    tabs: ref<Tab[]>([terminalTab()]),
    activePaneId: ref<string | null>('tab-1'),
    session: { reorderTab: vi.fn(), renameTab: vi.fn() },
    ui: { requestCloseTab: vi.fn(), requestClosePane: vi.fn(), cancelClose: vi.fn() },
    appSettings: { inherit_cwd_for_new_tab: false },
    activeWorkspaceId: ref<string | null>(null),
    workspaces: ref<Workspace[]>([]),
    matchWorkspace: () => null,
    activateWorkspace: vi.fn(async () => true),
    cancelPendingWorkspaceActivation: vi.fn(),
    workspaceIdOfTab: () => null,
    activeWorkspacePath: ref<string | undefined>(undefined),
    notif: { clearForPaneIds: vi.fn() },
    termRefs,
    isMobile: ref(false),
    tabBarRef: ref(null),
    persist: vi.fn(),
    persistNow: vi.fn(),
    onSshConnectRef: shallowRef(async () => {}),
    sendSync: vi.fn(),
    showCreateTerminalError: vi.fn(),
  })
}

function termRef(): TermRefStub & { focus: ReturnType<typeof vi.fn> } {
  return { focus: vi.fn(), blur: vi.fn(), fit: vi.fn(), isComposing: () => false }
}

async function flushFocus() {
  await nextTick()
  await nextTick()
}

describe('activateTab terminal focus', () => {
  beforeEach(() => {
    api.activatePane.mockClear()
  })

  afterEach(() => {
    document.body.replaceChildren()
  })

  it('keeps focus on the tab-title rename editor', async () => {
    const input = document.createElement('input')
    input.className = TAB_TITLE_INPUT_CLASS
    document.body.appendChild(input)
    input.focus()
    expect(document.activeElement).toBe(input)

    const pane = termRef()
    const subject = setup({ 'pane-1': pane })

    await subject.activateTab('tab-1')
    await flushFocus()

    // Activation still happened; only the terminal focus was deferred away so
    // the editor's blur handler does not close it mid-rename.
    expect(api.activatePane).toHaveBeenCalledWith('tab-1', 'pane-1')
    expect(pane.focus).not.toHaveBeenCalled()
    expect(document.activeElement).toBe(input)
  })

  it('still focuses the terminal when nothing owns focus', async () => {
    const pane = termRef()
    const subject = setup({ 'pane-1': pane })

    await subject.activateTab('tab-1')
    await flushFocus()

    expect(pane.focus).toHaveBeenCalledTimes(1)
  })
})
