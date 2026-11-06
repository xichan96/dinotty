import { isTauri, tauriInvoke } from './useTransport'
import { overlapRatio, titleBarRect, type WindowRect } from '../utils/windowDock'
import {
  DETACHED_DOCK_TARGET_EVENT,
  DETACHED_DOCK_TARGET_REQUEST_EVENT,
  type DockTargetReply,
} from './detachedWindowBridge'

/** Share of this window's title bar that must cover the main tab bar. */
const DOCK_HIT_RATIO = 0.5
/** Wait for the move to settle, so dragging *through* the tab bar does not
 *  reattach by accident. */
const DOCK_SETTLE_MS = 400
/** Moving the native window fires continuously; sample the target at a rate
 *  the eye can follow without hammering the geometry IPC. */
const DOCK_HINT_THROTTLE_MS = 80
/** A missing reply means the main tab bar is not a viable target right now. */
const DOCK_TARGET_TIMEOUT_MS = 350
/** Standard macOS title-bar height, used only if the window reports no inset. */
const TITLE_BAR_FALLBACK_CSS = 28

export interface DetachedWindowDockOptions {
  /** Called when the "title bar is over the main tab bar" hint turns on/off. */
  onHintChange?: (active: boolean) => void
}

interface TauriWindowLike {
  label?: string
  outerPosition(): Promise<{ x: number; y: number }>
  innerPosition?(): Promise<{ x: number; y: number }>
  outerSize(): Promise<{ width: number; height: number }>
  scaleFactor?(): Promise<number>
  onMoved(handler: () => void): Promise<() => void>
  isVisible?(): Promise<boolean>
  unminimize?(): Promise<void>
  show?(): Promise<void>
  setFocus?(): Promise<void>
}

/**
 * Recall the detached tab when the user drags this window's native title bar
 * onto the main window's tab bar.
 *
 * There is no native "drop on another window" event, so the gesture is a move
 * that settles with the title-bar strip over the tab bar (see the constants
 * above). Only the title bar counts: parking the window body anywhere over the
 * main window does nothing, which keeps the target deliberate instead of
 * capturing the whole main window.
 *
 * The tab bar's screen rectangle belongs to the main window (it moves with it
 * and can be top/bottom/left/right), so it is requested over a Tauri event pair
 * and measured in physical pixels, the same space as the window geometry.
 *
 * The close carries `reattach: true`, so Rust reports a recall rather than a
 * terminal close and the main window remounts the tab. While the title bar is
 * over the tab bar, `onHintChange` drives the drop-target visuals in both
 * windows.
 *
 * Returns a disposer; a no-op outside the desktop app.
 */
export function useDetachedWindowDock(
  tabId: string,
  options: DetachedWindowDockOptions = {}
): () => void {
  if (!isTauri() || !tabId) return () => {}
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
  let hintActive = false
  let stopMoved: (() => void) | null = null
  let stopTarget: (() => void) | null = null
  let requestSeq = 0
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

  function setHint(active: boolean): void {
    if (disposed || hintActive === active) return
    hintActive = active
    options.onHintChange?.(active)
  }

  /** Ask the main window where its tab bar is; null means "no target". */
  function requestTarget(): Promise<WindowRect | null> {
    if (disposed) return Promise.resolve(null)
    const requestId = `${tabId}-${++requestSeq}`
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
          emitTo('main', DETACHED_DOCK_TARGET_REQUEST_EVENT, {
            tab_id: tabId,
            request_id: requestId,
          })
        ).catch((error: unknown) => {
          pendingTargets.delete(requestId)
          clearTimeout(timeout)
          resolve(null)
          console.warn('[detached] dock target request failed', error)
        })
      } catch (error) {
        pendingTargets.delete(requestId)
        clearTimeout(timeout)
        resolve(null)
        console.warn('[detached] dock target request failed', error)
      }
    })
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

  /** Share of this window's title bar that is over the main tab bar. */
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

  async function tryDock(self: TauriWindowLike, main: TauriWindowLike): Promise<void> {
    if (disposed || docking) return
    try {
      // A tray-hidden main window has no visible target to drop onto.
      if (main.isVisible && !(await main.isVisible())) {
        setHint(false)
        return
      }
      const share = await dockShare(self)
      if (disposed || docking) return
      setHint(share >= DOCK_HIT_RATIO)
      if (share < DOCK_HIT_RATIO) return

      docking = true
      setHint(false)
      // Bring main forward before the tab lands there; the detached window is
      // about to close.
      await Promise.resolve(main.unminimize?.()).catch(() => {})
      await Promise.resolve(main.show?.()).catch(() => {})
      await Promise.resolve(main.setFocus?.()).catch(() => {})
      await tauriInvoke('close_tab_window', { tabId, reattach: true })
    } catch (error) {
      console.warn('[detached] dock check failed', error)
    }
  }

  function scheduleHint(self: TauriWindowLike, main: TauriWindowLike): void {
    if (disposed || docking || hintTimer !== null) return
    hintTimer = setTimeout(() => {
      hintTimer = null
      void checkHint(self, main)
    }, DOCK_HINT_THROTTLE_MS)
  }

  void (async () => {
    try {
      const self = tauriWindow.getCurrentWindow() as TauriWindowLike
      const windows = (await tauriWindow.getAllWindows?.()) as TauriWindowLike[] | undefined
      const main = (windows ?? []).find((win) => win.label === 'main')
      if (!main || disposed) return

      // Register the reply channel before the first request can be sent.
      const stopTargetFn = await listen(
        DETACHED_DOCK_TARGET_EVENT,
        (event: { payload?: DockTargetReply }) => {
          const payload = event?.payload
          if (!payload || payload.tab_id !== tabId) return
          const resolve = pendingTargets.get(payload.request_id)
          if (!resolve) return
          pendingTargets.delete(payload.request_id)
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
        clearTimer()
        timer = setTimeout(() => void tryDock(self, main), DOCK_SETTLE_MS)
      })
      if (disposed) stopMovedFn()
      else stopMoved = stopMovedFn
    } catch (error) {
      console.warn('[detached] dock listener failed', error)
    }
  })()

  return () => {
    disposed = true
    clearTimer()
    clearHintTimer()
    hintActive = false
    stopMoved?.()
    stopMoved = null
    stopTarget?.()
    stopTarget = null
    for (const resolve of pendingTargets.values()) resolve(null)
    pendingTargets.clear()
  }
}
