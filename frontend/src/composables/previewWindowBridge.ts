/**
 * Event contract between the main window (through Rust) and a native preview
 * window. Reopening an already-open preview focuses that window and carries
 * the new target in this event, so a single window per kind suffices.
 *
 * Rust owns the emission (`preview_windows.rs`); keeping the name and payload
 * shape here stops the two sides drifting apart.
 */
export const PREVIEW_WINDOW_NAVIGATE_EVENT = 'preview-window-navigate'

export interface PreviewWindowPayload {
  kind: 'files' | 'web'
  /** Workspace-relative or absolute path for the file browser. */
  path?: string | null
  /** Target URL for the web preview. */
  url?: string | null
  /** Terminal session the file browser binds to. */
  sourcePaneId?: string | null
}
