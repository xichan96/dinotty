import DetachedApp from './DetachedApp.vue'
import { prepareRuntime, mountApp } from './bootstrap'

/**
 * Detached terminal window entry (`detached.html?tabId=<tab_id>`).
 *
 * Shares only the runtime bootstrap with the main window. It deliberately skips
 * the main entry's service-worker registration and lazy-chunk prefetch, and the
 * root component owns no global app singletons (no TabBar, Mission Control,
 * notification panel or plugin hosts).
 *
 * The real single-tab terminal rendering lands in a follow-up task; see
 * `DetachedApp.vue` for the current scaffold.
 */
async function bootstrap() {
  await prepareRuntime()
  mountApp(DetachedApp)
}

void bootstrap()
