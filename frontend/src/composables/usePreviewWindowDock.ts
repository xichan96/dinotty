import { isTauri, tauriInvoke } from './useTransport'
import { overlapRatio, titleBarRect, type WindowRect } from '../utils/windowDock'
import {
  PREVIEW_DOCK_REQUEST_EVENT,
  PREVIEW_DOCK_RESULT_EVENT,
  PREVIEW_DOCK_TARGET_EVENT,
  PREVIEW_DOCK_TARGET_REQUEST_EVENT,
  type PreviewDockFailureReason,
  type PreviewDockRequest,
  type PreviewDockResult,
  type PreviewDockTargetReply,
} from './previewWindowBridge'

/** Share of this window's title bar that must cover the main tab strip. */
const DOCK_HIT_RATIO = 0.5
/** Fallback for platforms with no pointer-button introspection: merge once the
 *  move has settled. Platforms with release detection never use this. */
const DOCK_SETTLE_MS = 400
/** Moving the native window fires continuously; sample the target at a rate
 *  the eye can follow without hammering the geometry IPC. */
const DOCK_HINT_THROTTLE_MS = 80
/** A missing reply means the main tab strip is not a viable target right now. */
const DOCK_TARGET_TIMEOUT_MS = 350
/** How often to ask whether the mouse button is still down while dragging. */
const DOCK_POLL_INTERVAL_MS = 50
/** A move that never becomes a drag (window snap, restore) should stop the
 *  poll instead of running it forever. */
const DOCK_POLL_IDLE_MS = 1200
/** If the main window never answers a dock request, unlock the gesture so the
 *  user can try again instead of being stuck. */
const DOCK_RESULT_TIMEOUT_MS = 3000
/** Standard macOS title-bar height, used only if the window reports no inset. */
const TITLE_BAR_FALLBACK_CSS = 28

export interface PreviewWindowDockOptions {
  /** Tauri window label of this preview window. */
  windowLabel: string
  kind: 'files' | 'web'
  /** Terminal session a file browser is bound to. */
  sourcePaneId?: () => string
  /** Live target of the preview: selected path or current web URL. */
  getLocation: () => { path?: string; url?: string }
  /** Called when the "title bar is over the main tab strip" hint turns on/off. */
  onHintChange?: (active: boolean) => void
  /** Called when the main window rejects the merge (window stays open). */
  onRejected?: (reason: PreviewDockFailureReason) => void
}

interface TauriWindowLike {
  label?: string
  outerPosition(): Promise<{ x: number; y: number }>
  innerPosition?(): Promise<{ x: number; y: number }>
  innerSize?(): Promise<{ width: number; height: number }>
  outerSize(): Promise<{ width: number; height: number }>
  scaleFactor?(): Promise<number>
  onMoved(handler: () => void): Promise<() => void>
  isVisible?(): Promise<boolean>
  unminimize?(): Promise<void>
  show?(): Promise<void>
  setFocus?(): Promise<void>
}

/**
 * Merge this preview window into the main window when the user releases its
 * native title bar over the main window's tab strip.
 *
 * There is no native "drop on another window" event, and a native title-bar
 * drag hands the pointer to the OS: the webview never sees the `mouseup`. The
 * gesture therefore does two things:
 *
 * - The drop target is the main window's tab strip (the tab bar up to the
 *   toolbar buttons), measured by the main window and requested over a Tauri
 *   event pair. Hovering the terminal area itself never matches.
 * - While the window moves, it polls `pointer_buttons_down` so the merge fires
 *   when the button is actually released over the strip, not merely when the
 *   movement pauses. Where the platform cannot report button state the command
 *   returns `null` and this falls back to merging after the move settles.
 *
 * On a hit this emits `preview-window-dock-request` to the main window. The
 * main window inserts the preview into its current workspace and closes this
 * window; if it cannot (no active terminal, empty URL, insert failure) it
 * replies with `preview-window-dock-result` and this window stays open.
 *
 * Returns a disposer; a no-op outside the desktop app.
 */
export function usePreviewWindowDock(options: PreviewWindowDockOptions): () => void {
  if (!isTauri() || !options.windowLabel) return () => {}
  const tauri = (window as any).__TAURI__
  const tauriWindow = tauri?.window
  const listen = tauri?.event?.listen
  const emitTo = tauri?.event?.emitTo
  if (
    !tauriWindow?.getCurrentWindow ||
    typeof listen !== 'function' ||
    typeof emitTo !== 'function'
  ) {
    return () => {}
  }

  let disposed = false
  let docking = false
  let timer: ReturnType<typeof setTimeout> | null = null
  let hintTimer: ReturnType<typeof setTimeout> | null = null
  let resultTimer: ReturnType<typeof setTimeout> | null = null
  let pollTimer: ReturnType<typeof setTimeout> | null = null
  let hintActive = false
  /** null until the first poll; false means "platform cannot tell". */
  let pointerSupported: boolean | null = null
  let polling = false
  let sawPress = false
  let stopMoved: (() => void) | null = null
  let stopResult: (() => void) | null = null
  let stopTarget: (() => void) | null = null
  let requestSeq = 0
  let pendingRequestId: string | null = null
  const pendingTargets = new Map<string, (rect: WindowRect | null) => void>()

  const clearTimer = () => {
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
    }
  }

  const clearHintTimer = () => {
    if (hintTimer !== null) {
      clearTimeout(hintTimer)
      hintTimer = null
    }
  }

  const clearResultTimer = () => {
    if (resultTimer !== null) {
      clearTimeout(resultTimer)
      resultTimer = null
    }
  }

  const stopPolling = () => {
    polling = false
    if (pollTimer !== null) {
      clearTimeout(pollTimer)
      pollTimer = null
    }
  }

  function setHint(active: boolean): void {
    if (disposed || hintActive === active) return
    hintActive = active
    options.onHintChange?.(active)
  }

  /** Reset after a rejected or unanswered request so a retry is possible. */
  function releaseDock(): void {
    docking = false
    pendingRequestId = null
  }

  async function headerRect(self: TauriWindowLike): Promise<WindowRect> {
    const [position, inner, size, scale] = await Promise.all([
      self.outerPosition(),
      self.innerPosition?.() ?? Promise.resolve(null),
      self.outerSize(),
      self.scaleFactor?.() ?? Promise.resolve(1),
    ])
    const factor = scale && scale > 0 ? scale : 1
    const inset =
      inner && inner.y > position.y ? inner.y - position.y : TITLE_BAR_FALLBACK_CSS * factor
    return titleBarRect(
      { x: position.x, y: position.y, width: size.width, height: size.height },
      inset
    )
  }

  /** Ask the main window where its tab strip is; null means "no target". */
  function requestTarget(): Promise<WindowRect | null> {
    if (disposed) return Promise.resolve(null)
    const requestId = `${options.windowLabel}-target-${++requestSeq}`
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        pendingTargets.delete(requestId)
        resolve(null)
      }, DOCK_TARGET_TIMEOUT_MS)
      pendingTargets.set(requestId, (rect) => {
        clearTimeout(timeout)
        resolve(rect)
      })
      try {
        void Promise.resolve(
          emitTo('main', PREVIEW_DOCK_TARGET_REQUEST_EVENT, { requestId })
        ).catch((error: unknown) => {
          pendingTargets.delete(requestId)
          clearTimeout(timeout)
          resolve(null)
          console.warn('[preview-window] dock target request failed', error)
        })
      } catch (error) {
        pendingTargets.delete(requestId)
        clearTimeout(timeout)
        resolve(null)
        console.warn('[preview-window] dock target request failed', error)
      }
    })
  }

  /** Share of this window's title bar that is over the main tab strip. */
  async function dockShare(self: TauriWindowLike): Promise<number> {
    const [header, target] = await Promise.all([headerRect(self), requestTarget()])
    if (!target) return 0
    return overlapRatio(header, target)
  }

  async function checkHint(self: TauriWindowLike, main: TauriWindowLike): Promise<void> {
    if (disposed || docking) return
    try {
      if (main.isVisible && !(await main.isVisible())) {
        setHint(false)
        return
      }
      setHint((await dockShare(self)) >= DOCK_HIT_RATIO)
    } catch {
      setHint(false)
    }
  }

  /** Hand the preview to the main window; it inserts the pane and closes us. */
  async function dockNow(self: TauriWindowLike, main: TauriWindowLike): Promise<void> {
    docking = true
    setHint(false)
    // Bring main forward before the preview lands there; this window may be
    // closed by the main window once the pane exists.
    await Promise.resolve(main.unminimize?.()).catch(() => {})
    await Promise.resolve(main.show?.()).catch(() => {})
    await Promise.resolve(main.setFocus?.()).catch(() => {})

    const requestId = `${options.windowLabel}-${++requestSeq}`
    pendingRequestId = requestId
    const location = options.getLocation()
    const request: PreviewDockRequest = {
      requestId,
      windowLabel: options.windowLabel,
      kind: options.kind,
      sourcePaneId: options.sourcePaneId?.(),
      ...location,
    }
    try {
      await emitTo('main', PREVIEW_DOCK_REQUEST_EVENT, request)
    } catch (error) {
      releaseDock()
      setHint(false)
      console.warn('[preview-window] failed to send the dock request', error)
      return
    }

    clearResultTimer()
    resultTimer = setTimeout(() => {
      resultTimer = null
      if (disposed || pendingRequestId !== requestId) return
      releaseDock()
    }, DOCK_RESULT_TIMEOUT_MS)
  }

  /** Re-measure at the final position and merge if the release was on target. */
  async function finishDrag(self: TauriWindowLike, main: TauriWindowLike): Promise<void> {
    if (disposed || docking) return
    try {
      if (main.isVisible && !(await main.isVisible())) {
        setHint(false)
        return
      }
      const share = await dockShare(self)
      if (disposed || docking) return
      if (share < DOCK_HIT_RATIO) {
        setHint(false)
        return
      }
      await dockNow(self, main)
    } catch (error) {
      releaseDock()
      setHint(false)
      console.warn('[preview-window] dock on release failed', error)
    }
  }

  /** Settle-based fallback for platforms without pointer-button state. */
  async function settleDock(self: TauriWindowLike, main: TauriWindowLike): Promise<void> {
    if (disposed || docking) return
    try {
      if (main.isVisible && !(await main.isVisible())) {
        setHint(false)
        return
      }
      const share = await dockShare(self)
      if (disposed || docking) return
      if (share < DOCK_HIT_RATIO) {
        setHint(false)
        return
      }
      await dockNow(self, main)
    } catch (error) {
      releaseDock()
      setHint(false)
      console.warn('[preview-window] dock check failed', error)
    }
  }

  function scheduleSettle(self: TauriWindowLike, main: TauriWindowLike): void {
    clearTimer()
    timer = setTimeout(() => {
      timer = null
      void settleDock(self, main)
    }, DOCK_SETTLE_MS)
  }

  /**
   * Watch the mouse button until it is released.
   *
   * `NSEvent.pressedMouseButtons` (macOS) and `GetAsyncKeyState` (Windows) tell
   * us whether a button is down even while the OS owns the title-bar drag. A
   * release after an observed press is the drop. Polls that never see a press
   * are a programmatic move, not a drag, and give up after a short idle.
   */
  function startPolling(self: TauriWindowLike, main: TauriWindowLike): void {
    if (polling || disposed || docking) return
    polling = true
    sawPress = false
    const startedAt = Date.now()

    const tick = async (): Promise<void> => {
      pollTimer = null
      if (disposed || docking) {
        stopPolling()
        return
      }

      let mask: number | null = null
      try {
        const value = await tauriInvoke('pointer_buttons_down')
        mask = typeof value === 'number' ? value : null
      } catch {
        // Older backend without the command: treat it like an unsupported
        // platform and keep the settle fallback.
      }
      if (disposed || docking) {
        stopPolling()
        return
      }

      if (mask === null) {
        // No introspection on this platform: keep the settle fallback.
        pointerSupported = false
        stopPolling()
        scheduleSettle(self, main)
        return
      }

      pointerSupported = true
      // Polling is authoritative now; the settle fallback must not fire.
      clearTimer()

      if (mask > 0) {
        sawPress = true
      } else if (sawPress) {
        stopPolling()
        void finishDrag(self, main)
        return
      } else if (Date.now() - startedAt >= DOCK_POLL_IDLE_MS) {
        stopPolling()
        return
      }

      pollTimer = setTimeout(() => void tick(), DOCK_POLL_INTERVAL_MS)
    }

    pollTimer = setTimeout(() => void tick(), DOCK_POLL_INTERVAL_MS)
  }

  function scheduleHint(self: TauriWindowLike, main: TauriWindowLike): void {
    if (disposed || docking || hintTimer !== null) return
    hintTimer = setTimeout(() => {
      hintTimer = null
      void checkHint(self, main)
    }, DOCK_HINT_THROTTLE_MS)
  }

  function onDockResult(payload: PreviewDockResult | null | undefined): void {
    if (disposed || !payload) return
    if (payload.requestId !== pendingRequestId) return
    clearResultTimer()
    if (payload.ok) {
      // The main window is closing this window after inserting the pane.
      return
    }
    releaseDock()
    setHint(false)
    options.onRejected?.(payload.reason ?? 'insert-failed')
  }

  void (async () => {
    try {
      const self = tauriWindow.getCurrentWindow() as TauriWindowLike
      const windows = (await tauriWindow.getAllWindows?.()) as TauriWindowLike[] | undefined
      const main = (windows ?? []).find((win) => win.label === 'main')
      if (!main || disposed) return

      // Register the reply channels before the first request can be sent.
      const stopResultFn = await listen(
        PREVIEW_DOCK_RESULT_EVENT,
        (event: { payload?: PreviewDockResult }) => onDockResult(event?.payload)
      )
      if (disposed) {
        stopResultFn()
        return
      }
      stopResult = stopResultFn

      const stopTargetFn = await listen(
        PREVIEW_DOCK_TARGET_EVENT,
        (event: { payload?: PreviewDockTargetReply }) => {
          const payload = event?.payload
          if (!payload) return
          const resolve = pendingTargets.get(payload.requestId)
          if (!resolve) return
          pendingTargets.delete(payload.requestId)
          resolve(payload.rect ?? null)
        }
      )
      if (disposed) {
        stopTargetFn()
        return
      }
      stopTarget = stopTargetFn

      const stopMovedFn = await self.onMoved(() => {
        if (disposed || docking) return
        scheduleHint(self, main)
        if (pointerSupported === false) {
          scheduleSettle(self, main)
          return
        }
        startPolling(self, main)
      })
      if (disposed) stopMovedFn()
      else stopMoved = stopMovedFn
    } catch (error) {
      console.warn('[preview-window] dock listener failed', error)
    }
  })()

  return () => {
    disposed = true
    clearTimer()
    clearHintTimer()
    clearResultTimer()
    stopPolling()
    hintActive = false
    docking = false
    pendingRequestId = null
    stopMoved?.()
    stopMoved = null
    stopResult?.()
    stopResult = null
    stopTarget?.()
    stopTarget = null
    for (const resolve of pendingTargets.values()) resolve(null)
    pendingTargets.clear()
  }
}
