import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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
const localStorageMock = {
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

vi.mock('../composables/apiBase', () => ({
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
vi.mock('../composables/useTransport', () => ({ isTauri: () => false, tauriInvoke: vi.fn() }))
vi.mock('../composables/useHistory', async () => {
  const { ref } = await vi.importActual<typeof import('vue')>('vue')
  return {
    useHistory: () => ({
      suggestions: ref([]),
      fetchSuggestions: vi.fn(),
      fetchDebounced: vi.fn(),
    }),
  }
})
vi.mock('../composables/useTerminal', () => ({
  isTouchDevice: () => false,
  setActivePaneId: () => {},
}))
vi.mock('../utils/clientPlatform', () => ({ isWindowsClient: true }))
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
vi.mock('../composables/useKeybindings', () => ({
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
vi.mock('../composables/useMonitor', () => ({ initMonitorHistory: () => {} }))
vi.mock('../composables/useNotification', () => ({
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
vi.mock('../composables/useNotificationPresentation', async () => {
  const { reactive } = await import('vue')
  mocks.presentationSettings = reactive({ channels: { tab_indicator: true } })
  return {
    useNotificationPresentation: () => ({ settings: mocks.presentationSettings }),
  }
})
vi.mock('../composables/useAppForeground', () => ({
  getIsAppForeground: () => true,
  onAppForegroundGain: vi.fn(() => mocks.stopForegroundGainSubscription),
}))
vi.mock('../composables/usePluginLoader', () => ({
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

vi.mock('../composables/useTabApi', () => ({
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

vi.mock('../composables/useWorkspaceApi', () => ({
  apiListWorkspaces: vi.fn(async () => []),
  apiCreateWorkspace: vi.fn(),
  apiUpdateWorkspace: vi.fn(),
  apiDeleteWorkspace: vi.fn(),
  apiActivateWorkspace: mocks.apiActivateWorkspace,
  apiDeactivateWorkspace: mocks.apiDeactivateWorkspace,
  apiReorderWorkspaces: vi.fn(),
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

import { shallowMount, type VueWrapper } from '@vue/test-utils'
import { nextTick, defineComponent, h } from 'vue'
import { createPinia } from 'pinia'
import App from '../App.vue'
import { settings } from '../composables/useSettings'
import { useUiStore } from '../stores/uiStore'
import { useSessionStore } from '../stores/sessionStore'
import { useWorkspaces } from '../composables/useWorkspaces'
import { currentRevealNavGen } from '../utils/navGen'
import type { Tab } from '../types/pane'

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

const TabBarStub = defineComponent({
  name: 'TabBar',
  props: { indicators: { type: Object, default: () => ({}) } },
  setup(props, { slots, expose }) {
    expose({
      hasTab: () => true,
      scrollTabIntoView: mocks.scrollTabIntoView,
    })
    return () => h('div', {
      class: 'tab-bar-stub',
      'data-indicators': JSON.stringify(props.indicators),
    }, slots.right?.())
  },
})

const ConfirmModalStub = defineComponent({
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

const ConfirmCloseDialogStub = defineComponent({
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

const MobileKeyboardStub = defineComponent({
  name: 'MobileKeyboard',
  emits: ['app-action', 'dismiss'],
  setup() {
    return () => h('div', { class: 'mobile-keyboard-stub' })
  },
})

let mountedWrapper: VueWrapper | undefined

async function mountWithTabs(options: { realKeyboard?: boolean } = {}) {
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
  mocks.mintNotificationRequestId.mockClear()
  mocks.resetNotificationRequestIds()
})

describe('App.vue - terminal-sequence app actions', () => {
  it('sends each exact sequence through the active terminal input path and no-ops unknown ids', async () => {
    const wrapper = await mountWithTabs()
    const activeTerminal = { sendData: vi.fn(), setOutputListener: vi.fn() }
    const splitContainer = wrapper.findComponent(SplitContainerStub)
    await splitContainer.vm.$emit('register', 'pane-1', activeTerminal)

    const keyboard = wrapper.findComponent(MobileKeyboardStub)
    const cases = [
      ['term.newline', '\x1b\r'],
      ['term.lineStart', '\x01'],
      ['term.lineEnd', '\x05'],
      ['term.deleteToLineStart', '\x15'],
    ] as const

    for (const [id, sequence] of cases) {
      await keyboard.vm.$emit('app-action', id, {})
      expect(activeTerminal.sendData).toHaveBeenLastCalledWith(sequence)
    }
    expect(activeTerminal.sendData).toHaveBeenCalledTimes(cases.length)

    await keyboard.vm.$emit('app-action', 'unknown-action', { autoEnter: true })
    expect(activeTerminal.sendData).toHaveBeenCalledTimes(cases.length)
  })
})

describe('App.vue - system keyboard dismissal', () => {
  it('runs the real dismiss button chain in textarea, active-terminal, active-element order', async () => {
    const wrapper = await mountWithTabs({ realKeyboard: true })
    const order: string[] = []
    const fallbackInput = document.createElement('input')
    document.body.appendChild(fallbackInput)
    const nativeFallbackBlur = fallbackInput.blur.bind(fallbackInput)
    vi.spyOn(fallbackInput, 'blur').mockImplementation(() => {
      order.push('activeElement')
      nativeFallbackBlur()
    })

    const activeTerminal = {
      sendData: vi.fn(),
      setOutputListener: vi.fn(),
      blur: vi.fn(() => {
        order.push('terminalRef')
        fallbackInput.focus()
      }),
    }
    await wrapper.findComponent(SplitContainerStub).vm.$emit('register', 'pane-1', activeTerminal)

    const textarea = wrapper.find<HTMLTextAreaElement>('.mkb-text-input').element
    textarea.focus()
    await nextTick()
    const nativeTextareaBlur = textarea.blur.bind(textarea)
    vi.spyOn(textarea, 'blur').mockImplementation(() => {
      order.push('textarea')
      nativeTextareaBlur()
    })

    const dismissButton = wrapper.find('.mkb-dismiss-btn')
    expect(dismissButton.attributes('title')).toBe('mobileKb.dismissKeyboard')
    expect(dismissButton.attributes('aria-label')).toBe('mobileKb.dismissKeyboard')
    await dismissButton.trigger('mousedown')

    expect(order).toEqual(['textarea', 'terminalRef', 'activeElement'])
    expect(activeTerminal.blur).toHaveBeenCalledOnce()
    fallbackInput.remove()
  })

  it('blurs the active element when the MobileKeyboard stub emits dismiss', async () => {
    const wrapper = await mountWithTabs()
    const input = document.createElement('input')
    document.body.appendChild(input)
    input.focus()
    const blur = vi.spyOn(input, 'blur')

    await wrapper.findComponent(MobileKeyboardStub).vm.$emit('dismiss')

    expect(blur).toHaveBeenCalledOnce()
    input.remove()
  })

  it('does not throw for a non-terminal active tab and blurs from the real dismiss button', async () => {
    const wrapper = await mountWithTabs({ realKeyboard: true })
    const session = useSessionStore()
    session.setTabs([
      { type: 'plugin', paneId: 'plugin:memory', title: 'Memory', pluginId: 'memory' },
    ])
    session.setActivePane('plugin:memory')
    await nextTick()

    const textarea = wrapper.find<HTMLTextAreaElement>('.mkb-text-input').element
    textarea.focus()
    await nextTick()
    const blur = vi.spyOn(textarea, 'blur')

    await expect(wrapper.find('.mkb-dismiss-btn').trigger('mousedown')).resolves.toBeUndefined()
    expect(blur).toHaveBeenCalledOnce()
    expect(document.activeElement).not.toBe(textarea)
  })
})

describe('App.vue - activateTab cross-workspace', () => {
  const terminalTab = (paneId: string, cwd: string): Tab => ({
    type: 'terminal',
    paneId,
    layout: { type: 'leaf', paneId: `${paneId}-leaf`, title: paneId, ratio: 1, zoomed: false },
    activePaneId: `${paneId}-leaf`,
    paneMru: [`${paneId}-leaf`],
    broadcastMode: false,
    broadcastActivity: 0,
    previewVisible: false,
    previewAddress: '',
    previewUrl: '',
    previewKind: 'web',
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
      () => new Promise<void>((resolve) => { release = resolve })
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
      () => new Promise<void>((resolve) => { releasePane = resolve })
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

afterAll(() => {
  if (originalWebSocket === undefined) delete (global as any).WebSocket
  else (global as any).WebSocket = originalWebSocket

  if (originalLocalStorage === undefined) delete (global as any).localStorage
  else (global as any).localStorage = originalLocalStorage
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
    previewVisible: false,
    previewAddress: '',
    previewUrl: '',
    previewKind: 'web',
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

describe('App.vue - onClosePane routes through confirmation gate', () => {
  beforeEach(() => {
    settings.confirm_before_close_tab = true
    settings.windowsAltAsCmd = false
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
      previewVisible: false,
      previewAddress: '',
      previewUrl: '',
      previewKind: 'web',
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
      previewVisible: false,
      previewAddress: '',
      previewUrl: '',
      previewKind: 'web',
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
      previewVisible: false,
      previewAddress: '',
      previewUrl: '',
      previewKind: 'web',
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

describe('App.vue - notification badge visibility', () => {
  it('keeps the bell visible for authoritative unread attention with empty history', async () => {
    mocks.notificationItems.value = []
    mocks.unreadAttentionCount.value = 1

    const wrapper = await mountWithTabs()

    expect(wrapper.find('button.notif-btn').exists()).toBe(true)
    expect(wrapper.find('.notif-badge').text()).toBe('1')
  })
})

describe('App.vue - notification goto flow', () => {
  it('passes the goto reason from the real NotificationPanel reveal path', async () => {
    const wrapper = await mountWithTabs()
    mocks.clearForPaneIds.mockClear()

    await wrapper.findComponent({ name: 'NotificationPanel' }).vm.$emit('goto-pane', 'pane-1')
    await Promise.resolve()
    await nextTick()

    expect(mocks.clearForPaneIds).toHaveBeenCalledWith(
      expect.arrayContaining(['tab-1', 'pane-1', 'pane-2']),
      'goto'
    )
  })
})

describe('App.vue - plugin notification bridge', () => {
  function response(status: number, body: Record<string, unknown>) {
    return { ok: status >= 200 && status < 300, status, json: async () => body }
  }

  async function flushBridge() {
    for (let i = 0; i < 6; i++) await Promise.resolve()
  }

  it('POSTs pane-less plugin notifications and waits for the raised broadcast to insert history', async () => {
    await mountWithTabs()
    mocks.authFetch.mockClear()
    mocks.pushNotification.mockClear()
    ;(window as any).__dinotty_ui_notify('hello', 'warn', 'Plugin title')
    await Promise.resolve()
    await Promise.resolve()

    expect(mocks.authFetch).toHaveBeenCalledWith('/api/notify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientId: 'client-stable',
        requestId: 'tab-nonce-1',
        source: 'plugin',
        type: 'warning',
        title: 'Plugin title',
        body: 'hello',
      }),
      signal: expect.any(AbortSignal),
    })
    expect(mocks.pushNotification).not.toHaveBeenCalled()
  })

  it('retries an accepted-but-response-lost request with the same requestId and does not insert locally', async () => {
    await mountWithTabs()
    mocks.authFetch.mockClear()
    vi.useFakeTimers()
    mocks.authFetch.mockRejectedValueOnce(new Error('network'))
    mocks.authFetch.mockResolvedValueOnce(
      response(200, { status: 'accepted', notifId: 'notif-2', eventSeq: '2' })
    )
    ;(window as any).__dinotty_ui_notify('offline', 'error')
    await flushBridge()
    await vi.advanceTimersByTimeAsync(1000)
    await flushBridge()

    expect(mocks.authFetch).toHaveBeenCalledTimes(2)
    const requestBodies = mocks.authFetch.mock.calls.map(([, init]) => JSON.parse(init!.body as string))
    expect(requestBodies[0].requestId).toBe(requestBodies[1].requestId)
    expect(requestBodies[0]).toEqual(requestBodies[1])
    expect(mocks.pushNotification).not.toHaveBeenCalled()
  })

  it('does not insert for a suppressed response', async () => {
    await mountWithTabs()
    mocks.authFetch.mockClear()
    mocks.authFetch.mockResolvedValueOnce(response(200, { status: 'suppressed', reason: 'disabled' }))

    ;(window as any).__dinotty_ui_notify('suppressed', 'info')
    await flushBridge()

    expect(mocks.authFetch).toHaveBeenCalledTimes(1)
    expect(mocks.pushNotification).not.toHaveBeenCalled()
  })

  it('retries HTTP 503 responses regardless of body shape with the same requestId', async () => {
    await mountWithTabs()
    mocks.authFetch.mockClear()
    vi.useFakeTimers()
    mocks.authFetch
      .mockResolvedValueOnce({
        ok: false,
        status: 503,
        json: async () => {
          throw new SyntaxError('truncated proxy response')
        },
      })
      .mockResolvedValueOnce(response(503, { status: 'unexpected-proxy-shape' }))
      .mockResolvedValueOnce(
        response(200, { status: 'accepted', notifId: 'notif-3', eventSeq: '3' })
      )

    ;(window as any).__dinotty_ui_notify('busy', 'info')
    await flushBridge()
    await vi.advanceTimersByTimeAsync(3000)
    await flushBridge()

    expect(mocks.authFetch).toHaveBeenCalledTimes(3)
    const requestBodies = mocks.authFetch.mock.calls.map(([, init]) => JSON.parse(init!.body as string))
    expect(new Set(requestBodies.map(({ requestId }) => requestId))).toEqual(
      new Set([requestBodies[0].requestId])
    )
    expect(requestBodies[1]).toEqual(requestBodies[0])
    expect(requestBodies[2]).toEqual(requestBodies[0])
    expect(mocks.pushNotification).not.toHaveBeenCalled()
  })

  it('gives separate jobs distinct requestIds while preserving each id across retries', async () => {
    await mountWithTabs()
    mocks.authFetch.mockClear()
    vi.useFakeTimers()
    const attemptsByRequestId = new Map<string, number>()
    mocks.authFetch.mockImplementation(async (_input, init) => {
      const request = JSON.parse(init!.body as string)
      const attempt = (attemptsByRequestId.get(request.requestId) ?? 0) + 1
      attemptsByRequestId.set(request.requestId, attempt)
      if (attempt === 1) throw new Error('network')
      return response(200, { status: 'accepted', notifId: request.requestId, eventSeq: '1' })
    })

    ;(window as any).__dinotty_ui_notify('first', 'info')
    ;(window as any).__dinotty_ui_notify('second', 'warn')
    await flushBridge()
    await vi.advanceTimersByTimeAsync(1000)
    await flushBridge()

    const requests = mocks.authFetch.mock.calls.map(([, init]) => JSON.parse(init!.body as string))
    const requestIdsByBody = new Map<string, Set<string>>()
    for (const request of requests) {
      const ids = requestIdsByBody.get(request.body) ?? new Set<string>()
      ids.add(request.requestId)
      requestIdsByBody.set(request.body, ids)
    }
    expect([...requestIdsByBody.keys()].sort()).toEqual(['first', 'second'])
    expect(requestIdsByBody.get('first')?.size).toBe(1)
    expect(requestIdsByBody.get('second')?.size).toBe(1)
    expect([...requestIdsByBody.get('first')!][0]).not.toBe(
      [...requestIdsByBody.get('second')!][0]
    )
    expect([...attemptsByRequestId.values()]).toEqual([2, 2])
  })

  it.each([400, 404, 409])(
    'treats HTTP %s as terminal without retrying or inserting locally',
    async (status) => {
      await mountWithTabs()
      mocks.authFetch.mockClear()
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
      mocks.authFetch.mockResolvedValueOnce(response(status, { status: 'terminal' }))

      ;(window as any).__dinotty_ui_notify('rejected', 'info')
      await flushBridge()

      expect(mocks.authFetch).toHaveBeenCalledTimes(1)
      expect(mocks.pushNotification).not.toHaveBeenCalled()
      expect(consoleError).toHaveBeenCalledWith(
        `[notification] plugin notify failed with HTTP ${status}`
      )
      consoleError.mockRestore()
    }
  )

  it('falls back exactly once after all four retryable attempts fail', async () => {
    await mountWithTabs()
    mocks.authFetch.mockClear()
    vi.useFakeTimers()
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    mocks.authFetch.mockRejectedValue(new Error('offline'))

    ;(window as any).__dinotty_ui_notify('offline', 'error')
    await flushBridge()
    await vi.advanceTimersByTimeAsync(7000)
    await flushBridge()

    expect(mocks.authFetch).toHaveBeenCalledTimes(4)
    expect(mocks.pushNotification).toHaveBeenCalledTimes(1)
    expect(mocks.pushNotification).toHaveBeenCalledWith({
      type: 'error',
      title: 'Plugin',
      body: 'offline',
      source: 'plugin',
    })
    consoleError.mockRestore()
  })

  it('limits a failing notification burst to three concurrent fetches', async () => {
    await mountWithTabs()
    mocks.authFetch.mockClear()
    mocks.pushNotification.mockClear()
    vi.useFakeTimers()
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    let inFlight = 0
    let maxInFlight = 0
    const attemptsByBody = new Map<string, number>()
    const requestIdsByBody = new Map<string, Set<string>>()
    const attemptsByRequestId = new Map<string, number>()
    mocks.authFetch.mockImplementation(
      (_input, init) =>
        new Promise((_, reject) => {
          const request = JSON.parse(init!.body as string)
          attemptsByBody.set(request.body, (attemptsByBody.get(request.body) ?? 0) + 1)
          const ids = requestIdsByBody.get(request.body) ?? new Set<string>()
          ids.add(request.requestId)
          requestIdsByBody.set(request.body, ids)
          attemptsByRequestId.set(
            request.requestId,
            (attemptsByRequestId.get(request.requestId) ?? 0) + 1
          )
          inFlight++
          maxInFlight = Math.max(maxInFlight, inFlight)
          setTimeout(() => {
            inFlight--
            reject(new Error('offline'))
          }, 10)
        })
    )

    for (let i = 0; i < 12; i++) {
      ;(window as any).__dinotty_ui_notify(`burst-${i}`, 'info')
    }
    await flushBridge()
    await vi.runAllTimersAsync()
    await flushBridge()

    expect(maxInFlight).toBe(3)
    expect(mocks.authFetch).toHaveBeenCalledTimes(48)
    expect([...attemptsByBody.keys()].sort()).toEqual(
      Array.from({ length: 12 }, (_, i) => `burst-${i}`).sort()
    )
    expect([...attemptsByBody.values()]).toEqual(Array(12).fill(4))
    expect([...requestIdsByBody.values()].every((ids) => ids.size === 1)).toBe(true)
    expect(attemptsByRequestId.size).toBe(12)
    expect([...attemptsByRequestId.values()]).toEqual(Array(12).fill(4))
    consoleError.mockRestore()
  })

  it('aggregates overflow warnings while evicting the oldest queued jobs', async () => {
    await mountWithTabs()
    mocks.authFetch.mockClear()
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const pending: Array<{
      body: string
      resolve: (value: ReturnType<typeof response>) => void
    }> = []
    mocks.authFetch.mockImplementation(
      (_input, init) =>
        new Promise((resolve) => {
          pending.push({ body: init!.body as string, resolve })
        })
    )

    for (let i = 0; i < 72; i++) {
      ;(window as any).__dinotty_ui_notify(`queued-${i}`, 'info')
    }
    await flushBridge()

    expect(mocks.authFetch).toHaveBeenCalledTimes(3)
    expect(consoleWarn).toHaveBeenCalledTimes(1)
    expect(consoleWarn).toHaveBeenCalledWith(
      '[notification] plugin notify bridge queue full; evicted 5 oldest pending jobs'
    )
    pending.splice(0, 3).forEach(({ resolve }) =>
      resolve(response(200, { status: 'accepted', notifId: 'notif', eventSeq: '1' }))
    )
    await flushBridge()

    const startedAfterSlotRelease = mocks.authFetch.mock.calls
      .slice(3, 6)
      .map(([, init]) => JSON.parse(init!.body as string).body)
    expect(startedAfterSlotRelease).toEqual(['queued-8', 'queued-9', 'queued-10'])
    pending.splice(0).forEach(({ resolve }) =>
      resolve(response(200, { status: 'accepted', notifId: 'notif', eventSeq: '1' }))
    )
    await flushBridge()
    consoleWarn.mockRestore()
  })

  it('aborts pending fetches on unmount without retrying, starting queued work, or falling back', async () => {
    const wrapper = await mountWithTabs()
    mocks.authFetch.mockClear()
    mocks.pushNotification.mockClear()
    const signals: AbortSignal[] = []
    let abortEvents = 0
    mocks.authFetch.mockImplementation(
      (_input, init) =>
        new Promise((_, reject) => {
          const signal = init!.signal as AbortSignal
          signals.push(signal)
          signal.addEventListener('abort', () => {
            abortEvents++
            const error = new Error('aborted')
            error.name = 'AbortError'
            reject(error)
          })
        })
    )

    for (let i = 0; i < 4; i++) {
      ;(window as any).__dinotty_ui_notify(`dispose-${i}`, 'error')
    }
    await flushBridge()
    expect(mocks.authFetch).toHaveBeenCalledTimes(3)
    expect(signals.every((signal) => !signal.aborted)).toBe(true)

    wrapper.unmount()
    mountedWrapper = undefined
    await flushBridge()

    expect(abortEvents).toBe(3)
    expect(signals.every((signal) => signal.aborted)).toBe(true)
    expect(mocks.authFetch).toHaveBeenCalledTimes(3)
    const startedBodies = mocks.authFetch.mock.calls.map(([, init]) =>
      JSON.parse(init!.body as string).body
    )
    expect(startedBodies).toEqual(['dispose-0', 'dispose-1', 'dispose-2'])
    expect(mocks.pushNotification).not.toHaveBeenCalled()
  })
})

describe('App.vue - records terminal shell type', () => {
  it('writes shell info into the matching leaf pane', async () => {
    // 步骤1：挂载包含两个本地终端 Pane 的应用。
    const wrapper = await mountWithTabs()
    const splitContainer = wrapper.findComponent(SplitContainerStub)
    const layout = splitContainer.props('layout') as {
      children: Array<{ paneId: string; shell_type?: string }>
    }

    // 步骤2：模拟 PowerShell 终端上报 shell 类型。
    await splitContainer.vm.$emit('shell-info', 'pane-1', 'powershell')
    await nextTick()

    // 步骤3：应用状态应记录该类型，供“运行代码”选择正确解释器。
    expect(layout.children[0].shell_type).toBe('powershell')
  })
})

describe('App.vue - Cmd+W routes through confirmation gate in split-pane mode', () => {
  beforeEach(() => {
    settings.confirm_before_close_tab = true
    settings.windowsAltAsCmd = false
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

describe('App.vue - notification tab indicator display filter', () => {
  it('hides and shows the rendered indicator without mutating authoritative unread state', async () => {
    mocks.authoritativeSeverity = 'warning'
    mocks.unreadByPane['pane-1'] = 'warning'
    mocks.presentationSettings.channels.tab_indicator = true
    const wrapper = await mountWithTabs()
    const tabBar = wrapper.findComponent(TabBarStub)

    expect(tabBar.attributes('data-indicators')).toContain('warning')
    expect(mocks.unreadByPane['pane-1']).toBe('warning')

    mocks.presentationSettings.channels.tab_indicator = false
    await nextTick()
    expect(tabBar.attributes('data-indicators')).toBe('{}')
    expect(mocks.unreadByPane['pane-1']).toBe('warning')

    mocks.presentationSettings.channels.tab_indicator = true
    await nextTick()
    expect(tabBar.attributes('data-indicators')).toContain('warning')
    expect(mocks.unreadByPane['pane-1']).toBe('warning')
  })
})
