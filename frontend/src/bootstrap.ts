import { createApp, type App, type Component } from 'vue'
import { createPinia } from 'pinia'
import Toast, { POSITION, type PluginOptions } from 'vue-toastification'
import 'vue-toastification/dist/index.css'
import '@xterm/xterm/css/xterm.css'
import './styles/base.css'
import './styles/layout.css'
import './styles/mission-control.css'
import './styles/mobile-keyboard.css'
import { installHostBridge } from './keyboard/installHostBridge'
import { loadLocale, normalizeLocale } from './composables/useI18n'
import { settings } from './composables/useSettings'

/**
 * Shared bootstrap for every HTML entry (main window and detached terminal
 * window).
 *
 * Each entry must install the same runtime before its root component mounts:
 * the active locale table (`t()` is synchronous and falls back to raw keys
 * until the lazy chunk lands), the host bridge for externally-built plugin
 * bundles, Pinia, and Toast. Keeping the sequence here means a future entry
 * cannot silently skip one and still render `app.*` as untranslated keys.
 */

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

/**
 * Load the active locale and install the plugin host bridge.
 *
 * Must complete before the root component renders: the tables are lazy chunks,
 * and the bridge hands `t()` (and the other shared singletons) to plugin
 * bundles that load after startup.
 */
export async function prepareRuntime(): Promise<void> {
  await loadLocale(normalizeLocale(settings.locale))
  installHostBridge()
}

/** Create the root app with the shared plugins and mount it into `selector`. */
export function mountApp(root: Component, selector = '#app'): App {
  const app = createApp(root)
  app.use(createPinia())
  app.use(Toast, toastOptions)
  app.mount(selector)
  return app
}
