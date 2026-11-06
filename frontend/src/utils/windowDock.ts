/** Physical-pixel rectangle shared by window position/size APIs. */
export interface WindowRect {
  x: number
  y: number
  width: number
  height: number
}

/**
 * The draggable top strip of a window — its native title bar.
 *
 * The dock gesture starts from the header, so only this strip counts when
 * checking whether the window has been moved onto the main tab bar. Clamped
 * to the window itself so odd window-manager insets cannot escape it.
 */
export function titleBarRect(rect: WindowRect, titleBarHeight: number): WindowRect {
  return {
    x: rect.x,
    y: rect.y,
    width: rect.width,
    height: Math.max(0, Math.min(titleBarHeight, rect.height)),
  }
}

/**
 * Share of `source` covered by `target`, in [0, 1].
 *
 * Used for the detach-window dock gesture: the share is relative to the
 * rectangle being dragged, so a small title bar over a full-width tab bar can
 * still reach 1.
 */
export function overlapRatio(source: WindowRect, target: WindowRect): number {
  if (source.width <= 0 || source.height <= 0) return 0
  const width =
    Math.min(source.x + source.width, target.x + target.width) - Math.max(source.x, target.x)
  const height =
    Math.min(source.y + source.height, target.y + target.height) - Math.max(source.y, target.y)
  if (width <= 0 || height <= 0) return 0
  return (width * height) / (source.width * source.height)
}
