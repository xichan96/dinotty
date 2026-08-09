<template>
  <SetupPage v-if="!authenticated && needsSetup" @success="onLoginSuccess" />
  <LoginPage v-else-if="!authenticated && authProbe === 'done'" @success="onLoginSuccess" />
  <div v-else-if="!authenticated" class="auth-probe-screen">
    <RefreshCw :size="20" class="auth-probe-spinner" />
  </div>
  <div v-else id="app-root">
    <TabBar
      ref="tabBarRef"
      :tabs="visibleTabList"
      :active-pane-id="activePaneId"
      :indicators="tabIndicators"
      :plugins="pluginList"
      :can-broadcast="canBroadcast"
      :broadcast-active="isBroadcastActive"
      :is-mobile="isMobile"
      :current-tab-title="currentTabTitle"
      :current-tab-index="currentTabIndex"
      :active-workspace-abbr="activeWorkspaceAbbr"
      :active-workspace-color="activeWorkspaceColor"
      @activate="activateTab"
      @close="requestCloseTab"
      @close-tabs="onCloseTabsBulk"
      @action="onNewMenuAction"
      @reorder="reorderTab"
      @merge-tab-into-pane="onMergeTabIntoPane"
      @open-plugin="openPlugin"
      @rename="onRenameTab"
      @open-overview="openOverview"
      @save-as-template="openSaveTemplateDialog"
      @apply-template="templatePickerVisible = true"
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
        <div v-if="activeTabType === 'terminal'" class="preview-menu-wrap">
          <button
            type="button"
            class="tab-bar-icon-btn"
            :class="{ 'is-active': previewMenuOpen }"
            :title="t('app.preview')"
            @click="previewMenuOpen = !previewMenuOpen"
            @touchend.prevent="previewMenuOpen = !previewMenuOpen"
          >
            <Monitor :size="16" />
          </button>
          <div
            v-if="previewMenuOpen"
            class="preview-menu-backdrop"
            @click="previewMenuOpen = false"
            @contextmenu.prevent="previewMenuOpen = false"
          ></div>
          <div v-if="previewMenuOpen" class="preview-menu-dropdown" role="menu">
            <button
              type="button"
              class="preview-menu-item"
              role="menuitem"
              @click="previewMenuOpen = false; openOrFocusPreview('files')"
            >
              <FolderTree :size="14" />
              <span>{{ t('previewPanel.switchFiles') }}</span>
            </button>
            <button
              type="button"
              class="preview-menu-item"
              role="menuitem"
              @click="previewMenuOpen = false; openOrFocusPreview('web')"
            >
              <Globe :size="14" />
              <span>{{ t('previewPanel.switchWeb') }}</span>
            </button>
          </div>
        </div>
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
          v-if="notif.notifications.value.length > 0 || notif.unreadAttentionCount.value > 0"
          type="button"
          class="tab-bar-icon-btn notif-btn"
          :title="t('notification.title')"
          @click="notif.togglePanel()"
          @touchend.prevent="notif.togglePanel()"
        >
          <Bell :size="16" />
          <span v-if="notif.unreadAttentionCount.value > 0" class="notif-badge">{{
            notif.unreadAttentionCount.value > 9 ? '9+' : notif.unreadAttentionCount.value
          }}</span>
        </button>
      </template>
    </TabBar>

    <div
      id="tab-content"
      @mousedown.capture="onTabContentMouseDownCapture"
      @touchend="onTerminalTouch"
    >
      <div
        v-for="tab in tabs"
        :key="tabKey(tab)"
        class="tab-page"
        :class="{
          active: tab.paneId === activePaneId,
        }"
      >
        <template v-if="tab.type === 'terminal'">
          <SplitContainer
            :layout="tab.layout"
            :active-pane-id="tab.activePaneId"
            :broadcast-mode="tab.broadcastMode"
            :broadcast-activity="tab.broadcastActivity"
            :allow-close="getAllLeaves(tab.layout).length > 1"
            :tab-id="tab.paneId"
            :is-visible="tab.paneId === activePaneId"
            @register="registerTermRef"
            @title-change="onTitleChange"
            @shell-info="onShellInfo"
            @focus="(id: string) => splitPane.focusPane(id)"
            @close="(id: string) => onClosePane(tab.paneId, id)"
            @input="(id: string, data: string) => splitPane.onTerminalInput(id, data)"
            @file-click="onFileClick"
            @preview-link="onPreviewLink"
            @link-activate="onLinkActivate"
            @split-horizontal="splitPane.splitPane('horizontal')"
            @split-vertical="splitPane.splitPane('vertical')"
            @toggle-broadcast="splitPane.toggleBroadcast()"
            @new-local-terminal="
              splitPane.splitPane('horizontal', true, activeWorkspacePath ?? undefined)
            "
            @reorder="
              (src: string, tgt: string, pos: DropPosition) => splitPane.reorderPane(src, tgt, pos)
            "
            @drop-on-tab="
              (srcTab: string, srcPane: string, dstTab: string, pos: DropPosition) =>
                onDropOnTab(srcTab, srcPane, dstTab, pos)
            "
            @drop-extract="
              (srcTab: string, srcPane: string, idx: number) => onDropExtract(srcTab, srcPane, idx)
            "
            @divider-drag-end="onDividerDragEnd(tab)"
            @reconnect="onSshReconnect"
          />
        </template>
      </div>
    </div>

    <NotificationPanel :pane-labels="notificationPaneLabels" @goto-pane="revealPane" />

    <DropPreview />

    <StatusBar />

    <CommandPalette ref="paletteRef" :commands="paletteCommands" />

    <SettingsPanel
      :open="settingsOpen"
      @close="settingsOpen = false"
      @token-changed="onTokenChanged"
      @open-plugin="openPlugin"
      @open-about="settingsOpen = true"
    />

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

    <PromptModal
      :visible="promptState.visible"
      :title="promptState.title"
      :default-value="promptState.defaultValue"
      :placeholder="promptState.placeholder"
      :confirm-text="promptState.confirmText"
      :cancel-text="promptState.cancelText"
      @confirm="promptResolve"
      @cancel="promptCancel"
    />

    <WindowCloseDialog
      :visible="windowCloseConfirmVisible"
      :can-hide-to-tray="desktopLifecycle.capabilities.value.canHideToTray"
      :title="t('confirm.closeWindowTitle')"
      :message="
        desktopLifecycle.capabilities.value.canHideToTray
          ? t('confirm.closeWindowMessage')
          : t('confirm.closeWindowMessageNoTray')
      "
      :hide-text="t('confirm.closeWindowHide')"
      :quit-text="t('confirm.closeWindowQuit')"
      :cancel-text="t('confirm.closeWindowCancel')"
      @hide="onWindowCloseHide"
      @quit="onWindowCloseQuit"
      @cancel="onWindowCloseCancel"
    />

    <TrayVisibilityDialog
      :visible="trayVisibilityDialogVisible"
      :title="t('traySetup.title')"
      :message="t('traySetup.message')"
      :open-settings-text="t('traySetup.openSettings')"
      :confirm-text="t('traySetup.confirmAndHide')"
      :cancel-text="t('traySetup.cancel')"
      @open-settings="onOpenSystemTraySettings"
      @confirm="onTrayVisibilityConfirmed"
      @cancel="onTrayVisibilityCancel"
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
      v-if="effectiveMobileInputMode === 'builtin'"
      :visible="kbVisible && hasActiveTerminalLeaf"
      :pane-id="activeTerminalLeaf?.paneId ?? ''"
      :get-send-fn="getSendFn"
      @update:visible="onBuiltinKeyboardVisibilityChange"
      @bookmarks="bookmarksRef?.open()"
      @app-action="dispatchAppAction"
      @dismiss="onKeyboardDismiss"
      @typing-change="(v: boolean) => (kbTyping = v)"
    />

    <SystemKeyboardToolbar
      v-if="effectiveMobileInputMode === 'system'"
      :visible="kbVisible && hasActiveTerminalLeaf"
      :pane-id="activeTerminalLeaf?.paneId ?? ''"
      :get-send-fn="getSendFn"
      :action-open="systemActionKeyboardOpen"
      @update:action-open="onSystemActionKeyboardChange"
      @modifier-change="onSystemModifierChange"
      @bookmarks="bookmarksRef?.open()"
      @app-action="dispatchAppAction"
      @dismiss="dismissTerminalKeyboard"
      @focus-xterm="focusSystemInput"
      @paste-text="pasteActiveTerminal"
    />

    <MobileInputGuide
      :visible="mobileInputGuideVisible"
      @choose="onMobileInputGuideChoose"
      @close="mobileInputGuideVisible = false"
    />

    <KbToggleButton
      v-show="
        (appSettings.show_virtual_keyboard || hasOpenGuard(appSettings.keyboard_guard_mode)) &&
        hasActiveTerminalLeaf &&
        !kbVisible &&
        !mobileInputGuideVisible
      "
      :visible="kbVisible"
      @toggle="toggleTerminalKeyboard"
    />

    <WorkspaceOverview
      :visible="overviewOpen"
      :active-pane-id="activePaneId"
      :term-refs="termRefs"
      :indicators="tabIndicators"
      @close="closeOverview"
      @activate="onOverviewActivate"
      @close-tab="onOverviewCloseTab"
      @close-tabs="onCloseTabsBulk"
      @new-tab="onOverviewNewTab"
      @new-tab-ssh="onOverviewNewTabSsh"
      @rename-tab="onOverviewRenameTab"
    />

    <MultiSelectPicker
      :visible="cursorPickerVisible"
      :title="t('palette.addCursors')"
      :items="cursorPickerItems"
      @confirm="onCursorPickerConfirm"
      @cancel="cursorPickerVisible = false"
    />

    <SaveTemplateDialog
      :visible="saveTemplateVisible"
      :source-tab-id="saveTemplateSourceTabId"
      :source-layout="saveTemplateSourceLayout"
      @close="saveTemplateVisible = false"
      @saved="onTemplateSaved"
    />

    <TemplatePicker
      :visible="templatePickerVisible"
      :workspace-id="activeWorkspaceId"
      @close="templatePickerVisible = false"
      @apply="onTemplateApplied"
    />
  </div>
</template>

<script setup lang="ts">
import {
  ref,
  reactive,
  shallowReactive,
  shallowRef,
  computed,
  watch,
  onMounted,
  onBeforeUnmount,
  nextTick,
  h,
} from 'vue'
import TabBar from './components/terminal/TabBar.vue'
import type { TabInfo } from './components/terminal/TabBar.vue'
import TerminalPane from './components/terminal/TerminalPane.vue'
import SplitContainer from './components/split/SplitContainer.vue'
import DropPreview from './components/split/DropPreview.vue'
import CommandPalette from './components/command/CommandPalette.vue'
import type { Command } from './components/command/CommandPalette.vue'
import MobileKeyboard from './components/keyboard/MobileKeyboard.vue'
import KbToggleButton from './components/keyboard/KbToggleButton.vue'
import MobileInputGuide from './components/keyboard/MobileInputGuide.vue'
import SystemKeyboardToolbar from './components/keyboard/SystemKeyboardToolbar.vue'
import SettingsPanel from './components/SettingsPanel.vue'
import ConfirmCloseDialog from './components/ui/ConfirmCloseDialog.vue'
import ConfirmModal from './components/ui/ConfirmModal.vue'
import WindowCloseDialog from './components/ui/WindowCloseDialog.vue'
import TrayVisibilityDialog from './components/ui/TrayVisibilityDialog.vue'
import { confirmState, uiConfirm, confirmResolve, confirmCancel } from './composables/useConfirm'
import PromptModal from './components/ui/PromptModal.vue'
import MultiSelectPicker from './components/ui/MultiSelectPicker.vue'
import SaveTemplateDialog from './components/ui/SaveTemplateDialog.vue'
import TemplatePicker from './components/ui/TemplatePicker.vue'
import { promptState, promptResolve, promptCancel } from './composables/usePrompt'
import CommandBookmarks from './components/command/CommandBookmarks.vue'
import ServerList from './components/ServerList.vue'
import SshHostsPanel from './components/ssh/SshHostsPanel.vue'
import SshAuthPromptDialog from './components/ssh/SshAuthPromptDialog.vue'
import StatusBar from './components/terminal/StatusBar.vue'
import type { Tab, TerminalTab, PluginTab, PaneLayout, LeafPane, DropPosition } from './types/pane'
import { getAllLeaves, findLeaf, findFirstLeaf, ensureSplitRoot, paneKind } from './types/pane'
import { createFrozenSendFn, type SendDataFn } from './utils/frozenSend'
import { initializePaneMru } from './types/paneMru'
import { setTauriWindowTitle, updateDocumentTitle } from './utils/windowTitle'
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
import {
  isKbTypingLocked,
  isTouchDevice,
  applyAfterTerminalComposition,
  configureAllMobileInputTextareas,
  setActivePaneId,
  setKbTypingLock,
} from './composables/useTerminal'
import { useI18n } from './composables/useI18n'
import { keyEventMatchesBinding, useKeybindings } from './composables/useKeybindings'
import { usePluginNotifyBridge } from './composables/usePluginNotifyBridge'
import { useSshAuth } from './composables/useSshAuth'
import { useCursorPicker } from './composables/useCursorPicker'
import { useOverviewCallbacks } from './composables/useOverviewCallbacks'
import { useTabPersistence } from './composables/useTabPersistence'
import { useDesktopLifecycle } from './composables/useDesktopLifecycle'
import { useViewportResize } from './composables/useViewportResize'
import { useDeviceKeyboardSettings } from './composables/useDeviceKeyboardSettings'
import type { MobileInputMode } from './composables/useSettings'
import { useKeyboardOverlap } from './composables/useKeyboardOverlap'
import { usePluginLauncher } from './composables/usePluginLauncher'
import { useSshConnectFlow } from './composables/useSshConnectFlow'
import { useTabLifecycle } from './composables/useTabLifecycle'
import { setMcSender } from './composables/useMissionControlState'
import { clearFileWorkspaceState } from './composables/useFileWorkspaceState'
import { useSplitPane } from './composables/useSplitPane'
import { useSuperviseTabs } from './composables/useSuperviseTabs'
import { useSyncWebSocket } from './composables/useSyncWebSocket'
import type { SyncClientMsg } from './types/protocol'
import { isWindowsClient } from './utils/clientPlatform'
import { nextRevealNavGen, currentRevealNavGen } from './utils/navGen'
import { pickSuccessorTab } from './utils/tabSuccessor'
import { workspaceIdFromPaneId } from './utils/pluginPaneId'
import { initMonitorHistory } from './composables/useMonitor'
import NotificationPanel from './components/notification/NotificationPanel.vue'
import { POSITION, useToast } from 'vue-toastification'
import {
  useNotification,
  pushNotification,
  setToastInstance,
  setActiveReadContext,
  evaluateActiveRead,
  aggregateSeverity,
  getNotificationClientId,
  mintNotificationRequestId,
  disposeNotificationPresentationScheduler,
} from './composables/useNotification'
import { useNotificationPresentation } from './composables/useNotificationPresentation'
import { getIsAppForeground, onAppForegroundGain } from './composables/useAppForeground'
import { getEffectiveSuperviseReload } from './composables/useDeviceSuperviseReload'
import { usePluginLoader } from './composables/usePluginLoader'
import PluginView from './components/plugin/PluginView.vue'
import {
  apiCreateTab,
  apiCreateSshTab,
  apiCloseTab,
  apiClosePane,
  apiActivatePane,
  apiListTabs,
  apiCreatePluginTab,
} from './composables/useTabApi'
import {
  Settings,
  Bell,
  Monitor,
  Plus,
  X,
  Star,
  AppWindow,
  Radar,
  RefreshCw,
  FolderTree,
  Globe,
} from 'lucide-vue-next'
import WorkspaceOverview from './components/overview/WorkspaceOverview.vue'
import { refreshPluginPreview, invalidatePluginPreview } from './composables/useTabPreview'
import { useIsMobile } from './composables/useIsMobile'
import { useWorkspaces, DEFAULT_WORKSPACE_ID } from './composables/useWorkspaces'
// formatCloseTabMessage moved to ConfirmCloseDialog component
import LoginPage from './components/LoginPage.vue'
import SetupPage from './components/SetupPage.vue'
import { storeToRefs } from 'pinia'
import { useSessionStore } from './stores/sessionStore'
import { useUiStore } from './stores/uiStore'
import { useSettingsStore } from './stores/settingsStore'
import { shellEscapePath } from './utils/shell'
import { buildRunCodeCommand } from './utils/runCodeCommand'
import { resolveAbbr, resolveColor } from './utils/workspaceIcon'
import { getTerminalSequenceAppAction, isDispatchableAppAction } from './utils/appActionCatalog'
import { createHostClipboardPasteController } from './utils/hostClipboardPaste'
import { readHostClipboard } from './utils/clipboard'
import { hasCollapseGuard, hasOpenGuard } from './utils/keyboardGuardMode'
import type { AppActionOptions } from './components/keyboard/mkbTypes'
import { canFixShellErrorInSettings, shellErrorMessage } from './utils/shellError'

// ── Stores ──────────────────────────────────────────────────────
const session = useSessionStore()
const { tabs, activePaneId, tabList, activeTabType, activeTab, isBroadcastActive, canBroadcast } =
  storeToRefs(session)

const { persist, persistNow, dispose: disposePersist } = useTabPersistence({ tabs, activePaneId })

const ui = useUiStore()
const { syncConnected, kbVisible, settingsOpen, authenticated, authProbe, needsSetup } =
  storeToRefs(ui)

const settingsStore = useSettingsStore()
const appSettings = settingsStore.settings

const desktopLifecycle = useDesktopLifecycle({
  persistNow,
  saveSettings: () => settingsStore.save(),
})

const windowCloseConfirmVisible = ref(false)
const trayVisibilityDialogVisible = ref(false)
const previewMenuOpen = ref(false)

let linkJustActivated = false
let scrollGestureDetected = false
let scrollGestureTimer = 0
// Sticky typing mode: true while the mobile keyboard's text input is focused.
const kbTyping = ref(false)
const terminalImeFocused = ref(false)
const mobileInputGuideVisible = ref(false)
const systemActionKeyboardOpen = ref(false)
const { imeKeyboardOverlapPx } = useDeviceKeyboardSettings()
const effectiveMobileInputMode = computed<MobileInputMode>(
  () => appSettings.mobile_input_mode ?? 'builtin'
)
const activeTerminalLeaf = computed(() => {
  const tab = activeTab.value
  if (!tab || tab.type !== 'terminal') return null
  const leaf = findLeaf(tab.layout, tab.activePaneId)
  return leaf && paneKind(leaf) === 'terminal' ? leaf : null
})
const hasActiveTerminalLeaf = computed(() => activeTerminalLeaf.value !== null)

// ── Template refs (purely UI concerns) ─────────────────────────
const paletteRef = ref<InstanceType<typeof CommandPalette>>()
const tabBarRef = ref<InstanceType<typeof TabBar> | null>(null)
const bookmarksRef = ref<InstanceType<typeof CommandBookmarks>>()
const serverListRef = ref<InstanceType<typeof ServerList>>()
const sshPanelRef = ref<InstanceType<typeof SshHostsPanel>>()
const { t } = useI18n()
const { getBinding, formatBinding } = useKeybindings()
const notif = useNotification()
const presentationSettings = useNotificationPresentation().settings
const { supervise } = useSuperviseTabs()
const toast = useToast()

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

const hostClipboardPaste = createHostClipboardPasteController({
  fetchText: async () => {
    const text = await readHostClipboard()
    if (text === null) throw new Error('clipboard unavailable')
    return text
  },
  paste: (text, autoEnter) => {
    getActiveTerminalRef()?.pasteFromClipboard(text, autoEnter, !systemActionKeyboardOpen.value)
  },
  clipboardEmpty: () =>
    toast.info(t('mobileKb.clipboardEmpty'), { position: POSITION.BOTTOM_CENTER }),
  pasteFailed: () => toast.error(t('mobileKb.pasteFailed'), { position: POSITION.BOTTOM_CENTER }),
  confirmMultiline: (lines) =>
    toast.info(t('mobileKb.confirmMultiline', { n: lines }), {
      position: POSITION.BOTTOM_CENTER,
    }),
})
const cursorPicker = useCursorPicker({
  tabs,
  activePaneId,
  toast,
  t,
})
const { cursorPickerVisible, cursorPickerItems, triggerAddCursors, onCursorPickerConfirm } =
  cursorPicker
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
const { loadedPlugins, loadAll, getPluginContext, pluginList, allCommands } = usePluginLoader()
const { isMobile } = useIsMobile()

// Workspace filtering
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
    return tab.workspaceId ?? workspaceIdFromPaneId(tab.paneId) ?? null
  }
  return (
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
    // tabs that don't belong to any workspace. `matchWorkspace` returns
    // the default workspace (id === DEFAULT_WORKSPACE_ID) for tabs whose
    // cwd matches its path, and `null` for ungrouped tabs - both belong
    // in the default view.
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

const termRefs = shallowReactive<Record<string, InstanceType<typeof TerminalPane>>>({})
const filesRefs = shallowReactive<Record<string, any>>({})
const webRefs = shallowReactive<Record<string, any>>({})

const { isLandscape, dispose: disposeViewport } = useViewportResize({
  kbVisible,
  terminalImeFocused,
  activePaneId,
  tabs,
  termRefs,
  onSystemKeyboardClose: onSystemKeyboardClosed,
})

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

// Sticky typing mode: the terminal must not be able to take focus while the user
// is typing on the mobile keyboard, otherwise the iOS system keyboard closes.
// Only under the collapse guard, so off/open_only stay upstream-equivalent.
watch(
  [kbTyping, () => appSettings.keyboard_guard_mode],
  ([typing, mode]) => {
    setKbTypingLock(isTouchDevice() && typing && hasCollapseGuard(mode))
  },
  { immediate: true }
)

watch(
  () => appSettings.mobile_input_mode,
  (mode, previousMode) => {
    applyAfterTerminalComposition(() => {
      configureAllMobileInputTextareas(mode)
      if (previousMode != null && previousMode !== mode && kbVisible.value) {
        dismissTerminalKeyboard()
      }
    })
  },
  { immediate: true, flush: 'sync' }
)

// Capture plugin preview when active tab changes to a plugin tab (handles initial load)
watch(activePaneId, (paneId) => {
  const tab = tabs.value.find((t) => t.paneId === paneId)
  if (!tab) return
  // Legacy PluginTab or migrated TerminalTab-with-plugin-leaf.
  if (tab.type === 'plugin') {
    nextTick(() => refreshPluginPreview(tab.paneId))
  } else if (tab.type === 'terminal') {
    const pluginLeaf = getAllLeaves(tab.layout).find((l) => l.kind === 'plugin')
    if (pluginLeaf) nextTick(() => refreshPluginPreview(pluginLeaf.paneId))
  }
})

const isSingleTerminalTab = computed(() => {
  const tab = activeTab.value
  if (!tab || tab.type !== 'terminal') return false
  const leaves = getAllLeaves(tab.layout)
  return leaves.length === 1 && paneKind(leaves[0]) === 'terminal'
})
useKeyboardOverlap({
  settingPx: imeKeyboardOverlapPx,
  kbVisible,
  textInputFocused: kbTyping,
  isSingleTerminalTab,
  hasVerticalPreview: computed(() => false),
})

watch(
  () => appSettings.locale,
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
  [
    () => {
      const tab = tabs.value.find((t) => t.paneId === activePaneId.value)
      return tab?.type === 'terminal' ? tab.activePaneId : null
    },
    hasActiveTerminalLeaf,
  ],
  ([paneId, isTerminalLeaf], [previousPaneId]) => {
    setActivePaneId(paneId)
    const previousTerminal = previousPaneId ? (termRefs[previousPaneId] ?? null) : null
    if (previousPaneId && previousPaneId !== paneId) {
      previousTerminal?.setVirtualModifiers(false, false)
    }
    if (!isTerminalLeaf) {
      dismissTerminalKeyboard(previousTerminal)
      return
    }
    if (
      paneId &&
      effectiveMobileInputMode.value === 'system' &&
      kbVisible.value &&
      !systemActionKeyboardOpen.value
    ) {
      nextTick(focusSystemInput)
    }
  }
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
  // The drop target is a leaf paneId; locate its containing tab.
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

const DEFAULT_PREVIEW_URL = ''

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
  const payload: { path?: string; url?: string } =
    kind === 'files' ? { path: tab.cwd || '' } : {}
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

function focusSystemInput() {
  if (
    effectiveMobileInputMode.value !== 'system' ||
    systemActionKeyboardOpen.value ||
    !hasActiveTerminalLeaf.value
  )
    return
  configureAllMobileInputTextareas('system')
  setKbTypingLock(false)
  getActiveTerminalRef()?.focus()
}

function pasteActiveTerminal(text: string) {
  if (!text) return
  getActiveTerminalRef()?.pasteFromClipboard(text, false, !systemActionKeyboardOpen.value)
}

function onSystemModifierChange(modifiers: { ctrl: boolean; alt: boolean }) {
  getActiveTerminalRef()?.setVirtualModifiers(modifiers.ctrl, modifiers.alt)
}

function onSystemActionKeyboardChange(open: boolean) {
  systemActionKeyboardOpen.value = open
  if (open) {
    getActiveTerminalRef()?.blur()
    terminalImeFocused.value = false
  }
}

function dismissTerminalKeyboard(terminal = getActiveTerminalRef()) {
  systemActionKeyboardOpen.value = false
  kbVisible.value = false
  terminalImeFocused.value = false
  mobileInputGuideVisible.value = false
  terminal?.blur()

  const activeElement = document.activeElement
  if (
    activeElement instanceof HTMLElement &&
    (activeElement.classList.contains('xterm-helper-textarea') ||
      activeElement.closest('#mobile-kb, #system-mobile-kb'))
  ) {
    activeElement.blur()
  }
}

function onSystemKeyboardClosed() {
  if (
    effectiveMobileInputMode.value !== 'system' ||
    !kbVisible.value ||
    systemActionKeyboardOpen.value
  )
    return
  const activeElement = document.activeElement
  if (
    activeElement instanceof HTMLElement &&
    activeElement.classList.contains('xterm-helper-textarea')
  ) {
    dismissTerminalKeyboard()
  }
}

function requestTerminalKeyboard() {
  if (!hasActiveTerminalLeaf.value) return
  if (isTouchDevice() && appSettings.mobile_input_mode == null) {
    kbVisible.value = false
    mobileInputGuideVisible.value = true
    return
  }

  mobileInputGuideVisible.value = false
  systemActionKeyboardOpen.value = false
  kbVisible.value = true
  if (effectiveMobileInputMode.value === 'system') focusSystemInput()
}

function toggleTerminalKeyboard() {
  if (kbVisible.value) dismissTerminalKeyboard()
  else requestTerminalKeyboard()
}

function onBuiltinKeyboardVisibilityChange(visible: boolean) {
  if (visible) requestTerminalKeyboard()
  else kbVisible.value = false
}

function onMobileInputGuideChoose(mode: MobileInputMode) {
  // This handler is reached synchronously from the card's click event. Keeping
  // focus in this stack is required for iOS Safari/PWA to open the software IME.
  appSettings.mobile_input_mode = mode
  void settingsStore.save()
  configureAllMobileInputTextareas(mode)
  mobileInputGuideVisible.value = false
  if (!hasActiveTerminalLeaf.value) {
    dismissTerminalKeyboard()
    return
  }
  systemActionKeyboardOpen.value = false
  kbVisible.value = true
  if (mode === 'system') focusSystemInput()
}

function onKeyboardDismiss() {
  const tab = activeTab.value
  if (tab?.type === 'terminal') {
    termRefs[tab.activePaneId]?.blur()
  }
  const activeElement = document.activeElement
  if (activeElement instanceof HTMLElement) activeElement.blur()
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

function onLinkActivate() {
  linkJustActivated = true
}

function onOpenSettingsRequest() {
  settingsOpen.value = true
}

// Sticky typing mode, native focus-move guard.
//
// While typing, disabling every xterm helper textarea already stops a tap that
// LANDS on a terminal from stealing focus (xterm's own mousedown handler calls
// preventDefault() and then focus() on a now-unfocusable textarea). But a tap on
// pane chrome that xterm does not cover — a split pane's header, the reduced-
// opacity inactive-pane surface, the gap between panes — has no such
// preventDefault, so the browser's default mousedown action moves focus off our
// mobile keyboard input, which is exactly what closes the iOS system keyboard.
// This is why a single-pane tap (always on the terminal) was fine while tapping
// the other pane in a split was not. Cancel that default action for every
// mousedown inside the terminal area while the lock is on. Capture phase so it
// runs before the target's default focus handling; no stopPropagation, so pane
// activation (SplitContainer's own mousedown -> focusPane) and link clicks still
// fire. The lock is only ever set on touch under the collapse guard, so desktop
// and off / open_only never reach this.
//
// #tab-content also holds the preview panel, whose address field and other real
// inputs the user must still be able to focus while typing — cancelling their
// default action would make them uneditable. So skip genuine focus targets
// (form controls / contenteditable) and only guard taps on inert terminal
// chrome. Buttons and links are unaffected either way: preventing a mousedown's
// default does not cancel the subsequent click.
function onTabContentMouseDownCapture(e: MouseEvent) {
  const target = e.target as HTMLElement | null
  if (
    effectiveMobileInputMode.value === 'system' &&
    !kbVisible.value &&
    hasOpenGuard(appSettings.keyboard_guard_mode) &&
    target?.closest('.terminal-pane-container') &&
    !target.closest('input, textarea, select, [contenteditable="true"]')
  ) {
    e.preventDefault()
    return
  }
  if (!isKbTypingLocked()) return
  if (target?.closest('input, textarea, select, [contenteditable="true"]')) return
  e.preventDefault()
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
      if (kbVisible.value && !hasCollapseGuard(appSettings.keyboard_guard_mode))
        kbVisible.value = false
      return
    }
    const tab = tabs.value.find((t) => t.paneId === activePaneId.value)
    const paneId = tab?.type === 'terminal' ? tab.activePaneId : null
    const term = paneId ? termRefs[paneId]?.getTerminal() : null
    if (term && term.touchMoved) {
      term.touchMoved = false
      if (kbVisible.value && !hasCollapseGuard(appSettings.keyboard_guard_mode))
        kbVisible.value = false
      return
    }
    if (!hasOpenGuard(appSettings.keyboard_guard_mode)) requestTerminalKeyboard()
  }
}

function onTerminalScroll() {
  scrollGestureDetected = true
  clearTimeout(scrollGestureTimer)
  scrollGestureTimer = window.setTimeout(() => {
    scrollGestureDetected = false
  }, 300)
  if (effectiveMobileInputMode.value === 'system') {
    dismissTerminalKeyboard()
    return
  }
  // With the collapse guard enabled, scrolling back through history must not
  // dismiss the keyboard the user is typing on.
  if (hasCollapseGuard(appSettings.keyboard_guard_mode)) return
  if (kbVisible.value) kbVisible.value = false
}

function onTokenChanged() {
  syncWs.closeWs()
  syncWs.connectSyncWS()
}

const { onServerConnect, onSshConnect, onSshReconnect, onSshAuthSubmit, onSshAuthCancel } =
  useSshConnectFlow({
    tabs,
    activeWorkspaceId,
    workspaces,
    syncWs,
    sshAuth,
    sshPanelRef,
    ensureSplitRoot,
    commitLocalActivePane,
    persist,
    focusActive,
  })

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

onSshConnectRef.value = onSshConnect

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
  async createTerminalTab(opts: { cwd: string; argv: string[]; title?: string }) {
    const ws = matchWorkspace(opts.cwd)
    const targetId = ws?.id ?? null
    if (targetId !== activeWorkspaceId.value) await activateWorkspace(targetId)
    return newTab(opts.cwd, opts.argv, opts.title)
  },
}
// Test hooks for P3 verification (focusActive + isComposing guard).
window.__dinotty_test_focus_active = focusActive
window.__dinotty_test_is_composing = (paneId: string) => termRefs[paneId]?.isComposing() ?? false
const pluginNotifyBridge = usePluginNotifyBridge({
  pushNotification,
})

window.__dinotty_ui_notify = (
  message: string,
  level?: 'info' | 'warn' | 'error',
  title?: string
) => {
  const type = level === 'error' ? 'error' : level === 'warn' ? 'warning' : 'info'
  const requestId = mintNotificationRequestId()
  const job = Object.freeze({
    requestId,
    body: JSON.stringify({
      clientId: getNotificationClientId(),
      requestId,
      source: 'plugin',
      type,
      title: title ?? 'Plugin',
      body: message,
    }),
  })

  pluginNotifyBridge.enqueueJob(job)
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
      title: t('palette.openFilePreview'),
      subtitle: t('palette.openFilePreviewDesc'),
      action: () => openOrFocusPreview('files'),
    },
    {
      icon: '⊙',
      title: t('palette.openWebPreview'),
      subtitle: t('palette.openWebPreviewDesc'),
      action: () => openOrFocusPreview('web'),
    },
    {
      icon: '⠿',
      title: t('palette.addCursors'),
      subtitle: t('palette.addCursorsDesc'),
      kbd: formatBinding(getBinding('addCursorsInFiles')),
      action: () => triggerAddCursors(),
    },
    {
      icon: '⇄',
      title: t('palette.sshConnect'),
      subtitle: t('palette.sshConnectDesc'),
      action: () => sshPanelRef.value?.open(),
    },
    // Only show "New Local Terminal" when active tab is an SSH session
    ...(activeTab.value?.type === 'terminal' && activeTab.value.connectionId
      ? [
          {
            icon: '⌂',
            title: t('palette.newLocalTerminal'),
            subtitle: t('palette.newLocalTerminalDesc'),
            action: () => splitPane.splitPane('horizontal', true, activeWorkspacePath.value),
          },
        ]
      : []),
    // Only show "Save as Template" when active tab is a terminal tab with a layout
    ...(activeTab.value?.type === 'terminal'
      ? [
          {
            icon: '⎘',
            title: t('palette.saveAsTemplate'),
            subtitle: t('palette.saveAsTemplateDesc'),
            action: () => openSaveTemplateDialog(activeTab.value!.paneId),
          },
        ]
      : []),
    {
      icon: '⊷',
      title: t('palette.applyTemplate'),
      subtitle: t('palette.applyTemplateDesc'),
      action: () => {
        templatePickerVisible.value = true
      },
    },
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

const keyActions: Record<string, (options?: AppActionOptions) => void> = {
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
  pasteTerminal: (options) => void hostClipboardPaste.trigger(options?.autoEnter ?? true),
  missionControl: () => openOverview(),
  superviseTabs: () =>
    void supervise((id) => activateTab(id, { defer: true }))
      .then((activated) => {
        if (activated && getEffectiveSuperviseReload()) reloadApp()
      })
      .catch(console.error),
  sshConnect: () => sshPanelRef.value?.open(),
  fontSizeUp: () => adjustActiveTerminalFontSize(1),
  fontSizeDown: () => adjustActiveTerminalFontSize(-1),
  reloadApp: () => reloadApp(),
  fontSizeReset: () => adjustActiveTerminalFontSize(0),
  addCursorsInFiles: () => triggerAddCursors(),
}

function dispatchAppAction(id: string, options?: AppActionOptions) {
  if (!isDispatchableAppAction(id)) return
  const terminalAction = getTerminalSequenceAppAction(id)
  if (terminalAction) {
    getSendFn()?.(terminalAction.sequence)
    return
  }
  if (id === 'closeTab') lastTabCloseShortcutAt = Date.now()
  keyActions[id]?.(options)
}

function onGlobalKeydown(e: KeyboardEvent) {
  const cmd = e.metaKey || e.ctrlKey
  const altAsCmd = appSettings.windowsAltAsCmd && isWindowsClient
  // On Windows, Ctrl+Alt is AltGr (a layout-character modifier), never an app command —
  // exclude it regardless of Alt-as-Cmd so AltGr keeps producing its character. macOS
  // (isWindowsClient=false) is unaffected.
  const appCmd = (cmd || (altAsCmd && e.altKey)) && !(isWindowsClient && e.ctrlKey && e.altKey)
  if (!appCmd) return

  for (const [id, action] of Object.entries(keyActions)) {
    const binding = getBinding(id)
    if (keyEventMatchesBinding(e, binding)) {
      e.preventDefault()
      if (id === 'closeTab') {
        lastTabCloseShortcutAt = Date.now()
      }
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

const _focusHandler = () => {
  nextTick(() => focusActive())
}

function onDocumentFocusIn(event: FocusEvent) {
  const target = event.target as HTMLElement | null
  if (!target) return
  if (target.classList.contains('xterm-helper-textarea')) {
    terminalImeFocused.value = effectiveMobileInputMode.value === 'system'
    return
  }
  if (
    effectiveMobileInputMode.value === 'system' &&
    kbVisible.value &&
    target.matches('input, textarea, select, [contenteditable="true"]') &&
    !target.closest('#system-mobile-kb')
  ) {
    systemActionKeyboardOpen.value = false
    kbVisible.value = false
    terminalImeFocused.value = false
    getActiveTerminalRef()?.setVirtualModifiers(false, false)
  }
}

// Tauri window close confirmation
// On macOS, Cmd+W is bound to the native "Close" menu item and fires CloseRequested
// in addition to the JS keydown handler. Track when the tab-close shortcut fires so
// the window-close-requested listener can suppress the app-exit path — Cmd+W should
// close the tab, not quit the app.
let lastTabCloseShortcutAt = 0
let unlistenWindowClose: (() => void) | undefined
function setupTauriWindowClose() {
  if (!isTauri()) return
  const listen = (window as any).__TAURI__?.event?.listen
  if (!listen) return
  listen('window-close-requested', () => {
    if (Date.now() - lastTabCloseShortcutAt < 500) {
      return
    }
    windowCloseConfirmVisible.value = true
  }).then((fn: () => void) => {
    unlistenWindowClose = fn
  })
}
async function onWindowCloseHide() {
  windowCloseConfirmVisible.value = false
  if (desktopLifecycle.needsTrayVisibilityConfirmation()) {
    trayVisibilityDialogVisible.value = true
    return
  }
  await performHideToTray()
}
async function performHideToTray() {
  try {
    await desktopLifecycle.hideToTray()
  } catch (error) {
    const message =
      typeof error === 'object' && error && 'message' in error
        ? String((error as { message: unknown }).message)
        : String(error)
    toast.error(message)
  }
}
async function onOpenSystemTraySettings() {
  try {
    await desktopLifecycle.openSystemTraySettings()
  } catch (error) {
    const message =
      typeof error === 'object' && error && 'message' in error
        ? String((error as { message: unknown }).message)
        : String(error)
    toast.error(message)
  }
}
async function onTrayVisibilityConfirmed() {
  desktopLifecycle.confirmTrayVisibility()
  trayVisibilityDialogVisible.value = false
  await performHideToTray()
}
function onTrayVisibilityCancel() {
  trayVisibilityDialogVisible.value = false
}
function onWindowCloseQuit() {
  windowCloseConfirmVisible.value = false
  void desktopLifecycle.requestQuit('window')
}
function onWindowCloseCancel() {
  windowCloseConfirmVisible.value = false
}

onMounted(async () => {
  setupTauriWindowClose()
  await desktopLifecycle.setup()
  document.addEventListener('keydown', onGlobalKeydown)
  document.addEventListener('focusin', onDocumentFocusIn)
  document.addEventListener('terminal-scroll', onTerminalScroll)
  window.addEventListener('focus', _focusHandler)
  window.addEventListener('terminal-insert-path', onTerminalInsertPath)
  window.addEventListener('terminal-insert-text', onTerminalInsertText)
  window.addEventListener('terminal-run-code', onTerminalRunCode)
  window.addEventListener('dinotty:open-settings', onOpenSettingsRequest)
  window.addEventListener('pane-drag-hover-switch', onPaneDragHoverSwitch)
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
  hostClipboardPaste.dispose()
  stopForegroundGainSubscription()
  pluginNotifyBridge.dispose()
  disposeNotificationPresentationScheduler()
  clearActiveReadContext()
  clearToastInstance()
  disposePersist()
  desktopLifecycle.dispose()
  unlistenWindowClose?.()
  document.removeEventListener('keydown', onGlobalKeydown)
  document.removeEventListener('focusin', onDocumentFocusIn)
  document.removeEventListener('terminal-scroll', onTerminalScroll)
  window.removeEventListener('focus', _focusHandler)
  window.removeEventListener('terminal-insert-path', onTerminalInsertPath)
  window.removeEventListener('terminal-insert-text', onTerminalInsertText)
  window.removeEventListener('terminal-run-code', onTerminalRunCode)
  window.removeEventListener('dinotty:open-settings', onOpenSettingsRequest)
  window.removeEventListener('pane-drag-hover-switch', onPaneDragHoverSwitch)
  disposeViewport()
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
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}
#app-root {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: calc(
    100% - max(0px, var(--mkb-height, 0px) - var(--kb-overlap, 0px)) - var(--sys-kb-height, 0px)
  );
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

.preview-menu-wrap {
  position: relative;
  display: flex;
  align-items: center;
  height: 100%;
}
.preview-menu-wrap .tab-bar-icon-btn.is-active {
  color: var(--fg-bright);
  background: var(--tab-hover-bg);
}
.preview-menu-backdrop {
  position: fixed;
  inset: 0;
  z-index: 499;
  background: transparent;
}
.preview-menu-dropdown {
  position: absolute;
  top: 100%;
  right: 0;
  z-index: 500;
  min-width: 180px;
  background: var(--bg-surface, #1a1a1a);
  border: 1px solid var(--border, #333);
  border-radius: 6px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
  padding: 4px 0;
  display: flex;
  flex-direction: column;
}
.preview-menu-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 14px;
  background: transparent;
  border: none;
  color: var(--fg, #c7c7c7);
  font-size: 13px;
  text-align: left;
  white-space: nowrap;
  cursor: pointer;
  border-radius: 0;
}
.preview-menu-item:hover {
  background: var(--tab-hover-bg, rgba(255, 255, 255, 0.06));
  color: var(--fg-bright, #fff);
}
</style>
