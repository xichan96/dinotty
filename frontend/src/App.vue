<template>
  <SetupPage v-if="!authenticated && needsSetup" @success="onLoginSuccess" />
  <LoginPage v-else-if="!authenticated" @success="onLoginSuccess" />
  <div v-else id="app-root">
    <TabBar
      :tabs="tabList"
      :active-pane-id="activePaneId"
      :indicators="notif.unreadByPane"
      :plugins="pluginList"
      :can-broadcast="canBroadcast"
      :broadcast-active="isBroadcastActive"
      @activate="activateTab"
      @close="requestCloseTab"
      @action="onNewMenuAction"
      @reorder="reorderTab"
      @open-plugin="openPlugin"
    >
      <template #left>
        <button v-if="isBroadcastActive" type="button" class="tab-bar-icon-btn broadcast-btn" :title="t('split.toggleBroadcast')" @click="splitPane.toggleBroadcast()" @touchend.prevent="splitPane.toggleBroadcast()">
          <Radar :size="16" />
        </button>
      </template>
      <template #right>
        <button v-if="activeTabType === 'terminal'" type="button" class="tab-bar-icon-btn" :title="t('app.preview')" @click="openPreview" @touchend.prevent="openPreview"><Monitor :size="16" /></button>
        <button type="button" class="tab-bar-icon-btn" :title="t('app.settings')" @click="settingsOpen = true" @touchend.prevent="settingsOpen = true"><Settings :size="16" /></button>
        <button v-if="notif.notifications.value.length > 0" type="button" class="tab-bar-icon-btn notif-btn" :title="t('notification.title')" @click="notif.togglePanel()" @touchend.prevent="notif.togglePanel()">
          <Bell :size="16" />
          <span v-if="notif.unreadCount.value > 0" class="notif-badge">{{ notif.unreadCount.value > 9 ? '9+' : notif.unreadCount.value }}</span>
        </button>
      </template>
    </TabBar>

    <div id="tab-content" @touchend="onTerminalTouch">
      <div
        v-for="tab in tabs"
        :key="tabKey(tab)"
        class="tab-page"
        :class="{ active: tab.paneId === activePaneId, 'has-preview': tab.type === 'terminal' && tab.previewVisible, ['pos-' + resolvedPosition]: tab.type === 'terminal' && tab.previewVisible }"
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
            @reorder="(src: string, tgt: string, pos: 'left' | 'right' | 'top' | 'bottom') => splitPane.reorderPane(src, tgt, pos)"
            @divider-drag-end="onDividerDragEnd(tab)"
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
            @close="closePreview(tab.paneId)"
            @update:address="(v: string) => { tab.previewAddress = v; persist() }"
            @update:kind="(v: 'web' | 'files') => { tab.previewKind = v; persist() }"
            @update:web-url="(v: string) => { tab.previewUrl = v; persist() }"
          />
        </template>
        <PluginView
          v-else-if="tab.type === 'plugin'"
          :plugin="loadedPlugins.get(tab.pluginId)!"
          :api="getPluginContext(tab.pluginId)"
        />
      </div>
    </div>

    <NotificationPanel :pane-labels="paneLabels" @goto-pane="activateTab" />

    <StatusBar />

    <CommandPalette ref="paletteRef" :commands="paletteCommands" />

    <SettingsPanel :open="settingsOpen" @close="settingsOpen = false" />

    <ConfirmModal
      :visible="confirmCloseVisible"
      :title="t('confirm.closeTabTitle')"
      :message="pendingCloseMessage"
      :confirm-text="t('confirm.closeTabConfirm')"
      :cancel-text="t('confirm.closeTabCancel')"
      @confirm="onConfirmClose"
      @cancel="onCancelClose"
    />

    <CommandBookmarks ref="bookmarksRef" :get-send-fn="getSendFn" :create-tab="newTab" />

    <ServerList ref="serverListRef" @connect="onServerConnect" />

    <MobileKeyboard
      :visible="kbVisible"
      :pane-id="activePaneId ?? ''"
      :get-send-fn="getSendFn"
      @update:visible="(v: boolean) => kbVisible = v"
      @bookmarks="bookmarksRef?.open()"
    />

    <KbToggleButton
      v-show="appSettings.show_virtual_keyboard && !kbVisible"
      :visible="kbVisible"
      @toggle="kbVisible = !kbVisible"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, shallowReactive, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import TabBar from './components/terminal/TabBar.vue'
import type { TabInfo } from './components/terminal/TabBar.vue'
import TerminalPane from './components/terminal/TerminalPane.vue'
import SplitContainer from './components/split/SplitContainer.vue'
import CommandPalette from './components/command/CommandPalette.vue'
import type { Command } from './components/command/CommandPalette.vue'
import MobileKeyboard from './components/keyboard/MobileKeyboard.vue'
import KbToggleButton from './components/keyboard/KbToggleButton.vue'
import SettingsPanel from './components/SettingsPanel.vue'
import ConfirmModal from './components/ui/ConfirmModal.vue'
import PreviewPanel from './components/preview/PreviewPanel.vue'
import CommandBookmarks from './components/command/CommandBookmarks.vue'
import ServerList from './components/ServerList.vue'
import StatusBar from './components/terminal/StatusBar.vue'
import type { SyncServerMsg, SyncClientMsg } from './types/protocol'
import type { Tab, TerminalTab, PluginTab, PaneLayout } from './types/pane'
import { migrateTab, getAllLeaves, findLeaf, findFirstLeaf, ensureSplitRoot } from './types/pane'
import { useSettings } from './composables/useSettings'
import { getApiBase, wsUrlWithToken, hasAuthToken, checkTokenConfigured, setAuthToken } from './composables/apiBase'
import { isTauri } from './composables/useTransport'
import { isTouchDevice, setActivePaneId } from './composables/useTerminal'
import { useI18n } from './composables/useI18n'
import { useKeybindings } from './composables/useKeybindings'
import { useSplitPane } from './composables/useSplitPane'
import { isWebPreviewInput } from './utils/previewRouting'
import { initMonitorHistory } from './composables/useMonitor'
import NotificationPanel from './components/notification/NotificationPanel.vue'
import { useNotification } from './composables/useNotification'
import { usePluginLoader, handlePluginChanged } from './composables/usePluginLoader'
import PluginView from './components/plugin/PluginView.vue'
import { apiCreateTab, apiCloseTab, apiClosePane, apiActivatePane, apiListTabs } from './composables/useTabApi'
import { Settings, Bell, Monitor, Plus, X, Star, AppWindow, Radar } from 'lucide-vue-next'
import { formatCloseTabMessage } from './composables/formatCloseTabMessage'
import LoginPage from './components/LoginPage.vue'
import SetupPage from './components/SetupPage.vue'

const tabs = ref<Tab[]>([])
const activePaneId = ref<string | null>(null)
const syncConnected = ref(false)
const kbVisible = ref(false)
let linkJustActivated = false
const settingsOpen = ref(false)
const authenticated = ref(hasAuthToken())
const needsSetup = ref(false)
const paletteRef = ref<InstanceType<typeof CommandPalette>>()
const previewPanelRef = ref<InstanceType<typeof PreviewPanel> | null>(null)

function setPreviewPanelRef(el: any) {
  previewPanelRef.value = el
}
const bookmarksRef = ref<InstanceType<typeof CommandBookmarks>>()
const serverListRef = ref<InstanceType<typeof ServerList>>()

const { settings: appSettings, loadSettings } = useSettings()
const { t } = useI18n()
const { getBinding, formatBinding } = useKeybindings()
const notif = useNotification()
const { loadedPlugins, loadAll, getPluginContext, pluginList, allCommands } = usePluginLoader()

const isLandscape = ref(window.innerWidth > window.innerHeight)

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
  { immediate: true },
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
    document.title = title || 'Terminal'
  },
  { immediate: true },
)

// Track effective active pane for Tauri WKWebView input guard
watch(
  [activePaneId, tabs],
  () => {
    const tab = tabs.value.find(t => t.paneId === activePaneId.value)
    const paneId = (tab?.type === 'terminal') ? tab.activePaneId : null
    setActivePaneId(paneId)
  },
  { immediate: true, deep: true },
)

const termRefs = shallowReactive<Record<string, InstanceType<typeof TerminalPane>>>({})
const outputListeners = new Set<(paneId: string, data: string) => void>()

const splitPane = useSplitPane({
  tabs,
  activePaneId,
  termRefs,
  genPaneId,
  sendSync,
  sendLayoutSync,
  persist,
})

function registerTermRef(paneId: string, el: InstanceType<typeof TerminalPane> | null) {
  if (el) {
    termRefs[paneId] = el
    el.setOutputListener((data: string) => {
      outputListeners.forEach(cb => cb(paneId, data))
    })
  }
}

let syncWs: WebSocket | null = null
let suppressSync = false
let viewportRefitTimer = 0

function onViewportResize() {
  clearTimeout(viewportRefitTimer)
  viewportRefitTimer = window.setTimeout(() => {
    if (!activePaneId.value) return
    const tab = tabs.value.find(t => t.paneId === activePaneId.value)
    if (!tab || tab.type !== 'terminal') return
    for (const leaf of getAllLeaves(tab.layout)) {
      termRefs[leaf.paneId]?.fit()
    }
  }, 100)
}

const tabList = computed<TabInfo[]>(() =>
  tabs.value.map((t) => ({
    paneId: t.paneId,
    title: t.type === 'terminal'
      ? (findLeaf(t.layout, t.activePaneId)?.title ?? 'Terminal')
      : t.title,
  })),
)
const activeTabType = computed(() => {
  const tab = tabs.value.find((t) => t.paneId === activePaneId.value)
  return tab?.type ?? 'terminal'
})
const isBroadcastActive = computed(() => {
  const tab = tabs.value.find(t => t.paneId === activePaneId.value)
  return tab?.type === 'terminal' && tab.broadcastMode && getAllLeaves(tab.layout).length > 1
})
const canBroadcast = computed(() => {
  const tab = tabs.value.find(t => t.paneId === activePaneId.value)
  return tab?.type === 'terminal' && getAllLeaves(tab.layout).length > 1
})
const paneLabels = computed(() => {
  const m: Record<string, string> = {}
  for (const t of tabs.value) {
    if (t.type === 'terminal') {
      for (const leaf of getAllLeaves(t.layout)) {
        m[leaf.paneId] = leaf.title
      }
    } else {
      m[t.paneId] = t.title
    }
  }
  return m
})

function genPaneId(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16)
  })
}

/** Stable key for tab v-for — uses the first leaf paneId which never changes */
function tabKey(tab: Tab): string {
  if (tab.type !== 'terminal') return tab.paneId
  const leaf = findFirstLeaf(tab.layout)
  return leaf ? leaf.paneId : tab.paneId
}

function sendSync(msg: SyncClientMsg) {
  if (syncWs && syncWs.readyState === WebSocket.OPEN && !suppressSync) {
    syncWs.send(JSON.stringify(msg))
  }
}

function sendLayoutSync(tabPaneId: string, layout: any, activePaneIdVal: string) {
  sendSync({ type: 'update_layout', pane_id: tabPaneId, layout, active_pane_id: activePaneIdVal })
}

function onDividerDragEnd(tab: Tab) {
  if (tab.type === 'terminal') {
    persist()
    sendLayoutSync(tab.paneId, tab.layout, tab.activePaneId)
  }
}

function persist() {
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
      }
    }
    return {
      type: t.type,
      paneId: t.paneId,
      title: t.title,
      pluginId: t.pluginId,
    }
  })
  const activeIdx = tabs.value.findIndex((t) => t.paneId === activePaneId.value)
  localStorage.setItem('dinotty_tabs', JSON.stringify({ tabs: state, activeIdx }))
}

function getSavedTab(paneId: string): any {
  try {
    const raw = localStorage.getItem('dinotty_tabs')
    if (!raw) return null
    const { tabs: savedTabs } = JSON.parse(raw)
    // Search by tab paneId first
    const direct = savedTabs?.find((t: any) => t.paneId === paneId)
    if (direct) return direct
    // Search within layouts for leaf paneId
    return savedTabs?.find((t: any) => {
      if (!t.layout) return false
      const leaves = getAllLeaves(t.layout)
      return leaves.some(l => l.paneId === paneId)
    }) ?? null
  } catch {
    return null
  }
}

function getSavedTitle(paneId: string): string | null {
  return getSavedTab(paneId)?.title ?? null
}

const DEFAULT_PREVIEW_URL = ''

async function newTab() {
  try {
    const result = await apiCreateTab()
    // Dedup: broadcast_sync echoes back to sender — tab_created handler may
    // have already added this tab if the sync message arrived before the
    // REST response.
    if (tabs.value.some(t => t.type === 'terminal' && t.paneId === result.tab_id)) {
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
      broadcastMode: false,
      broadcastActivity: 0,
      previewVisible: false,
      previewAddress: '',
      previewUrl: '',
      previewKind: 'web',
    })
    activePaneId.value = result.tab_id
    persist()
    nextTick(() => focusActive())
  } catch (e) {
    console.error('Failed to create tab:', e)
  }
}

function onNewMenuAction(type: 'new-tab' | 'split-h' | 'split-v' | 'broadcast') {
  switch (type) {
    case 'new-tab': return newTab()
    case 'split-h': return splitPane.splitPane('horizontal')
    case 'split-v': return splitPane.splitPane('vertical')
    case 'broadcast': return splitPane.toggleBroadcast()
  }
}

async function activateTab(tabId: string) {
  activePaneId.value = tabId
  const tab = tabs.value.find(t => t.paneId === tabId)
  if (tab?.type === 'terminal') {
    notif.clearPaneUnread(tab.activePaneId)
    try {
      await apiActivatePane(tab.paneId, tab.activePaneId)
    } catch (e) {
      console.error('Failed to activate pane:', e)
    }
  }
  persist()
  nextTick(() => focusActive())
}

function reorderTab(fromId: string, toId: string) {
  const fromIdx = tabs.value.findIndex((t) => t.paneId === fromId)
  const toIdx = tabs.value.findIndex((t) => t.paneId === toId)
  if (fromIdx === -1 || toIdx === -1) return
  const [moved] = tabs.value.splice(fromIdx, 1)
  tabs.value.splice(toIdx, 0, moved)
  persist()
}

async function onClosePane(tabId: string, paneId: string) {
  const tab = tabs.value.find(t => t.paneId === tabId)
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
  pendingCloseTabId.value = tabId
  pendingClosePaneId.value = paneId
  confirmCloseVisible.value = true
}

async function requestCloseTab(tabId: string) {
  const tab = tabs.value.find(t => t.paneId === tabId)
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
  pendingCloseTabId.value = tabId
  confirmCloseVisible.value = true
}

const pendingCloseTabId = ref<string | null>(null)
const pendingClosePaneId = ref<string | null>(null)
const confirmCloseVisible = ref(false)

const pendingCloseTabTitle = computed(() => {
  const id = pendingCloseTabId.value
  if (!id) return ''
  const tab = tabs.value.find(t => t.paneId === id)
  if (!tab) return ''
  if (tab.type === 'terminal') {
    const leaf = findFirstLeaf(tab.layout)
    return leaf?.title ?? 'Terminal'
  }
  return tab.title
})

const pendingCloseMessage = computed(() => {
  if (!pendingCloseTabTitle.value) return t('confirm.closeTabMessage')
  // t() does not support {var} interpolation; use extracted helper (Design Doc E9 fallback)
  return formatCloseTabMessage(
    t('confirm.closeTabMessage'),
    pendingCloseTabTitle.value,
    appSettings.locale === 'en' ? 'en' : 'zh',
  )
})

async function onConfirmClose() {
  const tabId = pendingCloseTabId.value
  const paneId = pendingClosePaneId.value

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

  pendingCloseTabId.value = null
  pendingClosePaneId.value = null
  confirmCloseVisible.value = false
}

function onCancelClose() {
  pendingCloseTabId.value = null
  pendingClosePaneId.value = null
  confirmCloseVisible.value = false
}

async function closeTab(tabId: string) {
  const tab = tabs.value.find(t => t.paneId === tabId)
  if (!tab) return

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
  const tab = tabs.value.find(t => t.paneId === activePaneId.value)
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
  const tab = tabs.value.find(t => {
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
  const tab = tabs.value.find(t => {
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

function openPreview() {
  const tabId = activePaneId.value
  if (!tabId) return
  const tab = tabs.value.find((t) => t.paneId === tabId)
  if (!tab || tab.type !== 'terminal') return
  if (!tab.previewAddress.trim()) {
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
  const tab = tabs.value.find(t => t.paneId === activePaneId.value)
  if (!tab || tab.type !== 'terminal') return null
  const paneId = tab.activePaneId
  if (!termRefs[paneId]) return null
  return (data: string) => termRefs[paneId]?.sendData(data)
}

async function onLoginSuccess() {
  authenticated.value = true
  await getApiBase()
  await loadSettings()
  void loadAll()
  void connectSyncWS()
  initMonitorHistory()
}

function shellEscapePath(path: string): string {
  return /[\s'"\\()&;|<>$!`{}[\]#?*~]/.test(path)
    ? `'${path.replace(/'/g, "'\\''")}'`
    : path
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
    if (linkJustActivated) { linkJustActivated = false; return }
    const tab = tabs.value.find(t => t.paneId === activePaneId.value)
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

function onServerConnect(host: string, port: number) {
  const proto = location.protocol
  window.location.href = `${proto}//${host}:${port}/`
}

function openPlugin(pluginId: string) {
  try {
    const paneId = `plugin:${pluginId}`
    const existing = tabs.value.find(t => t.paneId === paneId)
    if (existing) {
      activateTab(paneId)
      return
    }

    const plugin = loadedPlugins.get(pluginId)
    if (!plugin || plugin.state !== 'active') {
      const msg = plugin?.state === 'error'
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
    }
    tabs.value.push(newTab)
    activePaneId.value = paneId
    sendSync({ type: 'activate_tab', pane_id: paneId })
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
    const tab = tabs.value.find(t => t.paneId === activePaneId.value)
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
    return { dispose() { outputListeners.delete(callback) } }
  },
  async createTab(command?: string) {
    newTab()
    const tab = tabs.value.find(t => t.paneId === activePaneId.value)
    return tab?.type === 'terminal' ? tab.activePaneId : ''
  },
}
window.__dinotty_ui_notify = (message: string, level?: 'info' | 'warn' | 'error') => {
  // Use notification system or console
  if (level === 'error') console.error('[plugin]', message)
  else console.log('[plugin]', message)
}
window.__dinotty_ui_confirm = async (message: string) => window.confirm(message)
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
          const tab = tabs.value.find(t => t.paneId === activePaneId.value)
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
  ]

  // Plugin-registered commands
  for (const cmd of allCommands.value) {
    const plugin = loadedPlugins.get(cmd.pluginId)
    // Look up title from manifest commands list
    const cmdDef = plugin?.manifest.commands?.find(c => c.id === cmd.id)
    base.push({
      icon: '◈',
      title: cmdDef?.title || cmd.id,
      subtitle: plugin?.manifest.name,
      action: cmd.handler,
    })
  }

  // Plugin open commands (skip if plugin already registered its own commands)
  const pluginsWithCommands = new Set(allCommands.value.map(c => c.pluginId))
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
  if (!cmd) return

  const keyActions: Record<string, () => void> = {
    togglePalette: () => paletteRef.value?.toggle(),
    openBookmarks: () => bookmarksRef.value?.open(),
    newTab: () => newTab(),
    closeTab: async () => {
      if (!activePaneId.value) return
      const tab = tabs.value.find(t => t.paneId === activePaneId.value)
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
      const tab = tabs.value.find(t => t.paneId === activePaneId.value)
      if (!tab || tab.type !== 'terminal') return
      termRefs[tab.activePaneId]?.toggleSearch()
    },
  }

  for (const [id, action] of Object.entries(keyActions)) {
    const binding = getBinding(id)
    const eventKey = binding.key.length === 1 ? e.key.toLowerCase() : e.key
    if (eventKey === binding.key.toLowerCase() && e.shiftKey === binding.shift) {
      e.preventDefault()
      action()
      return
    }
  }

  // Cmd+Option+Arrow: focus neighbor pane (spatial navigation)
  if (e.altKey && !e.shiftKey) {
    const dirMap: Record<string, 'left' | 'right' | 'up' | 'down'> = {
      ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down',
    }
    if (dirMap[e.key]) {
      e.preventDefault()
      splitPane.focusNeighbor(dirMap[e.key])
      return
    }
  }

  // Cmd+Option+Shift+Arrow: keyboard resize
  if (e.altKey && e.shiftKey) {
    const dirMap: Record<string, 'left' | 'right' | 'up' | 'down'> = {
      ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down',
    }
    if (dirMap[e.key]) {
      e.preventDefault()
      splitPane.keyboardResize(dirMap[e.key])
      return
    }
  }

  if (!e.shiftKey && e.key >= '1' && e.key <= '9') {
    const idx = parseInt(e.key) - 1
    if (idx < tabs.value.length) {
      e.preventDefault()
      activateTab(tabs.value[idx].paneId)
    }
  }
}

let syncReconnectDelay = 1000

async function connectSyncWS() {
  let url: string
  if (isTauri()) {
    const origin = await getApiBase()
    url = `${origin.replace(/^http/, 'ws')}/ws/sync`
  } else {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
    url = `${proto}//${location.host}/ws/sync`
  }
  const wsUrl = wsUrlWithToken(url)
  if (wsUrl === url && hasAuthToken()) {
    // Token exists in localStorage but wsUrlWithToken didn't append it — should not happen
    console.warn('[sync] token available but not appended to WS URL')
  }
  syncWs = new WebSocket(wsUrl)

  syncWs.onopen = () => {
    console.log('[sync] connected')
    syncConnected.value = true
    syncReconnectDelay = 1000
  }

  syncWs.onmessage = (e) => {
    let msg: SyncServerMsg
    try {
      msg = JSON.parse(e.data)
    } catch {
      return
    }

    if (msg.type === 'tab_list') {
      // Collect all local leaf paneIds and tab-level paneIds
      const localLeafIds = new Set<string>()
      const localTabIds = new Set<string>()
      for (const t of tabs.value) {
        if (t.type === 'terminal') {
          localTabIds.add(t.paneId)
          for (const leaf of getAllLeaves(t.layout)) {
            localLeafIds.add(leaf.paneId)
          }
        }
      }

      // Create tabs for any server paneIds we don't have locally
      for (const tab of msg.tabs) {
        if (!localLeafIds.has(tab.pane_id) && !localTabIds.has(tab.pane_id) && !localTabIds.has(tab.tab_id)) {
          // Prefer server layout, then localStorage, then default single leaf
          const serverLayout = tab.layout ?? null
          const saved = !serverLayout ? getSavedTab(tab.pane_id) : null
          const migrated = saved ? migrateTab(saved) : null
          tabs.value.push({
            type: 'terminal',
            paneId: tab.tab_id,
            layout: ensureSplitRoot(serverLayout ?? migrated?.layout ?? { type: 'leaf', paneId: tab.pane_id, title: 'Terminal', ratio: 1, zoomed: false }),
            activePaneId: tab.active_pane_id ?? migrated?.activePaneId ?? tab.pane_id,
            broadcastMode: false,
            broadcastActivity: 0,
            previewVisible: migrated?.previewVisible ?? false,
            previewAddress: migrated?.previewAddress ?? '',
            previewUrl: migrated?.previewUrl ?? '',
            previewKind: migrated?.previewKind ?? 'web',
          })
        }
      }

      // Restore plugin tabs from localStorage
      try {
        const raw = localStorage.getItem('dinotty_tabs')
        if (raw) {
          const { tabs: savedTabs } = JSON.parse(raw)
          for (const st of savedTabs) {
            if (st.type === 'plugin' && !tabs.value.some(t => t.paneId === st.paneId)) {
              tabs.value.push({
                type: 'plugin',
                paneId: st.paneId,
                title: st.title || st.pluginId,
                pluginId: st.pluginId,
              })
            }
          }
        }
      } catch { /* noop */ }

      // Remove terminal tabs whose leaf paneIds are no longer on the server
      const serverTabIds = new Set(msg.tabs.map((t) => t.tab_id))
      const serverLeafIds = new Set(msg.tabs.flatMap((t) => t.layout ? getAllLeaves(t.layout).map(l => l.paneId) : []))
      tabs.value = tabs.value.filter((t) => {
        if (t.type === 'plugin') return true
        // Keep tab if it matches a server tab by tabId or leaf paneId, or if at least one leaf is in a server layout
        return serverTabIds.has(t.paneId) || getAllLeaves(t.layout).some(l => serverLeafIds.has(l.paneId))
      })

      if (msg.active_pane_id) {
        const cur = tabs.value.find(t => t.paneId === activePaneId.value)
        if (!cur || cur.type !== 'plugin') {
          // Find the tab containing this leaf paneId
          const targetTab = tabs.value.find(t => {
            if (t.type !== 'terminal') return false
            return !!findLeaf(t.layout, msg.active_pane_id!)
          }) as TerminalTab | undefined
          if (targetTab) {
            suppressSync = true
            targetTab.activePaneId = msg.active_pane_id
            activePaneId.value = targetTab.paneId
            suppressSync = false
          }
        }
      }

      if (msg.tabs.length === 0 && tabs.value.length === 0) {
        newTab()
      }

      // Fallback: ensure at least one tab is active after sync
      if (!activePaneId.value || !tabs.value.some(t => t.paneId === activePaneId.value)) {
        if (tabs.value.length > 0) {
          activePaneId.value = tabs.value[0].paneId
        }
      }

      persist()
      nextTick(() => focusActive())
    } else if (msg.type === 'tab_created') {
      // Check if this tab already exists locally (either our own or from tab_list)
      const exists = tabs.value.some(t => {
        if (t.type !== 'terminal') return false
        return t.paneId === msg.tab_id || !!findLeaf(t.layout, msg.pane_id)
      })
      if (!exists) {
        const layout = msg.layout ? ensureSplitRoot(msg.layout) : ensureSplitRoot({ type: 'leaf', paneId: msg.pane_id, title: 'Terminal', ratio: 1, zoomed: false })
        tabs.value.push({
          type: 'terminal',
          paneId: msg.tab_id,
          layout,
          activePaneId: msg.pane_id,
          broadcastMode: false,
          broadcastActivity: 0,
          previewVisible: false,
          previewAddress: '',
          previewUrl: '',
          previewKind: 'web',
        })
        // Activate the new tab so it becomes visible immediately.
        // broadcast_sync echoes to the sender — without this, the sender's
        // own tab stays hidden until the REST response arrives.
        activePaneId.value = msg.tab_id
        persist()
        nextTick(() => focusActive())
      }
    } else if (msg.type === 'tab_closed') {
      // Find the tab by its paneId (server's tab_id), or by leaf paneId in layouts
      let tabIdx = tabs.value.findIndex(t =>
        t.type === 'terminal' && t.paneId === msg.pane_id,
      )
      if (tabIdx === -1) {
        // Fallback: search by leaf paneId in layouts (handles PTY exit case)
        tabIdx = tabs.value.findIndex(t =>
          t.type === 'terminal' && !!findLeaf(t.layout, msg.pane_id),
        )
      }
      if (tabIdx !== -1) {
        const tab = tabs.value[tabIdx] as TerminalTab
        for (const leaf of getAllLeaves(tab.layout)) {
          delete termRefs[leaf.paneId]
        }
        tabs.value.splice(tabIdx, 1)
        if (tabs.value.length === 0) {
          newTab()
        } else if (activePaneId.value === tab.paneId) {
          activePaneId.value = tabs.value[Math.min(tabIdx, tabs.value.length - 1)].paneId
          persist()
          nextTick(() => focusActive())
        }
      }
    } else if (msg.type === 'tab_activated') {
      const cur = tabs.value.find(t => t.paneId === activePaneId.value)
      if (!cur || cur.type !== 'plugin') {
        // Find the tab containing this leaf paneId
        const targetTab = tabs.value.find(t => {
          if (t.type !== 'terminal') return false
          return !!findLeaf(t.layout, msg.pane_id)
        }) as TerminalTab | undefined
        if (targetTab && activePaneId.value !== targetTab.paneId) {
          suppressSync = true
          targetTab.activePaneId = msg.pane_id
          activePaneId.value = targetTab.paneId
          suppressSync = false
        }
      }
    } else if (msg.type === 'layout_updated') {
      // Find the tab by tab-level paneId OR by shared leaf paneIds
      // (tab-level paneIds are client-local, so fall back to leaf matching)
      const targetTab = tabs.value.find(t => {
        if (t.type !== 'terminal') return false
        if (t.paneId === msg.pane_id) return true
        const incomingLeafIds = getAllLeaves(msg.layout).map((l: any) => l.paneId)
        const localLeafIds = getAllLeaves(t.layout).map(l => l.paneId)
        return incomingLeafIds.some((id: string) => localLeafIds.includes(id))
      }) as TerminalTab | undefined
      if (targetTab) {
        const incomingLeafIds = getAllLeaves(msg.layout).map((l: any) => l.paneId)
        const localLeafIds = getAllLeaves(targetTab.layout).map(l => l.paneId)
        const sameLeaves = incomingLeafIds.length === localLeafIds.length
          && incomingLeafIds.every((id: string) => localLeafIds.includes(id))

        suppressSync = true
        if (!sameLeaves) {
          // Structural change from another client — replace layout
          targetTab.layout = ensureSplitRoot(msg.layout)
        }
        targetTab.activePaneId = msg.active_pane_id
        suppressSync = false

        // Remove orphaned tabs whose sole leaf paneId is now inside this layout
        const updatedLeafIds = new Set(getAllLeaves(targetTab.layout).map(l => l.paneId))
        tabs.value = tabs.value.filter(t => {
          if (t.type !== 'terminal') return true
          if (t.paneId === targetTab.paneId) return true
          const leaves = getAllLeaves(t.layout)
          return !leaves.every(l => updatedLeafIds.has(l.paneId))
        })

        persist()
        nextTick(() => {
          getAllLeaves(targetTab.layout).forEach(l => termRefs[l.paneId]?.fit())
        })
      }
    } else if (msg.type === 'plugin_changed') {
      handlePluginChanged(msg.plugin_id, msg.change)
    }
  }

  syncWs.onclose = (e) => {
    console.warn('[sync] disconnected', e.code, e.reason)
    syncWs = null
    syncConnected.value = false
    setTimeout(connectSyncWS, syncReconnectDelay)
    syncReconnectDelay = Math.min(syncReconnectDelay * 2, 30000)
  }

  syncWs.onerror = (e) => {
    console.error('[sync] error', e)
  }
}

function onOrientationChange() {
  isLandscape.value = window.innerWidth > window.innerHeight
}

const _focusHandler = () => {
  nextTick(() => focusActive())
}

onMounted(async () => {
  document.addEventListener('keydown', onGlobalKeydown)
  window.addEventListener('focus', _focusHandler)
  window.addEventListener('resize', onOrientationChange)
  window.addEventListener('terminal-insert-path', onTerminalInsertPath)
  window.addEventListener('terminal-insert-text', onTerminalInsertText)
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', onViewportResize)
  }
  if (authenticated.value) {
    await getApiBase()
    void connectSyncWS()
    initMonitorHistory()
    void loadAll()
    // Fallback: if sync WS hasn't delivered tabs within 3s, load via REST
    setTimeout(async () => {
      if (tabs.value.length === 0 && (!syncWs || syncWs.readyState !== WebSocket.OPEN)) {
        try {
          const data = await apiListTabs()
          for (const tab of data.tabs) {
            if (tabs.value.some(t => t.paneId === tab.tab_id)) continue
            const layout = tab.layout ? ensureSplitRoot(tab.layout) : ensureSplitRoot({ type: 'leaf', paneId: tab.pane_id, title: 'Terminal', ratio: 1, zoomed: false })
            tabs.value.push({
              type: 'terminal',
              paneId: tab.tab_id,
              layout,
              activePaneId: tab.active_pane_id ?? tab.pane_id,
              broadcastMode: false,
              broadcastActivity: 0,
              previewVisible: false,
              previewAddress: '',
              previewUrl: '',
              previewKind: 'web',
            })
          }
          if (data.active_pane_id) {
            const targetTab = tabs.value.find(t => {
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
    // No local token — check if server has one configured
    await getApiBase()
    const configured = await checkTokenConfigured()
    if (!configured) {
      // First-time setup: show setup page
      needsSetup.value = true
    }
  }
})

onBeforeUnmount(() => {
  document.removeEventListener('keydown', onGlobalKeydown)
  window.removeEventListener('focus', _focusHandler)
  window.removeEventListener('resize', onOrientationChange)
  window.removeEventListener('terminal-insert-path', onTerminalInsertPath)
  window.removeEventListener('terminal-insert-text', onTerminalInsertText)
  if (window.visualViewport) {
    window.visualViewport.removeEventListener('resize', onViewportResize)
  }
  if (syncWs) {
    syncWs.close()
    syncWs = null
  }
})
</script>

<style>
#app-root {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: calc(100% - var(--mkb-height, 0px));
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
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
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
