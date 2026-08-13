import { POSITION } from 'vue-toastification'

export function resolveResponsiveToastPosition(
  desktopPosition: POSITION = POSITION.BOTTOM_CENTER,
  viewportWidth = typeof window === 'undefined' ? Number.POSITIVE_INFINITY : window.innerWidth
): POSITION {
  return viewportWidth <= 768 ? POSITION.TOP_RIGHT : desktopPosition
}
