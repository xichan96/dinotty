import { reactive, readonly } from 'vue'

/**
 * Window-local feedback for the detached-window gestures.
 *
 * The detached window cannot paint anything over the main window, so it
 * announces "I am about to dock here" through a Tauri event; the main window
 * mirrors that in `dockHintTabId` and shows the drop-target frame. The recall
 * flash is applied to the tab that just came back, so the tab strip reacts to
 * the remount instead of the tab simply appearing.
 */
const state = reactive({
  /** Tab whose detached window is currently hovering over the main window. */
  dockHintTabId: null as string | null,
  /** Tab that was just recalled; the TabBar flashes it once. */
  recalledTabId: null as string | null,
})

let recallTimer: ReturnType<typeof setTimeout> | null = null

export function useDetachedWindowFeedback() {
  return {
    state: readonly(state),

    setDockHint(tabId: string | null) {
      state.dockHintTabId = tabId
    },

    flashRecall(tabId: string) {
      state.recalledTabId = tabId
      if (recallTimer !== null) clearTimeout(recallTimer)
      recallTimer = setTimeout(() => {
        recallTimer = null
        state.recalledTabId = null
      }, 900)
    },
  }
}
