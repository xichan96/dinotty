import * as vue from 'vue'
import App from './App.vue'
import { prepareRuntime, mountApp } from './bootstrap'
import { loadAllBuiltins } from './composables/i18n/tables'

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
  // Locale, host bridge, Pinia and Toast come from the shared entry bootstrap.
  await prepareRuntime()
  mountApp(App)
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
  // Every builtin locale, so switching languages never flashes raw keys.
  // Installed packs are not prefetched: they arrive as data with the settings
  // round-trip rather than as a chunk, and there may be arbitrarily many.
  loadAllBuiltins().catch(() => {})
}
if ('requestIdleCallback' in window) {
  requestIdleCallback(() => prefetchLazyChunks(), { timeout: 3000 })
} else {
  setTimeout(prefetchLazyChunks, 3000)
}
