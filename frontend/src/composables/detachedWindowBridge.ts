import type { WindowRect } from '../utils/windowDock'

/**
 * Event names shared by the main window and detached tab windows.
 *
 * Keeping them here avoids the two webviews drifting apart on spelling and
 * keeps the payload shapes next to the names they belong to.
 */
export const DETACHED_WINDOW_CLOSED_EVENT = 'tab-window-closed'

/** Detached → main: its title bar is over the main tab bar (or left it). */
export const DETACHED_DOCK_HINT_EVENT = 'detached-dock-hint'

/** Detached → main: where is the tab bar on screen right now? */
export const DETACHED_DOCK_TARGET_REQUEST_EVENT = 'detached-dock-target-request'

/** Main → detached: reply with the tab-bar rectangle, or null if hidden. */
export const DETACHED_DOCK_TARGET_EVENT = 'detached-dock-target'

export interface DockTargetRequest {
  tab_id: string
  request_id: string
}

export interface DockTargetReply {
  tab_id: string
  request_id: string
  rect: WindowRect | null
}
