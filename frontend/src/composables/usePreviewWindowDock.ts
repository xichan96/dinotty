import { isTauri } from './useTransport'
import { overlapRatio, titleBarRect, type WindowRect } from '../utils/windowDock'
import {
  PREVIEW_DOCK_REQUEST_EVENT,
  PREVIEW_DOCK_RESULT_EVENT,
  type PreviewDockFailureReason,
  type PreviewDockRequest,
  type PreviewDockResult,
} from './previewWindowBridge'

/** Share of this window's title bar that must cover the main window. */
const DOCK_HIT_RATIO = 0.5
/** Wait for the move to settle, so dragging *through* the main window does not
 *  merge by accident. */
const DOCK_SETTLE_MS = 400
/** Moving the native window fires continuously; sample the target at a rate
 *  the eye can follow without hammering the geometry IPC. */
const DOCK_HINT_THROTTLE_MS = 80
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
  /** Called when the "title bar is over the main window" hint turns on/off. */
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
 * Merge this preview window into the main window when the user drags its native
 * title bar over the main window and lets go.
 *
 * There is no native "drop on another window" event, so the gesture is a move
 * that settles with the title-bar strip over the main window's content rect
 * (see the constants above). Only the title bar counts, which keeps the target
 * deliberate instead of capturing the whole window; the 400 ms settle prevents
 * a drag that merely passes over the main window from merging.
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
  let hintActive = false
  let stopMoved: (() => void) | null = null
  let stopResult: (() => void) | null = null
  let requestSeq = 0
  let pendingRequestId: string | null = null

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

  /** The main window's client area, in physical screen pixels. */
  async function mainContentRect(main: TauriWindowLike): Promise<WindowRect | null> {
    if (main.isVisible && !(await main.isVisible())) return null
    const [position, size] = await Promise.all([
      main.innerPosition?.() ?? Promise.resolve(null),
      main.innerSize?.() ?? Promise.resolve(null),
    ])
    if (!position || !size) return null
    const rect = { x: position.x, y: position.y, width: size.width, height: size.height }
    return rect.width > 0 && rect.height > 0 ? rect : null
  }

  /** Share of this window's title bar that is over the main window. */
  async function dockShare(self: TauriWindowLike, main: TauriWindowLike): Promise<number> {
    const [header, target] = await Promise.all([headerRect(self), mainContentRect(main)])
    if (!target) return 0
    return overlapRatio(header, target)
  }

  async function checkHint(self: TauriWindowLike, main: TauriWindowLike): Promise<void> {
    if (disposed || docking) return
    try {
      setHint((await dockShare(self, main)) >= DOCK_HIT_RATIO)
    } catch {
      setHint(false)
    }
  }

  async function tryDock(self: TauriWindowLike, main: TauriWindowLike): Promise<void> {
    if (disposed || docking) return
    try {
      const share = await dockShare(self, main)
      if (disposed || docking) return
      setHint(share >= DOCK_HIT_RATIO)
      if (share < DOCK_HIT_RATIO) return

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
      await emitTo('main', PREVIEW_DOCK_REQUEST_EVENT, request)

      clearResultTimer()
      resultTimer = setTimeout(() => {
        resultTimer = null
        if (disposed || pendingRequestId !== requestId) return
        releaseDock()
      }, DOCK_RESULT_TIMEOUT_MS)
    } catch (error) {
      releaseDock()
      setHint(false)
      console.warn('[preview-window] dock check failed', error)
    }
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

      // Register the result channel before the first request can be sent.
      const stopResultFn = await listen(
        PREVIEW_DOCK_RESULT_EVENT,
        (event: { payload?: PreviewDockResult }) => onDockResult(event?.payload)
      )
      if (disposed) {
        stopResultFn()
        return
      }
      stopResult = stopResultFn

      const stopMovedFn = await self.onMoved(() => {
        if (disposed || docking) return
        scheduleHint(self, main)
        clearTimer()
        timer = setTimeout(() => void tryDock(self, main), DOCK_SETTLE_MS)
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
    hintActive = false
    docking = false
    pendingRequestId = null
    stopMoved?.()
    stopMoved = null
    stopResult?.()
    stopResult = null
  }
}
