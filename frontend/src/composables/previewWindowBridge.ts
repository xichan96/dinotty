/**
 * Event contract between the main window (through Rust) and a native preview
 * window.
 *
 * Preview windows are multi-instance now: a file browser window is bound to the
 * terminal session it browses (one window per `sourcePaneId`), and every web
 * preview open creates a fresh window. Reopening the same file-browser session
 * focuses its window and carries the new target in this event. Window identity
 * travels in the URL (`windowLabel`) and in dock payloads.
 *
 * Rust owns the emission of `preview-window-navigate`
 * (`preview_windows.rs`); the dock pair is frontend-only. Keeping the names and
 * payload shapes here stops the two sides drifting apart.
 */
export const PREVIEW_WINDOW_NAVIGATE_EVENT = 'preview-window-navigate'

/** Preview window → main: its title bar is over the main window; merge it. */
export const PREVIEW_DOCK_REQUEST_EVENT = 'preview-window-dock-request'

/** Main → preview window: the merge succeeded (window is closing) or failed. */
export const PREVIEW_DOCK_RESULT_EVENT = 'preview-window-dock-result'

export interface PreviewWindowPayload {
  kind: 'files' | 'web'
  /** Workspace-relative or absolute path for the file browser. */
  path?: string | null
  /** Target URL for the web preview. */
  url?: string | null
  /** Terminal session the file browser binds to. */
  sourcePaneId?: string | null
}

export interface PreviewDockRequest {
  requestId: string
  /** Tauri window label of the preview being merged. */
  windowLabel: string
  kind: 'files' | 'web'
  sourcePaneId?: string | null
  path?: string | null
  url?: string | null
}

export type PreviewDockFailureReason = 'no-active-terminal' | 'invalid-target' | 'insert-failed'

export interface PreviewDockResult {
  requestId: string
  ok: boolean
  reason?: PreviewDockFailureReason
}
