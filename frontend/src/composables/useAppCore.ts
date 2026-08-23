import {
  ref,
  shallowReactive,
  shallowRef,
  computed,
  watch,
  provide,
  nextTick,
  h,
  type ComponentPublicInstance,
  type Ref,
} from 'vue'
import TabBar from '../components/terminal/TabBar.vue'
import type { TabInfo } from '../components/terminal/TabBar.vue'
import TerminalPane from '../components/terminal/TerminalPane.vue'
import type { Tab, TerminalTab, LeafPane, PaneLayout, DropPosition } from '../types/pane'
import { getAllLeaves, findLeaf, findFirstLeaf, ensureSplitRoot, paneKind } from '../types/pane'
import { createFrozenSendFn, type SendDataFn } from '../utils/frozenSend'
import { setTauriWindowTitle, updateDocumentTitle } from '../utils/windowTitle'
import { getApiBase, markCookieAuthenticated } from './apiBase'
import { isTauri, tauriInvoke } from './useTransport'
import { isTouchDevice, setKbTypingLock } from './useTerminal'
import { useI18n } from './useI18n'
import { hasOpenGuard } from '../utils/keyboardGuardMode'
import { FOCUS_ACTIVE_KEY } from './useFocusActive'
import { useSshAuth } from './useSshAuth'
import { useCursorPicker } from './useCursorPicker'
import { useOverviewCallbacks } from './useOverviewCallbacks'
import { useNotificationPresentation } from './useNotificationPresentation'
import {
  setToastInstance,
  setActiveReadContext,
  evaluateActiveRead,
  aggregateSeverity,
} from './useNotification'
import { getIsAppForeground, onAppForegroundGain } from './useAppForeground'
import { usePluginLoader, handlePluginChanged } from './usePluginLoader'
import { usePluginLauncher } from './usePluginLauncher'
import { useTabLifecycle } from './useTabLifecycle'
import { setMcSender } from './useMissionControlState'
import { useSplitPane } from './useSplitPane'
import { useSyncWebSocket, setPluginChangedHandler } from './useSyncWebSocket'
import type { SyncClientMsg } from '../types/protocol'
import { workspaceIdFromPaneId } from '../utils/pluginPaneId'
import { initMonitorHistory } from './useMonitor'
import { refreshPluginPreview } from './useTabPreview'
import { useIsMobile } from './useIsMobile'
import { useWorkspaces, DEFAULT_WORKSPACE_ID, toActiveWorkspaceId } from './useWorkspaces'
import { shellEscapePath } from '../utils/shell'
import { buildRunCodeCommand } from '../utils/runCodeCommand'
import { resolveAbbr, resolveColor } from '../utils/workspaceIcon'
import { canFixShellErrorInSettings, shellErrorMessage } from '../utils/shellError'
import {
  initHostKeyboardProviders,
  SYSTEM_KEYBOARD_ID,
  useKeyboardProviders,
} from './useKeyboardProviders'
import type { MobileInputMode } from './useSettings'
import { useSessionStore } from '../stores/sessionStore'
import { useUiStore } from '../stores/uiStore'
import { useSettingsStore } from '../stores/settingsStore'
import { useDesktopLifecycle } from './useDesktopLifecycle'
import { useNotification } from './useNotification'
import { useToast } from 'vue-toastification'
import { storeToRefs } from 'pinia'

export interface AppCoreOptions {
  session: ReturnType<typeof useSessionStore>
  ui: ReturnType<typeof useUiStore>
  settingsStore: ReturnType<typeof useSettingsStore>
  persist: () => void
  persistNow: () => void
  disposePersist: () => void
  desktopLifecycle: ReturnType<typeof useDesktopLifecycle>
  toast: ReturnType<typeof useToast>
  notif: ReturnType<typeof useNotification>
  tabBarRef: Ref<InstanceType<typeof TabBar> | null>
}

export function useAppCore(options: AppCoreOptions) {
  const {
    session,
    ui,
    settingsStore,
    persist,
    persistNow,
    disposePersist,
    desktopLifecycle,
    toast,
    notif,
    tabBarRef,
  } = options
  const { tabs, activePaneId, tabList, activeTabType, activeTab, isBroadcastActive, canBroadcast } =
    storeToRefs(session)
  const { kbVisible, settingsOpen, authenticated, authProbe, needsSetup } = storeToRefs(ui)
  const appSettings = settingsStore.settings
  const { t, locale } = useI18n()
  const presentationSettings = useNotificationPresentation().settings
  const isMobile = useIsMobile().isMobile

  // ── Keyboard host state (owned here so useAppCore's terminal-focus helpers
  // can read it; useAppKeyboard consumes these refs and owns the behavior). ──
  const kbTyping = ref(false)
  const terminalImeFocused = ref(false)
  const mobileInputGuideVisible = ref(false)
  const systemActionKeyboardOpen = ref(false)
  const kbDebugEnabled = ref(false)
  function syncKbDebugFlag() {
    kbDebugEnabled.value = /kbdebug/i.test(location.search + location.hash)
  }

  initHostKeyboardProviders()
  const { providers: keyboardProviders, resolveActive: resolveActiveKeyboardProvider } =
    useKeyboardProviders()
  const effectiveMobileInputMode = computed<MobileInputMode>(() => {
    const providerId = resolveActiveKeyboardProvider(appSettings.mobile_input_mode)
    return providerId === SYSTEM_KEYBOARD_ID ? 'system' : 'builtin'
  })
  const activeTerminalLeaf = computed(() => {
    const tab = activeTab.value
    if (!tab || tab.type !== 'terminal') return null
    const leaf = findLeaf(tab.layout, tab.activePaneId)
    return leaf && paneKind(leaf) === 'terminal' ? leaf : null
  })
  const hasActiveTerminalLeaf = computed(() => activeTerminalLeaf.value !== null)
  const activeKeyboardProvider = computed(() => {
    const providerId = resolveActiveKeyboardProvider(appSettings.mobile_input_mode)
    return keyboardProviders.value.get(providerId)
  })
  const keyboardProviderComponent = computed(() => activeKeyboardProvider.value?.component)
  const persistentSystemToolbar = computed(
    () =>
      effectiveMobileInputMode.value === 'system' &&
      isMobile.value &&
      appSettings.system_toolbar_mode === 'persistent_mobile'
  )
  const systemToolbarVisible = computed(
    () => hasActiveTerminalLeaf.value && (kbVisible.value || persistentSystemToolbar.value)
  )
  const keyboardHostRef = ref<ComponentPublicInstance | null>(null)
  const systemToolbarRef = ref<ComponentPublicInstance | null>(null)

  const termRefs = shallowReactive<Record<string, InstanceType<typeof TerminalPane>>>({})
  const filesRefs = shallowReactive<Record<string, any>>({})
  const webRefs = shallowReactive<Record<string, any>>({})

  const onSshConnectRef = shallowRef<
    (result: {
      tab_id: string
      pane_id: string
      layout: any
      connection_id?: string
      workspace_id?: string
    }) => Promise<void>
  >(async () => {
    throw new Error('onSshConnect not wired')
  })

  let sendSyncFn: (msg: SyncClientMsg) => void = () => {}

  const clearToastInstance = setToastInstance(toast)
  const clearActiveReadContext = setActiveReadContext({
    getActiveFocusedPaneId: () =>
      activeTab.value?.type === 'terminal' ? activeTab.value.activePaneId : null,
    isAppForeground: getIsAppForeground,
    getActiveTabPaneIds: () => {
      const tab = activeTab.value
      if (!tab) return []
      return tab.type === 'terminal'
        ? [tab.paneId, ...getAllLeaves(tab.layout).map((leaf) => leaf.paneId)]
        : [tab.paneId]
    },
  })
  const stopForegroundGainSubscription = onAppForegroundGain(evaluateActiveRead)
  const cursorPicker = useCursorPicker({ tabs, activePaneId, toast, t })
  const { loadedPlugins, loadAll, getPluginContext, pluginList, allCommands } = usePluginLoader()

  function showShellApiError(error: unknown, fallbackKey: string) {
    const message = shellErrorMessage(error, t, fallbackKey)
    if (!canFixShellErrorInSettings(error)) {
      toast.error(message)
      return
    }

    toast.error(
      h('div', { class: 'notif-toast-content' }, [
        h('span', { class: 'notif-toast-body' }, message),
        h(
          'button',
          {
            class: 'notif-toast-btn',
            onClick: () => {
              settingsOpen.value = true
            },
          },
          t('settings.title')
        ),
      ]),
      { timeout: 8000 }
    )
  }

  // ── Workspace filtering ──────────────────────────────────────────
  const {
    workspaces,
    activeWorkspaceId,
    activeWorkspace,
    activeWorkspacePath,
    activeWorkspaceName,
    matchWorkspace,
    activateWorkspace,
    cancelPendingWorkspaceActivation,
  } = useWorkspaces()

  function workspaceIdOfTab(tab: Tab): string | null {
    if (tab.type === 'plugin') {
      return toActiveWorkspaceId(tab.workspaceId ?? workspaceIdFromPaneId(tab.paneId))
    }
    return toActiveWorkspaceId(
      matchWorkspace(
        tab.cwd ?? '',
        tab.connectionId,
        tab.workspaceId ?? workspaceIdFromPaneId(tab.paneId)
      )?.id ?? null
    )
  }
  const activeWorkspaceAbbr = computed(() =>
    activeWorkspace.value ? resolveAbbr(activeWorkspace.value) : ''
  )
  const activeWorkspaceColor = computed(() =>
    activeWorkspace.value ? resolveColor(activeWorkspace.value) : undefined
  )

  const visibleTabList = computed(() => {
    const list = tabList.value.filter((info) => {
      const rawTab = tabs.value.find((t) => t.paneId === info.paneId)
      if (!rawTab) return false
      if (rawTab.type === 'plugin') return true
      // Terminal tab: match by connectionId (SSH) or cwd (local)
      const ws =
        rawTab.type === 'terminal'
          ? matchWorkspace(
              rawTab.cwd ?? '',
              rawTab.connectionId,
              rawTab.type === 'terminal' ? rawTab.workspaceId : undefined
            )
          : null
      if (activeWorkspaceId.value) {
        // Specific workspace: only tabs matching this workspace
        return ws?.id === activeWorkspaceId.value
      }
      // Default workspace: tabs matching the default workspace's path OR
      // tabs that don't belong to any workspace.
      return !ws || ws.id === DEFAULT_WORKSPACE_ID
    })
    // Reindex: workspace-relative 1-based indices
    return list.map((t, i) => ({ ...t, index: i + 1 }))
  })

  /** Aggregated per-tab unread notification severity (rolls up all leaves of a split tab). */
  const tabIndicators = computed(() => {
    const result: Record<string, string> = {}
    if (!presentationSettings.channels.tab_indicator) return result
    for (const tab of tabs.value) {
      const paneIds =
        tab.type === 'terminal'
          ? [tab.paneId, ...getAllLeaves(tab.layout).map((l) => l.paneId)]
          : [tab.paneId]
      const sev = aggregateSeverity(paneIds)
      if (sev) result[tab.paneId] = sev
    }
    return result
  })

  /** Enriched pane labels with workspace and tab context for notifications */
  const notificationPaneLabels = computed(() => {
    const result: Record<string, string> = {}
    for (const tab of tabs.value) {
      if (tab.type === 'terminal') {
        const ws = matchWorkspace(tab.cwd ?? '', tab.connectionId, tab.workspaceId)
        const wsPrefix = ws ? `${ws.name} › ` : ''
        const leaves = getAllLeaves(tab.layout)
        const activeLeaf = leaves.find((l) => l.paneId === tab.activePaneId)
        const tabTitle = tab.customTitle ?? activeLeaf?.title ?? ''
        for (const leaf of leaves) {
          if (leaves.length > 1 && tabTitle && tabTitle !== leaf.title) {
            result[leaf.paneId] = `${wsPrefix}${tabTitle} / ${leaf.title}`
          } else {
            result[leaf.paneId] = `${wsPrefix}${leaf.title}`
          }
        }
      } else {
        // Plugin tab
        const ws = tab.workspaceId ? workspaces.value.find((w) => w.id === tab.workspaceId) : null
        result[tab.paneId] = ws ? `${ws.name} › ${tab.title}` : tab.title
      }
    }
    return result
  })

  // ── Tab / split orchestration ────────────────────────────────────
  const {
    newTab,
    applyTemplate,
    resolveTab,
    resolveTabWorkspace,
    clearResolvedTabNotifications,
    commitLocalActivePane,
    scrollActiveTabIntoView,
    activateTab,
    revealPane,
    reorderTab,
    onRenameTab,
    requestCloseTab,
    closeTab,
    focusActive,
  } = useTabLifecycle({
    tabs,
    activePaneId,
    session,
    ui,
    appSettings,
    activeWorkspaceId,
    workspaces,
    matchWorkspace,
    activateWorkspace,
    cancelPendingWorkspaceActivation,
    workspaceIdOfTab,
    activeWorkspacePath,
    notif,
    termRefs,
    isMobile,
    tabBarRef,
    persist,
    persistNow,
    onSshConnectRef,
    sendSync: (msg) => sendSyncFn(msg),
    showCreateTerminalError: (error) => showShellApiError(error, 'terminal.createFailed'),
  })

  // Overlay host is a sibling of #app-root and cannot reach this per-instance
  // composable state directly, so focusActive is provided for it (design R4).
  provide(FOCUS_ACTIVE_KEY, focusActive)

  const {
    overviewOpen,
    openOverview,
    closeOverview,
    onOverviewActivate,
    onOverviewCloseTab,
    onCloseTabsBulk,
    onOverviewNewTab,
    onOverviewNewTabSsh,
    onOverviewRenameTab,
  } = useOverviewCallbacks({
    tabs,
    activePaneId,
    activeWorkspaceId,
    termRefs,
    session,
    activateTab,
    activateWorkspace,
    closeTab,
    requestCloseTab,
    newTab,
    persist,
    commitLocalActivePane,
    focusActive,
    sendSync: (msg) => sendSyncFn(msg),
  })
  const currentTabIndex = computed(
    () => visibleTabList.value.findIndex((t) => t.paneId === activePaneId.value) + 1
  )
  const currentTabTitle = computed(() => {
    const tab = tabs.value.find((t) => t.paneId === activePaneId.value)
    if (!tab) return ''
    if (tab.type === 'terminal')
      return tab.customTitle ?? findLeaf(tab.layout, tab.activePaneId)?.title ?? 'Terminal'
    return tab.title
  })

  function adjustActiveTerminalFontSize(delta: number) {
    if (!activePaneId.value) return
    const tab = tabs.value.find((t) => t.paneId === activePaneId.value)
    if (!tab || tab.type !== 'terminal') return
    const ref = termRefs[tab.activePaneId]
    if (!ref) return
    if (delta === 0) {
      ref.resetFontSize()
    } else {
      ref.adjustFontSize(delta)
    }
  }

  // Capture plugin preview when active tab changes to a plugin tab (handles initial load)
  // and remember the last terminal cwd so plugins can derive a default working directory
  // even when a non-terminal tab (e.g. a plugin tab) is currently active.
  const lastTerminalCwd = ref<string | null>(null)
  watch(activePaneId, (paneId) => {
    const tab = tabs.value.find((t) => t.paneId === paneId)
    if (!tab) return
    if (tab.type === 'terminal') {
      if (tab.cwd) lastTerminalCwd.value = tab.cwd
      const pluginLeaf = getAllLeaves(tab.layout).find((l) => l.kind === 'plugin')
      if (pluginLeaf) nextTick(() => refreshPluginPreview(pluginLeaf.paneId))
    } else if (tab.type === 'plugin') {
      nextTick(() => refreshPluginPreview(tab.paneId))
    }
  })

  watch(
    locale,
    (l) => {
      document.documentElement.lang = l === 'en' ? 'en' : 'zh-CN'
    },
    { immediate: true }
  )
  watch(
    () => activeWorkspaceName.value,
    (wsName) => {
      const title = updateDocumentTitle(wsName)
      if (isTauri()) {
        void setTauriWindowTitle(title, tauriInvoke, () =>
          (window as any).__TAURI__?.window?.getCurrentWindow?.()
        )
      }
    },
    { immediate: true }
  )

  const outputListeners = new Set<(paneId: string, data: string) => void>()

  const syncWs = useSyncWebSocket({
    termRefs,
    persist,
    focusActive,
    newTab: async () => {
      await newTab()
    },
  })
  sendSyncFn = syncWs.sendSync
  // Wire MC ops from overview components to the sync WS. Components call
  // `sendMcOp` (from useMissionControlState) which routes through this sender.
  setMcSender((op) => sendSyncFn({ type: 'mission_control_op', op }))
  // Late-bind the plugin_changed handler: a static import from usePluginLoader
  // inside useSyncWebSocket would create a circular module-init (plugin loader →
  // event bridge → useSyncWebSocket) that TDZ-crashes at startup. Bound here so
  // it is ready before any WS plugin_changed message can arrive.
  setPluginChangedHandler(handlePluginChanged)

  const sshAuth = useSshAuth({ syncWs })
  const { sshAuthVisible, sshAuthHost, sshAuthPrompts } = sshAuth

  // Set up SSH keyboard-interactive auth handler
  syncWs.setSshAuthPromptHandler(
    (paneId: string, prompts: Array<{ prompt: string; echo: boolean }>) => {
      // Find the host info from tabs
      const tab = tabs.value.find((t) => {
        if (t.type !== 'terminal') return false
        return t.paneId === paneId || !!findLeaf(t.layout, paneId)
      })
      let host = paneId
      if (tab && tab.type === 'terminal') {
        const leaf = findLeaf(tab.layout, paneId)
        host = leaf?.title || paneId
      }
      sshAuth.showPrompt(paneId, prompts, host)
    }
  )

  const splitPane = useSplitPane({
    tabs,
    activePaneId,
    termRefs,
    genPaneId,
    sendSync: (msg) => sendSyncFn(msg),
    sendLayoutSync: syncWs.sendLayoutSync,
    persist,
    showSplitTerminalError: (error) => showShellApiError(error, 'terminal.splitFailed'),
  })

  function registerTermRef(paneId: string, el: any) {
    if (!el) return
    if (typeof el.setOutputListener === 'function') {
      termRefs[paneId] = el
      el.setOutputListener((data: string) => {
        outputListeners.forEach((cb) => cb(paneId, data))
      })
    } else if (typeof el.openFromTerminal === 'function') {
      filesRefs[paneId] = el
    } else if (typeof el.openFromWebUrl === 'function') {
      webRefs[paneId] = el
    }
  }

  function genPaneId(): string {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0
      return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16)
    })
  }

  /** Stable key for tab v-for — uses the first leaf paneId which never changes */
  function tabKey(tab: Tab): string {
    if (tab.type !== 'terminal') return tab.paneId
    const leaf = findFirstLeaf(tab.layout)
    return leaf ? leaf.paneId : tab.paneId
  }

  function onDividerDragEnd(tab: Tab) {
    if (tab.type === 'terminal') {
      persist()
      syncWs.sendLayoutSync(tab.paneId, tab.layout, tab.activePaneId)
    }
  }

  function onDropOnTab(srcTabId: string, srcPaneId: string, dstTabId: string, pos: DropPosition) {
    // Find the active pane in dst tab as the drop target
    const dstTab = tabs.value.find((t) => t.paneId === dstTabId)
    if (!dstTab || dstTab.type !== 'terminal') return
    const direction = pos === 'left' || pos === 'right' ? 'left' : ('right' as const)
    void splitPane.movePaneToTab(srcTabId, srcPaneId, dstTabId, dstTab.activePaneId, direction)
  }

  function onDropExtract(srcTabId: string, srcPaneId: string, _targetIndex: number) {
    void splitPane.promotePaneToTab(srcTabId, srcPaneId)
  }

  function onMergeTabIntoPane(
    srcTabId: string,
    targetPaneId: string,
    direction: 'left' | 'right' | 'top' | 'bottom'
  ) {
    // Mode A: merge whole source tab as subtree into a pane of another tab.
    const dstTab = tabs.value.find(
      (t) => t.type === 'terminal' && !!findLeaf(t.layout, targetPaneId)
    ) as TerminalTab | undefined
    if (!dstTab) return
    if (dstTab.paneId === srcTabId) return // self-loop guard
    void splitPane.moveTabToPane(srcTabId, dstTab.paneId, targetPaneId, direction)
  }

  function onPaneDragHoverSwitch(e: Event) {
    const detail = (e as CustomEvent).detail as { tabId: string } | undefined
    if (!detail?.tabId) return
    // Switch active tab to allow dropping into its panes
    const tab = tabs.value.find((t) => t.paneId === detail.tabId)
    if (!tab) return
    activePaneId.value = tab.paneId
  }

  // Wire up toast notification direct-jump handler
  notif.setGoToPaneHandler((paneId: string) => revealPane(paneId))

  function onTitleChange(paneId: string, title: string) {
    // Find terminal tab containing this leaf pane
    const tab = tabs.value.find((t) => {
      if (t.type !== 'terminal') return false
      return !!findLeaf(t.layout, paneId)
    }) as TerminalTab | undefined
    if (tab) {
      const leaf = findLeaf(tab.layout, paneId)
      if (leaf) {
        leaf.title = title || 'Terminal'
        persist()
      }
    }
  }

  function onShellInfo(paneId: string, shellType: string) {
    // 步骤1：找到终端 Pane 所属的标签页和叶子节点。
    let matchingLeaf: LeafPane | null = null
    for (let tabIndex = 0; tabIndex < tabs.value.length; tabIndex += 1) {
      const candidateTab = tabs.value[tabIndex]
      if (candidateTab.type !== 'terminal') continue
      matchingLeaf = findLeaf(candidateTab.layout, paneId)
      if (matchingLeaf) break
    }
    if (!matchingLeaf || matchingLeaf.shell_type === shellType) return

    // 步骤2：保存后端识别出的 shell，供运行代码等功能生成正确命令。
    matchingLeaf.shell_type = shellType
    persist()
  }

  function onPreviewLink(leafPaneId: string, url: string) {
    const tab = tabs.value.find((t) => {
      if (t.type !== 'terminal') return false
      return !!findLeaf(t.layout, leafPaneId)
    }) as TerminalTab | undefined
    if (!tab) return

    const existing = getAllLeaves(tab.layout).find((l) => paneKind(l) === 'web')
    if (existing) {
      splitPane.focusPane(existing.paneId)
      nextTick(() => webRefs[existing.paneId]?.openFromWebUrl(url))
      return
    }
    void splitPane.insertNonTerminalPane('web', { url })
  }

  function reloadApp() {
    window.location.reload()
  }

  function openOrFocusPreview(kind: 'files' | 'web') {
    const tabId = activePaneId.value
    if (!tabId) return
    const tab = tabs.value.find((t) => t.paneId === tabId)
    if (!tab || tab.type !== 'terminal') return

    const leaves = getAllLeaves(tab.layout)
    const existing = leaves.find((l) => paneKind(l) === kind)
    if (existing) {
      splitPane.focusPane(existing.paneId)
      return
    }
    const payload: { path?: string; url?: string } = kind === 'files' ? { path: tab.cwd || '' } : {}
    void splitPane.insertNonTerminalPane(kind, payload)
  }

  function onFileClick(path: string) {
    const tabId = activePaneId.value
    if (!tabId) return
    const tab = tabs.value.find((t) => t.paneId === tabId)
    if (!tab || tab.type !== 'terminal') return

    const existing = getAllLeaves(tab.layout).find((l) => paneKind(l) === 'files')
    if (existing) {
      splitPane.focusPane(existing.paneId)
      nextTick(() => filesRefs[existing.paneId]?.openFromTerminal(path))
      return
    }
    void splitPane.insertNonTerminalPane('files', { path })
  }

  function getSendFn(): SendDataFn | null {
    if (!activePaneId.value) return null
    const tab = tabs.value.find((t) => t.paneId === activePaneId.value)
    if (!tab || tab.type !== 'terminal') return null
    const activeLeaf = findLeaf(tab.layout, tab.activePaneId)
    if (!activeLeaf || paneKind(activeLeaf) !== 'terminal') return null
    const paneId = activeLeaf.paneId
    if (!termRefs[paneId]) return null
    const broadcastMode = tab.broadcastMode
    const frozenLeaves = broadcastMode
      ? getAllLeaves(tab.layout).filter((leaf) => paneKind(leaf) === 'terminal')
      : []
    const recipientIds = [
      paneId,
      ...frozenLeaves.filter((leaf) => leaf.paneId !== paneId).map((leaf) => leaf.paneId),
    ]
    return createFrozenSendFn(
      recipientIds.map((recipientId) =>
        recipientId === paneId
          ? (data: string) => termRefs[recipientId]?.sendData(data)
          : (data: string) => termRefs[recipientId]?.sendData(data, true)
      ),
      broadcastMode && recipientIds.length > 1 ? () => tab.broadcastActivity++ : undefined
    )
  }

  function getActiveTerminalRef() {
    const paneId = activeTerminalLeaf.value?.paneId
    return paneId ? (termRefs[paneId] ?? null) : null
  }

  function canRestoreSystemInputFocus() {
    return !(
      isTouchDevice() &&
      effectiveMobileInputMode.value === 'system' &&
      hasOpenGuard(appSettings.keyboard_guard_mode) &&
      !terminalImeFocused.value
    )
  }

  function focusSystemInput(authorizeOpen = false) {
    if (
      effectiveMobileInputMode.value !== 'system' ||
      systemActionKeyboardOpen.value ||
      !hasActiveTerminalLeaf.value ||
      (!authorizeOpen && !canRestoreSystemInputFocus())
    )
      return
    terminalImeFocused.value = true
    setKbTypingLock(false)
    getActiveTerminalRef()?.focus()
  }

  function pasteActiveTerminal(text: string) {
    if (!text) return
    getActiveTerminalRef()?.pasteFromClipboard(
      text,
      false,
      !systemActionKeyboardOpen.value && canRestoreSystemInputFocus()
    )
  }

  async function onLoginSuccess() {
    markCookieAuthenticated()
    ui.setAuthenticated(true)
    await getApiBase()
    await settingsStore.load()
    void loadAll()
    void syncWs.connectSyncWS()
    initMonitorHistory()
  }

  function onTerminalInsertPath(e: Event) {
    const path = (e as CustomEvent<{ path: string }>).detail?.path
    if (!path) return
    const send = getSendFn()
    if (send) send(shellEscapePath(path) + ' ')
  }

  function onTerminalInsertText(e: Event) {
    const text = (e as CustomEvent<{ text: string }>).detail?.text
    if (!text) return
    const send = getSendFn()
    if (send) send(text)
  }

  function onTerminalRunCode(e: Event) {
    // 步骤1：读取文件路径和当前活动终端。
    const path = (e as CustomEvent<{ path: string }>).detail?.path
    if (!path || !activePaneId.value) return

    let activeTerminalTab: TerminalTab | null = null
    for (let tabIndex = 0; tabIndex < tabs.value.length; tabIndex += 1) {
      const candidateTab = tabs.value[tabIndex]
      if (candidateTab.paneId === activePaneId.value && candidateTab.type === 'terminal') {
        activeTerminalTab = candidateTab
        break
      }
    }
    if (!activeTerminalTab) return

    const activeLeaf = findLeaf(activeTerminalTab.layout, activeTerminalTab.activePaneId)
    const send = getSendFn()
    if (!activeLeaf || !send) return

    if (activeLeaf.shell_type === 'wsl') {
      toast.warning(t('terminal.wslRunCodeUnsupported'))
      return
    }

    // 步骤2：按活动 shell 生成命令，并发送回车立即执行。
    const command = buildRunCodeCommand(path, activeLeaf.shell_type ?? '')
    if (command) send(`${command}\r`)
  }

  function onOpenSettingsRequest() {
    settingsOpen.value = true
  }

  function onTokenChanged() {
    syncWs.closeWs()
    syncWs.connectSyncWS()
  }

  // ── Plugin launcher (openPlugin is needed by palette/actions) ─────
  const { openPlugin } = usePluginLauncher({
    tabs,
    activeWorkspaceId,
    loadedPlugins,
    syncWs,
    ensureSplitRoot,
    activateTab,
    commitLocalActivePane,
    persist,
    focusActive,
  })

  // ─── Save as Template dialog ───────────────────────────────────────
  const saveTemplateVisible = ref(false)
  const saveTemplateSourceTabId = ref('')
  const saveTemplateSourceLayout = computed<PaneLayout | null>(() => {
    const tab = tabs.value.find((t) => t.paneId === saveTemplateSourceTabId.value)
    if (!tab || tab.type !== 'terminal') return null
    return tab.layout
  })

  function openSaveTemplateDialog(tabId: string) {
    const tab = tabs.value.find((t) => t.paneId === tabId)
    if (!tab || tab.type !== 'terminal') return
    saveTemplateSourceTabId.value = tabId
    saveTemplateVisible.value = true
  }

  function onTemplateSaved(_templateId: string) {
    toast?.success(t('template.savedToast'))
  }

  // ─── Apply Template dialog ───────────────────────────────────────────
  const templatePickerVisible = ref(false)

  async function onTemplateApplied(
    templateId: string,
    scope: 'workspace' | 'global',
    workspaceId?: string
  ) {
    try {
      const result = await applyTemplate(templateId, workspaceId)
      if (!result) return
      if (result.warnings.length > 0) {
        toast?.warning(
          t('template.applyWarningsToast').replace('{n}', String(result.warnings.length))
        )
      } else {
        toast?.success(t('template.applyToast'))
      }
    } catch (e: unknown) {
      showShellApiError(e, 'template.applyFailed')
    }
    void scope
  }

  async function onClosePane(tabId: string, paneId: string) {
    const tab = tabs.value.find((t) => t.paneId === tabId)
    if (!tab) return

    if (tab.type !== 'terminal') {
      const closed = await splitPane.closePane(paneId)
      if (!closed) await closeTab(tabId)
      return
    }

    if (appSettings.confirm_before_close_tab === false) {
      const closed = await splitPane.closePane(paneId)
      if (!closed) await closeTab(tabId)
      return
    }

    ui.requestClosePane(tabId, paneId)
  }

  async function onConfirmClose(tabId: string, paneId: string | null) {
    if (paneId) {
      const closed = await splitPane.closePane(paneId)
      if (!closed && tabId) {
        await closeTab(tabId)
      }
    } else if (tabId) {
      await closeTab(tabId)
    }
    ui.cancelClose()
  }

  // The plugin-facing active pane: the focused leaf inside the active terminal
  // tab, or the top-level active pane id when that tab is not a terminal.
  const pluginActivePaneId = computed(() => {
    const tab = tabs.value.find((t) => t.paneId === activePaneId.value)
    return tab?.type === 'terminal' ? tab.activePaneId : activePaneId.value
  })
  const pluginActivePaneListeners = new Set<(paneId: string | null) => void>()
  watch(pluginActivePaneId, (paneId) => {
    for (const listener of pluginActivePaneListeners) listener(paneId)
  })

  return {
    // stores / shared refs
    tabs,
    activePaneId,
    tabList,
    activeTabType,
    activeTab,
    isBroadcastActive,
    canBroadcast,
    kbVisible,
    settingsOpen,
    authenticated,
    authProbe,
    needsSetup,
    appSettings,
    t,
    locale,
    // keyboard host state
    kbTyping,
    terminalImeFocused,
    mobileInputGuideVisible,
    systemActionKeyboardOpen,
    kbDebugEnabled,
    syncKbDebugFlag,
    keyboardHostRef,
    systemToolbarRef,
    keyboardProviders,
    resolveActiveKeyboardProvider,
    effectiveMobileInputMode,
    activeTerminalLeaf,
    hasActiveTerminalLeaf,
    activeKeyboardProvider,
    keyboardProviderComponent,
    persistentSystemToolbar,
    systemToolbarVisible,
    // terminal / plugin refs
    termRefs,
    filesRefs,
    webRefs,
    outputListeners,
    onSshConnectRef,
    pluginActivePaneId,
    pluginActivePaneListeners,
    lastTerminalCwd,
    // workspaces
    workspaces,
    activeWorkspaceId,
    activeWorkspace,
    activeWorkspacePath,
    activeWorkspaceName,
    matchWorkspace,
    activateWorkspace,
    cancelPendingWorkspaceActivation,
    workspaceIdOfTab,
    activeWorkspaceAbbr,
    activeWorkspaceColor,
    // tab metadata
    visibleTabList,
    tabIndicators,
    notificationPaneLabels,
    currentTabIndex,
    currentTabTitle,
    adjustActiveTerminalFontSize,
    // lifecycle
    newTab,
    applyTemplate,
    resolveTab,
    resolveTabWorkspace,
    clearResolvedTabNotifications,
    commitLocalActivePane,
    scrollActiveTabIntoView,
    activateTab,
    revealPane,
    reorderTab,
    onRenameTab,
    requestCloseTab,
    closeTab,
    focusActive,
    // overview
    overviewOpen,
    openOverview,
    closeOverview,
    onOverviewActivate,
    onOverviewCloseTab,
    onCloseTabsBulk,
    onOverviewNewTab,
    onOverviewNewTabSsh,
    onOverviewRenameTab,
    // split
    splitPane,
    syncWs,
    sshAuth,
    sshAuthVisible,
    sshAuthHost,
    sshAuthPrompts,
    // send / focus helpers
    getSendFn,
    getActiveTerminalRef,
    canRestoreSystemInputFocus,
    focusSystemInput,
    pasteActiveTerminal,
    // handlers
    onTitleChange,
    onShellInfo,
    onPreviewLink,
    reloadApp,
    openOrFocusPreview,
    onFileClick,
    onTerminalInsertPath,
    onTerminalInsertText,
    onTerminalRunCode,
    onOpenSettingsRequest,
    onTokenChanged,
    onLoginSuccess,
    onClosePane,
    onConfirmClose,
    registerTermRef,
    genPaneId,
    tabKey,
    onDividerDragEnd,
    onDropOnTab,
    onDropExtract,
    onMergeTabIntoPane,
    onPaneDragHoverSwitch,
    showShellApiError,
    // plugin
    loadedPlugins,
    loadAll,
    getPluginContext,
    pluginList,
    allCommands,
    openPlugin,
    isMobile,
    // cursor picker
    cursorPickerVisible: cursorPicker.cursorPickerVisible,
    cursorPickerItems: cursorPicker.cursorPickerItems,
    triggerAddCursors: cursorPicker.triggerAddCursors,
    onCursorPickerConfirm: cursorPicker.onCursorPickerConfirm,
    // template dialogs
    saveTemplateVisible,
    saveTemplateSourceTabId,
    saveTemplateSourceLayout,
    openSaveTemplateDialog,
    onTemplateSaved,
    templatePickerVisible,
    onTemplateApplied,
    // cleanup
    clearToastInstance,
    clearActiveReadContext,
    stopForegroundGainSubscription,
    disposePersist,
  }
}
