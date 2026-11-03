import { isTauri } from './useTransport'
import type { WindowRect } from '../utils/windowDock'
import {
  DETACHED_DOCK_TARGET_EVENT,
  DETACHED_DOCK_TARGET_REQUEST_EVENT,
  type DockTargetReply,
  type DockTargetRequest,
} from './detachedWindowBridge'

interface TauriWindowLike {
  innerPosition?(): Promise<{ x: number; y: number }>
  scaleFactor?(): Promise<number>
}

/**
 * Answer dock-target requests from detached windows with the main window's
 * tab-bar rectangle in physical screen pixels.
 *
 * The tab bar — not the whole main window — is the recall target, so the
 * detached window needs its exact position. It moves with the main window,
 * changes size with the tab-bar placement (top/bottom/left/right) and the
 * mobile layout, so it is measured on demand rather than cached.
 *
 * Returns a disposer; a no-op outside the desktop app.
 */
export function useDockTargetReporter(): () => void {
  if (!isTauri()) return () => {}

  const tauri = (window as any).__TAURI__
  const listen = tauri?.event?.listen
  const emit = tauri?.event?.emit
  const getCurrentWindow = tauri?.window?.getCurrentWindow
  if (
    typeof listen !== 'function' ||
    typeof emit !== 'function' ||
    typeof getCurrentWindow !== 'function'
  ) {
    return () => {}
  }

  let disposed = false
  let unlisten: (() => void) | null = null

  async function measureTabBar(): Promise<WindowRect | null> {
    const element = document.getElementById('tab-bar')
    if (!element) return null
    const rect = element.getBoundingClientRect()
    if (rect.width < 1 || rect.height < 1) return null

    const win = getCurrentWindow() as TauriWindowLike
    const [position, scale] = await Promise.all([
      win.innerPosition?.() ?? Promise.resolve(null),
      win.scaleFactor?.() ?? Promise.resolve(1),
    ])
    if (!position) return null

    // DOM rects are CSS pixels relative to the client area; window geometry is
    // physical screen pixels. Both webviews compare in the latter.
    const factor = scale && scale > 0 ? scale : 1
    return {
      x: position.x + rect.left * factor,
      y: position.y + rect.top * factor,
      width: rect.width * factor,
      height: rect.height * factor,
    }
  }

  void Promise.resolve(
    listen(DETACHED_DOCK_TARGET_REQUEST_EVENT, (event: { payload?: DockTargetRequest }) => {
      const tabId = event?.payload?.tab_id
      const requestId = event?.payload?.request_id
      if (typeof tabId !== 'string' || !tabId) return
      if (typeof requestId !== 'string' || !requestId) return

      void measureTabBar()
        .then((rect) => {
          if (disposed) return
          const reply: DockTargetReply = { tab_id: tabId, request_id: requestId, rect }
          return emit(DETACHED_DOCK_TARGET_EVENT, reply)
        })
        .catch((error: unknown) => {
          console.warn('[detached] failed to report the tab-bar dock target', error)
        })
    })
  )
    .then((fn: () => void) => {
      if (disposed) fn()
      else unlisten = fn
    })
    .catch((error: unknown) => {
      console.warn('[detached] failed to listen for dock target requests', error)
    })

  return () => {
    disposed = true
    unlisten?.()
    unlisten = null
  }
}
