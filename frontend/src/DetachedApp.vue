<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
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
import { t } from './composables/useI18n'

/**
 * Scaffold for the detached terminal window.
 *
 * Scope of this task: read `tabId`, bring up apiBase / settings / theme / auth,
 * and render loading, error and ready states. It intentionally does NOT render
 * a terminal, TabBar, Mission Control, plugin hosts or tab persistence.
 *
 * The follow-up task fills the ready state with the tab's SplitContainer. When
 * it does, the terminal must be constructed with `forceWebSocket: true`
 * (`TerminalInstance` / `createTransport`): Tauri IPC is single-owner, so a
 * detached window sharing a pane with the main window would kick its forwarder.
 */

type ShellState = 'loading' | 'ready' | 'error'

const settingsStore = useSettingsStore()

const tabId = new URLSearchParams(window.location.search).get('tabId')?.trim() ?? ''

const state = ref<ShellState>(tabId ? 'loading' : 'error')
const errorKey = ref<'detached.tabNotFound' | 'detached.connectionFailed'>(
  tabId ? 'detached.connectionFailed' : 'detached.tabNotFound'
)

const title = computed(() => (tabId ? tabId : t('detached.tabNotFound')))

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
  document.title = `Dinotty — ${tabId}`

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
    state.value = 'ready'
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
    <header class="detached-shell__titlebar">
      <span class="detached-shell__title" :title="title">{{ title }}</span>
    </header>

    <main class="detached-shell__body">
      <p v-if="state === 'loading'" class="detached-shell__status" role="status">
        {{ t('detached.loading') }}
      </p>
      <p
        v-else-if="state === 'error'"
        class="detached-shell__status detached-shell__status--error"
        role="alert"
      >
        {{ t(errorKey) }}
      </p>
      <!-- Scaffold only: the next task mounts the tab's SplitContainer here. -->
      <p v-else class="detached-shell__status">{{ t('detached.previewPlaceholder') }}</p>
    </main>
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
  min-height: 34px;
  padding: 0 12px;
  border-bottom: 1px solid var(--border, #333);
  font-size: 12px;
  font-weight: 600;
}

.detached-shell__title {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.detached-shell__body {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
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
</style>
