<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useToast } from 'vue-toastification'
import { Ellipsis, Radar } from 'lucide-vue-next'
import {
  apiUrl,
  authFetch,
  checkTokenConfigured,
  fetchAutoToken,
  getApiBase,
  markCookieAuthenticated,
  validateToken,
} from './composables/apiBase'
import { loadThemePacks } from './composables/useThemePacks'
import { effectiveTheme } from './composables/useDeviceThemeSelection'
import { useSettingsStore } from './stores/settingsStore'
import { useDetachedTab } from './composables/useDetachedTab'
import { t } from './composables/useI18n'
import SplitContainer from './components/split/SplitContainer.vue'
import SshAuthPromptDialog from './components/ssh/SshAuthPromptDialog.vue'
import ConfirmModal from './components/ui/ConfirmModal.vue'
import type { DropPosition } from './types/pane'

/**
 * Detached terminal window (`detached.html?tabId=<tab_id>`).
 *
 * A pure single-tab terminal: no TabBar, StatusBar, notification panel, command
 * palette, Mission Control, plugin hosts or mobile keyboard. The tab is loaded
 * over REST, then kept live by the sync WebSocket in `detached` mode (no global
 * activation, no `dinotty_tabs` persistence).
 *
 * Every terminal is forced onto `WebSocketTransport`: Tauri IPC is single-owner
 * per pane, so sharing a pane with the main window over IPC would kick the main
 * window off its own session.
 */

type ShellState = 'loading' | 'ready' | 'error'

const settingsStore = useSettingsStore()
const toast = useToast()

const tabId = new URLSearchParams(window.location.search).get('tabId')?.trim() ?? ''

const state = ref<ShellState>(tabId ? 'loading' : 'error')
const errorKey = ref<'detached.tabNotFound' | 'detached.connectionFailed'>(
  tabId ? 'detached.connectionFailed' : 'detached.tabNotFound'
)

const {
  tab,
  tabTitle,
  broadcastActive,
  allowClose,
  load,
  focusActive,
  closeTerminal,
  reattachToMain,
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
  onInput,
  onSplitHorizontal,
  onSplitVertical,
  onNewLocalTerminal,
  onToggleBroadcast,
  sshAuthVisible,
  sshAuthHost,
  sshAuthPrompts,
  onSshAuthSubmit,
  onSshAuthCancel,
} = useDetachedTab(tabId, { toast })

const title = computed(() => {
  if (tabTitle.value) return tabTitle.value
  return state.value === 'error' ? t(errorKey.value) : t('detached.loading')
})

// ── Titlebar context menu ───────────────────────────────────────
const menuOpen = ref(false)
const menuPos = ref({ x: 0, y: 0 })
const closeConfirmVisible = ref(false)

function openMenuAt(event: MouseEvent) {
  event.preventDefault()
  menuPos.value = { x: event.clientX, y: event.clientY }
  menuOpen.value = true
}

function toggleMenu(event: MouseEvent) {
  if (menuOpen.value) {
    menuOpen.value = false
    return
  }
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
  menuPos.value = { x: rect.right - 8, y: rect.bottom + 4 }
  menuOpen.value = true
}

function closeMenu() {
  menuOpen.value = false
}

function onReattach() {
  closeMenu()
  reattachToMain()
}

function requestCloseTerminal() {
  closeMenu()
  closeConfirmVisible.value = true
}

function confirmCloseTerminal() {
  closeConfirmVisible.value = false
  void closeTerminal()
}

function onMenuReorder(sourcePaneId: string, targetPaneId: string, position: DropPosition) {
  onReorder(sourcePaneId, targetPaneId, position)
}

let stopThemeWatch: (() => void) | null = null

/**
 * True when this window may talk to the active server.
 *
 * Probe with the same authenticated endpoint the main window uses, then fall
 * back to the desktop loopback auto-token (the cookie-less Tauri path). A
 * detached window is only opened by the desktop app, so there is no setup or
 * login UI here — failure is terminal.
 */
async function probeSession(): Promise<boolean> {
  await getApiBase()
  try {
    const res = await authFetch(apiUrl('/api/settings'))
    if (res.ok) {
      markCookieAuthenticated()
      return true
    }
  } catch {
    // Unreachable server; try the desktop loopback auto-token before giving up.
  }

  const { configured, serverMode } = await checkTokenConfigured()
  if (!configured || serverMode) return false
  const autoToken = await fetchAutoToken()
  if (!autoToken) return false
  const result = await validateToken(autoToken)
  if (!result.ok) return false
  markCookieAuthenticated()
  return true
}

function fail(key: 'detached.tabNotFound' | 'detached.connectionFailed') {
  errorKey.value = key
  state.value = 'error'
}

onMounted(async () => {
  if (!tabId) return

  try {
    if (!(await probeSession())) {
      fail('detached.connectionFailed')
      return
    }

    // Re-apply when an installed theme lands after the first settings paint,
    // mirroring the main window's `useSettingsSync` theme watcher.
    stopThemeWatch = watch(effectiveTheme, () => settingsStore.applyTheme())
    void loadThemePacks()
    await settingsStore.load()
    settingsStore.applyTheme()

    const result = await load()
    if (result === 'not-found') {
      fail('detached.tabNotFound')
      return
    }

    state.value = 'ready'
    await nextTick()
    focusActive()
  } catch (err) {
    console.error('[detached] bootstrap failed:', err)
    fail('detached.connectionFailed')
  }
})

onBeforeUnmount(() => {
  stopThemeWatch?.()
  stopThemeWatch = null
})
</script>

<template>
  <div class="detached-shell" :data-state="state">
    <header class="detached-shell__titlebar" @contextmenu="openMenuAt">
      <span class="detached-shell__title" :title="title">{{ title }}</span>
      <span
        v-if="broadcastActive"
        class="detached-shell__broadcast"
        :title="t('split.broadcastTooltip')"
        :aria-label="t('split.broadcastActive')"
      >
        <Radar :size="13" />
        <span class="detached-shell__broadcast-label">{{ t('split.broadcastActive') }}</span>
      </span>
      <button
        type="button"
        class="detached-shell__menu-btn"
        :aria-label="t('detached.reattachToMain')"
        @click.stop="toggleMenu"
      >
        <Ellipsis :size="16" />
      </button>
    </header>

    <main
      v-if="state === 'ready' && tab"
      class="detached-shell__body detached-shell__body--terminal"
    >
      <div id="tab-content" class="detached-shell__content">
        <div class="tab-page active">
          <!--
            Cross-tab pane gestures are intentionally unbound: `dropOnTab` /
            `dropExtract` need the main window's TabBar (`#tabs-list`,
            `.tab[data-tab-id]`), which does not exist here. Within-tab reorder
            stays bound; pane close only appears when the tab is split.
          -->
          <SplitContainer
            :layout="tab.layout"
            :active-pane-id="tab.activePaneId"
            :broadcast-mode="tab.broadcastMode"
            :broadcast-activity="tab.broadcastActivity"
            :allow-close="allowClose"
            :tab-id="tab.paneId"
            :workspace-id="tab.workspaceId"
            :is-visible="true"
            :force-web-socket="true"
            @register="registerTermRef"
            @title-change="onTitleChange"
            @shell-info="onShellInfo"
            @focus="onFocus"
            @close="onClosePane"
            @input="onInput"
            @split-horizontal="onSplitHorizontal"
            @split-vertical="onSplitVertical"
            @toggle-broadcast="onToggleBroadcast"
            @new-local-terminal="onNewLocalTerminal"
            @reorder="onMenuReorder"
            @divider-drag-end="onDividerDragEnd"
            @file-click="onFileClick"
            @preview-link="onPreviewLink"
            @link-activate="onLinkActivate"
          />
        </div>
      </div>
    </main>

    <main v-else class="detached-shell__body">
      <p v-if="state === 'loading'" class="detached-shell__status" role="status">
        {{ t('detached.loading') }}
      </p>
      <p v-else class="detached-shell__status detached-shell__status--error" role="alert">
        {{ t(errorKey) }}
      </p>
    </main>

    <template v-if="menuOpen">
      <div class="detached-menu-backdrop" @click="closeMenu" @contextmenu.prevent="closeMenu"></div>
      <div
        class="detached-menu"
        role="menu"
        :style="{ left: `${menuPos.x}px`, top: `${menuPos.y}px` }"
      >
        <button type="button" role="menuitem" @click="onReattach">
          {{ t('detached.reattachToMain') }}
        </button>
        <button
          type="button"
          role="menuitem"
          class="detached-menu__danger"
          @click="requestCloseTerminal"
        >
          {{ t('detached.closeTerminal') }}
        </button>
      </div>
    </template>

    <SshAuthPromptDialog
      v-if="sshAuthVisible"
      :host="sshAuthHost"
      :prompts="sshAuthPrompts"
      @submit="onSshAuthSubmit"
      @cancel="onSshAuthCancel"
    />

    <ConfirmModal
      :visible="closeConfirmVisible"
      :title="t('detached.closeTerminal')"
      :message="t('detached.closeTerminalConfirm')"
      :confirm-text="t('detached.closeTerminal')"
      :cancel-text="t('ssh.cancel')"
      danger
      @confirm="confirmCloseTerminal"
      @cancel="closeConfirmVisible = false"
    />
  </div>
</template>

<style scoped>
.detached-shell {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--bg, #1e1e1e);
  color: var(--fg, #c7c7c7);
}

.detached-shell__titlebar {
  flex: none;
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 34px;
  padding: 0 6px 0 12px;
  border-bottom: 1px solid var(--border, #333);
  font-size: 12px;
  font-weight: 600;
}

.detached-shell__title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.detached-shell__broadcast {
  flex: none;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 1px 6px;
  border-radius: 999px;
  background: rgba(239, 68, 68, 0.12);
  color: #ef4444;
  font-size: 11px;
  font-weight: 600;
  animation: detached-broadcast-pulse 2s ease-in-out infinite;
}

.detached-shell__broadcast-label {
  white-space: nowrap;
}

@keyframes detached-broadcast-pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.5;
  }
}

.detached-shell__menu-btn {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 26px;
  border-radius: 4px;
  color: var(--fg-muted, #888);
}

.detached-shell__menu-btn:hover {
  color: var(--fg-bright, #fff);
  background: var(--tab-hover-bg, rgba(255, 255, 255, 0.06));
}

.detached-shell__body {
  flex: 1;
  min-height: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
}

.detached-shell__body--terminal {
  display: block;
  padding: 0;
  position: relative;
}

.detached-shell__content {
  position: absolute;
  inset: 0;
}

.detached-shell__status {
  margin: 0;
  font-size: 13px;
  opacity: 0.75;
}

.detached-shell__status--error {
  color: var(--danger, #e5484d);
  opacity: 1;
}

.detached-menu-backdrop {
  position: fixed;
  inset: 0;
  z-index: 999;
  background: transparent;
}

.detached-menu {
  position: fixed;
  z-index: 1000;
  min-width: 160px;
  max-width: calc(100vw - 16px);
  padding: 4px 0;
  background: var(--bg-surface, #1a1a1a);
  border: 1px solid var(--border, #333);
  border-radius: 6px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
  display: flex;
  flex-direction: column;
}

.detached-menu button {
  padding: 8px 14px;
  background: transparent;
  border: none;
  color: var(--fg, #c7c7c7);
  font-size: 13px;
  text-align: left;
  white-space: nowrap;
  cursor: pointer;
}

.detached-menu button:hover {
  color: var(--fg-bright, #fff);
  background: var(--tab-hover-bg, rgba(255, 255, 255, 0.06));
}

.detached-menu__danger {
  color: var(--danger, #f44747);
}
</style>
