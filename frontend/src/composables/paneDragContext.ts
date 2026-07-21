import { reactive, readonly } from 'vue'

/** Drop zone taxonomy for unified pane/tab drag-and-drop. */
export type DropZone =
  | 'left' | 'right' | 'top' | 'bottom' | 'center'
  | 'tab-label' | 'tab-blank'

/** Kind of drop target a candidate represents. */
export type DropTargetKind = 'pane' | 'tab-label' | 'tab-blank'

export interface PaneDragSnapshot {
  isDragging: boolean
  /** Pane being dragged (leaf paneId). */
  sourcePaneId: string | null
  /** Tab that owns the source pane. */
  sourceTabId: string | null
  /** Current drop target id (paneId or tabId, depending on targetKind). */
  targetId: string | null
  /** Active drop zone. */
  zone: DropZone | null
  /** Kind of the current drop target. */
  targetKind: DropTargetKind | null
  /** Tab currently being hovered during a pane drag (for hover-delay switching). */
  hoverTabId: string | null
  /** For Mode A: when set, the whole source tab is dragged as a subtree. */
  wholeTab: boolean
}

const state = reactive<PaneDragSnapshot>({
  isDragging: false,
  sourcePaneId: null,
  sourceTabId: null,
  targetId: null,
  zone: null,
  targetKind: null,
  hoverTabId: null,
  wholeTab: false,
})

/** Shared drag-and-drop coordinator. Singleton state across the app. */
export function usePaneDrag() {
  return {
    state: readonly(state),

    startDrag(payload: {
      sourcePaneId: string
      sourceTabId: string
      wholeTab?: boolean
    }) {
      state.isDragging = true
      state.sourcePaneId = payload.sourcePaneId
      state.sourceTabId = payload.sourceTabId
      state.wholeTab = payload.wholeTab ?? false
      state.targetId = null
      state.zone = null
      state.targetKind = null
      state.hoverTabId = null
    },

    setTarget(targetId: string, zone: DropZone, kind: DropTargetKind) {
      state.targetId = targetId
      state.zone = zone
      state.targetKind = kind
    },

    clearTarget() {
      state.targetId = null
      state.zone = null
      state.targetKind = null
    },

    setHoverTab(tabId: string | null) {
      state.hoverTabId = tabId
    },

    endDrag() {
      state.isDragging = false
      state.sourcePaneId = null
      state.sourceTabId = null
      state.targetId = null
      state.zone = null
      state.targetKind = null
      state.hoverTabId = null
      state.wholeTab = false
    },
  }
}
