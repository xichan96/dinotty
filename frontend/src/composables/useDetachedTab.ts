import { computed, nextTick, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import type { DropPosition, TerminalTab } from '../types/pane'
import { ensureSplitRoot, findFirstLeaf, findLeaf, getAllLeaves } from '../types/pane'
import { initializePaneMru } from '../types/paneMru'
import type TerminalPane from '../components/terminal/TerminalPane.vue'
import { apiListTabs, type ListTabsResult } from './useTabApi'
import { useSyncWebSocket } from './useSyncWebSocket'
import { useSshAuth } from './useSshAuth'
import { useSplitPane } from './useSplitPane'
import { useSessionStore } from '../stores/sessionStore'
import { setActivePaneId } from './useTerminal'
import { isTauri, tauriInvoke } from './useTransport'
import { setTauriWindowTitle } from '../utils/windowTitle'
import { openUrlInSystemBrowser } from '../utils/openExternalUrl'
import { useI18n } from './useI18n'

type LoadResult = 'ok' | 'not-found'

/** Minimal toast surface, injected so the composable stays mountable in tests. */
export interface DetachedToast {
  info(message: string): void
  error(message: string): void
}

export interface DetachedTabOptions {
  toast?: DetachedToast
}

/**
 * Single-tab state and actions for a detached terminal window.
 *
 * The window is a second view of one tab: it reads the tab over REST once,
 * mirrors server changes through the sync WebSocket in `detached` mode, and
 * never touches the main window's `dinotty_tabs` persistence or global active
 * pane. Layout mutations (split/close/focus/resize) go through the same
 * `useSplitPane` logic as the main window but sync only — `persist` is a no-op.
 *
 * Broadcast mode is not part of the sync protocol today, so a window opened
 * while the main window has broadcast enabled starts with it off. The title
 * indicator reflects this window's own state, mirroring the same
 * `broadcastMode && leaves > 1` rule as `sessionStore.isBroadcastActive`.
 */
export function useDetachedTab(tabId: string, opts: DetachedTabOptions = {}) {
  const { toast } = opts
  const session = useSessionStore()
  const { tabs, activePaneId } = storeToRefs(session)
  const { t } = useI18n()

  const termRefs: Record<string, InstanceType<typeof TerminalPane>> = {}

  const tab = computed<TerminalTab | null>(() => {
    const found = tabs.value.find((candidate) => candidate.paneId === tabId)
    return found && found.type === 'terminal' ? found : null
  })

  /** Tab title follows the active leaf, like the main window's tab bar. */
  const tabTitle = computed(() => {
    const current = tab.value
    if (!current) return ''
    return (
      current.customTitle || findLeaf(current.layout, current.activePaneId)?.title || 'Terminal'
    )
  })

  const broadcastActive = computed(() => {
    const current = tab.value
    return !!current && current.broadcastMode && getAllLeaves(current.layout).length > 1
  })

  const allowClose = computed(() => {
    const current = tab.value
    return !!current && getAllLeaves(current.layout).length > 1
  })

  async function closeWindow(): Promise<void> {
    // The command is the only reliable cross-platform way to close a Tauri
    // window. In a plain browser (dev/test) it is unavailable — fall back.
    try {
      await tauriInvoke('close_tab_window', { tabId })
    } catch {
      try {
        window.close()
      } catch {
        // Nothing else to do; the tab is already gone.
      }
    }
  }

  function focusActive(): void {
    const paneId = tab.value?.activePaneId
    if (!paneId) return
    void nextTick(() => termRefs[paneId]?.focus())
  }

  const syncWs = useSyncWebSocket({
    termRefs,
    // The detached window must never write the main window's tab snapshot.
    persist: () => {},
    focusActive,
    // A detached window never creates tabs; new splits happen inside its tab.
    newTab: async () => {},
    detached: {
      tabId,
      onTabClosed: () => closeWindow(),
    },
  })

  const sshAuth = useSshAuth({ syncWs })
  syncWs.setSshAuthPromptHandler((paneId, prompts) => {
    const current = tab.value
    const leaf = current ? findLeaf(current.layout, paneId) : null
    sshAuth.showPrompt(paneId, prompts, leaf?.title || paneId)
  })

  const splitPane = useSplitPane({
    tabs,
    activePaneId,
    termRefs,
    genPaneId,
    sendSync: (msg) => syncWs.sendSync(msg),
    // A detached window may focus/resize/split, but it must never move the
    // server-global active pane that the main window follows.
    sendLayoutSync: (tabPaneId, layout, activePaneId) =>
      syncWs.sendLayoutSync(tabPaneId, layout, activePaneId, { activate: false }),
    persist: () => {},
    showSplitTerminalError: (error) => console.error('[detached] split failed:', error),
  })

  function genPaneId(): string {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0
      return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16)
    })
  }

  function buildTab(info: ListTabsResult['tabs'][number]): TerminalTab {
    const layout = ensureSplitRoot(
      info.layout ?? {
        type: 'leaf',
        paneId: info.pane_id,
        title: 'Terminal',
        ratio: 1,
        zoomed: false,
      }
    )
    const leaves = getAllLeaves(layout)
    const preferredPaneId =
      info.active_pane_id && findLeaf(layout, info.active_pane_id)
        ? info.active_pane_id
        : findFirstLeaf(layout).paneId
    return {
      type: 'terminal',
      paneId: info.tab_id,
      layout,
      activePaneId: preferredPaneId,
      paneMru: initializePaneMru(
        leaves.map((leaf) => leaf.paneId),
        preferredPaneId
      ),
      broadcastMode: false,
      broadcastActivity: 0,
      cwd: info.cwd,
      connectionId: info.connection_id,
      workspaceId: info.workspace_id ?? undefined,
    }
  }

  /**
   * Load this window's tab over REST and start syncing.
   *
   * Runs after authentication is ready. A missing tab is a terminal state for
   * the window (`detached.tabNotFound`); network errors are thrown so the shell
   * can distinguish them from a genuinely missing tab.
   */
  async function load(): Promise<LoadResult> {
    const data = await apiListTabs()
    const info = data.tabs.find((candidate) => candidate.tab_id === tabId)
    if (!info) return 'not-found'

    const created = buildTab(info)
    session.setTabs([created])
    session.activePaneId = tabId
    // Input gate: only the tab's focused pane may emit keystrokes.
    setActivePaneId(created.activePaneId)

    void syncWs.connectSyncWS()
    return 'ok'
  }

  // Keep the input gate on whatever pane the layout says is focused. This
  // covers local focus changes (useSplitPane updates `activePaneId`) and
  // `layout_updated` from another client.
  watch(
    () => tab.value?.activePaneId,
    (paneId) => {
      const current = tab.value
      if (paneId && current && findLeaf(current.layout, paneId)) {
        setActivePaneId(paneId)
      }
    }
  )

  // Titlebar + native window title follow the tab title, never the raw id.
  // `immediate` still runs before load; the empty title guard keeps the
  // bootstrap document title until the tab is known.
  watch(
    [tabTitle, broadcastActive],
    ([name, broadcast]) => {
      if (!name) return
      const label = broadcast ? `${name} · ${t('split.broadcastActive')}` : name
      document.title = label
      if (isTauri()) {
        void setTauriWindowTitle(label, tauriInvoke, () =>
          (window as any).__TAURI__?.window?.getCurrentWindow?.()
        )
      }
    },
    { immediate: true }
  )

  function registerTermRef(paneId: string, el: unknown): void {
    if (!el) return
    if (typeof (el as any).setOutputListener === 'function') {
      termRefs[paneId] = el as InstanceType<typeof TerminalPane>
    }
  }

  function onTitleChange(paneId: string, title: string): void {
    const leaf = tab.value ? findLeaf(tab.value.layout, paneId) : null
    if (leaf) leaf.title = title || 'Terminal'
  }

  function onShellInfo(paneId: string, shellType: string): void {
    const leaf = tab.value ? findLeaf(tab.value.layout, paneId) : null
    if (leaf) leaf.shell_type = shellType
  }

  function onFocus(paneId: string): void {
    splitPane.focusPane(paneId)
  }

  function onClosePane(paneId: string): void {
    const current = tab.value
    if (!current) return
    // Closing the last pane means closing the tab; the pane header only offers
    // close while a split exists, so this is a defensive no-op.
    if (getAllLeaves(current.layout).length <= 1) return
    void splitPane.closePane(paneId)
  }

  function onDividerDragEnd(): void {
    const current = tab.value
    if (!current) return
    // Resize is global layout state; unlike the main window there is nothing to
    // persist locally.
    syncWs.sendLayoutSync(current.paneId, current.layout, current.activePaneId, {
      activate: false,
    })
  }

  function onReorder(sourcePaneId: string, targetPaneId: string, position: DropPosition): void {
    splitPane.reorderPane(sourcePaneId, targetPaneId, position)
  }

  /**
   * Terminal links in a detached window (v1).
   *
   * External HTTP(S) links open through the shell plugin, exactly like the
   * main window's "open in browser" action. File links and in-app web previews
   * need the main window's files/web pane stack, which the detached entry does
   * not load — surface a toast instead of silently dropping the click.
   */
  function onPreviewLink(_paneId: string, url: string): void {
    let parsed: URL | null = null
    try {
      parsed = new URL(url)
    } catch {
      // Not an absolute URL; fall through to the unsupported-link toast.
    }
    if (!parsed || (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')) {
      toast?.info(t('detached.previewPlaceholder'))
      return
    }
    void openUrlInSystemBrowser(url).then((opened) => {
      if (!opened) toast?.error(t('detached.previewPlaceholder'))
    })
  }

  function onFileClick(path: string, line?: number, column?: number): void {
    // Documented v1 gap: opening the files preview is a main-window feature.
    console.info('[detached] file link ignored (unsupported in detached window):', {
      path,
      line,
      column,
    })
    toast?.info(t('detached.fileLinkUnavailable'))
  }

  function onLinkActivate(): void {
    // Emitted for the mobile IME link-replay guard in the main window. The
    // detached window is desktop-only, so there is nothing to suppress.
  }

  return {
    tab,
    tabTitle,
    broadcastActive,
    allowClose,
    termRefs,
    load,
    focusActive,
    registerTermRef,
    onTitleChange,
    onShellInfo,
    onFocus,
    onClosePane,
    onDividerDragEnd,
    onReorder,
    onFileClick,
    onPreviewLink,
    onLinkActivate,
    onInput: splitPane.onTerminalInput,
    onSplitHorizontal: () => void splitPane.splitPane('horizontal'),
    onSplitVertical: () => void splitPane.splitPane('vertical'),
    onNewLocalTerminal: () => void splitPane.splitPane('horizontal', true),
    onToggleBroadcast: () => splitPane.toggleBroadcast(),
    sshAuthVisible: sshAuth.sshAuthVisible,
    sshAuthHost: sshAuth.sshAuthHost,
    sshAuthPrompts: sshAuth.sshAuthPrompts,
    onSshAuthSubmit: (responses: string[]) => sshAuth.submit(responses),
    onSshAuthCancel: () => sshAuth.cancel(),
  }
}
