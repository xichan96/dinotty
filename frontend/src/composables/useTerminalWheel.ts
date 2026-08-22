import type { Terminal as XTerm } from '@xterm/xterm'
import { computeWheelPlan, type TrackingWheelState, type WheelPlanInput } from './computeWheelPlan'
import { settings } from './useSettings'

export interface WheelHost {
  getXterm(): XTerm | null
  isMouseModeEnabled(): boolean
  getWritePinnedToBottom(): boolean
  setWritePinnedToBottom(v: boolean): void
}

export interface TerminalWheel {
  setup(): void
  cleanup(): void
  sendWheelEvent(deltaY: number, clientX: number, clientY: number, deltaMode?: number): void
  isBypassActive(): boolean
}

export function createTerminalWheel(host: WheelHost): TerminalWheel {
  let bypass = false
  let lastWheelTime = 0
  let trackingWheelState: TrackingWheelState | null = null
  let wheelRowHeightWarned = false
  let wheelUpAccumulated = 0
  let wheelUpResetTimer: ReturnType<typeof setTimeout> | null = null

  function isAtBottom(): boolean {
    const xt = host.getXterm()
    if (!xt) return true
    const buf = xt.buffer.active
    return buf.viewportY >= buf.baseY
  }

  function getWheelRowHeight(): number {
    const xt = host.getXterm()
    try {
      const h = Number((xt as any)?._core?._renderService?.dimensions?.css?.cell?.height)
      if (Number.isFinite(h) && h > 0) return h
    } catch {
      // fall through to the one-time warning below
    }
    if (!wheelRowHeightWarned) {
      wheelRowHeightWarned = true
      console.warn(
        '[useTerminalWheel] xterm private cell-height API (_core._renderService.dimensions.css.cell.height) unavailable or invalid; wheel-scroll acceleration (velocity term) is disabled, sensitivity still applies. xterm.js internals may have changed.'
      )
    }
    return 0
  }

  function isWheelReportedByApp(): boolean | undefined {
    const xt = host.getXterm()
    try {
      const core = (xt as any)?._core
      const svc = core?.coreMouseService ?? core?.mouseService ?? core?.services?.coreMouseService
      const activeProtocol = svc?.activeProtocol ?? svc?._activeProtocol
      if (typeof activeProtocol !== 'string') return undefined
      const events = svc?._protocols?.[activeProtocol]?.events
      return typeof events === 'number' ? (events & 16) !== 0 : undefined
    } catch {
      return undefined
    }
  }

  function sendWheelEvent(deltaY: number, clientX: number, clientY: number, deltaMode = 0) {
    const xt = host.getXterm()
    if (!xt || deltaY === 0) return
    const xtermEl = xt.element
    if (!xtermEl) return

    // Synthetic dispatches must never re-enter the adaptive-wheel planner.
    bypass = true
    try {
      xtermEl.dispatchEvent(
        new WheelEvent('wheel', {
          deltaY,
          deltaX: 0,
          deltaZ: 0,
          deltaMode,
          bubbles: true,
          cancelable: true,
          clientX,
          clientY,
        })
      )
    } finally {
      bypass = false
    }
  }

  function setup() {
    const xt = host.getXterm()
    xt?.attachCustomWheelEventHandler((e: WheelEvent): boolean => {
      if (bypass) return true
      const cur = host.getXterm()
      if (!cur) return true

      // xterm.js 5.5.0 hardcodes alt-screen wheel-to-arrow conversion with no
      // option (upstream issue #5194); keep this after _wheelBypass so touchScroll's
      // synthetic full-screen scrolling can still use that native conversion.
      if (cur.buffer.active.type === 'alternate' && isWheelReportedByApp() === false) {
        e.preventDefault()
        e.stopPropagation()
        return false
      }

      // Track user scroll intent to maintain the cross-batch viewport pin.
      // macOS trackpad inertia produces sub-pixel deltaY<0 events that set
      // xterm's isUserScrolling=true; without this filter, a single inertia
      // event between rAF-yielded write batches would un-pin and drop the
      // viewport above ybase mid-stream.
      if (e.deltaY < 0) {
        if (wheelUpResetTimer) clearTimeout(wheelUpResetTimer)
        wheelUpAccumulated += Math.abs(e.deltaY)
        if (wheelUpAccumulated > 8) {
          host.setWritePinnedToBottom(false)
        }
        wheelUpResetTimer = setTimeout(() => {
          wheelUpAccumulated = 0
          wheelUpResetTimer = null
        }, 500)
      } else if (e.deltaY > 0) {
        wheelUpAccumulated = 0
        if (isAtBottom()) {
          host.setWritePinnedToBottom(true)
        }
      }

      const now = Date.now()
      const elapsed = now - lastWheelTime
      if (elapsed > 500) trackingWheelState = null
      const dt = elapsed || 1
      const rowHeight = getWheelRowHeight()
      const lines =
        e.deltaMode === 1
          ? Math.abs(e.deltaY)
          : e.deltaMode === 0 && rowHeight > 0
            ? Math.abs(e.deltaY) / rowHeight
            : 0
      const velocity = lines / dt
      lastWheelTime = now

      const sensitivity = settings.text.scroll_sensitivity ?? 1
      const acceleration = settings.text.scroll_acceleration ?? 0
      const isMouseTracking = host.isMouseModeEnabled()
      if (!isMouseTracking) trackingWheelState = null
      const input: WheelPlanInput = {
        deltaY: e.deltaY,
        deltaX: e.deltaX,
        deltaMode: e.deltaMode,
        shiftKey: e.shiftKey,
        ctrlKey: e.ctrlKey,
        altKey: e.altKey,
        metaKey: e.metaKey,
        velocity,
        isMouseTracking,
      }
      const plan = computeWheelPlan(input, sensitivity, acceleration, trackingWheelState)
      if (plan.action === 'native') {
        trackingWheelState = null
        return true
      }
      trackingWheelState = plan.nextTrackingState ?? null

      e.preventDefault()
      e.stopPropagation()
      for (let i = 0; i < plan.count; i++) {
        sendWheelEvent(plan.deltaY, e.clientX, e.clientY, plan.deltaMode)
      }
      return false
    })
  }

  function cleanup() {
    if (wheelUpResetTimer) {
      clearTimeout(wheelUpResetTimer)
      wheelUpResetTimer = null
    }
    wheelUpAccumulated = 0
  }

  function isBypassActive() {
    return bypass
  }

  return { setup, cleanup, sendWheelEvent, isBypassActive }
}
