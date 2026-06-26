import { ref } from 'vue'

const isMobile = ref(false)

const FORCE_KEY = 'dinotty:force-mobile'

function check() {
  const forced = localStorage.getItem(FORCE_KEY)
  if (forced === '1') { isMobile.value = true; return }
  if (forced === '0') { isMobile.value = false; return }

  isMobile.value = window.matchMedia('(max-width: 600px)').matches
    && window.matchMedia('(pointer: coarse)').matches
}

if (typeof window !== 'undefined') {
  window.addEventListener('resize', check)
  window.addEventListener('orientationchange', check)
  check()
}

export function useIsMobile() {
  return { isMobile }
}
