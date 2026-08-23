import { computed, watch, type Ref } from 'vue'
import { dispatchLocal } from './useEventBridge'

/**
 * Host keyboard-open broadcast for overlay plugins. Mirrors the --kb-open CSS
 * var's definition (sysKbOpen || kbVisible) and delivers kb-open / kb-close
 * locally so same-client plugins can react via ctx.events without a server
 * round-trip (the emit path's client_id is excluded by broadcast_sync_others).
 */
export function useOverlayKeyboardBroadcast(opts: {
  systemKeyboardOpen: Ref<boolean>
  kbVisible: Ref<boolean>
}) {
  const kbOpen = computed(() => opts.systemKeyboardOpen.value || opts.kbVisible.value)
  // Transition-only (no immediate): plugins load after mount; firing on init
  // would broadcast before any plugin could hear it.
  watch(kbOpen, (open) => {
    dispatchLocal(open ? 'kb-open' : 'kb-close', {})
  })
  return { kbOpen }
}
