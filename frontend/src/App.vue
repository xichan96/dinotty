<template>
  <SetupPage v-if="!authenticated && needsSetup" @success="onLoginSuccess" />
  <LoginPage v-else-if="!authenticated && authProbe === 'done'" @success="onLoginSuccess" />
  <div v-else-if="!authenticated" class="auth-probe-screen">
    <RefreshCw :size="20" class="auth-probe-spinner" />
  </div>
  <div
    v-else
    id="app-root"
    ref="appRootRef"
    :class="{
      'system-toolbar-docked': effectiveMobileInputMode === 'system' && systemToolbarVisible,
      'system-ime-open': effectiveMobileInputMode === 'system' && systemKeyboardOpen,
    }"
    @mousedown.capture="onAppMouseReplayCapture"
    @click.capture="onAppMouseReplayCapture"
    @touchstart.capture="onAppTouchStartCapture"
  >
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
              @click="((previewMenuOpen = false), openOrFocusPreview('files'))"
            >
              <FolderTree :size="14" />
              <span>{{ t('previewPanel.switchFiles') }}</span>
            </button>
            <button
              type="button"
              class="preview-menu-item"
              role="menuitem"
              @click="((previewMenuOpen = false), openOrFocusPreview('web'))"
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
      @pointerdown.capture="onTabContentPointerDownCapture"
      @touchstart.capture="onTabContentTouchStartCapture"
      @touchend="onTerminalTouch"
      @touchcancel.capture="onTabContentTouchCancelCapture"
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
      :danger="confirmState.danger"
      @confirm="confirmResolve"
      @cancel="confirmCancel"
    />

    <AlertModal
      :visible="alertState.visible"
      :title="alertState.title"
      :message="alertState.message"
      :confirm-text="alertState.confirmText"
      @confirm="alertResolve"
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

    <component
      :is="keyboardProviderComponent"
      v-if="keyboardProviderComponent"
      ref="keyboardHostRef"
      :ctx="keyboardCtx"
    />

    <MobileKeyboard v-else-if="effectiveMobileInputMode === 'builtin'" :ctx="keyboardCtx" />

    <SystemKeyboardToolbar
      v-if="effectiveMobileInputMode === 'system'"
      ref="systemToolbarRef"
      :ctx="keyboardCtx"
      :visible="systemToolbarVisible"
      :action-open="systemActionKeyboardOpen"
      @update:action-open="onSystemActionKeyboardChange"
    />

    <MobileInputGuide
      :visible="mobileInputGuideVisible"
      @choose="onMobileInputGuideChoose"
      @close="mobileInputGuideVisible = false"
    />

    <KbDebugOverlay v-if="kbDebugEnabled" />

    <KbToggleButton
      v-show="
        (appSettings.show_virtual_keyboard || hasOpenGuard(appSettings.keyboard_guard_mode)) &&
        hasActiveTerminalLeaf &&
        !systemToolbarVisible &&
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
  <PluginOverlayHost v-if="authenticated" :get-plugin-context="getPluginContext" />
</template>

<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, nextTick } from 'vue'
import TabBar from './components/terminal/TabBar.vue'
import CommandPalette from './components/command/CommandPalette.vue'
import CommandBookmarks from './components/command/CommandBookmarks.vue'
import ServerList from './components/ServerList.vue'
import SshHostsPanel from './components/ssh/SshHostsPanel.vue'
import SshAuthPromptDialog from './components/ssh/SshAuthPromptDialog.vue'
import NotificationPanel from './components/notification/NotificationPanel.vue'
import DropPreview from './components/split/DropPreview.vue'
import SplitContainer from './components/split/SplitContainer.vue'
import StatusBar from './components/terminal/StatusBar.vue'
import SettingsPanel from './components/SettingsPanel.vue'
import ConfirmCloseDialog from './components/ui/ConfirmCloseDialog.vue'
import ConfirmModal from './components/ui/ConfirmModal.vue'
import AlertModal from './components/ui/AlertModal.vue'
import PromptModal from './components/ui/PromptModal.vue'
import WindowCloseDialog from './components/ui/WindowCloseDialog.vue'
import TrayVisibilityDialog from './components/ui/TrayVisibilityDialog.vue'
import MultiSelectPicker from './components/ui/MultiSelectPicker.vue'
import SaveTemplateDialog from './components/ui/SaveTemplateDialog.vue'
import TemplatePicker from './components/ui/TemplatePicker.vue'
import PluginOverlayHost from './components/plugin/PluginOverlayHost.vue'
import WorkspaceOverview from './components/overview/WorkspaceOverview.vue'
import MobileKeyboard from './components/keyboard/MobileKeyboard.vue'
import SystemKeyboardToolbar from './components/keyboard/SystemKeyboardToolbar.vue'
import MobileInputGuide from './components/keyboard/MobileInputGuide.vue'
import KbDebugOverlay from './components/keyboard/KbDebugOverlay.vue'
import KbToggleButton from './components/keyboard/KbToggleButton.vue'
import LoginPage from './components/LoginPage.vue'
import SetupPage from './components/SetupPage.vue'
import { confirmState, confirmResolve, confirmCancel } from './composables/useConfirm'
import { alertState, alertResolve } from './composables/useAlert'
import { promptState, promptResolve, promptCancel } from './composables/usePrompt'
import {
  getApiBase,
  checkTokenConfigured,
  fetchAutoToken,
  validateToken,
  apiUrl,
} from './composables/apiBase'
import { useToast } from 'vue-toastification'
import {
  useNotification,
  disposeNotificationPresentationScheduler,
} from './composables/useNotification'
import { initMonitorHistory } from './composables/useMonitor'
import { apiListTabs } from './composables/useTabApi'
import {
  getAllLeaves,
  findLeaf,
  ensureSplitRoot,
  type TerminalTab,
  type DropPosition,
} from './types/pane'
import { initializePaneMru } from './types/paneMru'
import { hasOpenGuard } from './utils/keyboardGuardMode'
import { storeToRefs } from 'pinia'
import { useSessionStore } from './stores/sessionStore'
import { useUiStore } from './stores/uiStore'
import { useSettingsStore } from './stores/settingsStore'
import { useTabPersistence } from './composables/useTabPersistence'
import { useDesktopLifecycle } from './composables/useDesktopLifecycle'
import { useAppCore } from './composables/useAppCore'
import { useAppActions } from './composables/useAppActions'
import { useAppKeyboard } from './composables/useAppKeyboard'
import { useAppConnectivity } from './composables/useAppConnectivity'
import { useAppTauri } from './composables/useAppTauri'
import { usePluginBridge } from './composables/usePluginBridge'
import { Settings, Bell, Monitor, Radar, RefreshCw, FolderTree, Globe } from 'lucide-vue-next'

// ── Stores & shared app services ────────────────────────────────
const session = useSessionStore()
const { tabs, activePaneId } = storeToRefs(session)
const ui = useUiStore()
const settingsStore = useSettingsStore()

const { persist, persistNow, dispose: disposePersist } = useTabPersistence({ tabs, activePaneId })

const desktopLifecycle = useDesktopLifecycle({
  persistNow,
  saveSettings: () => settingsStore.save(),
})
const toast = useToast()
const notif = useNotification()

// ── App-layer template refs & local dialog state ────────────────
const windowCloseConfirmVisible = ref(false)
const trayVisibilityDialogVisible = ref(false)
const previewMenuOpen = ref(false)
const lastTabCloseShortcutAt = ref(0)
const appRootRef = ref<HTMLElement | null>(null)
const tabBarRef = ref<InstanceType<typeof TabBar> | null>(null)
const paletteRef = ref<InstanceType<typeof CommandPalette>>()
const bookmarksRef = ref<InstanceType<typeof CommandBookmarks>>()
const serverListRef = ref<InstanceType<typeof ServerList>>()
const sshPanelRef = ref<InstanceType<typeof SshHostsPanel>>()

// ── Orchestration composables (core → actions → keyboard → connectivity → tauri → bridge) ──
const core = useAppCore({
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
})
const actions = useAppActions({
  core,
  paletteRef,
  bookmarksRef,
  sshPanelRef,
  lastTabCloseShortcutAt,
  toast,
})
const keyboard = useAppKeyboard({ core, actions, settingsStore, bookmarksRef, appRootRef })
const connectivity = useAppConnectivity({ core, sshPanelRef, persist })
const tauri = useAppTauri({
  desktopLifecycle,
  toast,
  windowCloseConfirmVisible,
  trayVisibilityDialogVisible,
  lastTabCloseShortcutAt,
})
const bridge = usePluginBridge({ core })

// ── Re-exports for the template ─────────────────────────────────
const {
  authenticated,
  needsSetup,
  authProbe,
  appSettings,
  t,
  kbVisible,
  settingsOpen,
  effectiveMobileInputMode,
  systemToolbarVisible,
  hasActiveTerminalLeaf,
  systemActionKeyboardOpen,
  mobileInputGuideVisible,
  kbDebugEnabled,
  keyboardProviderComponent,
  keyboardHostRef,
  systemToolbarRef,
  activeTabType,
  visibleTabList,
  tabIndicators,
  notificationPaneLabels,
  currentTabIndex,
  currentTabTitle,
  activeWorkspaceId,
  activeWorkspaceAbbr,
  activeWorkspaceColor,
  activeWorkspacePath,
  isMobile,
  canBroadcast,
  isBroadcastActive,
  pluginList,
  newTab,
  activateTab,
  closeTab,
  requestCloseTab,
  onCloseTabsBulk,
  reorderTab,
  onRenameTab,
  openOverview,
  openSaveTemplateDialog,
  templatePickerVisible,
  splitPane,
  openOrFocusPreview,
  reloadApp,
  onTokenChanged,
  onLoginSuccess,
  onClosePane,
  onConfirmClose,
  onTitleChange,
  onShellInfo,
  onPreviewLink,
  onFileClick,
  onDividerDragEnd,
  onDropOnTab,
  onDropExtract,
  onMergeTabIntoPane,
  onPaneDragHoverSwitch,
  onTerminalInsertPath,
  onTerminalInsertText,
  onTerminalRunCode,
  onOpenSettingsRequest,
  registerTermRef,
  tabKey,
  termRefs,
  revealPane,
  getSendFn,
  getPluginContext,
  openPlugin,
  syncWs,
  sshAuthVisible,
  sshAuthHost,
  sshAuthPrompts,
  overviewOpen,
  closeOverview,
  onOverviewActivate,
  onOverviewCloseTab,
  onOverviewNewTab,
  onOverviewNewTabSsh,
  onOverviewRenameTab,
  cursorPickerVisible,
  cursorPickerItems,
  onCursorPickerConfirm,
  saveTemplateVisible,
  saveTemplateSourceTabId,
  saveTemplateSourceLayout,
  onTemplateSaved,
  onTemplateApplied,
  loadAll,
  focusActive,
  syncKbDebugFlag,
  clearToastInstance,
  clearActiveReadContext,
  stopForegroundGainSubscription,
} = core

const { paletteCommands, onGlobalKeydown, hostClipboardPaste } = actions

const {
  systemKeyboardOpen,
  keyboardCtx,
  disposeViewport,
  disposePanLock,
  toggleTerminalKeyboard,
  onSystemActionKeyboardChange,
  onMobileInputGuideChoose,
  onTabContentMouseDownCapture,
  onTabContentPointerDownCapture,
  onTabContentTouchStartCapture,
  onTabContentTouchCancelCapture,
  onTerminalTouch,
  onLinkActivate,
  onTerminalScroll,
  onDocumentFocusIn,
  onWindowFocus,
  onAppMouseReplayCapture,
  onAppTouchStartCapture,
} = keyboard

const {
  onServerConnect,
  onSshConnect,
  onSshReconnect,
  onSshAuthSubmit,
  onSshAuthCancel,
  onNewMenuAction,
} = connectivity

const {
  setupTauriWindowClose,
  onWindowCloseHide,
  onWindowCloseQuit,
  onWindowCloseCancel,
  onOpenSystemTraySettings,
  onTrayVisibilityConfirmed,
  onTrayVisibilityCancel,
  disposeTauriWindowClose,
} = tauri

const { pluginNotifyBridge } = bridge

onMounted(async () => {
  setupTauriWindowClose()
  syncKbDebugFlag()
  window.addEventListener('hashchange', syncKbDebugFlag)
  await desktopLifecycle.setup()
  document.addEventListener('keydown', onGlobalKeydown)
  document.addEventListener('focusin', onDocumentFocusIn)
  document.addEventListener('terminal-scroll', onTerminalScroll)
  window.addEventListener('focus', onWindowFocus)
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
  disposeTauriWindowClose()
  document.removeEventListener('keydown', onGlobalKeydown)
  document.removeEventListener('focusin', onDocumentFocusIn)
  document.removeEventListener('terminal-scroll', onTerminalScroll)
  window.removeEventListener('focus', onWindowFocus)
  window.removeEventListener('terminal-insert-path', onTerminalInsertPath)
  window.removeEventListener('terminal-insert-text', onTerminalInsertText)
  window.removeEventListener('terminal-run-code', onTerminalRunCode)
  window.removeEventListener('dinotty:open-settings', onOpenSettingsRequest)
  window.removeEventListener('pane-drag-hover-switch', onPaneDragHoverSwitch)
  window.removeEventListener('hashchange', syncKbDebugFlag)
  disposeViewport()
  disposePanLock()
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
/* The fixed system shortcut toolbar reserves its own height through the host
 * keyboard band (--mkb-height), and --sys-kb-height covers the native keyboard
 * occlusion. Do NOT make #app-root position:fixed: iOS WebKit's caret pan on
 * IME open pushes the whole fixed box - terminal included - off the top of the
 * screen (#260 regression). Do NOT dock the toolbar in this flow either: on
 * devices where 100dvh does not track the keyboard the in-flow bar stays at
 * the screen bottom, buried under the IME (v0.22.0 kept it fixed for exactly
 * this reason). The system-toolbar-docked / system-ime-open classes stay as
 * state markers for diagnostics (KbDebugOverlay) and tests. */
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
