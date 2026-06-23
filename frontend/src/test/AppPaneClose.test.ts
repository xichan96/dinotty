import { describe, it, expect, vi, beforeEach } from 'vitest'

// Stub WebSocket to a no-op shim — happy-dom may not provide a real one
// in some test runners, and App.vue's connectSyncWS will read its
// readyState. We set readyState=CONNECTING (0) so the fallback timer
// fires apiListTabs and populates tabs.
class MockWebSocket {
  public readyState = 0
  public onopen: any = null
  public onmessage: any = null
  public onclose: any = null
  public onerror: any = null
  constructor(public url: string) {}
  close() {}
}
;(global as any).WebSocket = MockWebSocket as any
;(global as any).WebSocket.OPEN = 1
;(global as any).WebSocket.CONNECTING = 0
;(global as any).WebSocket.CLOSED = 3

// Stub localStorage so persist() can write without throwing
const localStorageMock = {
  store: {} as Record<string, string>,
  getItem(key: string) { return this.store[key] ?? null },
  setItem(key: string, value: string) { this.store[key] = value },
  removeItem(key: string) { delete this.store[key] },
  clear() { this.store = {} },
}
;(global as any).localStorage = localStorageMock

// vi.mock factories are hoisted; vi.hoisted lets us share spies with them.
const mocks = vi.hoisted(() => ({
  closePane: vi.fn<(paneId: string) => Promise<boolean>>(),
  splitPane: vi.fn(),
  toggleBroadcast: vi.fn(),
  toggleZoom: vi.fn(),
  equalizePanes: vi.fn(),
  focusPane: vi.fn(),
  focusNext: vi.fn(),
  focusPrev: vi.fn(),
  keyboardResize: vi.fn(),
  reorderPane: vi.fn(),
  onTerminalInput: vi.fn(),
  focusNeighbor: vi.fn(),
  apiCloseTab: vi.fn(async () => {}),
}))

vi.mock('../composables/apiBase', () => ({
  apiUrl: (path: string) => path,
  authFetch: vi.fn(async () => ({ ok: true, json: async () => ({}) })),
  getAuthToken: () => 'token',
  setAuthToken: () => {},
  getApiBase: async () => 'http://127.0.0.1:7681',
  fetchServerToken: async () => '',
  hasAuthToken: () => true,
  wsUrlWithToken: (url: string) => url,
  checkTokenConfigured: async () => false,
}))
vi.mock('../composables/useTransport', () => ({ isTauri: () => false }))
vi.mock('../composables/useTerminal', () => ({ isTouchDevice: () => false, setActivePaneId: () => {} }))
// Per-binding key map so Cmd+W can be dispatched without colliding with
// other keyActions in onGlobalKeydown (the first matching binding wins).
const BINDING_KEYS: Record<string, string> = {
  togglePalette: 'p',
  openBookmarks: 'b',
  newTab: 't',
  closeTab: 'w',
  splitHorizontal: 'd',
  splitVertical: 'e',
  toggleBroadcast: 'g',
  toggleZoom: 'z',
  equalizePanes: '=',
  focusNextPane: ']',
  focusPrevPane: '[',
  searchTerminal: 'f',
}
vi.mock('../composables/useKeybindings', () => ({
  useKeybindings: () => ({
    getBinding: (id: string) => ({ key: BINDING_KEYS[id] ?? 'x', shift: false }),
    formatBinding: (b: any) => b.key,
  }),
}))
vi.mock('../composables/useMonitor', () => ({ initMonitorHistory: () => {} }))
vi.mock('../composables/useNotification', () => ({
  useNotification: () => ({
    notifications: { value: [] },
    unreadCount: { value: 0 },
    unreadByPane: {},
    togglePanel: vi.fn(),
    clearPaneUnread: vi.fn(),
  }),
}))
vi.mock('../composables/usePluginLoader', () => ({
  usePluginLoader: () => ({
    loadedPlugins: { value: new Map() },
    loadAll: vi.fn(),
    getPluginContext: vi.fn(),
    pluginList: { value: [] },
    allCommands: { value: [] },
    allQuickPicks: { value: [] },
  }),
  handlePluginChanged: vi.fn(),
}))

vi.mock('../composables/useTabApi', () => ({
  apiCreateTab: vi.fn(async () => ({ tab_id: 't-new', pane_id: 'p-new', layout: {} })),
  apiCloseTab: mocks.apiCloseTab,
  apiClosePane: vi.fn(async () => ({ tab_closed: false })),
  apiActivatePane: vi.fn(async () => {}),
  apiListTabs: vi.fn(async () => ({
    tabs: [
      {
        tab_id: 'tab-1',
        pane_id: 'pane-1',
        active_pane_id: 'pane-1',
        layout: {
          type: 'split',
          direction: 'horizontal',
          ratio: 0.5,
          children: [
            { type: 'leaf', paneId: 'pane-1', title: 'P1', ratio: 1, zoomed: false },
            { type: 'leaf', paneId: 'pane-2', title: 'P2', ratio: 1, zoomed: false },
          ],
        },
      },
    ],
    active_pane_id: 'pane-1',
  })),
}))

vi.mock('../composables/useI18n', () => ({
  useI18n: () => ({ t: (k: string) => k, locale: { value: 'zh' }, setLocale: vi.fn() }),
}))

vi.mock('../composables/useSplitPane', () => ({
  useSplitPane: () => ({
    closePane: mocks.closePane,
    splitPane: mocks.splitPane,
    toggleBroadcast: mocks.toggleBroadcast,
    toggleZoom: mocks.toggleZoom,
    equalizePanes: mocks.equalizePanes,
    focusPane: mocks.focusPane,
    focusNext: mocks.focusNext,
    focusPrev: mocks.focusPrev,
    keyboardResize: mocks.keyboardResize,
    reorderPane: mocks.reorderPane,
    onTerminalInput: mocks.onTerminalInput,
    focusNeighbor: mocks.focusNeighbor,
  }),
}))

import { shallowMount } from '@vue/test-utils'
import { nextTick, defineComponent, h } from 'vue'
import App from '../App.vue'
import { settings } from '../composables/useSettings'

// Spec: openspec/changes/confirm-before-close-tab/spec.md
//   "### Requirement: Pane Close Confirmation"
//   "### Scenario: Pane close in split-screen triggers confirmation"
// Every pane is an independent terminal session. Closing any pane must
// route through the same confirmation gate as closing the whole tab.

// A SplitContainer stub that proxies emits — when App.vue's template wires
// `@close="(id) => onClosePane(tab.paneId, id)"` and the stub fires `close`,
// the inline arrow handler runs against the live `tabs` state.
const SplitContainerStub = defineComponent({
  name: 'SplitContainer',
  emits: ['close', 'register', 'title-change', 'focus', 'input', 'file-click', 'preview-link', 'link-activate', 'reorder', 'divider-drag-end'],
  setup(_, { emit }) {
    return () => h('div', { class: 'split-stub' })
  },
})

const ConfirmModalStub = defineComponent({
  name: 'ConfirmModal',
  props: ['visible', 'title', 'message', 'confirmText', 'cancelText'],
  emits: ['confirm', 'cancel'],
  setup(props, { emit }) {
    return () => h('div', {
      class: 'confirm-stub',
      'data-visible': String(props.visible),
      onClick: () => emit('confirm'),
    })
  },
})

async function mountWithTabs() {
  vi.useFakeTimers()
  const wrapper = shallowMount(App, {
    global: {
      stubs: {
        SplitContainer: SplitContainerStub,
        ConfirmModal: ConfirmModalStub,
      },
    },
  })
  await nextTick()
  // Fast-forward past the 3-second REST fallback timer in App.vue's onMounted.
  vi.advanceTimersByTime(3500)
  await nextTick()
  await nextTick()
  vi.useRealTimers()
  return wrapper
}

describe('App.vue - onClosePane routes through confirmation gate', () => {
  beforeEach(() => {
    settings.confirm_before_close_tab = true
    mocks.closePane.mockReset()
    mocks.splitPane.mockReset()
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

    // ConfirmModal must now be visible
    const confirmModal = wrapper.findComponent(ConfirmModalStub)
    expect(confirmModal.exists()).toBe(true)
    expect((confirmModal.vm as any).$props.visible).toBe(true)

    wrapper.unmount()
  })

  it('onConfirmClose with pendingClosePaneId → calls splitPane.closePane, not closeTab', async () => {
    mocks.closePane.mockResolvedValue(true)

    const wrapper = await mountWithTabs()
    const splitContainer = wrapper.findComponent(SplitContainerStub)
    await splitContainer.vm.$emit('close', 'pane-2')
    await nextTick()

    const confirmModal = wrapper.findComponent(ConfirmModalStub)
    await confirmModal.vm.$emit('confirm')
    await nextTick()

    // splitPane.closePane should be called with the pane id
    expect(mocks.closePane).toHaveBeenCalledWith('pane-2')

    // apiCloseTab should NOT have been called (closePane returned true)
    expect(mocks.apiCloseTab).not.toHaveBeenCalled()

    // Modal should be closed
    expect((confirmModal.vm as any).$props.visible).toBe(false)

    wrapper.unmount()
  })

  it('onConfirmClose with pane close cascade (closePane returns false) → calls closeTab fallback', async () => {
    mocks.closePane.mockResolvedValue(false)

    const wrapper = await mountWithTabs()
    const splitContainer = wrapper.findComponent(SplitContainerStub)
    await splitContainer.vm.$emit('close', 'pane-3')
    await nextTick()

    const confirmModal = wrapper.findComponent(ConfirmModalStub)
    await confirmModal.vm.$emit('confirm')
    await nextTick()

    // splitPane.closePane should be called first
    expect(mocks.closePane).toHaveBeenCalledWith('pane-3')

    // Since closePane returned false, the tab should be closed (cascade fallback)
    expect(mocks.apiCloseTab).toHaveBeenCalled()

    wrapper.unmount()
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

    wrapper.unmount()
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

    wrapper.unmount()
  })
})

describe('App.vue - Cmd+W routes through confirmation gate in split-pane mode', () => {
  beforeEach(() => {
    settings.confirm_before_close_tab = true
    mocks.closePane.mockReset()
    mocks.splitPane.mockReset()
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
    mocks.apiCloseTab.mockReset()
    localStorageMock.clear()
  })

  it('Cmd+W on multi-pane layout → does NOT closePane, shows modal', async () => {
    mocks.closePane.mockResolvedValue(true)

    const wrapper = await mountWithTabs()

    // Dispatch Cmd+W (stubbed key 'w' for closeTab binding).
    // App.vue attaches the keydown listener to `document`.
    document.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'w',
      metaKey: true,
      bubbles: true,
    }))
    await nextTick()

    // closePane must NOT have been called yet — we expect the modal gate
    expect(mocks.closePane).not.toHaveBeenCalled()

    // ConfirmModal must now be visible
    const confirmModal = wrapper.findComponent(ConfirmModalStub)
    expect(confirmModal.exists()).toBe(true)
    expect((confirmModal.vm as any).$props.visible).toBe(true)

    wrapper.unmount()
  })

  it('Cmd+W + confirm in multi-pane mode → calls splitPane.closePane with active pane id', async () => {
    mocks.closePane.mockResolvedValue(true)

    const wrapper = await mountWithTabs()

    document.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'w',
      metaKey: true,
      bubbles: true,
    }))
    await nextTick()

    const confirmModal = wrapper.findComponent(ConfirmModalStub)
    await confirmModal.vm.$emit('confirm')
    await nextTick()

    // closePane should be called with the active pane id (pane-1 in fixture)
    expect(mocks.closePane).toHaveBeenCalledWith('pane-1')
    // apiCloseTab should NOT have been called (closePane returned true)
    expect(mocks.apiCloseTab).not.toHaveBeenCalled()
    // Modal should be closed
    expect((confirmModal.vm as any).$props.visible).toBe(false)

    wrapper.unmount()
  })

  it('Cmd+W + setting off → bypasses modal and calls closePane directly', async () => {
    settings.confirm_before_close_tab = false
    mocks.closePane.mockResolvedValue(true)

    const wrapper = await mountWithTabs()

    document.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'w',
      metaKey: true,
      bubbles: true,
    }))
    await nextTick()

    expect(mocks.closePane).toHaveBeenCalledWith('pane-1')
    // Modal should NOT be visible (bypass)
    const confirmModal = wrapper.findComponent(ConfirmModalStub)
    expect((confirmModal.vm as any).$props.visible).toBe(false)

    wrapper.unmount()
  })
})
