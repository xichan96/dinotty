import { mount, flushPromises } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { nextTick } from 'vue'
import Toast from 'vue-toastification'

/**
 * The detached window is a second view of one tab. These tests pin the
 * contract that makes that safe: it renders only its own tab, ignores global
 * activation, closes its native window when the tab disappears, follows
 * renames in the titlebar, and never writes the main window's tab snapshot.
 */

const mocks = vi.hoisted(() => ({
  tauriInvoke: vi.fn(async () => undefined),
  apiListTabs: vi.fn(),
  apiCloseTab: vi.fn(async () => undefined),
  settings: {
    load: vi.fn(async () => {}),
    applyTheme: vi.fn(),
  },
}))

const splitMocks = vi.hoisted(() => ({
  focusPane: vi.fn(),
  closePane: vi.fn(async () => true),
  reorderPane: vi.fn(),
  onTerminalInput: vi.fn(),
  splitPane: vi.fn(async () => null),
  toggleBroadcast: vi.fn(),
}))

vi.mock('../composables/apiBase', () => ({
  getApiBase: async () => 'http://localhost',
  apiUrl: (path: string) => path,
  wsUrl: (path: string) => `ws://localhost${path}`,
  authFetch: async () => ({ ok: true }),
  checkTokenConfigured: async () => ({ configured: true, serverMode: false }),
  fetchAutoToken: async () => null,
  validateToken: async () => ({ ok: true }),
  markCookieAuthenticated: () => {},
  hasAuthToken: () => false,
}))

vi.mock('../composables/useTabApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../composables/useTabApi')>()
  return {
    ...actual,
    apiListTabs: mocks.apiListTabs,
    apiCloseTab: mocks.apiCloseTab,
  }
})

vi.mock('../composables/useTransport', () => ({
  isTauri: () => true,
  tauriInvoke: mocks.tauriInvoke,
  createTransport: vi.fn(),
}))

vi.mock('../composables/useTerminal', () => ({
  setActivePaneId: vi.fn(),
}))

vi.mock('../composables/useSplitPane', () => ({
  useSplitPane: () => splitMocks,
}))

vi.mock('../composables/useThemePacks', () => ({
  loadThemePacks: vi.fn(),
}))

vi.mock('../composables/useDeviceThemeSelection', async () => {
  const { ref } = await import('vue')
  return { effectiveTheme: ref('dark') }
})

vi.mock('../stores/settingsStore', () => ({
  useSettingsStore: () => mocks.settings,
}))

vi.mock('../composables/useWorkspaceApi', () => ({
  apiListWorkspaces: vi.fn(async () => []),
  apiCreateWorkspace: vi.fn(),
  apiUpdateWorkspace: vi.fn(),
  apiDeleteWorkspace: vi.fn(),
  apiActivateWorkspace: vi.fn(async () => {}),
  apiDeactivateWorkspace: vi.fn(async () => {}),
  apiReorderWorkspaces: vi.fn(),
}))

// The real split tree is not what is under test here; a prop-declaring stub
// keeps the terminal stack (xterm, transports) out of the test.
vi.mock('../components/split/SplitContainer.vue', async () => {
  const { defineComponent, h } = await import('vue')
  return {
    default: defineComponent({
      name: 'SplitContainer',
      props: {
        layout: { type: Object, required: true },
        activePaneId: { type: String, default: '' },
        broadcastMode: Boolean,
        broadcastActivity: Number,
        allowClose: Boolean,
        tabId: String,
        workspaceId: String,
        isVisible: Boolean,
        forceWebSocket: Boolean,
      },
      setup() {
        return () => h('div', { class: 'split-stub' })
      },
    }),
  }
})

const sockets: MockWebSocket[] = []
class MockWebSocket {
  static OPEN = 1
  readyState = MockWebSocket.OPEN
  onopen: (() => void) | null = null
  onmessage: ((event: { data: string }) => void) | null = null
  onclose: ((event: { code: number; reason: string }) => void) | null = null
  onerror: (() => void) | null = null
  send = vi.fn()
  close = vi.fn()
  constructor(public url: string) {
    sockets.push(this)
  }
}
vi.stubGlobal('WebSocket', MockWebSocket)

import DetachedApp from '../DetachedApp.vue'
import { t } from '../composables/useI18n'
import { useSessionStore } from '../stores/sessionStore'
import type { TerminalTab } from '../types/pane'

const TAB_ID = 'tab-1'

function serverLayout() {
  return JSON.parse(
    JSON.stringify({
      type: 'split',
      id: 'root',
      direction: 'horizontal',
      ratios: [0.5, 0.5],
      children: [
        { type: 'leaf', paneId: 'pane-a', title: 'Alpha', ratio: 0.5, zoomed: false },
        { type: 'leaf', paneId: 'pane-b', title: 'Beta', ratio: 0.5, zoomed: false },
      ],
    })
  )
}

async function mountDetached() {
  window.history.replaceState({}, '', `/detached.html?tabId=${TAB_ID}`)
  const pinia = createPinia()
  setActivePinia(pinia)
  const wrapper = mount(DetachedApp, {
    global: {
      plugins: [pinia, Toast],
      stubs: { SshAuthPromptDialog: true, ConfirmModal: true },
    },
  })
  await vi.waitFor(() => expect(wrapper.find('.split-stub').exists()).toBe(true))
  await vi.waitFor(() => expect(sockets.length).toBeGreaterThan(0))
  const session = useSessionStore()
  return { wrapper, session }
}

function emit(msg: Record<string, unknown>) {
  sockets[0].onmessage?.({ data: JSON.stringify(msg) })
}

beforeEach(() => {
  vi.clearAllMocks()
  sockets.length = 0
  document.title = ''
  window.history.replaceState({}, '', '/detached.html')
  mocks.apiListTabs.mockResolvedValue({
    tabs: [
      {
        tab_id: TAB_ID,
        pane_id: 'pane-a',
        layout: serverLayout(),
        active_pane_id: 'pane-a',
      },
    ],
    active_pane_id: 'pane-a',
  })
})

describe('DetachedApp', () => {
  it('renders only its tab and forces WebSocket on the split tree', async () => {
    const { wrapper } = await mountDetached()

    const split = wrapper.findComponent({ name: 'SplitContainer' })
    expect(split.exists()).toBe(true)
    expect(split.props('layout')).toMatchObject({ type: 'split' })
    expect(split.props('tabId')).toBe(TAB_ID)
    expect(split.props('forceWebSocket')).toBe(true)

    expect(wrapper.find('.detached-shell__title').text()).toBe('Alpha')
    expect(document.title).toBe('Alpha')
    expect(wrapper.text()).not.toContain(TAB_ID)

    wrapper.unmount()
  })

  it('ignores tab_activated so it never follows the main window selection', async () => {
    const { wrapper, session } = await mountDetached()

    emit({ type: 'tab_activated', pane_id: 'pane-b' })
    await flushPromises()
    await nextTick()

    const tab = session.tabs.find((candidate) => candidate.paneId === TAB_ID)
    expect(tab?.type === 'terminal' ? tab.activePaneId : null).toBe('pane-a')
    expect(session.activePaneId).toBe(TAB_ID)

    wrapper.unmount()
  })

  it('closes the native window when its tab is closed elsewhere', async () => {
    const { wrapper } = await mountDetached()

    emit({ type: 'tab_closed', pane_id: TAB_ID })

    await vi.waitFor(() => {
      expect(mocks.tauriInvoke).toHaveBeenCalledWith('close_tab_window', { tabId: TAB_ID })
    })

    wrapper.unmount()
  })

  it('follows tab_renamed in the titlebar and native window title', async () => {
    const { wrapper } = await mountDetached()
    mocks.tauriInvoke.mockClear()

    emit({ type: 'tab_renamed', tab_id: TAB_ID, title: 'Renamed' })

    await vi.waitFor(() => {
      expect(wrapper.find('.detached-shell__title').text()).toBe('Renamed')
    })
    expect(document.title).toBe('Renamed')
    expect(mocks.tauriInvoke).toHaveBeenCalledWith('set_window_title', { title: 'Renamed' })

    wrapper.unmount()
  })

  it('applies layout_updated and tab_workspace_updated to the local tab', async () => {
    const { wrapper, session } = await mountDetached()

    emit({
      type: 'layout_updated',
      pane_id: TAB_ID,
      layout: {
        type: 'split',
        id: 'root-2',
        direction: 'horizontal',
        ratios: [1],
        children: [{ type: 'leaf', paneId: 'pane-b', title: 'Beta', ratio: 1, zoomed: false }],
      },
      active_pane_id: 'pane-b',
    })
    emit({ type: 'tab_workspace_updated', tab_id: TAB_ID, workspace_id: 'ws-2' })

    await vi.waitFor(() => {
      expect(wrapper.findComponent({ name: 'SplitContainer' }).props('layout')).toMatchObject({
        children: [{ paneId: 'pane-b' }],
      })
    })
    const tab = session.tabs.find((candidate) => candidate.paneId === TAB_ID)
    expect(tab?.type === 'terminal' ? tab.workspaceId : null).toBe('ws-2')

    wrapper.unmount()
  })

  it('shows pane headers only while the tab is split', async () => {
    const split = await mountDetached()
    expect(split.wrapper.findComponent({ name: 'SplitContainer' }).props('allowClose')).toBe(true)
    split.wrapper.unmount()

    mocks.apiListTabs.mockResolvedValue({
      tabs: [
        {
          tab_id: TAB_ID,
          pane_id: 'pane-a',
          layout: { type: 'leaf', paneId: 'pane-a', title: 'Alpha', ratio: 1, zoomed: false },
          active_pane_id: 'pane-a',
        },
      ],
      active_pane_id: 'pane-a',
    })
    const single = await mountDetached()
    expect(single.wrapper.findComponent({ name: 'SplitContainer' }).props('allowClose')).toBe(false)
    single.wrapper.unmount()
  })

  it('shows the broadcast indicator and marks the native title', async () => {
    const { wrapper, session } = await mountDetached()
    expect(wrapper.find('.detached-shell__broadcast').exists()).toBe(false)

    const tab = session.tabs.find((candidate) => candidate.paneId === TAB_ID) as TerminalTab
    tab.broadcastMode = true
    await nextTick()
    await nextTick()

    const badge = wrapper.find('.detached-shell__broadcast')
    expect(badge.exists()).toBe(true)
    expect(badge.attributes('aria-label')).toBe(t('split.broadcastActive'))
    expect(document.title).toBe(`Alpha · ${t('split.broadcastActive')}`)

    wrapper.unmount()
  })

  it('restores a split layout changed by another client while offline', async () => {
    const { wrapper, session } = await mountDetached()

    emit({ type: 'tab_list', tabs: [
      {
        tab_id: TAB_ID,
        pane_id: 'pane-c',
        layout: {
          type: 'split',
          id: 'root-3',
          direction: 'vertical',
          ratios: [0.5, 0.5],
          children: [
            { type: 'leaf', paneId: 'pane-c', title: 'Gamma', ratio: 0.5, zoomed: false },
            { type: 'leaf', paneId: 'pane-d', title: 'Delta', ratio: 0.5, zoomed: false },
          ],
        },
        active_pane_id: 'pane-d',
      },
    ] })

    await vi.waitFor(() => {
      expect(wrapper.findComponent({ name: 'SplitContainer' }).props('layout')).toMatchObject({
        direction: 'vertical',
        children: [{ paneId: 'pane-c' }, { paneId: 'pane-d' }],
      })
    })
    const tab = session.tabs.find((candidate) => candidate.paneId === TAB_ID) as TerminalTab
    expect(tab.activePaneId).toBe('pane-d')

    wrapper.unmount()
  })

  it('never writes the main window tab snapshot', async () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem')
    const { wrapper } = await mountDetached()

    emit({ type: 'tab_renamed', tab_id: TAB_ID, title: 'Renamed' })
    emit({
      type: 'layout_updated',
      pane_id: TAB_ID,
      layout: serverLayout(),
      active_pane_id: 'pane-b',
    })
    await flushPromises()

    const writtenKeys = setItem.mock.calls.map((call) => String(call[0]))
    expect(writtenKeys.some((key) => key.includes('dinotty_tabs'))).toBe(false)

    setItem.mockRestore()
    wrapper.unmount()
  })
})
