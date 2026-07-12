<template>
  <SetupPage v-if="!authenticated && needsSetup" @success="onLoginSuccess" />
  <LoginPage v-else-if="!authenticated && authProbe === 'done'" @success="onLoginSuccess" />
  <div v-else-if="!authenticated" class="auth-probe-screen">
    <RefreshCw :size="20" class="auth-probe-spinner" />
  </div>
  <div v-else id="app-root">
    <TabBar
      :tabs="visibleTabList"
      :active-pane-id="activePaneId"
      :indicators="notif.unreadByPane"
      :plugins="pluginList"
      :can-broadcast="canBroadcast"
      :broadcast-active="isBroadcastActive"
      :is-mobile="isMobile"
      :current-tab-title="currentTabTitle"
      :current-tab-index="currentTabIndex"
      @activate="activateTab"
      @close="requestCloseTab"
      @action="onNewMenuAction"
      @reorder="reorderTab"
      @open-plugin="openPlugin"
      @rename="onRenameTab"
      @open-overview="openOverview"
    >
      <template #left>
        <button
          v-if="isBroadcastActive"
          type="button"
          class="tab-bar-icon-btn broadcast-btn"
          :title="t('split.toggleBroadcast')"
          @click="splitPane.toggleBroadcast()"
          @touchend.prevent="splitPane.toggleBroadcast()"
        >
          <Radar :size="16" />
        </button>
      </template>
      <template #right>
        <button
          v-if="activeTabType === 'terminal'"
          type="button"
          class="tab-bar-icon-btn"
          :title="t('app.preview')"
          @click="openPreview"
          @touchend.prevent="openPreview"
        >
          <Monitor :size="16" />
        </button>
        <button
          type="button"
          class="tab-bar-icon-btn"
          :title="t('app.reload')"
          @click="reloadApp"
          @touchend.prevent="reloadApp"
        >
          <RefreshCw :size="16" />
        </button>
        <button
          type="button"
          class="tab-bar-icon-btn"
          :title="t('app.settings')"
          @click="settingsOpen = true"
          @touchend.prevent="settingsOpen = true"
        >
          <Settings :size="16" />
        </button>
        <button
          v-if="notif.notifications.value.length > 0"
          type="button"
          class="tab-bar-icon-btn notif-btn"
          :title="t('notification.title')"
          @click="notif.togglePanel()"
          @touchend.prevent="notif.togglePanel()"
        >
          <Bell :size="16" />
          <span v-if="notif.unreadCount.value > 0" class="notif-badge">{{
            notif.unreadCount.value > 9 ? '9+' : notif.unreadCount.value
          }}</span>
        </button>
      </template>
    </TabBar>

    <div id="tab-content" @touchend="onTerminalTouch">
      <div
        v-for="tab in tabs"
        :key="tabKey(tab)"
        class="tab-page"
        :class="{
          active: tab.paneId === activePaneId,
          'has-preview': tab.type === 'terminal' && tab.previewVisible,
          ['pos-' + resolvedPosition]: tab.type === 'terminal' && tab.previewVisible,
        }"
      >
        <template v-if="tab.type === 'terminal'">
          <SplitContainer
            :layout="tab.layout"
            :active-pane-id="tab.activePaneId"
            :broadcast-mode="tab.broadcastMode"
            :broadcast-activity="tab.broadcastActivity"
            :allow-close="getAllLeaves(tab.layout).length > 1"
            @register="registerTermRef"
            @title-change="onTitleChange"
            @focus="(id: string) => splitPane.focusPane(id)"
            @close="(id: string) => onClosePane(tab.paneId, id)"
            @input="(id: string, data: string) => splitPane.onTerminalInput(id, data)"
            @file-click="onFileClick"
            @preview-link="onPreviewLink"
            @link-activate="onLinkActivate"
            @split-horizontal="splitPane.splitPane('horizontal')"
            @split-vertical="splitPane.splitPane('vertical')"
            @toggle-broadcast="splitPane.toggleBroadcast()"
            @new-local-terminal="splitPane.splitPane('horizontal', true, activeWorkspacePath ?? undefined)"
            @reorder="
              (src: string, tgt: string, pos: DropPosition) =>
                splitPane.reorderPane(src, tgt, pos)
            "
            @divider-drag-end="onDividerDragEnd(tab)"
            @reconnect="onSshReconnect"
          />
          <PreviewPanel
            v-if="tab.paneId === activePaneId"
            :ref="setPreviewPanelRef"
            :visible="tab.previewVisible"
            :pane-id="tab.activePaneId"
            :address="tab.previewAddress"
            :kind="tab.previewKind"
            :web-url="tab.previewUrl"
            :panel-position="resolvedPosition"
            :remote="isRemote"
            @close="closePreview(tab.paneId)"
            @update:address="
              (v: string) => {
                tab.previewAddress = v
                persist()
              }
            "
            @update:kind="
              (v: 'web' | 'files') => {
                tab.previewKind = v
                persist()
              }
            "
            @update:web-url="
              (v: string) => {
                tab.previewUrl = v
                persist()
              }
            "
          />
        </template>
        <PluginView
          v-else-if="tab.type === 'plugin'"
          :data-plugin-pane-id="tab.paneId"
          :plugin="loadedPlugins.get(tab.pluginId)!"
          :api="getPluginContext(tab.pluginId)"
        />
      </div>
    </div>

    <NotificationPanel :pane-labels="notificationPaneLabels" @goto-pane="activateTab" />

    <StatusBar />

    <CommandPalette ref="paletteRef" :commands="paletteCommands" />

    <SettingsPanel :open="settingsOpen" @close="settingsOpen = false" @token-changed="onTokenChanged" />

    <ConfirmCloseDialog @confirm="onConfirmClose" />

    <ConfirmModal
      :visible="confirmState.visible"
      :title="confirmState.title"
      :message="confirmState.message"
      :confirm-text="confirmState.confirmText"
      :cancel-text="confirmState.cancelText"
      @confirm="confirmResolve"
      @cancel="confirmCancel"
    />

    <ConfirmModal
      :visible="windowCloseConfirmVisible"
      :title="t('confirm.closeWindowTitle')"
      :message="t('confirm.closeWindowMessage')"
      :confirm-text="t('confirm.closeWindowConfirm')"
      :cancel-text="t('confirm.closeWindowCancel')"
      @confirm="onWindowCloseConfirm"
      @cancel="onWindowCloseCancel"
    />

    <CommandBookmarks ref="bookmarksRef" :get-send-fn="getSendFn" :create-tab="newTab" />

    <ServerList ref="serverListRef" @connect="onServerConnect" />

    <SshHostsPanel ref="sshPanelRef" @connect="onSshConnect" />

    <SshAuthPromptDialog
      v-if="sshAuthVisible"
      :host="sshAuthHost"
      :prompts="sshAuthPrompts"
      @submit="onSshAuthSubmit"
      @cancel="onSshAuthCancel"
    />

    <MobileKeyboard
      :visible="kbVisible"
      :pane-id="activePaneId ?? ''"
      :get-send-fn="getSendFn"
      @update:visible="(v: boolean) => (kbVisible = v)"
      @bookmarks="bookmarksRef?.open()"
    />

    <KbToggleButton
      v-show="appSettings.show_virtual_keyboard && !kbVisible"
      :visible="kbVisible"
      @toggle="kbVisible = !kbVisible"
    />

    <WorkspaceOverview
      :visible="overviewOpen"
      :active-pane-id="activePaneId"
      :term-refs="termRefs"
      @close="overviewOpen = false"
      @activate="onOverviewActivate"
      @close-tab="onOverviewCloseTab"
      @new-tab="onOverviewNewTab"
      @new-tab-ssh="onOverviewNewTabSsh"
      @rename-tab="onOverviewRenameTab"
    />
  </div>
</template>

<script setup lang="ts">
import {
  ref,
  reactive,
  shallowReactive,
  computed,
  watch,
  onMounted,
  onBeforeUnmount,
  nextTick,
} from 'vue'
import TabBar from './components/terminal/TabBar.vue'
import type { TabInfo } from './components/terminal/TabBar.vue'
import TerminalPane from './components/terminal/TerminalPane.vue'
import SplitContainer from './components/split/SplitContainer.vue'
import CommandPalette from './components/command/CommandPalette.vue'
import type { Command } from './components/command/CommandPalette.vue'
import MobileKeyboard from './components/keyboard/MobileKeyboard.vue'
import KbToggleButton from './components/keyboard/KbToggleButton.vue'
import SettingsPanel from './components/SettingsPanel.vue'
import ConfirmCloseDialog from './components/ui/ConfirmCloseDialog.vue'
import ConfirmModal from './components/ui/ConfirmModal.vue'
import { confirmState, uiConfirm, confirmResolve, confirmCancel } from './composables/useConfirm'
import PreviewPanel from './components/preview/PreviewPanel.vue'
import CommandBookmarks from './components/command/CommandBookmarks.vue'
import ServerList from './components/ServerList.vue'
import SshHostsPanel from './components/ssh/SshHostsPanel.vue'
import SshAuthPromptDialog from './components/ssh/SshAuthPromptDialog.vue'
import StatusBar from './components/terminal/StatusBar.vue'
import type { Tab, TerminalTab, PluginTab, PaneLayout, DropPosition } from './types/pane'
import { getAllLeaves, findLeaf, findFirstLeaf, ensureSplitRoot } from './types/pane'
import { initializePaneMru } from './types/paneMru'
// useSettings replaced by useSettingsStore
import {
  getApiBase,
  checkTokenConfigured,
  fetchAutoToken,
  validateToken,
  apiUrl,
  markCookieAuthenticated,
} from './composables/apiBase'
import { isTauri, tauriInvoke } from './composables/useTransport'
import { isTouchDevice, setActivePaneId } from './composables/useTerminal'
import { useI18n } from './composables/useI18n'
import { keyEventMatchesBinding, useKeybindings } from './composables/useKeybindings'
import { useSplitPane } from './composables/useSplitPane'
import { useSyncWebSocket } from './composables/useSyncWebSocket'
import { isWebPreviewInput } from './utils/previewRouting'
import { isWindowsClient } from './utils/clientPlatform'
import { initMonitorHistory } from './composables/useMonitor'
import NotificationPanel from './components/notification/NotificationPanel.vue'
import { useNotification } from './composables/useNotification'
import { usePluginLoader } from './composables/usePluginLoader'
import PluginView from './components/plugin/PluginView.vue'
import {
  apiCreateTab,
  apiCreateSshTab,
  apiCloseTab,
  apiClosePane,
  apiActivatePane,
  apiListTabs,
} from './composables/useTabApi'
import { Settings, Bell, Monitor, Plus, X, Star, AppWindow, Radar, RefreshCw } from 'lucide-vue-next'
import WorkspaceOverview from './components/overview/WorkspaceOverview.vue'
import { refreshPluginPreview, invalidatePluginPreview } from './composables/useTabPreview'
import { useIsMobile } from './composables/useIsMobile'
import { useWorkspaces } from './composables/useWorkspaces'
// formatCloseTabMessage moved to ConfirmCloseDialog component
import LoginPage from './components/LoginPage.vue'
import SetupPage from './components/SetupPage.vue'
import { storeToRefs } from 'pinia'
import { useSessionStore } from './stores/sessionStore'
import { useUiStore } from './stores/uiStore'
import { useSettingsStore } from './stores/settingsStore'
import { shellEscapePath } from './utils/shell'

// ── Stores ──────────────────────────────────────────────────────
const session = useSessionStore()
const { tabs, activePaneId, tabList, activeTabType, activeTab, isBroadcastActive, canBroadcast } =
  storeToRefs(session)

const ui = useUiStore()
const { syncConnected, kbVisible, settingsOpen, authenticated, authProbe, needsSetup } = storeToRefs(ui)

const settingsStore = useSettingsStore()
const appSettings = settingsStore.settings

const windowCloseConfirmVisible = ref(false)

let linkJustActivated = false
let scrollGestureDetected = false
let scrollGestureTimer = 0

// ── Template refs (purely UI concerns) ─────────────────────────
const paletteRef = ref<InstanceType<typeof CommandPalette>>()
const previewPanelRef = ref<InstanceType<typeof PreviewPanel> | null>(null)

function setPreviewPanelRef(el: any) {
  previewPanelRef.value = el
}
const bookmarksRef = ref<InstanceType<typeof CommandBookmarks>>()
const serverListRef = ref<InstanceType<typeof ServerList>>()
const sshPanelRef = ref<InstanceType<typeof SshHostsPanel>>()
const sshAuthVisible = ref(false)
const sshAuthHost = ref('')
const sshAuthPaneId = ref('')
const sshAuthPrompts = ref<Array<{ prompt: string; echo: boolean }>>([])
const { t } = useI18n()
const { getBinding, formatBinding } = useKeybindings()
const notif = useNotification()
const { loadedPlugins, loadAll, getPluginContext, pluginList, allCommands } = usePluginLoader()
const { isMobile } = useIsMobile()

// Workspace filtering
const { workspaces, activeWorkspaceId, activeWorkspacePath, activeWorkspaceName, matchWorkspace, activateWorkspace } = useWorkspaces()

const visibleTabList = computed(() => {
  const list = tabList.value.filter((info) => {
    const rawTab = tabs.value.find((t) => t.paneId === info.paneId)
    if (!rawTab) return false
    if (rawTab.type === 'plugin') return true
    // Terminal tab: match by connectionId (SSH) or cwd (local)
    const ws =
      rawTab.type === 'terminal'
        ? matchWorkspace(rawTab.cwd ?? '', rawTab.connectionId, rawTab.type === 'terminal' ? rawTab.workspaceId : undefined)
        : null
    if (activeWorkspaceId.value) {
      // Specific workspace: only tabs matching this workspace
      return ws?.id === activeWorkspaceId.value
    }
    // Default (无工作区): only tabs not belonging to any workspace
    return !ws
  })
  // Reindex: workspace-relative 1-based indices
  return list.map((t, i) => ({ ...t, index: i + 1 }))
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

const isLandscape = ref(window.innerWidth > window.innerHeight)

// Mission Control
const overviewOpen = ref(false)
const currentTabIndex = computed(() =>
  visibleTabList.value.findIndex((t) => t.paneId === activePaneId.value) + 1
)
const currentTabTitle = computed(() => {
  const tab = tabs.value.find((t) => t.paneId === activePaneId.value)
  if (!tab) return ''
  if (tab.type === 'terminal') return tab.customTitle ?? findLeaf(tab.layout, tab.activePaneId)?.title ?? 'Terminal'
  return tab.title
})

function openOverview() {
  overviewOpen.value = true
}

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

function onOverviewActivate(paneId: string) {
  activateTab(paneId)
  overviewOpen.value = false
  nextTick(() => {
    const ref = termRefs[paneId]
    ref?.focus()
  })
}

function onOverviewCloseTab(tabId: string) {
  requestCloseTab(tabId)
}

async function onOverviewNewTab(cwd?: string) {
  overviewOpen.value = false
  await newTab(cwd)
}

async function onOverviewNewTabSsh(connectionId: string, initialCwd?: string) {
  overviewOpen.value = false
  try {
    const result = await apiCreateSshTab(connectionId, initialCwd)
    const existing = tabs.value.find((t) => t.type === 'terminal' && t.paneId === result.tab_id)
    if (existing) {
      activePaneId.value = result.tab_id
      persist()
      nextTick(() => focusActive())
      return
    }
    const layout = ensureSplitRoot(result.layout)
    tabs.value.push({
      type: 'terminal',
      paneId: result.tab_id,
      layout,
      activePaneId: result.pane_id,
      paneMru: [result.pane_id],
      broadcastMode: false,
      broadcastActivity: 0,
      previewVisible: false,
      previewAddress: '',
      previewUrl: '',
      previewKind: 'web',
      connectionId,
    })
    activePaneId.value = result.tab_id
    persist()
    nextTick(() => focusActive())
  } catch (e) {
    console.error('Failed to create SSH tab:', e)
  }
}

function onOverviewRenameTab(paneId: string, title: string) {
  session.renameTab(paneId, title)
  persist()
}

// Capture plugin preview when active tab changes to a plugin tab (handles initial load)
watch(
  activePaneId,
  (paneId) => {
    const tab = tabs.value.find((t) => t.paneId === paneId)
    if (tab?.type === 'plugin') {
      nextTick(() => refreshPluginPreview(tab.paneId))
    }
  }
)

const resolvedPosition = computed(() => {
  const pos = appSettings.panel_position ?? 'auto'
  if (pos === 'auto') return isLandscape.value ? 'right' : 'top'
  return pos
})

watch(
  () => appSettings.locale,
  (l) => {
    document.documentElement.lang = l === 'en' ? 'en' : 'zh-CN'
  },
  { immediate: true }
)
watch(
  () => {
    const tab = tabs.value.find((t) => t.paneId === activePaneId.value)
    if (!tab) return 'Terminal'
    if (tab.type === 'terminal') {
      return findLeaf(tab.layout, tab.activePaneId)?.title ?? 'Terminal'
    }
    return tab.title
  },
  (title) => {
    const wsName = activeWorkspaceName.value
    const fullTitle = wsName ? `${wsName} - ${title || 'Terminal'}` : (title || 'Terminal')
    document.title = fullTitle
    if (isTauri()) {
      const tauriWindow = (window as any).__TAURI__?.window?.getCurrentWindow?.()
      tauriWindow?.setTitle?.(fullTitle)
    }
  },
  { immediate: true }
)

// Track effective active pane for Tauri WKWebView input guard
function syncActivePaneId() {
  const tab = tabs.value.find((t) => t.paneId === activePaneId.value)
  const paneId = tab?.type === 'terminal' ? tab.activePaneId : null
  setActivePaneId(paneId)
}
// Fire on tab switch (store activePaneId change) and initial load
watch(activePaneId, syncActivePaneId, { immediate: true })
// Fire when tab list changes (add/remove) — not deep, just array reference
watch(() => tabs.value.length, syncActivePaneId)
// Fire when active terminal tab's internal focus changes (sync WS, etc.)
watch(
  () => {
    const tab = tabs.value.find((t) => t.paneId === activePaneId.value)
    return tab?.type === 'terminal' ? tab.activePaneId : null
  },
  (paneId) => setActivePaneId(paneId),
)

const termRefs = shallowReactive<Record<string, InstanceType<typeof TerminalPane>>>({})
const outputListeners = new Set<(paneId: string, data: string) => void>()

const syncWs = useSyncWebSocket({
  termRefs,
  persist,
  focusActive,
  newTab: async () => { await newTab() },
})

// Set up SSH keyboard-interactive auth handler
syncWs.setSshAuthPromptHandler((paneId: string, prompts: Array<{ prompt: string; echo: boolean }>) => {
  sshAuthPaneId.value = paneId
  sshAuthPrompts.value = prompts
  // Find the host info from tabs
  const tab = tabs.value.find((t) => {
    if (t.type !== 'terminal') return false
    return t.paneId === paneId || !!findLeaf(t.layout, paneId)
  })
  if (tab && tab.type === 'terminal') {
    const leaf = findLeaf(tab.layout, paneId)
    sshAuthHost.value = leaf?.title || paneId
  } else {
    sshAuthHost.value = paneId
  }
  sshAuthVisible.value = true
})

const splitPane = useSplitPane({
  tabs,
  activePaneId,
  termRefs,
  genPaneId,
  sendSync: syncWs.sendSync,
  sendLayoutSync: syncWs.sendLayoutSync,
  persist,
})

function registerTermRef(paneId: string, el: InstanceType<typeof TerminalPane> | null) {
  if (el) {
    termRefs[paneId] = el
    el.setOutputListener((data: string) => {
      outputListeners.forEach((cb) => cb(paneId, data))
    })
  }
}

let viewportRefitTimer = 0
let naturalVH = 0

function onViewportResize() {
  if (!window.visualViewport) return
  const vh = window.visualViewport.height
  if (vh > naturalVH) naturalVH = vh
  const off = window.innerHeight - (window.visualViewport.offsetTop + vh)
  // Shrink #app-root when system keyboard is visible (even without custom keyboard)
  document.documentElement.style.setProperty('--sys-kb-height', `${Math.max(0, off)}px`)
  // Set --kb-open: either system keyboard or custom mobile keyboard is visible
  const sysKbOpen = naturalVH > 0 && naturalVH - vh > 120
  document.documentElement.style.setProperty('--kb-open', (sysKbOpen || kbVisible.value) ? '1' : '0')

  clearTimeout(viewportRefitTimer)
  viewportRefitTimer = window.setTimeout(() => {
    if (!activePaneId.value) return
    const tab = tabs.value.find((t) => t.paneId === activePaneId.value)
    if (!tab || tab.type !== 'terminal') return
    for (const leaf of getAllLeaves(tab.layout)) {
      termRefs[leaf.paneId]?.fit()
    }
  }, 100)
}

// Set --kb-open when custom keyboard visibility changes
watch(kbVisible, (v) => {
  document.documentElement.style.setProperty('--kb-open', v ? '1' : '0')
})

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

let persistTimer: ReturnType<typeof setTimeout> | null = null
function persistNow() {
  const state = tabs.value.map((t) => {
    if (t.type === 'terminal') {
      return {
        type: t.type,
        paneId: t.paneId,
        layout: t.layout,
        activePaneId: t.activePaneId,
        broadcastMode: t.broadcastMode,
        previewVisible: t.previewVisible,
        previewAddress: t.previewAddress,
        previewUrl: t.previewUrl,
        previewKind: t.previewKind,
        customTitle: t.customTitle,
        connectionId: t.connectionId,
      }
    }
    return {
      type: t.type,
      paneId: t.paneId,
      title: t.title,
      pluginId: t.pluginId,
      workspaceId: t.workspaceId,
    }
  })
  const activeIdx = tabs.value.findIndex((t) => t.paneId === activePaneId.value)
  localStorage.setItem('dinotty_tabs', JSON.stringify({ tabs: state, activeIdx }))
}
function persist() {
  if (persistTimer) clearTimeout(persistTimer)
  persistTimer = setTimeout(persistNow, 200)
}
// Flush pending persist on page unload
window.addEventListener('beforeunload', (e) => {
  if (persistTimer) {
    clearTimeout(persistTimer)
    persistNow()
  }
})

const DEFAULT_PREVIEW_URL = ''

async function newTab(cwd?: string) {
  try {
    // Remote workspace: open an SSH terminal and cd into the workspace's remote path.
    const activeWs = workspaces.value.find((w) => w.id === activeWorkspaceId.value)
    if (activeWs?.connection_id) {
      const result = await apiCreateSshTab(activeWs.connection_id, activeWs.path)
      await onSshConnect(result)
      return
    }
    const effectiveCwd = cwd ?? activeWorkspacePath.value
    const result = await apiCreateTab(effectiveCwd)
    // Dedup: broadcast_sync echoes back to sender — tab_created handler may
    // have already added this tab if the sync message arrived before the
    // REST response.
    const existing = tabs.value.find((t) => t.type === 'terminal' && t.paneId === result.tab_id)
    if (existing) {
      // Ensure cwd is set (sync message may have arrived without it)
      if (result.cwd && existing.type === 'terminal' && !existing.cwd) {
        existing.cwd = result.cwd
      }
      activePaneId.value = result.tab_id
      persist()
      nextTick(() => focusActive())
      return
    }
    const layout = ensureSplitRoot(result.layout)
    tabs.value.push({
      type: 'terminal',
      paneId: result.tab_id,
      layout,
      activePaneId: result.pane_id,
      paneMru: [result.pane_id],
      broadcastMode: false,
      broadcastActivity: 0,
      previewVisible: false,
      previewAddress: '',
      previewUrl: '',
      previewKind: 'web',
      cwd: result.cwd,
    })
    activePaneId.value = result.tab_id
    persist()
    nextTick(() => focusActive())
  } catch (e) {
    console.error('Failed to create tab:', e)
  }
}

function onNewMenuAction(type: 'new-tab' | 'split-h' | 'split-v' | 'broadcast' | 'ssh-connect') {
  switch (type) {
    case 'new-tab':
      return newTab()
    case 'split-h':
      return splitPane.splitPane('horizontal')
    case 'split-v':
      return splitPane.splitPane('vertical')
    case 'broadcast':
      return splitPane.toggleBroadcast()
    case 'ssh-connect':
      return sshPanelRef.value?.open()
  }
}

async function activateTab(tabId: string) {
  // Try tab-level paneId first, then search by leaf paneId
  let tab = tabs.value.find((t) => t.paneId === tabId)
  if (!tab) {
    tab = tabs.value.find((t) => {
      if (t.type !== 'terminal') return false
      return !!findLeaf(t.layout, tabId)
    })
  }
  if (!tab) return

  // Switch workspace if the tab belongs to a different one
  const targetWs = tab.type === 'terminal'
    ? matchWorkspace(tab.cwd ?? '', tab.connectionId, tab.workspaceId)
    : tab.workspaceId ? workspaces.value.find((w) => w.id === tab.workspaceId) ?? null : null
  if (targetWs && targetWs.id !== activeWorkspaceId.value) {
    await activateWorkspace(targetWs.id)
  }

  activePaneId.value = tab.paneId
  if (tab.type === 'terminal') {
    // Clear unread for all leaves in this tab
    for (const leaf of getAllLeaves(tab.layout)) {
      notif.clearPaneUnread(leaf.paneId)
    }
    try {
      await apiActivatePane(tab.paneId, tab.activePaneId)
    } catch (e) {
      console.error('Failed to activate pane:', e)
    }
  }
  persist()
  nextTick(() => focusActive())
}

// Wire up toast notification direct-jump handler
notif.setGoToPaneHandler((paneId: string) => activateTab(paneId))

function reorderTab(fromId: string, toId: string) {
  session.reorderTab(fromId, toId)
  persist()
}

function onRenameTab(paneId: string, title: string) {
  session.renameTab(paneId, title)
  persist()
}

async function onClosePane(tabId: string, paneId: string) {
  const tab = tabs.value.find((t) => t.paneId === tabId)
  if (!tab) return

  // Bypass 1: non-terminal tab
  if (tab.type !== 'terminal') {
    const closed = await splitPane.closePane(paneId)
    if (!closed) await closeTab(tabId)
    return
  }

  // Bypass 2: user disabled confirmation
  if (appSettings.confirm_before_close_tab === false) {
    const closed = await splitPane.closePane(paneId)
    if (!closed) await closeTab(tabId)
    return
  }

  // Show confirmation (handles both pane and tab close)
  ui.requestClosePane(tabId, paneId)
}

async function requestCloseTab(tabId: string) {
  const tab = tabs.value.find((t) => t.paneId === tabId)
  if (!tab) return

  // Bypass 1: non-terminal tabs (plugins) — close immediately, no prompt
  if (tab.type !== 'terminal') {
    await closeTab(tabId)
    return
  }

  // Bypass 2: user disabled confirmation in settings
  if (appSettings.confirm_before_close_tab === false) {
    await closeTab(tabId)
    return
  }

  // Otherwise: show confirmation
  ui.requestCloseTab(tabId)
}

async function onConfirmClose(tabId: string, paneId: string | null) {
  if (paneId) {
    // Pane close: try close pane first, fall back to tab close if last
    const closed = await splitPane.closePane(paneId)
    if (!closed && tabId) {
      await closeTab(tabId)
    }
  } else if (tabId) {
    // Tab close (no pane specified)
    await closeTab(tabId)
  }
  ui.cancelClose()
}

async function closeTab(tabId: string) {
  const tab = tabs.value.find((t) => t.paneId === tabId)
  if (!tab) return

  // Invalidate plugin preview cache when closing a plugin tab
  if (tab.type === 'plugin') {
    invalidatePluginPreview(tab.paneId)
  }

  if (tab.type === 'terminal') {
    // Clean up local term refs
    for (const leaf of getAllLeaves(tab.layout)) {
      delete termRefs[leaf.paneId]
    }

    try {
      await apiCloseTab(tabId)
    } catch (e) {
      console.error('Failed to close tab:', e)
      return
    }
  }

  // Remove tab from local array
  const idx = tabs.value.findIndex((t) => t.paneId === tabId)
  if (idx === -1) return

  tabs.value.splice(idx, 1)

  // If this was the last tab, create a new one
  if (tabs.value.length === 0) {
    await newTab()
    return
  }

  if (activePaneId.value === tabId) {
    const newIdx = Math.min(idx, tabs.value.length - 1)
    activePaneId.value = tabs.value[newIdx].paneId
  }

  persist()
  nextTick(() => focusActive())
}

function focusActive() {
  if (!activePaneId.value) return
  const tab = tabs.value.find((t) => t.paneId === activePaneId.value)
  if (!tab) return
  if (tab.type === 'terminal') {
    const paneId = tab.activePaneId
    if (!(isTouchDevice() && kbVisible.value)) {
      // Blur all other panes first to prevent duplicate input in Tauri WKWebView
      for (const leaf of getAllLeaves(tab.layout)) {
        if (leaf.paneId !== paneId) {
          termRefs[leaf.paneId]?.blur()
        }
      }
      termRefs[paneId]?.focus()
    }
    termRefs[paneId]?.fit()
  }
}

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

function onPreviewLink(leafPaneId: string, url: string) {
  const tab = tabs.value.find((t) => {
    if (t.type !== 'terminal') return false
    return !!findLeaf(t.layout, leafPaneId)
  }) as TerminalTab | undefined
  if (!tab) return
  tab.previewKind = 'web'
  tab.previewUrl = url
  tab.previewAddress = url
  tab.previewVisible = true
  persist()
}

function closePreview(tabId: string) {
  const tab = tabs.value.find((t) => t.paneId === tabId)
  if (tab && tab.type === 'terminal') {
    tab.previewVisible = false
    persist()
  }
}

const isRemote = computed(() => {
  const tabId = activePaneId.value
  if (!tabId) return false
  const tab = tabs.value.find((t) => t.paneId === tabId)
  if (!tab || tab.type !== 'terminal') return false
  return findLeaf(tab.layout, tab.activePaneId)?.shell_type === 'ssh'
})

function reloadApp() {
  window.location.reload()
}

function openPreview() {
  const tabId = activePaneId.value
  if (!tabId) return
  const tab = tabs.value.find((t) => t.paneId === tabId)
  if (!tab || tab.type !== 'terminal') return
  const isSsh = findLeaf(tab.layout, tab.activePaneId)?.shell_type === 'ssh'
  if (isSsh || !tab.previewAddress.trim()) {
    tab.previewKind = 'files'
  }
  tab.previewVisible = true
  persist()
  nextTick(() => {
    if (tab.previewKind !== 'files') return
    const raw = tab.previewAddress.trim()
    if (raw && !isWebPreviewInput(raw)) {
      previewPanelRef.value?.openFromPath(raw)
    }
  })
}

function onFileClick(path: string) {
  const tabId = activePaneId.value
  if (!tabId) return
  const tab = tabs.value.find((t) => t.paneId === tabId)
  if (!tab || tab.type !== 'terminal') return
  tab.previewKind = 'files'
  tab.previewAddress = path
  tab.previewVisible = true
  persist()
  nextTick(() => previewPanelRef.value?.openFromPath(path))
}

function getSendFn(): ((data: string) => void) | null {
  if (!activePaneId.value) return null
  const tab = tabs.value.find((t) => t.paneId === activePaneId.value)
  if (!tab || tab.type !== 'terminal') return null
  const paneId = tab.activePaneId
  if (!termRefs[paneId]) return null
  return (data: string) => {
    termRefs[paneId]?.sendData(data)
    if (tab.broadcastMode && getAllLeaves(tab.layout).length > 1) {
      for (const leaf of getAllLeaves(tab.layout)) {
        if (leaf.paneId !== paneId) {
          termRefs[leaf.paneId]?.sendData(data, true)
        }
      }
      tab.broadcastActivity++
    }
  }
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

function onLinkActivate() {
  linkJustActivated = true
}

function onTerminalTouch(e: TouchEvent) {
  if (!isTouchDevice()) return
  const target = e.target as HTMLElement
  if (target.closest('.terminal-pane-container')) {
    // Don't show keyboard when tapping a link (file path or URL)
    if (linkJustActivated) {
      linkJustActivated = false
      return
    }
    // Don't show keyboard when a scroll gesture was just detected
    if (scrollGestureDetected) {
      scrollGestureDetected = false
      if (kbVisible.value) kbVisible.value = false
      return
    }
    const tab = tabs.value.find((t) => t.paneId === activePaneId.value)
    const paneId = tab?.type === 'terminal' ? tab.activePaneId : null
    const term = paneId ? termRefs[paneId]?.getTerminal() : null
    if (term && term.touchMoved) {
      term.touchMoved = false
      if (kbVisible.value) kbVisible.value = false
      return
    }
    kbVisible.value = true
  }
}

function onTerminalScroll() {
  scrollGestureDetected = true
  clearTimeout(scrollGestureTimer)
  scrollGestureTimer = window.setTimeout(() => { scrollGestureDetected = false }, 300)
  if (kbVisible.value) kbVisible.value = false
}

function onTokenChanged() {
  syncWs.closeWs()
  syncWs.connectSyncWS()
}

function onServerConnect(host: string, port: number) {
  const proto = location.protocol
  window.location.href = `${proto}//${host}:${port}/`
}

async function onSshConnect(result: { tab_id: string; pane_id: string; layout: any; connection_id?: string }) {
  // If API didn't return connection_id, inherit from the active workspace
  const resolvedConnectionId = result.connection_id
    ?? workspaces.value.find((w) => w.id === activeWorkspaceId.value)?.connection_id

  const existing = tabs.value.find((t) => t.paneId === result.tab_id)
  if (existing) {
    if (existing.type === 'terminal') {
      if (resolvedConnectionId && !existing.connectionId) {
        existing.connectionId = resolvedConnectionId
      }
      if (!existing.workspaceId && activeWorkspaceId.value) {
        existing.workspaceId = activeWorkspaceId.value
      }
    }
    activePaneId.value = result.tab_id
    persist()
    nextTick(() => focusActive())
    return
  }
  syncWs.markRecentlyCreated(result.tab_id)
  tabs.value.push({
    type: 'terminal',
    paneId: result.tab_id,
    layout: ensureSplitRoot(result.layout),
    activePaneId: result.pane_id,
    paneMru: [result.pane_id],
    broadcastMode: false,
    broadcastActivity: 0,
    previewVisible: false,
    previewAddress: '',
    previewUrl: '',
    previewKind: 'web',
    connectionId: resolvedConnectionId,
    workspaceId: activeWorkspaceId.value ?? undefined,
  })
  activePaneId.value = result.tab_id
  persist()
  nextTick(() => focusActive())
}

function onSshReconnect() {
  sshPanelRef.value?.open()
}

function onSshAuthSubmit(responses: string[]) {
  syncWs.sendSshAuthResponse(sshAuthPaneId.value, responses)
  sshAuthVisible.value = false
}

function onSshAuthCancel() {
  sshAuthVisible.value = false
}

function openPlugin(pluginId: string) {
  try {
    const wsId = activeWorkspaceId.value ?? ''
    const paneId = `plugin:${pluginId}:${wsId}`
    const existing = tabs.value.find((t) => t.paneId === paneId)
    if (existing) {
      activateTab(paneId)
      return
    }

    const plugin = loadedPlugins.get(pluginId)
    if (!plugin || plugin.state !== 'active') {
      const msg =
        plugin?.state === 'error'
          ? `Plugin "${pluginId}" failed to load: ${plugin.error ?? 'unknown error'}`
          : `Plugin "${pluginId}" is not loaded.`
      console.warn('[openPlugin]', msg)
      window.__dinotty_ui_notify?.(msg, 'error')
      return
    }

    const newTab = {
      type: 'plugin' as const,
      paneId,
      title: plugin.manifest.name,
      pluginId,
      workspaceId: activeWorkspaceId.value ?? undefined,
    }
    tabs.value.push(newTab)
    activePaneId.value = paneId
    syncWs.sendSync({ type: 'activate_tab', pane_id: paneId })
    persist()
    nextTick(() => focusActive())
  } catch (err) {
    console.error('[openPlugin] error:', err)
  }
}

// Window globals for plugin context
window.__dinotty_terminal_api = {
  send(paneId: string, data: string) {
    termRefs[paneId]?.sendData(data)
  },
  activePaneId() {
    const tab = tabs.value.find((t) => t.paneId === activePaneId.value)
    return tab?.type === 'terminal' ? tab.activePaneId : activePaneId.value
  },
  listPanes() {
    const result: { id: string; title: string; active: boolean }[] = []
    for (const t of tabs.value) {
      if (t.type !== 'terminal') continue
      for (const leaf of getAllLeaves(t.layout)) {
        result.push({
          id: leaf.paneId,
          title: leaf.title,
          active: t.paneId === activePaneId.value && leaf.paneId === t.activePaneId,
        })
      }
    }
    return result
  },
  onOutput(callback: (paneId: string, data: string) => void) {
    outputListeners.add(callback)
    return {
      dispose() {
        outputListeners.delete(callback)
      },
    }
  },
  async createTab(command?: string) {
    newTab()
    const tab = tabs.value.find((t) => t.paneId === activePaneId.value)
    return tab?.type === 'terminal' ? tab.activePaneId : ''
  },
}
window.__dinotty_ui_notify = (message: string, level?: 'info' | 'warn' | 'error') => {
  // Use notification system or console
  if (level === 'error') console.error('[plugin]', message)
  else console.log('[plugin]', message)
}
window.__dinotty_ui_confirm = (message: string) => uiConfirm(message)
window.__dinotty_open_plugin = openPlugin

const paletteCommands = computed<Command[]>(() => {
  const base: Command[] = [
    {
      icon: '＋',
      title: t('palette.newTab'),
      subtitle: t('palette.newTabDesc'),
      kbd: formatBinding(getBinding('newTab')),
      action: () => newTab(),
    },
    {
      icon: '✕',
      title: t('palette.closeTab'),
      subtitle: t('palette.closeTabDesc'),
      kbd: formatBinding(getBinding('closeTab')),
      action: async () => {
        if (activePaneId.value) {
          const tab = tabs.value.find((t) => t.paneId === activePaneId.value)
          if (tab?.type === 'terminal' && getAllLeaves(tab.layout).length > 1) {
            await onClosePane(tab.paneId, tab.activePaneId)
          } else {
            await requestCloseTab(activePaneId.value)
          }
        }
      },
    },
    {
      icon: '⊞',
      title: t('palette.splitHorizontal'),
      subtitle: t('palette.splitHorizontalDesc'),
      kbd: formatBinding(getBinding('splitHorizontal')),
      action: () => splitPane.splitPane('horizontal'),
    },
    {
      icon: '⊟',
      title: t('palette.splitVertical'),
      subtitle: t('palette.splitVerticalDesc'),
      kbd: formatBinding(getBinding('splitVertical')),
      action: () => splitPane.splitPane('vertical'),
    },
    {
      icon: '★',
      title: t('palette.bookmarks'),
      subtitle: t('palette.bookmarksDesc'),
      kbd: formatBinding(getBinding('openBookmarks')),
      action: () => bookmarksRef.value?.open(),
    },
    {
      icon: '⊡',
      title: t('palette.openPreview'),
      subtitle: t('palette.openPreviewDesc'),
      action: () => openPreview(),
    },
    {
      icon: '⇄',
      title: t('palette.sshConnect'),
      subtitle: t('palette.sshConnectDesc'),
      action: () => sshPanelRef.value?.open(),
    },
    // Only show "New Local Terminal" when active tab is an SSH session
    ...(activeTab.value?.type === 'terminal' && activeTab.value.connectionId ? [{
      icon: '⌂',
      title: t('palette.newLocalTerminal'),
      subtitle: t('palette.newLocalTerminalDesc'),
      action: () => splitPane.splitPane('horizontal', true, activeWorkspacePath.value),
    }] : []),
  ]

  // Plugin-registered commands
  for (const cmd of allCommands.value) {
    const plugin = loadedPlugins.get(cmd.pluginId)
    // Look up title from manifest commands list
    const cmdDef = plugin?.manifest.commands?.find((c) => c.id === cmd.id)
    base.push({
      icon: '◈',
      title: cmdDef?.title || cmd.id,
      subtitle: plugin?.manifest.name,
      action: () => {
        openPlugin(cmd.pluginId)
        cmd.handler()
      },
    })
  }

  // Plugin open commands (skip if plugin already registered its own commands)
  const pluginsWithCommands = new Set(allCommands.value.map((c) => c.pluginId))
  for (const p of pluginList.value) {
    if (p.state === 'active' && !pluginsWithCommands.has(p.id)) {
      base.push({
        icon: '◈',
        title: t('palette.openPlugin', { name: p.name }),
        subtitle: t('palette.openPluginDesc'),
        action: () => openPlugin(p.id),
      })
    }
  }

  return base
})

function onGlobalKeydown(e: KeyboardEvent) {
  const cmd = e.metaKey || e.ctrlKey
  const altAsCmd = appSettings.windowsAltAsCmd && isWindowsClient
  const appCmd = (cmd || (altAsCmd && e.altKey)) && !(altAsCmd && e.ctrlKey && e.altKey)
  if (!appCmd) return

  const keyActions: Record<string, () => void> = {
    togglePalette: () => paletteRef.value?.toggle(),
    openBookmarks: () => bookmarksRef.value?.open(),
    newTab: () => newTab(),
    closeTab: async () => {
      if (!activePaneId.value) return
      const tab = tabs.value.find((t) => t.paneId === activePaneId.value)
      if (tab?.type === 'terminal' && getAllLeaves(tab.layout).length > 1) {
        // Multi-pane: route through confirmation gate (consistent with X button)
        await onClosePane(tab.paneId, tab.activePaneId)
      } else {
        await requestCloseTab(activePaneId.value)
      }
    },
    splitHorizontal: () => splitPane.splitPane('horizontal'),
    splitVertical: () => splitPane.splitPane('vertical'),
    toggleBroadcast: () => splitPane.toggleBroadcast(),
    toggleZoom: () => splitPane.toggleZoom(),
    equalizePanes: () => splitPane.equalizePanes(),
    focusNextPane: () => splitPane.focusNext(),
    focusPrevPane: () => splitPane.focusPrev(),
    searchTerminal: () => {
      if (!activePaneId.value) return
      const tab = tabs.value.find((t) => t.paneId === activePaneId.value)
      if (!tab || tab.type !== 'terminal') return
      termRefs[tab.activePaneId]?.toggleSearch()
    },
    missionControl: () => openOverview(),
    sshConnect: () => sshPanelRef.value?.open(),
    fontSizeUp: () => adjustActiveTerminalFontSize(1),
    fontSizeDown: () => adjustActiveTerminalFontSize(-1),
    fontSizeReset: () => adjustActiveTerminalFontSize(0),
  }

  for (const [id, action] of Object.entries(keyActions)) {
    const binding = getBinding(id)
    if (keyEventMatchesBinding(e, binding)) {
      e.preventDefault()
      action()
      return
    }
  }

  // Cmd+Option+Arrow: focus neighbor pane (spatial navigation)
  if (cmd && e.altKey && !e.shiftKey) {
    const dirMap: Record<string, 'left' | 'right' | 'up' | 'down'> = {
      ArrowLeft: 'left',
      ArrowRight: 'right',
      ArrowUp: 'up',
      ArrowDown: 'down',
    }
    if (dirMap[e.key]) {
      e.preventDefault()
      splitPane.focusNeighbor(dirMap[e.key])
      return
    }
  }

  // Cmd+Option+Shift+Arrow: keyboard resize
  if (cmd && e.altKey && e.shiftKey) {
    const dirMap: Record<string, 'left' | 'right' | 'up' | 'down'> = {
      ArrowLeft: 'left',
      ArrowRight: 'right',
      ArrowUp: 'up',
      ArrowDown: 'down',
    }
    if (dirMap[e.key]) {
      e.preventDefault()
      splitPane.keyboardResize(dirMap[e.key])
      return
    }
  }

  if (!e.shiftKey && e.key >= '1' && e.key <= '9') {
    const idx = parseInt(e.key) - 1
    if (idx < visibleTabList.value.length) {
      e.preventDefault()
      activateTab(visibleTabList.value[idx].paneId)
    }
  }
}

function onOrientationChange() {
  isLandscape.value = window.innerWidth > window.innerHeight
}

const _focusHandler = () => {
  nextTick(() => focusActive())
}

// Tauri window close confirmation
let unlistenWindowClose: (() => void) | undefined
function setupTauriWindowClose() {
  if (!isTauri()) return
  const listen = (window as any).__TAURI__?.event?.listen
  if (!listen) return
  listen('window-close-requested', () => {
    if (appSettings.confirm_before_close_tab && tabs.value.some((t) => t.type === 'terminal')) {
      windowCloseConfirmVisible.value = true
    } else {
      tauriInvoke('close_window')
    }
  }).then((fn: () => void) => {
    unlistenWindowClose = fn
  })
}
function onWindowCloseConfirm() {
  windowCloseConfirmVisible.value = false
  if (persistTimer) {
    clearTimeout(persistTimer)
    persistNow()
  }
  tauriInvoke('close_window')
}
function onWindowCloseCancel() {
  windowCloseConfirmVisible.value = false
}

onMounted(async () => {
  setupTauriWindowClose()
  document.addEventListener('keydown', onGlobalKeydown)
  document.addEventListener('terminal-scroll', onTerminalScroll)
  window.addEventListener('focus', _focusHandler)
  window.addEventListener('resize', onOrientationChange)
  window.addEventListener('terminal-insert-path', onTerminalInsertPath)
  window.addEventListener('terminal-insert-text', onTerminalInsertText)
  if (window.visualViewport) {
    naturalVH = window.visualViewport.height
    window.visualViewport.addEventListener('resize', onViewportResize)
  }
  try {
    if (authenticated.value) {
    await getApiBase()
    await settingsStore.load()
    void syncWs.connectSyncWS()
    initMonitorHistory()
    void loadAll()
    // Fallback: if sync WS hasn't delivered tabs within 3s, load via REST
    setTimeout(async () => {
      if (tabs.value.length === 0 && !syncWs.isConnected()) {
        try {
          const data = await apiListTabs()
          for (const tab of data.tabs) {
            if (tabs.value.some((t) => t.paneId === tab.tab_id)) continue
            const layout = tab.layout
              ? ensureSplitRoot(tab.layout)
              : ensureSplitRoot({
                  type: 'leaf',
                  paneId: tab.pane_id,
                  title: 'Terminal',
                  ratio: 1,
                  zoomed: false,
                })
            tabs.value.push({
              type: 'terminal',
              paneId: tab.tab_id,
              layout,
              activePaneId: tab.active_pane_id ?? tab.pane_id,
              paneMru: initializePaneMru(
                getAllLeaves(layout).map((leaf) => leaf.paneId),
                tab.active_pane_id ?? tab.pane_id
              ),
              broadcastMode: false,
              broadcastActivity: 0,
              previewVisible: false,
              previewAddress: '',
              previewUrl: '',
              previewKind: 'web',
              connectionId: tab.connection_id,
            })
          }
          if (data.active_pane_id) {
            const targetTab = tabs.value.find((t) => {
              if (t.type !== 'terminal') return false
              return !!findLeaf(t.layout, data.active_pane_id!)
            }) as TerminalTab | undefined
            if (targetTab) {
              activePaneId.value = targetTab.paneId
            }
          }
          if (tabs.value.length > 0 && !activePaneId.value) {
            activePaneId.value = tabs.value[0].paneId
          }
          persist()
          nextTick(() => focusActive())
        } catch (e) {
          console.warn('[sync] REST fallback failed:', e)
        }
      }
    }, 3000)
  } else {
    // Not yet authenticated
    await getApiBase()
    const { configured, serverMode } = await checkTokenConfigured()
    if (!configured) {
      // First-time setup: show setup page (server mode only)
      needsSetup.value = true
    } else if (!serverMode) {
      // Desktop mode: honor an existing cookie session first (e.g. LAN
      // access after manual login). Fall back to loopback auto-token only
      // when the cookie is absent/invalid.
      let cookieOk = false
      try {
        const res = await fetch(apiUrl('/api/settings'), { credentials: 'include' })
        cookieOk = res.ok
      } catch {
        // network error - fall through to auto-token
      }
      if (cookieOk) {
        await onLoginSuccess()
      } else {
        const autoToken = await fetchAutoToken()
        if (autoToken) {
          const r = await validateToken(autoToken)
          if (r.ok) {
            await onLoginSuccess()
          }
        }
      }
    } else {
      // Server mode: check if session cookie is still valid
      try {
        const res = await fetch(apiUrl('/api/settings'), { credentials: 'include' })
        if (res.ok) {
          await onLoginSuccess()
        }
        // else: show LoginPage (default state)
      } catch {
        // Network error — show LoginPage
      }
    }
  }
  } finally {
    ui.markAuthProbeDone()
  }
})

onBeforeUnmount(() => {
  unlistenWindowClose?.()
  document.removeEventListener('keydown', onGlobalKeydown)
  document.removeEventListener('terminal-scroll', onTerminalScroll)
  window.removeEventListener('focus', _focusHandler)
  window.removeEventListener('resize', onOrientationChange)
  window.removeEventListener('terminal-insert-path', onTerminalInsertPath)
  window.removeEventListener('terminal-insert-text', onTerminalInsertText)
  if (window.visualViewport) {
    window.visualViewport.removeEventListener('resize', onViewportResize)
  }
  document.documentElement.style.removeProperty('--sys-kb-height')
  document.documentElement.style.setProperty('--kb-open', '0')
  syncWs.closeWs()
})
</script>

<style>
.auth-probe-screen {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  background: var(--bg, #1a1a1a);
}
.auth-probe-spinner {
  color: var(--fg-muted, #888);
  animation: auth-probe-spin 1s linear infinite;
}
@keyframes auth-probe-spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
#app-root {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: calc(100% - var(--mkb-height, 0px) - var(--sys-kb-height, 0px));
}
.tab-page.active.has-preview {
  display: flex;
}
.tab-page.active.has-preview.pos-right,
.tab-page.active.has-preview.pos-left {
  flex-direction: row;
}
.tab-page.active.has-preview.pos-top,
.tab-page.active.has-preview.pos-bottom {
  flex-direction: column;
}
.tab-page.active.has-preview > .terminal-pane-container,
.tab-page.active.has-preview > .split-container,
.tab-page.active.has-preview > .split-leaf {
  flex: 1;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}
.tab-page.active.has-preview > .preview-panel {
  flex: 1;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}
.tab-page.active.has-preview.pos-left > .terminal-pane-container,
.tab-page.active.has-preview.pos-left > .split-container,
.tab-page.active.has-preview.pos-left > .split-leaf,
.tab-page.active.has-preview.pos-top > .terminal-pane-container,
.tab-page.active.has-preview.pos-top > .split-container,
.tab-page.active.has-preview.pos-top > .split-leaf {
  order: 1;
}
.tab-page.active.has-preview.pos-left > .preview-panel,
.tab-page.active.has-preview.pos-top > .preview-panel {
  order: 0;
}
.tab-page.active.has-preview.pos-top > .terminal-pane-container,
.tab-page.active.has-preview.pos-top > .split-container,
.tab-page.active.has-preview.pos-top > .split-leaf,
.tab-page.active.has-preview.pos-bottom > .terminal-pane-container,
.tab-page.active.has-preview.pos-bottom > .split-container,
.tab-page.active.has-preview.pos-bottom > .split-leaf {
  flex: 2;
}
.tab-page.active.has-preview.pos-top > .preview-panel,
.tab-page.active.has-preview.pos-bottom > .preview-panel {
  flex: 1;
}
.broadcast-btn {
  position: relative;
  color: #ef4444;
  animation: broadcast-pulse 2s ease-in-out infinite;
}
@keyframes broadcast-pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.5;
  }
}
.notif-btn {
  position: relative;
}
.notif-badge {
  position: absolute;
  top: 2px;
  right: 2px;
  min-width: 14px;
  height: 14px;
  border-radius: 7px;
  background: var(--color-red, #ef4444);
  color: #fff;
  font-size: 9px;
  font-weight: 700;
  line-height: 14px;
  text-align: center;
  padding: 0 3px;
  pointer-events: none;
}
</style>
