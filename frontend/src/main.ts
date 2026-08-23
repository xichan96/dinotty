import { createApp } from 'vue'
import * as vue from 'vue'
import { createPinia } from 'pinia'
import Toast, { POSITION, type PluginOptions } from 'vue-toastification'
import 'vue-toastification/dist/index.css'
import App from './App.vue'
import { installHostBridge } from './keyboard/installHostBridge'
import '@xterm/xterm/css/xterm.css'
import './styles/base.css'
import './styles/layout.css'
import './styles/mission-control.css'
import './styles/mobile-keyboard.css'

// Shared Vue runtime for externally-built plugin bundles (keyboard-plugin-design.md §5 Phase 1b).
// Must be assigned before any bridged plugin loads; the bridge keeps plugin
// components on the exact same runtime instance as the host app.
;(window as unknown as Record<string, unknown>).__DINOTTY_VUE__ = vue

// Singleton composable bridge (settings/history/i18n/selectedPath) for the
// same plugin bundles - same startup-before-load contract as above.
installHostBridge()

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

// Register service worker for PWA installability
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {})
}

const app = createApp(App)
app.use(createPinia())
app.use(Toast, toastOptions)
app.mount('#app')
