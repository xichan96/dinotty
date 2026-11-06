/**
 * Geometry for the image preview.
 *
 * Every coordinate here is viewport-relative: `tx`/`ty` are the offset of the
 * image centre from the viewport centre, the same space as `focal` in
 * `zoomAt` and the midpoints passed to `pinchTransform`. Keeping the maths DOM
 * free makes the gesture behaviour unit-testable; the component only converts
 * client coordinates into this space.
 */

export interface Size {
  width: number
  height: number
}

export interface Point {
  x: number
  y: number
}

export interface ImageViewState {
  scale: number
  tx: number
  ty: number
}

export type ImageViewMode = 'fit' | 'manual' | 'actual'

export const MIN_ZOOM = 0.01
export const MAX_ZOOM = 16
export const ZOOM_STEP = 1.25

const WHEEL_LINE_HEIGHT = 16
const WHEEL_FALLBACK_PAGE_HEIGHT = 800

function finiteOr(value: number, fallback = 0): number {
  return Number.isFinite(value) ? value : fallback
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

export function isValidSize(size: Size | null | undefined): size is Size {
  return (
    !!size &&
    Number.isFinite(size.width) &&
    Number.isFinite(size.height) &&
    size.width > 0 &&
    size.height > 0
  )
}

/**
 * Scale that fits `natural` inside `viewport` minus `padding` on every side.
 * Never upscales past 1:1 unless `allowUpscale` is set, so small icons stay
 * crisp at their real size.
 */
export function fitScale(natural: Size, viewport: Size, padding = 0, allowUpscale = false): number {
  if (!isValidSize(natural) || !isValidSize(viewport)) return 1

  const pad = Number.isFinite(padding) && padding > 0 ? padding : 0
  const availableWidth = viewport.width - pad * 2
  const availableHeight = viewport.height - pad * 2
  if (availableWidth <= 0 || availableHeight <= 0) return MIN_ZOOM

  const upperBound = allowUpscale ? Number.POSITIVE_INFINITY : 1
  const scale = Math.min(
    upperBound,
    availableWidth / natural.width,
    availableHeight / natural.height
  )
  return Number.isFinite(scale) && scale > 0 ? scale : 1
}

export function clampScale(scale: number, min = MIN_ZOOM, max = MAX_ZOOM): number {
  if (!Number.isFinite(scale)) return min
  return clamp(scale, Math.min(min, max), Math.max(min, max))
}

/**
 * Keeps the image reachable: an axis whose content is smaller than the
 * viewport is centred (offset 0); otherwise the offset is limited to half the
 * overflow so at least one edge always touches the viewport edge.
 */
export function clampPan(state: ImageViewState, natural: Size, viewport: Size): ImageViewState {
  if (!isValidSize(natural) || !isValidSize(viewport)) return { ...state }

  const scale = finiteOr(state.scale, 1)
  const limitX = Math.max(0, (natural.width * scale - viewport.width) / 2)
  const limitY = Math.max(0, (natural.height * scale - viewport.height) / 2)

  return {
    scale,
    tx: clamp(finiteOr(state.tx), -limitX, limitX),
    ty: clamp(finiteOr(state.ty), -limitY, limitY),
  }
}

/**
 * Zooms around `focal` (viewport-relative): the image point under the focus
 * stays under it. T' = focal - ((focal - t) / s) * s'.
 */
export function zoomAt(
  state: ImageViewState,
  focal: Point,
  nextScale: number,
  natural: Size,
  viewport: Size
): ImageViewState {
  const scale = clampScale(nextScale)
  const current = Number.isFinite(state.scale) && state.scale > 0 ? state.scale : 1
  const fx = finiteOr(focal.x)
  const fy = finiteOr(focal.y)
  const tx = fx - ((fx - finiteOr(state.tx)) / current) * scale
  const ty = fy - ((fy - finiteOr(state.ty)) / current) * scale
  return clampPan({ scale, tx, ty }, natural, viewport)
}

export function panBy(
  state: ImageViewState,
  dx: number,
  dy: number,
  natural: Size,
  viewport: Size
): ImageViewState {
  return clampPan(
    {
      scale: state.scale,
      tx: finiteOr(state.tx) + finiteOr(dx),
      ty: finiteOr(state.ty) + finiteOr(dy),
    },
    natural,
    viewport
  )
}

/**
 * Two-finger gesture: scale by the distance ratio and move the image point
 * under `startMid` to `curMid`. Both midpoints are viewport-relative, like
 * the focal point of `zoomAt`.
 */
export function pinchTransform(
  base: ImageViewState,
  startMid: Point,
  startDist: number,
  curMid: Point,
  curDist: number,
  natural: Size,
  viewport: Size
): ImageViewState {
  const ratio =
    Number.isFinite(startDist) && startDist > 0 && Number.isFinite(curDist)
      ? curDist / startDist
      : 1
  const scale = clampScale(base.scale * ratio)
  const current = Number.isFinite(base.scale) && base.scale > 0 ? base.scale : 1
  const tx = finiteOr(curMid.x) - ((finiteOr(startMid.x) - finiteOr(base.tx)) / current) * scale
  const ty = finiteOr(curMid.y) - ((finiteOr(startMid.y) - finiteOr(base.ty)) / current) * scale
  return clampPan({ scale, tx, ty }, natural, viewport)
}

export function distance(a: Point, b: Point): number {
  return Math.hypot(finiteOr(b.x) - finiteOr(a.x), finiteOr(b.y) - finiteOr(a.y))
}

export function midpoint(a: Point, b: Point): Point {
  return {
    x: (finiteOr(a.x) + finiteOr(b.x)) / 2,
    y: (finiteOr(a.y) + finiteOr(b.y)) / 2,
  }
}

export function nextZoom(scale: number, direction: 1 | -1): number {
  const safe = Number.isFinite(scale) && scale > 0 ? scale : 1
  return clampScale(direction > 0 ? safe * ZOOM_STEP : safe / ZOOM_STEP)
}

/** Wheel deltas arrive in pixels (0), lines (1) or pages (2). */
export function normalizeWheelDelta(deltaY: number, deltaMode = 0, viewportHeight = 0): number {
  if (!Number.isFinite(deltaY) || deltaY === 0) return 0

  switch (deltaMode) {
    case 1:
      return deltaY * WHEEL_LINE_HEIGHT
    case 2:
      return (
        deltaY *
        (Number.isFinite(viewportHeight) && viewportHeight > 0
          ? viewportHeight
          : WHEEL_FALLBACK_PAGE_HEIGHT)
      )
    default:
      return deltaY
  }
}
