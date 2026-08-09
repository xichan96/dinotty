import { afterAll, afterEach, vi } from 'vitest'

// Stub WebSocket to a no-op shim — happy-dom may not provide a real one
// in some test runners, and App.vue's connectSyncWS will read its
// readyState. We set readyState=CONNECTING (0) so the fallback timer
// fires apiListTabs and populates tabs.
const originalWebSocket = (global as any).WebSocket
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
const originalLocalStorage = (global as any).localStorage
export const localStorageMock = {
  store: {} as Record<string, string>,
  getItem(key: string) {
    return this.store[key] ?? null
  },
  setItem(key: string, value: string) {
    this.store[key] = value
  },
  removeItem(key: string) {
    delete this.store[key]
  },
  clear() {
    this.store = {}
  },
}
;(global as any).localStorage = localStorageMock

// vi.mock factories are hoisted; vi.hoisted lets us share spies with them.
const mocks = vi.hoisted(() => {
  let notificationRequestIdCounter = 0
  return {
    closePane: vi.fn<(paneId: string) => Promise<boolean>>(),
    splitPane: vi.fn(),
    insertNonTerminalPane: vi.fn<() => Promise<void>>(async () => {}),
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
    scrollTabIntoView: vi.fn(),
    apiActivatePane: vi.fn<(paneId: string, activePaneId: string) => Promise<void>>(async () => {}),
    apiActivateWorkspace: vi.fn<(id: string) => Promise<void>>(async () => {}),
    apiDeactivateWorkspace: vi.fn<() => Promise<void>>(async () => {}),
    onSystemKeyboardClose: undefined as undefined | (() => void),
    apiCreateTab: vi.fn(async () => ({
      tab_id: 't-new',
      pane_id: 'p-new',
      layout: { type: 'leaf', paneId: 'p-new', title: 'Terminal', ratio: 1, zoomed: false },
    })),
    apiCloseTab: vi.fn(async () => {}),
    clearForPaneIds: vi.fn(),
    notificationItems: { value: [] as unknown[] },
    unreadAttentionCount: { value: 0 },
    unreadByPane: {} as Record<string, string>,
    authoritativeSeverity: null as string | null,
    presentationSettings: null as any,
    authFetch: vi.fn<(input: string, init?: RequestInit) => Promise<any>>(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ status: 'accepted', notifId: 'notif-1', eventSeq: '1' }),
    })),
    pushNotification: vi.fn(),
    setActiveReadContext: vi.fn(),
    evaluateActiveRead: vi.fn(),
    stopForegroundGainSubscription: vi.fn(),
    mintNotificationRequestId: vi.fn(() => `tab-nonce-${++notificationRequestIdCounter}`),
    resetNotificationRequestIds: () => {
      notificationRequestIdCounter = 0
    },
  }
})

vi.mock('../../composables/apiBase', () => ({
  apiUrl: (path: string) => path,
  authFetch: mocks.authFetch,
  getAuthToken: () => 'token',
  setAuthToken: () => {},
  getApiBase: async () => 'http://127.0.0.1:7681',
  fetchServerToken: async () => '',
  fetchAutoToken: async () => '',
  validateToken: async () => ({ ok: true }),
  hasAuthToken: () => true,
  wsUrlWithToken: (url: string) => url,
  checkTokenConfigured: async () => false,
}))
vi.mock('../../composables/useTransport', () => ({ isTauri: () => false, tauriInvoke: vi.fn() }))
vi.mock('../../composables/useHistory', async () => {
  const { ref } = await vi.importActual<typeof import('vue')>('vue')
  return {
    useHistory: () => ({
      suggestions: ref([]),
      fetchSuggestions: vi.fn(),
      fetchDebounced: vi.fn(),
    }),
  }
})
vi.mock('../../composables/useTerminal', () => ({
  applyAfterTerminalComposition: (apply: () => void) => {
    apply()
    return true
  },
  configureAllMobileInputTextareas: () => {},
  isKbTypingLocked: () => false,
  isTouchDevice: () => false,
  setActivePaneId: () => {},
  setKbTypingLock: () => {},
}))
vi.mock('../../composables/useViewportResize', async () => {
  const { ref } = await vi.importActual<typeof import('vue')>('vue')
  return {
    useViewportResize: (options: { onSystemKeyboardClose?: () => void }) => {
      mocks.onSystemKeyboardClose = options.onSystemKeyboardClose
      return { isLandscape: ref(false), dispose: vi.fn() }
    },
  }
})
vi.mock('../../utils/clientPlatform', () => ({ isWindowsClient: true }))
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
  missionControl: 'm',
  sshConnect: 's',
  fontSizeUp: '=',
  fontSizeDown: '-',
  fontSizeReset: '0',
}
vi.mock('../../composables/useKeybindings', () => ({
  defs: [
    {
      id: 'term.newline',
      kind: 'terminal',
      sequence: '\x1b\r',
      titleKey: 'keybinding.term.newline',
      icon: {},
      defaultBinding: { key: 'enter', shift: true, meta: false },
    },
    {
      id: 'term.lineStart',
      kind: 'terminal',
      sequence: '\x01',
      titleKey: 'keybinding.term.lineStart',
      icon: {},
      defaultBinding: { key: 'arrowleft', shift: false, meta: true },
    },
    {
      id: 'term.lineEnd',
      kind: 'terminal',
      sequence: '\x05',
      titleKey: 'keybinding.term.lineEnd',
      icon: {},
      defaultBinding: { key: 'arrowright', shift: false, meta: true },
    },
    {
      id: 'term.deleteToLineStart',
      kind: 'terminal',
      sequence: '\x15',
      titleKey: 'keybinding.term.deleteToLineStart',
      icon: {},
      defaultBinding: { key: 'backspace', shift: false, meta: true },
    },
  ],
  useKeybindings: () => ({
    getBinding: (id: string) => ({ key: BINDING_KEYS[id] ?? 'x', shift: false }),
    formatBinding: (b: any) => b.key,
  }),
  keyEventMatchesBinding: (e: KeyboardEvent, binding: { key: string; shift: boolean }) =>
    e.key.toLowerCase() === binding.key.toLowerCase() && e.shiftKey === binding.shift,
}))
vi.mock('../../composables/useMonitor', () => ({ initMonitorHistory: () => {} }))
vi.mock('../../composables/useNotification', () => ({
  useNotification: () => ({
    notifications: mocks.notificationItems,
    unreadAttentionCount: mocks.unreadAttentionCount,
    historyCount: { value: 0 },
    unreadByPane: mocks.unreadByPane,
    togglePanel: vi.fn(),
    clearPaneUnread: vi.fn(),
    clearForPaneIds: mocks.clearForPaneIds,
    setGoToPaneHandler: vi.fn(),
  }),
  aggregateSeverity: vi.fn(() => mocks.authoritativeSeverity),
  pushNotification: mocks.pushNotification,
  setToastInstance: vi.fn(() => vi.fn()),
  setActiveReadContext: vi.fn((...args) => {
    mocks.setActiveReadContext(...args)
    return vi.fn()
  }),
  evaluateActiveRead: mocks.evaluateActiveRead,
  getNotificationClientId: () => 'client-stable',
  mintNotificationRequestId: mocks.mintNotificationRequestId,
  disposeNotificationPresentationScheduler: vi.fn(),
}))
vi.mock('../../composables/useNotificationPresentation', async () => {
  const { reactive } = await import('vue')
  mocks.presentationSettings = reactive({ channels: { tab_indicator: true } })
  return {
    useNotificationPresentation: () => ({ settings: mocks.presentationSettings }),
  }
})
vi.mock('../../composables/useAppForeground', () => ({
  getIsAppForeground: () => true,
  onAppForegroundGain: vi.fn(() => mocks.stopForegroundGainSubscription),
}))
vi.mock('../../composables/usePluginLoader', () => ({
  usePluginLoader: () => ({
    loadedPlugins: new Map(),
    loadAll: vi.fn(),
    getPluginContext: vi.fn(),
    pluginList: { value: [], __v_isRef: true },
    allCommands: { value: [], __v_isRef: true },
    allQuickPicks: { value: [], __v_isRef: true },
  }),
  handlePluginChanged: vi.fn(),
}))

vi.mock('../../composables/useTabApi', () => ({
  apiCreateTab: mocks.apiCreateTab,
  apiCloseTab: mocks.apiCloseTab,
  apiClosePane: vi.fn(async () => ({ tab_closed: false })),
  apiActivatePane: mocks.apiActivatePane,
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

vi.mock('../../composables/useWorkspaceApi', () => ({
  apiListWorkspaces: vi.fn(async () => []),
  apiCreateWorkspace: vi.fn(),
  apiUpdateWorkspace: vi.fn(),
  apiDeleteWorkspace: vi.fn(),
  apiActivateWorkspace: mocks.apiActivateWorkspace,
  apiDeactivateWorkspace: mocks.apiDeactivateWorkspace,
  apiReorderWorkspaces: vi.fn(),
}))

vi.mock('../../composables/useI18n', () => ({
  useI18n: () => ({ t: (k: string) => k, locale: { value: 'zh' }, setLocale: vi.fn() }),
}))

vi.mock('../../composables/useSplitPane', () => ({
  useSplitPane: () => ({
    closePane: mocks.closePane,
    splitPane: mocks.splitPane,
    insertNonTerminalPane: mocks.insertNonTerminalPane,
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

import { shallowMount, type VueWrapper } from '@vue/test-utils'
import { nextTick, defineComponent, h, type PropType } from 'vue'
import { createPinia } from 'pinia'
import App from '../../App.vue'
import { settings } from '../../composables/useSettings'
import { useUiStore } from '../../stores/uiStore'
import { useWorkspaces } from '../../composables/useWorkspaces'

// Spec: openspec/changes/confirm-before-close-tab/spec.md
//   "### Requirement: Pane Close Confirmation"
//   "### Scenario: Pane close in split-screen triggers confirmation"
// Every pane is an independent terminal session. Closing any pane must
// route through the same confirmation gate as closing the whole tab.

// A SplitContainer stub that proxies emits — when App.vue's template wires
// `@close="(id) => onClosePane(tab.paneId, id)"` and the stub fires `close`,
// the inline arrow handler runs against the live `tabs` state.
export const SplitContainerStub = defineComponent({
  name: 'SplitContainer',
  props: ['layout'],
  emits: [
    'close',
    'register',
    'title-change',
    'shell-info',
    'focus',
    'input',
    'file-click',
    'preview-link',
    'link-activate',
    'reorder',
    'divider-drag-end',
  ],
  setup(_, { emit }) {
    return () => h('div', { class: 'split-stub' })
  },
})

export const TabBarStub = defineComponent({
  name: 'TabBar',
  props: { indicators: { type: Object, default: () => ({}) } },
  setup(props, { slots, expose }) {
    expose({
      hasTab: () => true,
      scrollTabIntoView: mocks.scrollTabIntoView,
    })
    return () =>
      h(
        'div',
        {
          class: 'tab-bar-stub',
          'data-indicators': JSON.stringify(props.indicators),
        },
        slots.right?.()
      )
  },
})

export const ConfirmModalStub = defineComponent({
  name: 'ConfirmModal',
  props: ['visible', 'title', 'message', 'confirmText', 'cancelText'],
  emits: ['confirm', 'cancel'],
  setup(props, { emit }) {
    return () =>
      h('div', {
        class: 'confirm-stub',
        'data-visible': String(props.visible),
        onClick: () => emit('confirm'),
      })
  },
})

export const ConfirmCloseDialogStub = defineComponent({
  name: 'ConfirmCloseDialog',
  emits: ['confirm'],
  setup(_, { emit }) {
    const ui = useUiStore()
    return () =>
      h('div', {
        class: 'confirm-close-stub',
        'data-visible': String(ui.confirmCloseVisible),
        onClick: () => emit('confirm', ui.pendingCloseTabId, ui.pendingClosePaneId),
      })
  },
})

export const MobileKeyboardStub = defineComponent({
  name: 'MobileKeyboard',
  emits: ['app-action', 'dismiss'],
  setup() {
    return () => h('div', { class: 'mobile-keyboard-stub' })
  },
})

export const SystemKeyboardToolbarStub = defineComponent({
  name: 'SystemKeyboardToolbar',
  props: {
    visible: Boolean,
    paneId: { type: String, required: true },
    getSendFn: { type: Function as PropType<() => unknown>, required: true },
    actionOpen: Boolean,
  },
  emits: [
    'update:actionOpen',
    'modifier-change',
    'app-action',
    'dismiss',
    'focus-xterm',
    'paste-text',
  ],
  setup(props) {
    return () =>
      h('div', {
        class: 'system-keyboard-toolbar-stub',
        'data-visible': String(props.visible),
        'data-action-open': String(props.actionOpen),
      })
  },
})

export const KbToggleButtonStub = defineComponent({
  name: 'KbToggleButton',
  emits: ['toggle'],
  setup() {
    return () => h('button', { class: 'kb-toggle-stub' })
  },
})

let mountedWrapper: VueWrapper | undefined

export async function mountWithTabs(options: { realKeyboard?: boolean } = {}) {
  vi.useFakeTimers()
  const wrapper = shallowMount(App, {
    global: {
      plugins: [createPinia()],
      stubs: {
        SplitContainer: SplitContainerStub,
        TabBar: TabBarStub,
        ConfirmCloseDialog: ConfirmCloseDialogStub,
        ConfirmModal: ConfirmModalStub,
        MobileKeyboard: options.realKeyboard ? false : MobileKeyboardStub,
        SystemKeyboardToolbar: SystemKeyboardToolbarStub,
        KbToggleButton: KbToggleButtonStub,
      },
    },
  })
  mountedWrapper = wrapper
  await nextTick()
  await Promise.resolve()
  await Promise.resolve()
  // Fast-forward past the 3-second REST fallback timer in App.vue's onMounted.
  await vi.advanceTimersByTimeAsync(3500)
  await nextTick()
  await nextTick()
  vi.useRealTimers()
  return wrapper
}

export function clearMountedWrapper() {
  mountedWrapper = undefined
}

afterEach(() => {
  mountedWrapper?.unmount()
  mountedWrapper = undefined
  const workspaceState = useWorkspaces()
  workspaceState.workspaces.value = []
  workspaceState.activeWorkspaceId.value = null
  vi.useRealTimers()
  localStorageMock.clear()
  mocks.clearForPaneIds.mockReset()
  mocks.notificationItems.value = []
  mocks.unreadAttentionCount.value = 0
  for (const paneId of Object.keys(mocks.unreadByPane)) delete mocks.unreadByPane[paneId]
  mocks.authoritativeSeverity = null
  mocks.presentationSettings.channels.tab_indicator = true
  mocks.authFetch.mockReset()
  mocks.authFetch.mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ status: 'accepted', notifId: 'notif-1', eventSeq: '1' }),
  })
  mocks.pushNotification.mockReset()
  mocks.scrollTabIntoView.mockReset()
  mocks.apiActivatePane.mockReset()
  mocks.apiActivatePane.mockResolvedValue(undefined)
  mocks.apiActivateWorkspace.mockReset()
  mocks.apiActivateWorkspace.mockResolvedValue(undefined)
  mocks.apiDeactivateWorkspace.mockReset()
  mocks.apiDeactivateWorkspace.mockResolvedValue(undefined)
  mocks.onSystemKeyboardClose = undefined
  mocks.mintNotificationRequestId.mockClear()
  mocks.resetNotificationRequestIds()
  settings.mobile_input_mode = null
})

afterAll(() => {
  if (originalWebSocket === undefined) delete (global as any).WebSocket
  else (global as any).WebSocket = originalWebSocket

  if (originalLocalStorage === undefined) delete (global as any).localStorage
  else (global as any).localStorage = originalLocalStorage
})

export { mocks }
