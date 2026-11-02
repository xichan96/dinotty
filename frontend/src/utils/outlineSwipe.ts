/** Gesture math for closing the mobile outline sheet with a downward swipe. */

/** Dragged further than this (px) and the sheet closes on release. */
export const SWIPE_CLOSE_DISTANCE = 96

/** Release velocity (px/ms) that closes the sheet even on a short drag. */
export const SWIPE_CLOSE_VELOCITY = 0.5

/**
 * Whether a swipe release should dismiss the sheet.
 *
 * Upward motion never closes, no matter how fast; otherwise a long enough
 * drag or a fast flick does.
 */
export function shouldCloseOnSwipe(
  dy: number,
  velocity: number,
  threshold = SWIPE_CLOSE_DISTANCE
): boolean {
  if (!Number.isFinite(dy) || !Number.isFinite(velocity)) return false
  if (dy <= 0) return false
  return dy > threshold || velocity > SWIPE_CLOSE_VELOCITY
}
