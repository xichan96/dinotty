import { isTauri } from './useTransport'
import type { WindowRect } from '../utils/windowDock'
import {
  DETACHED_DOCK_TARGET_EVENT,
  DETACHED_DOCK_TARGET_REQUEST_EVENT,
  type DockTargetReply,
  type DockTargetRequest,
} from './detachedWindowBridge'
import {
  PREVIEW_DOCK_TARGET_EVENT,
  PREVIEW_DOCK_TARGET_REQUEST_EVENT,
  type PreviewDockTargetReply,
  type PreviewDockTargetRequest,
} from './previewWindowBridge'

interface TauriWindowLike {
  innerPosition?(): Promise<{ x: number; y: number }>
  scaleFactor?(): Promise<number>
}

/** DOM rect fields used to convert a client rect into screen pixels. */
interface ClientRectLike {
  left: number
  top: number
  width: number
  height: number
}

/**
 * Answer dock-target requests from detached and preview windows with the
 * main window's dock rectangles in physical screen pixels.
 *
 * Detached windows dock back onto the whole tab bar. Preview windows dock onto
 * its strip — the bar up to where the toolbar buttons begin — because the
 * toolbar is not an insertion target (see `measureTabStrip`).
 *
 * Both rectangles move with the main window, change size with the tab-bar
 * placement (top/bottom/left/right) and the mobile layout, so they are measured
 * on demand rather than cached.
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
  const unlisten: Array<() => void> = []

  /** Convert a CSS-pixel client rect into physical screen pixels. */
  async function clientToScreenRect(rect: ClientRectLike): Promise<WindowRect | null> {
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

  function measurable(rect: DOMRect | undefined): ClientRectLike | null {
    return rect && rect.width >= 1 && rect.height >= 1 ? rect : null
  }

  /** The whole tab bar — the recall target for detached terminal windows. */
  async function measureTabBar(): Promise<WindowRect | null> {
    const element = document.getElementById('tab-bar')
    const rect = element ? measurable(element.getBoundingClientRect()) : null
    return rect ? clientToScreenRect(rect) : null
  }

  /**
   * The tab strip: the tab bar up to the toolbar buttons.
   *
   * Previews merge into the active terminal tab, so only the strip that holds
   * the tabs (plus the sidebar toggle in front of them) is a drop target; the
   * toolbar icons on the right are not. Vertical placements make the whole bar
   * a strip, so no clipping applies there.
   */
  async function measureTabStrip(): Promise<WindowRect | null> {
    const bar = document.getElementById('tab-bar')
    const barRect = bar ? measurable(bar.getBoundingClientRect()) : null
    if (!bar || !barRect) return null
    if (barRect.height > barRect.width) return clientToScreenRect(barRect)

    const tools = bar.querySelector('.tab-bar-tools')
    const toolsRect = tools ? measurable(tools.getBoundingClientRect()) : null
    const right =
      toolsRect && toolsRect.left > barRect.left
        ? Math.min(toolsRect.left, barRect.left + barRect.width)
        : barRect.left + barRect.width
    const width = right - barRect.left
    if (width < 1) return null
    return clientToScreenRect({
      left: barRect.left,
      top: barRect.top,
      width,
      height: barRect.height,
    })
  }

  function track(pending: Promise<() => void>): void {
    void pending
      .then((fn) => {
        if (disposed) fn()
        else unlisten.push(fn)
      })
      .catch((error: unknown) => {
        console.warn('[dock] failed to listen for dock target requests', error)
      })
  }

  track(
    Promise.resolve(
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
  )

  track(
    Promise.resolve(
      listen(PREVIEW_DOCK_TARGET_REQUEST_EVENT, (event: { payload?: PreviewDockTargetRequest }) => {
        const requestId = event?.payload?.requestId
        if (typeof requestId !== 'string' || !requestId) return

        void measureTabStrip()
          .then((rect) => {
            if (disposed) return
            const reply: PreviewDockTargetReply = { requestId, rect }
            return emit(PREVIEW_DOCK_TARGET_EVENT, reply)
          })
          .catch((error: unknown) => {
            console.warn('[preview-dock] failed to report the tab-strip target', error)
          })
      })
    )
  )

  return () => {
    disposed = true
    for (const fn of unlisten.splice(0)) fn()
  }
}
