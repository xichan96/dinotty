import { createApp } from 'vue'
import * as vue from 'vue'
import { createPinia } from 'pinia'
import Toast, { POSITION, type PluginOptions } from 'vue-toastification'
import 'vue-toastification/dist/index.css'
import App from './App.vue'
import { installHostBridge } from './keyboard/installHostBridge'
import { loadLocale, normalizeLocale } from './composables/useI18n'
import { settings } from './composables/useSettings'
import '@xterm/xterm/css/xterm.css'
import './styles/base.css'
import './styles/layout.css'
import './styles/mission-control.css'
import './styles/mobile-keyboard.css'

// Shared Vue runtime for externally-built plugin bundles (keyboard-plugin-design.md §5 Phase 1b).
// Must be assigned before any bridged plugin loads; the bridge keeps plugin
// components on the exact same runtime instance as the host app.
;(window as unknown as Record<string, unknown>).__DINOTTY_VUE__ = vue

// Register service worker for PWA installability
if ('serviceWorker' in navigator) {
  // When a new SW takes control, reload once so the page runs the new build
  // rather than sitting on whatever the old one had cached. The flag guards
  // against a reload loop if control changes again mid-reload.
  let reloading = false
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading) return
    reloading = true
    window.location.reload()
  })
  navigator.serviceWorker.register('/sw.js').catch(() => {})
}

async function bootstrap() {
  // Locale tables are lazy chunks; load the active one (browser-detected while
  // settings haven't arrived yet) before anything renders or the host bridge
  // hands t() to plugin bundles.
  await loadLocale(normalizeLocale(settings.locale))

  // Singleton composable bridge (settings/history/i18n/selectedPath) for the
  // same plugin bundles - same startup-before-load contract as above.
  installHostBridge()

  const app = createApp(App)
  app.use(createPinia())
  app.use(Toast, toastOptions)
  app.mount('#app')
}

const toastOptions: PluginOptions = {
  position: POSITION.TOP_RIGHT,
  timeout: 5000,
  closeOnClick: false,
  pauseOnFocusLoss: true,
  pauseOnHover: true,
  draggable: true,
  showCloseButtonOnHover: true,
  closeButton: 'button',
  icon: true,
}

void bootstrap()

// Monaco lives in a lazy chunk so terminal-only sessions don't pay for it.
// Prefetch it once the browser is idle so opening the file workspace later
// (or on a return visit, via the SW cache) doesn't wait on a cold download.
// Same for the settings panel chunk, so the first open doesn't wait either.
const prefetchLazyChunks = () => {
  import('./components/workspace/MonacoEditor.vue').catch(() => {})
  import('./components/SettingsPanel.vue').catch(() => {})
  import('./components/overview/WorkspaceOverview.vue').catch(() => {})
  // The other locale, so switching languages never flashes raw keys.
  loadLocale(normalizeLocale(settings.locale) === 'en' ? 'zh' : 'en').catch(() => {})
}
if ('requestIdleCallback' in window) {
  requestIdleCallback(() => prefetchLazyChunks(), { timeout: 3000 })
} else {
  setTimeout(prefetchLazyChunks, 3000)
}
