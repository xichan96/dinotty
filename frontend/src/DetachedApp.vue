<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useToast } from 'vue-toastification'
import { AppWindow } from 'lucide-vue-next'
import { probeWindowSession } from './composables/windowSessionProbe'
import { loadThemePacks } from './composables/useThemePacks'
import { effectiveTheme } from './composables/useDeviceThemeSelection'
import { useSettingsStore } from './stores/settingsStore'
import { useDetachedTab } from './composables/useDetachedTab'
import { useDetachedWindowDock } from './composables/useDetachedWindowDock'
import { DETACHED_DOCK_HINT_EVENT } from './composables/detachedWindowBridge'
import { usePluginLoader } from './composables/usePluginLoader'
import { t } from './composables/useI18n'
import SplitContainer from './components/split/SplitContainer.vue'
import SshAuthPromptDialog from './components/ssh/SshAuthPromptDialog.vue'
import { getAllLeaves, paneKind, type DropPosition } from './types/pane'

/**
 * Detached terminal window (`detached.html?tabId=<tab_id>`).
 *
 * A pure single-tab view: no TabBar, StatusBar, notification panel, command
 * palette, Mission Control, plugin hosts, mobile keyboard or in-page titlebar.
 * The native window title carries the tab title/path and broadcast state. The
 * tab is loaded over REST, then kept live by the sync WebSocket in `detached`
 * mode (no global activation, no `dinotty_tabs` persistence).
 *
 * Closing the native window closes the terminal: `useDetachedWindows` maps a
 * window close without a reattach intent to a tab close, so there is no
 * confirm dialog or prompt here.
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
  allowClose,
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

function onMenuReorder(sourcePaneId: string, targetPaneId: string, position: DropPosition) {
  onReorder(sourcePaneId, targetPaneId, position)
}

let stopThemeWatch: (() => void) | null = null
let stopDock: (() => void) | null = null

/** True while this window's title bar is over the main window's tab bar. */
const dockHint = ref(false)

/**
 * The detached window cannot draw over the main window, so the hover state is
 * forwarded there through Tauri events. The main window then highlights its
 * actual tab bar; this window highlights the header being dragged. Older
 * shells without the event API simply skip this.
 */
function onDockHintChange(active: boolean): void {
  if (dockHint.value === active) return
  dockHint.value = active
  try {
    const emitTo = (window as any).__TAURI__?.event?.emitTo
    if (typeof emitTo !== 'function') return
    void Promise.resolve(
      emitTo('main', DETACHED_DOCK_HINT_EVENT, { tab_id: tabId, active })
    ).catch((error: unknown) => {
      console.warn('[detached] dock hint emit failed', error)
    })
  } catch (error) {
    console.warn('[detached] dock hint emit failed', error)
  }
}

function fail(key: 'detached.tabNotFound' | 'detached.connectionFailed') {
  errorKey.value = key
  state.value = 'error'
}

onMounted(async () => {
  if (!tabId) return

  try {
    if (!(await probeWindowSession())) {
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

    // A detached tab may be a plugin leaf (or contain one in a split). Plugin
    // panes read the shared `loadedPlugins` map, so load them here too — only
    // when this tab actually needs one; the map is reactive and PluginView
    // renders as soon as the plugin is ready.
    if (tab.value && getAllLeaves(tab.value.layout).some((leaf) => paneKind(leaf) === 'plugin')) {
      void usePluginLoader().loadAll()
    }

    state.value = 'ready'
    await nextTick()
    focusActive()

    // Dragging this window's title bar onto the main tab bar recalls the tab.
    stopDock = useDetachedWindowDock(tabId, { onHintChange: onDockHintChange })
  } catch (err) {
    console.error('[detached] bootstrap failed:', err)
    fail('detached.connectionFailed')
  }
})

onBeforeUnmount(() => {
  stopDock?.()
  stopDock = null
  stopThemeWatch?.()
  stopThemeWatch = null
})
</script>

<template>
  <div class="detached-shell" :data-state="state">
    <main
      v-if="state === 'ready' && tab"
      class="detached-shell__body detached-shell__body--terminal"
    >
      <!--
        No `id="tab-content"`: that global rule (styles/layout.css) is a flex
        child of the main window's column and would win over this element's
        absolutely-positioned wrapper, collapsing it to zero height.
      -->
      <div class="detached-shell__content">
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

    <Transition name="dock-hint">
      <div v-if="state === 'ready' && dockHint" class="dock-hint" aria-hidden="true">
        <div class="dock-hint__header"></div>
        <div class="dock-hint__pill">
          <AppWindow :size="14" />
          <span>{{ t('tab.dockDropHint') }}</span>
        </div>
      </div>
    </Transition>

    <SshAuthPromptDialog
      v-if="sshAuthVisible"
      :host="sshAuthHost"
      :prompts="sshAuthPrompts"
      @submit="onSshAuthSubmit"
      @cancel="onSshAuthCancel"
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

/* Header highlight while the native title bar is over the main tab bar.
   Mirrors the main window's tab-bar highlight so both windows agree on the
   target: the header is the thing being dragged, the tab bar is the thing it
   must land on. */
.dock-hint {
  position: fixed;
  inset: 0;
  z-index: 30;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding-top: 46px;
  pointer-events: none;
}

.dock-hint__header {
  position: absolute;
  left: 6px;
  right: 6px;
  top: 6px;
  height: 34px;
  border: 2px solid var(--accent, #8a8a8a);
  border-radius: 8px;
  background: color-mix(in srgb, var(--accent, #8a8a8a) 12%, transparent);
  animation: dock-hint-pulse 1.2s ease-in-out infinite;
}

.dock-hint__pill {
  position: relative;
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 6px 12px;
  border: 1px solid var(--accent, #8a8a8a);
  border-radius: 999px;
  background: var(--bg-surface, #262626);
  color: var(--fg-bright, #fff);
  font-size: 12px;
  line-height: 1;
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.3);
  animation: dock-hint-pop 0.16s ease-out;
}

.dock-hint-enter-active,
.dock-hint-leave-active {
  transition: opacity 0.14s ease;
}

.dock-hint-enter-from,
.dock-hint-leave-to {
  opacity: 0;
}

@keyframes dock-hint-pop {
  from {
    opacity: 0;
    transform: translateY(-4px) scale(0.96);
  }
  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}

@keyframes dock-hint-pulse {
  0%,
  100% {
    opacity: 0.55;
  }
  50% {
    opacity: 1;
  }
}

@media (prefers-reduced-motion: reduce) {
  .dock-hint__header,
  .dock-hint__pill {
    animation: none;
  }
}
</style>
