import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import type { PaneLayout, Tab, TerminalTab } from '../types/pane'

const api = vi.hoisted(() => ({
  createFiles: vi.fn(),
  createPlugin: vi.fn(),
  createWeb: vi.fn(),
}))

vi.mock('../composables/useTabApi', () => ({
  apiSplitPane: vi.fn(),
  apiClosePane: vi.fn(),
  apiCreatePluginPane: api.createPlugin,
  apiCreateFilesPane: api.createFiles,
  apiCreateWebPane: api.createWeb,
  apiMovePane: vi.fn(),
  apiExtractPane: vi.fn(),
}))
vi.mock('../composables/useTerminal', () => ({
  setActivePaneId: vi.fn(),
  setKbTypingLock: () => {},
  isKbTypingLocked: () => false,
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
  const tab: TerminalTab = {
    type: 'terminal',
    paneId: 'tab-1',
    layout: layout('a', 'b'),
    activePaneId: 'b',
    paneMru: ['b', 'a'],
    broadcastMode: false,
    broadcastActivity: 0,
  }
  const tabs = ref<Tab[]>([tab])
  const activePaneId = ref<string | null>('tab-1')
  const subject = useSplitPane({
    tabs,
    activePaneId,
    termRefs: {} as any,
    genPaneId: () => 'x',
    sendSync: vi.fn(),
    sendLayoutSync: vi.fn(),
    persist: vi.fn(),
    showSplitTerminalError: vi.fn(),
  })
  return { tab, subject }
}

describe('insertNonTerminalPane files targeting', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    api.createFiles.mockResolvedValue({ layout: layout('a', 'b', 'files-1'), new_pane_id: 'files-1' })
  })

  it('splits from the originating terminal pane when one is supplied', async () => {
    const { subject } = setup()

    await subject.insertNonTerminalPane('files', { path: 'src/a.ts' }, 'horizontal', 'a')

    expect(api.createFiles).toHaveBeenCalledWith('tab-1', 'src/a.ts', 'a', 'right')
  })

  it('falls back to the active pane and makes the new pane active', async () => {
    const { tab, subject } = setup()

    const ok = await subject.insertNonTerminalPane('files', { path: 'src/a.ts' })

    expect(ok).toBe(true)
    expect(api.createFiles).toHaveBeenCalledWith('tab-1', 'src/a.ts', 'b', 'right')
    expect(tab.activePaneId).toBe('files-1')
  })
})
