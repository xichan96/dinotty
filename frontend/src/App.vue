<template>
  <LoginPage v-if="!authenticated" @success="onLoginSuccess" />
  <div v-else id="app-root">
    <TabBar
      :tabs="tabList"
      :active-pane-id="activePaneId"
      :indicators="notif.unreadByPane"
      :plugins="pluginList"
      @activate="activateTab"
      @close="closeTab"
      @new="newTab"
      @reorder="reorderTab"
      @open-plugin="openPlugin"
    >
      <template #right>
        <button v-if="activeTabType === 'terminal'" type="button" class="tab-bar-icon-btn" :title="t('app.preview')" @click="openPreview" @touchend.prevent="openPreview"><PanelRight :size="16" /></button>
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
        :key="tab.paneId"
        class="tab-page"
        :class="{ active: tab.paneId === activePaneId, 'has-preview': tab.type === 'terminal' && tab.previewVisible, ['pos-' + resolvedPosition]: tab.type === 'terminal' && tab.previewVisible }"
      >
        <template v-if="tab.type === 'terminal'">
          <TerminalPane
            :ref="(el: any) => registerTermRef(tab.paneId, el)"
            :pane-id="tab.paneId"
            @title-change="(t: string) => onTitleChange(tab.paneId, t)"
            @file-click="onFileClick"
            @preview-link="(url: string) => onPreviewLink(tab.paneId, url)"
            @link-activate="onLinkActivate"
          />
          <PreviewPanel
            v-if="tab.paneId === activePaneId"
            :ref="setPreviewPanelRef"
            :visible="tab.previewVisible"
            :pane-id="tab.paneId"
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

    <CommandBookmarks ref="bookmarksRef" :get-send-fn="getSendFn" />

    <ServerList ref="serverListRef" @connect="onServerConnect" />

    <MobileKeyboard
      :visible="kbVisible"
      :pane-id="activePaneId ?? ''"
      :get-send-fn="getSendFn"
      @update:visible="(v: boolean) => kbVisible = v"
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
import CommandPalette from './components/command/CommandPalette.vue'
import type { Command } from './components/command/CommandPalette.vue'
import MobileKeyboard from './components/keyboard/MobileKeyboard.vue'
import KbToggleButton from './components/keyboard/KbToggleButton.vue'
import SettingsPanel from './components/SettingsPanel.vue'
import PreviewPanel from './components/preview/PreviewPanel.vue'
import CommandBookmarks from './components/command/CommandBookmarks.vue'
import ServerList from './components/ServerList.vue'
import StatusBar from './components/terminal/StatusBar.vue'
import type { SyncServerMsg, SyncClientMsg } from './types/protocol'
import { useSettings } from './composables/useSettings'
import { getApiBase, wsUrlWithToken, hasAuthToken } from './composables/apiBase'
import { isTauri } from './composables/useTransport'
import { isTouchDevice } from './composables/useTerminal'
import { useI18n } from './composables/useI18n'
import { isWebPreviewInput } from './utils/previewRouting'
import { initMonitorHistory } from './composables/useMonitor'
import NotificationPanel from './components/notification/NotificationPanel.vue'
import { useNotification } from './composables/useNotification'
import { usePluginLoader, handlePluginChanged } from './composables/usePluginLoader'
import PluginView from './components/plugin/PluginView.vue'
import { Settings, Bell, PanelRight, Plus, X, Star, AppWindow } from 'lucide-vue-next'
import LoginPage from './components/LoginPage.vue'

interface TerminalTab {
  type: 'terminal'
  paneId: string
  title: string
  previewVisible: boolean
  previewAddress: string
  previewUrl: string
  previewKind: 'web' | 'files'
}

interface PluginTab {
  type: 'plugin'
  paneId: string
  title: string
  pluginId: string
}

type Tab = TerminalTab | PluginTab

const tabs = ref<Tab[]>([])
const activePaneId = ref<string | null>(null)
const kbVisible = ref(false)
let linkJustActivated = false
const settingsOpen = ref(false)
const authenticated = ref(hasAuthToken())
const paletteRef = ref<InstanceType<typeof CommandPalette>>()
const previewPanelRef = ref<InstanceType<typeof PreviewPanel> | null>(null)

function setPreviewPanelRef(el: any) {
  previewPanelRef.value = el
}
const bookmarksRef = ref<InstanceType<typeof CommandBookmarks>>()
const serverListRef = ref<InstanceType<typeof ServerList>>()

const { settings: appSettings } = useSettings()
const { t } = useI18n()
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
    return tab?.title
  },
  (title) => {
    document.title = title || 'Terminal'
  },
  { immediate: true },
)

const termRefs = shallowReactive<Record<string, InstanceType<typeof TerminalPane>>>({})
const outputListeners = new Set<(paneId: string, data: string) => void>()

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
    if (activePaneId.value && termRefs[activePaneId.value]) {
      termRefs[activePaneId.value].fit()
    }
  }, 100)
}

const tabList = computed<TabInfo[]>(() =>
  tabs.value.map((t) => ({ paneId: t.paneId, title: t.title })),
)
const activeTabType = computed(() => {
  const tab = tabs.value.find((t) => t.paneId === activePaneId.value)
  return tab?.type ?? 'terminal'
})
const paneLabels = computed(() => {
  const m: Record<string, string> = {}
  for (const t of tabs.value) m[t.paneId] = t.title
  return m
})

function genPaneId(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16)
  })
}

function sendSync(msg: SyncClientMsg) {
  if (syncWs && syncWs.readyState === WebSocket.OPEN && !suppressSync) {
    syncWs.send(JSON.stringify(msg))
  }
}

function persist() {
  const state = tabs.value.map((t) => {
    if (t.type === 'terminal') {
      return {
        type: t.type,
        paneId: t.paneId,
        title: t.title,
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
    return savedTabs?.find((t: any) => t.paneId === paneId) ?? null
  } catch {
    return null
  }
}

function getSavedTitle(paneId: string): string | null {
  return getSavedTab(paneId)?.title ?? null
}

const DEFAULT_PREVIEW_URL = ''

function newTab() {
  const paneId = genPaneId()
  tabs.value.push({
    type: 'terminal',
    paneId,
    title: 'Terminal',
    previewVisible: false,
    previewAddress: '',
    previewUrl: '',
    previewKind: 'web',
  })
  activePaneId.value = paneId
  sendSync({ type: 'create_tab', pane_id: paneId })
  persist()
  nextTick(() => focusActive())
}

function activateTab(paneId: string) {
  activePaneId.value = paneId
  notif.clearPaneUnread(paneId)
  sendSync({ type: 'activate_tab', pane_id: paneId })
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

function closeTab(paneId: string) {
  if (tabs.value.length === 1) {
    const oldTab = tabs.value[0]
    sendSync({ type: 'close_tab', pane_id: oldTab.paneId })
    const newPaneId = genPaneId()
    delete termRefs[oldTab.paneId]
    // Replace with a fresh terminal tab
    tabs.value[0] = {
      type: 'terminal',
      paneId: newPaneId,
      title: 'Terminal',
      previewVisible: false,
      previewAddress: '',
      previewUrl: '',
      previewKind: 'web',
    }
    activePaneId.value = newPaneId
    sendSync({ type: 'create_tab', pane_id: newPaneId })
    persist()
    return
  }

  const idx = tabs.value.findIndex((t) => t.paneId === paneId)
  if (idx === -1) return

  delete termRefs[paneId]
  tabs.value.splice(idx, 1)

  if (activePaneId.value === paneId) {
    const newIdx = Math.min(idx, tabs.value.length - 1)
    activePaneId.value = tabs.value[newIdx].paneId
  }

  sendSync({ type: 'close_tab', pane_id: paneId })
  persist()
  nextTick(() => focusActive())
}

function focusActive() {
  if (activePaneId.value && termRefs[activePaneId.value]) {
    termRefs[activePaneId.value].focus()
    termRefs[activePaneId.value].fit()
  }
}

function onTitleChange(paneId: string, title: string) {
  const tab = tabs.value.find((t) => t.paneId === paneId)
  if (tab) {
    tab.title = title || 'Terminal'
    persist()
  }
}

function onPreviewLink(paneId: string, url: string) {
  const tab = tabs.value.find((t) => t.paneId === paneId)
  if (!tab || tab.type !== 'terminal') return
  tab.previewKind = 'web'
  tab.previewUrl = url
  tab.previewAddress = url
  tab.previewVisible = true
  persist()
}

function closePreview(paneId: string) {
  const tab = tabs.value.find((t) => t.paneId === paneId)
  if (tab && tab.type === 'terminal') {
    tab.previewVisible = false
    persist()
  }
}

function openPreview() {
  const pid = activePaneId.value
  if (!pid) return
  const tab = tabs.value.find((t) => t.paneId === pid)
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
  const pid = activePaneId.value
  if (!pid) return
  const tab = tabs.value.find((t) => t.paneId === pid)
  if (!tab || tab.type !== 'terminal') return
  tab.previewKind = 'files'
  tab.previewAddress = path
  tab.previewVisible = true
  persist()
  nextTick(() => previewPanelRef.value?.openFromPath(path))
}

function getSendFn(): ((data: string) => void) | null {
  if (!activePaneId.value || !termRefs[activePaneId.value]) return null
  return (data: string) => termRefs[activePaneId.value!]?.sendData(data)
}

function onLoginSuccess() {
  authenticated.value = true
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
    const term = activePaneId.value ? termRefs[activePaneId.value]?.getTerminal() : null
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
  console.log('[openPlugin] called with:', pluginId)
  try {
    const paneId = `plugin:${pluginId}`
    const existing = tabs.value.find(t => t.paneId === paneId)
    if (existing) {
      console.log('[openPlugin] tab already exists, activating')
      activateTab(paneId)
      return
    }

    const plugin = loadedPlugins.get(pluginId)
    console.log('[openPlugin] plugin lookup:', !!plugin, plugin?.state)
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
    console.log('[openPlugin] pushing tab:', newTab)
    tabs.value.push(newTab)
    activePaneId.value = paneId
    sendSync({ type: 'activate_tab', pane_id: paneId })
    persist()
    console.log('[openPlugin] done, tabs count:', tabs.value.length, 'activePaneId:', activePaneId.value)
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
    return activePaneId.value
  },
  listPanes() {
    return tabs.value
      .filter(t => t.type === 'terminal')
      .map(t => ({ id: t.paneId, title: t.title, active: t.paneId === activePaneId.value }))
  },
  onOutput(callback: (paneId: string, data: string) => void) {
    outputListeners.add(callback)
    return { dispose() { outputListeners.delete(callback) } }
  },
  async createTab(command?: string) {
    newTab()
    return activePaneId.value ?? ''
  },
}
window.__dinotty_ui_notify = (message: string, level?: 'info' | 'warn' | 'error') => {
  // Use notification system or console
  if (level === 'error') console.error('[plugin]', message)
  else console.log('[plugin]', message)
}
window.__dinotty_ui_confirm = async (message: string) => window.confirm(message)

const paletteCommands = computed<Command[]>(() => {
  const base: Command[] = [
    {
      icon: '＋',
      title: 'New Tab',
      subtitle: 'Open a new terminal tab',
      kbd: ['⌘', 'T'],
      action: () => newTab(),
    },
    {
      icon: '✕',
      title: 'Close Tab',
      subtitle: 'Close the current tab',
      kbd: ['⌘', 'W'],
      action: () => {
        if (activePaneId.value) closeTab(activePaneId.value)
      },
    },
    {
      icon: '★',
      title: 'Saved Commands',
      subtitle: 'Open bookmarked commands',
      action: () => bookmarksRef.value?.open(),
    },
    {
      icon: '⊡',
      title: 'Open Preview',
      subtitle: 'URL or path in the address bar',
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

  // Plugin open commands
  for (const p of pluginList.value) {
    if (p.state === 'active') {
      base.push({
        icon: '◈',
        title: `Open ${p.name}`,
        subtitle: 'Open plugin tab',
        action: () => openPlugin(p.id),
      })
    }
  }

  return base
})

function onGlobalKeydown(e: KeyboardEvent) {
  const cmd = e.metaKey || e.ctrlKey
  const shift = e.shiftKey
  if (!cmd) return

  if (e.key === 'k' && !shift) {
    e.preventDefault()
    paletteRef.value?.toggle()
    return
  }
  if (e.key === 't' && !shift) {
    e.preventDefault()
    newTab()
    return
  }
  if (e.key === 'w' && !shift) {
    e.preventDefault()
    if (activePaneId.value) closeTab(activePaneId.value)
    return
  }

  if (!shift && e.key >= '1' && e.key <= '9') {
    const idx = parseInt(e.key) - 1
    if (idx < tabs.value.length) {
      e.preventDefault()
      activateTab(tabs.value[idx].paneId)
    }
  }
}

async function connectSyncWS() {
  let url: string
  if (isTauri()) {
    const origin = await getApiBase()
    url = `${origin.replace(/^http/, 'ws')}/ws/sync`
  } else {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
    url = `${proto}//${location.host}/ws/sync`
  }
  syncWs = new WebSocket(wsUrlWithToken(url))

  syncWs.onmessage = (e) => {
    let msg: SyncServerMsg
    try {
      msg = JSON.parse(e.data)
    } catch {
      return
    }

    if (msg.type === 'tab_list') {
      const localPaneIds = new Set(tabs.value.map((t) => t.paneId))

      for (const tab of msg.tabs) {
        if (!localPaneIds.has(tab.pane_id)) {
          const saved = getSavedTab(tab.pane_id)
          tabs.value.push({
            type: 'terminal',
            paneId: tab.pane_id,
            title: saved?.title || 'Terminal',
            previewVisible: saved?.previewVisible || false,
            previewAddress: saved?.previewAddress || '',
            previewUrl: saved?.previewUrl || '',
            previewKind: saved?.previewKind || 'web',
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

      const serverIds = new Set(msg.tabs.map((t) => t.pane_id))
      tabs.value = tabs.value.filter((t) => t.type === 'plugin' || serverIds.has(t.paneId))

      if (msg.active_pane_id) {
        const cur = tabs.value.find(t => t.paneId === activePaneId.value)
        console.log('[tab_list] active_pane_id:', msg.active_pane_id, 'current:', activePaneId.value, 'curType:', cur?.type)
        if (!cur || cur.type !== 'plugin') {
          activePaneId.value = msg.active_pane_id
        } else {
          console.log('[tab_list] skipping override, plugin tab is active')
        }
      }

      if (msg.tabs.length === 0 && tabs.value.length === 0) {
        newTab()
      }

      persist()
    } else if (msg.type === 'tab_created') {
      if (!tabs.value.some((t) => t.paneId === msg.pane_id)) {
        tabs.value.push({
          type: 'terminal',
          paneId: msg.pane_id,
          title: 'Terminal',
          previewVisible: false,
          previewAddress: '',
          previewUrl: '',
          previewKind: 'web',
        })
      }
    } else if (msg.type === 'tab_closed') {
      const idx = tabs.value.findIndex((t) => t.paneId === msg.pane_id)
      if (idx !== -1 && tabs.value.length > 1) {
        delete termRefs[msg.pane_id]
        tabs.value.splice(idx, 1)
        if (activePaneId.value === msg.pane_id) {
          activePaneId.value = tabs.value[Math.min(idx, tabs.value.length - 1)].paneId
        }
        persist()
      }
    } else if (msg.type === 'tab_activated') {
      const cur = tabs.value.find(t => t.paneId === activePaneId.value)
      console.log('[tab_activated] pane_id:', msg.pane_id, 'current:', activePaneId.value, 'curType:', cur?.type)
      if (activePaneId.value !== msg.pane_id && (!cur || cur.type !== 'plugin')) {
        suppressSync = true
        activePaneId.value = msg.pane_id
        suppressSync = false
      }
    } else if (msg.type === 'plugin_changed') {
      console.log('[plugin_changed] plugin_id:', msg.plugin_id, 'change:', msg.change)
      handlePluginChanged(msg.plugin_id, msg.change)
    }
  }

  syncWs.onclose = () => {
    syncWs = null
    setTimeout(connectSyncWS, 2000)
  }

  syncWs.onerror = () => {}
}

function onOrientationChange() {
  isLandscape.value = window.innerWidth > window.innerHeight
}

onMounted(() => {
  document.addEventListener('keydown', onGlobalKeydown)
  window.addEventListener('resize', onOrientationChange)
  window.addEventListener('terminal-insert-path', onTerminalInsertPath)
  window.addEventListener('terminal-insert-text', onTerminalInsertText)
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', onViewportResize)
  }
  void connectSyncWS()
  initMonitorHistory()
  void loadAll()
})

onBeforeUnmount(() => {
  document.removeEventListener('keydown', onGlobalKeydown)
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
.tab-page.active.has-preview > .terminal-pane-container {
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
.tab-page.active.has-preview.pos-top > .terminal-pane-container {
  order: 1;
}
.tab-page.active.has-preview.pos-left > .preview-panel,
.tab-page.active.has-preview.pos-top > .preview-panel {
  order: 0;
}
.tab-page.active.has-preview.pos-top > .terminal-pane-container,
.tab-page.active.has-preview.pos-bottom > .terminal-pane-container {
  flex: 2;
}
.tab-page.active.has-preview.pos-top > .preview-panel,
.tab-page.active.has-preview.pos-bottom > .preview-panel {
  flex: 1;
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
