import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import type { PaneLayout, Tab, TerminalTab } from '../types/pane'

const api = vi.hoisted(() => ({
  extract: vi.fn(),
}))
const termLock = vi.hoisted(() => ({ locked: false }))

vi.mock('../composables/useTabApi', () => ({
  apiSplitPane: vi.fn(),
  apiClosePane: vi.fn(),
  apiCreatePluginPane: vi.fn(),
  apiCreateFilesPane: vi.fn(),
  apiCreateWebPane: vi.fn(),
  apiMovePane: vi.fn(),
  apiExtractPane: api.extract,
}))
vi.mock('../composables/useTerminal', () => ({
  setActivePaneId: vi.fn(),
  setKbTypingLock: () => {},
  isKbTypingLocked: () => termLock.locked,
}))
vi.mock('../composables/useAppForeground', () => ({
  getIsAppForeground: () => true,
}))
vi.mock('../composables/useNotification', () => ({
  markPaneReadIfUnread: vi.fn(),
}))

import { useSplitPane } from '../composables/useSplitPane'

function leaf(paneId: string): PaneLayout {
  return { type: 'leaf', paneId, title: paneId, ratio: 1, zoomed: false }
}

function layout(...ids: string[]): PaneLayout {
  return {
    type: 'split',
    id: 'root',
    direction: 'horizontal',
    children: ids.map(leaf),
    ratios: ids.map(() => 1 / ids.length),
  }
}

function setup() {
  const showSplitTerminalError = vi.fn()
  const tab: TerminalTab = {
    type: 'terminal',
    paneId: 'tab-1',
    layout: layout('a', 'b'),
    activePaneId: 'a',
    paneMru: ['a', 'b'],
    broadcastMode: false,
    broadcastActivity: 0,
  }
  const tabs = ref<Tab[]>([tab])
  const termRefs = Object.fromEntries(
    ['a', 'b'].map((id) => [id, { focus: vi.fn(), blur: vi.fn(), fit: vi.fn(), sendData: vi.fn() }])
  ) as any
  const activePaneId = ref<string | null>('tab-1')
  const subject = useSplitPane({
    tabs,
    activePaneId,
    termRefs,
    genPaneId: () => 'x',
    sendSync: vi.fn(),
    sendLayoutSync: vi.fn(),
    persist: vi.fn(),
    showSplitTerminalError,
  })
  return { tab, tabs, subject, activePaneId }
}

describe('useSplitPane promotePaneToTab workspace attribution', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    termLock.locked = false
  })

  it('inherits the extracted pane cwd from the REST response when the source tab cwd is empty', async () => {
    const { tabs, subject, activePaneId } = setup()
    api.extract.mockResolvedValue({
      new_tab_id: 'tab-2',
      pane_id: 'a',
      source_layout: layout('b'),
      cwd: '/home/user/project',
    })
    await subject.promotePaneToTab('tab-1', 'a')
    const newTab = tabs.value.find((t) => t.paneId === 'tab-2') as TerminalTab | undefined
    expect(newTab).toBeDefined()
    expect(newTab?.cwd).toBe('/home/user/project')
    expect(activePaneId.value).toBe('tab-2')
  })

  it('prefers result workspace_id over the source tab for SSH attribution', async () => {
    const { tabs, subject } = setup()
    ;(tabs.value.find((t) => t.paneId === 'tab-1') as TerminalTab).workspaceId = 'ws-source'
    api.extract.mockResolvedValue({
      new_tab_id: 'tab-2',
      pane_id: 'a',
      source_layout: layout('b'),
      connection_id: 'conn-9',
      workspace_id: 'ws-ssh',
    })
    await subject.promotePaneToTab('tab-1', 'a')
    const newTab = tabs.value.find((t) => t.paneId === 'tab-2') as TerminalTab | undefined
    expect(newTab?.connectionId).toBe('conn-9')
    expect(newTab?.workspaceId).toBe('ws-ssh')
  })
})
