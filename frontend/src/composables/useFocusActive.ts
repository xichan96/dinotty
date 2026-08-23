import type { InjectionKey } from 'vue'

/** App.vue provides the active terminal's focus restore (useTabLifecycle.focusActive)
 *  to the overlay host, which is a sibling of #app-root and cannot reach App.vue's
 *  per-instance composable state directly. */
export const FOCUS_ACTIVE_KEY: InjectionKey<() => void> = Symbol('focus-active')
