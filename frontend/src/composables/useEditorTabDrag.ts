import type { EditorDropPosition } from './useEditorSplit'

/** MIME used so a tab drag can be recognised by drop targets in this window. */
export const TAB_DRAG_MIME = 'application/x-dinotty-editor-tab'

export interface TabDragState {
  leafId: string
  tabId: string
  filePath: string
}

// `dataTransfer.getData` is not readable during dragover in every browser, so
// the active drag is also mirrored in module state for the duration.
let activeDrag: TabDragState | null = null

export function beginTabDrag(state: TabDragState): void {
  activeDrag = state
}

export function endTabDrag(): void {
  activeDrag = null
}

export function getTabDrag(): TabDragState | null {
  return activeDrag
}

export function isTabDragEvent(ev: DragEvent): boolean {
  const types = ev.dataTransfer?.types
  if (!types) return !!activeDrag
  return types.includes
    ? types.includes(TAB_DRAG_MIME)
    : (types as any).contains(TAB_DRAG_MIME)
}

/** Edge detection for dropping a tab on an editor group. */
export function tabDropPosition(
  rect: { left: number; top: number; width: number; height: number },
  clientX: number,
  clientY: number
): EditorDropPosition {
  const x = clientX - rect.left
  const y = clientY - rect.top
  // The tab bar alone is ~36px tall, so width and height get separate
  // thresholds; a single min(width, height) scale makes top/bottom unreachable.
  const edgeX = Math.min(rect.width * 0.25, 90)
  const edgeY = Math.min(rect.height * 0.25, 140)
  if (x < edgeX) return 'left'
  if (x > rect.width - edgeX) return 'right'
  if (y < edgeY) return 'top'
  if (y > rect.height - edgeY) return 'bottom'
  return 'center'
}
