export interface WheelPlanInput {
  deltaY: number
  deltaX: number
  deltaMode: number
  shiftKey: boolean
  ctrlKey: boolean
  altKey: boolean
  metaKey: boolean
  velocity: number
  isAltScreen: boolean
  isMouseTracking: boolean
}

export interface WheelPlan {
  action: 'native' | 'amplify'
  deltaMode: number
  deltaY: number
  count: number
}

export const WHEEL_ACCEL_K = 0.05
// Acceleration is stored/passed as an integer LEVEL 0-5 (0 = off); each level maps to a
// small multiplier coefficient. Legacy stored floats (old 0-4 raw range) round to the
// nearest level.
export const WHEEL_ACCEL_COEFFS = [0, 0.01, 0.025, 0.05, 0.1, 0.2] as const

function clamp(v: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, v))
}

function native(input: WheelPlanInput): WheelPlan {
  return {
    action: 'native',
    deltaMode: input.deltaMode,
    deltaY: input.deltaY,
    count: 0,
  }
}

export function computeWheelPlan(
  input: WheelPlanInput,
  sensitivity: number,
  acceleration: number
): WheelPlan {
  // Identity fast-path: exact current behavior — native for ALL inputs (incl. non-finite velocity).
  if (sensitivity === 1 && acceleration === 0) return native(input)

  const modified = input.shiftKey || input.ctrlKey || input.altKey || input.metaKey
  const horizontal = Math.abs(input.deltaX) >= Math.abs(input.deltaY)
  if (modified || horizontal) return native(input)

  // Only PIXEL (0) and LINE (1) modes are eligible; PAGE (2) stays native.
  if (input.deltaMode !== 0 && input.deltaMode !== 1) return native(input)

  if (input.isAltScreen || input.isMouseTracking) return native(input)

  const velocity = Number.isFinite(input.velocity) ? input.velocity : 0
  const level = clamp(Math.round(acceleration), 0, 5)
  const coeff = WHEEL_ACCEL_COEFFS[level]
  // Floor 0.1 allows a sub-native slow band (sensitivity < 1); ceiling 4 is the speed cap.
  const scale = clamp(sensitivity * (1 + coeff * (velocity / WHEEL_ACCEL_K)), 0.1, 4)
  if (scale === 1) return native(input)

  // LINE mode rounds to whole lines; PIXEL mode passes the scaled float through —
  // xterm's Viewport divides pixel deltas by row height and accumulates fractions itself.
  const scaled = input.deltaY * scale
  const amplified =
    input.deltaMode === 1 ? Math.sign(input.deltaY) * Math.round(Math.abs(scaled)) : scaled
  // Tiny fractional line-mode delta can round to 0 (also covers de-amplified line-mode
  // deltas rounding to 0); fall back to native so the original scroll is not swallowed
  // (handler preventDefaults before re-dispatch, and _sendWheelEvent drops a 0-delta
  // synthetic event).
  if (amplified === 0) return native(input)

  return {
    action: 'amplify',
    deltaMode: input.deltaMode,
    deltaY: amplified,
    count: 1,
  }
}
