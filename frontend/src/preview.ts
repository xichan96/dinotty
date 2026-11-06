import PreviewWindowApp from './PreviewWindowApp.vue'
import { prepareRuntime, mountApp } from './bootstrap'

/**
 * Native preview window entry (`preview.html?kind=files|web&…`).
 *
 * Shares only the runtime bootstrap with the main window. The root component
 * owns no global app singletons (no TabBar, Mission Control, notification
 * panel or plugin hosts) and talks to the server directly.
 */
async function bootstrap() {
  await prepareRuntime()
  mountApp(PreviewWindowApp)
}

void bootstrap()
