/** Row-window math for virtualizing the outline tree. */
import type { OutlineVirtualWindow } from '../types/outline'

/** Rendered row height; keep in sync with `.outline-row` in OutlinePanel.vue. */
export const OUTLINE_ROW_HEIGHT = 26
export const OUTLINE_ROW_HEIGHT_MOBILE = 32

/** Above this many visible rows the panel renders a window instead of all. */
export const OUTLINE_VIRTUALIZE_THRESHOLD = 2000

export const OUTLINE_VIRTUAL_OVERSCAN = 8

/**
 * Visible slice for a fixed-height list, plus the spacer heights that keep the
 * scrollbar proportional to the full list.
 *
 * Clamped and defensive: empty or invalid input yields a zero window (or the
 * full list when the row height itself is unusable).
 */
export function virtualWindow(
  total: number,
  scrollTop: number,
  viewportHeight: number,
  rowHeight: number,
  overscan = OUTLINE_VIRTUAL_OVERSCAN
): OutlineVirtualWindow {
  const count = Number.isFinite(total) ? Math.max(0, Math.floor(total)) : 0
  if (count === 0) return { start: 0, end: 0, topPad: 0, bottomPad: 0 }
  if (!Number.isFinite(rowHeight) || rowHeight <= 0) {
    return { start: 0, end: count, topPad: 0, bottomPad: 0 }
  }

  const over = Number.isFinite(overscan) ? Math.max(0, Math.floor(overscan)) : 0
  const top = Number.isFinite(scrollTop) ? Math.max(0, scrollTop) : 0
  const height = Number.isFinite(viewportHeight) ? Math.max(0, viewportHeight) : 0

  const first = Math.floor(top / rowHeight)
  const start = Math.min(count, Math.max(0, first - over))
  const last = Math.ceil((top + height) / rowHeight)
  const end = Math.min(count, Math.max(start, last + over))

  return {
    start,
    end,
    topPad: start * rowHeight,
    bottomPad: (count - end) * rowHeight,
  }
}
