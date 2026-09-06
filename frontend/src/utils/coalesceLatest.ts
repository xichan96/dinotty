export type CoalesceLatest<T> = (value: T) => void

interface CoalesceLatestOptions {
  /** Minimum gap between consecutive emissions, in ms. */
  intervalMs: number
  now?: () => number
  schedule?: (fn: () => void, ms: number) => unknown
}

/**
 * Latest-value-wins throttler for high-frequency "show the current value"
 * feeds (e.g. system monitor samples over the sync WebSocket).
 *
 * A burst of `value` calls collapses so `emit` runs at most once per
 * `intervalMs`, always receiving the *newest* value of the burst, and the last
 * value seen is always emitted (trailing edge) even if the burst stops. Values
 * arriving slower than `intervalMs` pass through ~immediately, so the steady
 * 2s server cadence is unaffected.
 *
 * Inject `now`/`schedule` in tests to drive a fake clock.
 */
export function coalesceLatest<T>(
  emit: (value: T) => void,
  options: CoalesceLatestOptions
): CoalesceLatest<T> {
  const {
    intervalMs,
    now = () => performance.now(),
    schedule = (fn, ms) => setTimeout(fn, ms),
  } = options

  let lastEmitAt = -Infinity
  let pending: T | null = null
  let timer: unknown = null

  const flush = () => {
    timer = null
    if (pending === null) return
    const value = pending
    pending = null
    const wait = lastEmitAt + intervalMs - now()
    if (wait <= 0) {
      lastEmitAt = now()
      emit(value)
    } else {
      // Still inside the quiet window (clock jitter or a value landed between
      // the window boundary and this tick): re-arm to the boundary.
      timer = schedule(flush, wait)
    }
  }

  return (value) => {
    pending = value
    if (timer === null) {
      const wait = Math.max(0, lastEmitAt + intervalMs - now())
      timer = schedule(flush, wait)
    }
  }
}
