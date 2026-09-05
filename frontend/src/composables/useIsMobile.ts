import { ref } from 'vue'

const isMobile = ref(false)

const FORCE_KEY = 'dinotty:force-mobile'

function check() {
  const storage = typeof localStorage === 'undefined' ? null : localStorage
  const forced = storage?.getItem(FORCE_KEY)
  if (forced === '1') {
    isMobile.value = true
    return
  }
  if (forced === '0') {
    isMobile.value = false
    return
  }
  if (typeof window.matchMedia !== 'function') {
    isMobile.value = false
    return
  }

  const isCoarse = window.matchMedia('(pointer: coarse)').matches
  const isPortrait = window.matchMedia('(orientation: portrait)').matches
  const isNarrow = window.matchMedia('(max-width: 600px)').matches
  isMobile.value = isCoarse && (isPortrait || isNarrow)
}

if (typeof window !== 'undefined') {
  window.addEventListener('resize', check)
  window.addEventListener('orientationchange', check)
  check()
}

export function useIsMobile() {
  return { isMobile }
}

/** Touch-primary device (no hover + coarse pointer). Floating windows are
 *  desktop-only; openPlugin falls back to a tab on touch devices.
 *  Evaluated at call time (unlike the reactive isMobile above). */
export function isTouchDevice(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  return window.matchMedia('(hover: none) and (pointer: coarse)').matches
}
