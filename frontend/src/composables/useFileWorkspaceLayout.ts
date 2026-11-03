import { ref, computed, type Ref, type ComputedRef } from 'vue'
import { isNarrowViewport } from '../utils/viewport'

const TREE_WIDTH_STORAGE = 'dinotty_tree_pane_width'

const TREE_MIN_WIDTH = 120
const TREE_DEFAULT_WIDTH = 260
const TREE_DRAG_MAX_WIDTH = 560
const TREE_AUTO_MIN_WIDTH = 180
const TREE_AUTO_MAX_WIDTH = 420

/** Auto mode sizes the pane to its widest visible row (`max-content`), capped
 *  so long file names cannot crowd out the preview. */
const TREE_AUTO_STYLE: Record<string, string> = {
  width: 'max-content',
  minWidth: `${TREE_AUTO_MIN_WIDTH}px`,
  maxWidth: `min(78%, ${TREE_AUTO_MAX_WIDTH}px)`,
}

/**
 * `auto` sizes the pane to its widest visible row; `manual` is an explicit
 * pixel width the user chose by dragging the splitter.
 */
export type TreeWidthMode = 'auto' | 'manual'

export interface FileWorkspaceLayout {
  narrow: Ref<boolean>
  isLandscape: Ref<boolean>
  drawerOpen: Ref<boolean>
  treePaneWidth: Ref<number>
  treeWidthMode: Ref<TreeWidthMode>
  direction: ComputedRef<'horizontal' | 'vertical'>
  treeWrapStyle: ComputedRef<Record<string, string>>
  startTreeWidthDrag: (e: MouseEvent, body: HTMLElement | null, wrap?: HTMLElement | null) => void
  startTreeWidthDragTouch: (
    e: TouchEvent,
    body: HTMLElement | null,
    wrap?: HTMLElement | null
  ) => void
  clampTreePaneWidth: (body: HTMLElement | null) => void
  resetTreeWidthToAuto: () => void
  onResize: () => void
  toggleDrawer: () => void
  openDrawer: () => void
  closeDrawer: () => void
}

/** `null` means the user never dragged the splitter, so keep auto-fitting. */
function loadTreePaneWidth(): number | null {
  try {
    const raw = localStorage.getItem(TREE_WIDTH_STORAGE)
    if (raw === null) return null
    const v = parseInt(raw, 10)
    if (Number.isFinite(v) && v >= TREE_MIN_WIDTH && v <= 720) return v
  } catch {}
  return null
}

function persistTreePaneWidth(w: number) {
  try {
    localStorage.setItem(TREE_WIDTH_STORAGE, String(w))
  } catch {}
}

export function useFileWorkspaceLayout(): FileWorkspaceLayout {
  const storedWidth = loadTreePaneWidth()
  const narrow = ref(isNarrowViewport())
  const isLandscape = ref(window.innerWidth > window.innerHeight)
  const drawerOpen = ref(isNarrowViewport())
  const treePaneWidth = ref(storedWidth ?? TREE_DEFAULT_WIDTH)
  const treeWidthMode = ref<TreeWidthMode>(storedWidth === null ? 'auto' : 'manual')

  const direction = computed(
    () => (isLandscape.value ? 'horizontal' : 'vertical') as 'horizontal' | 'vertical'
  )

  // Narrow panes turn the tree into an overlay drawer whose width is owned by
  // CSS; a drag width would fight the drawer transition.
  const treeWrapStyle = computed((): Record<string, string> => {
    if (narrow.value) return {}
    if (treeWidthMode.value === 'auto') return TREE_AUTO_STYLE
    return { width: `${treePaneWidth.value}px` }
  })

  /** The splitter is rendered right after the tree wrap. Callers may pass the
   *  wrap explicitly; otherwise resolve it from the splitter that was hit. */
  function resolveTreeWrap(
    e: MouseEvent | TouchEvent,
    wrap: HTMLElement | null | undefined
  ): HTMLElement | null {
    if (wrap !== undefined) return wrap
    const target = e.currentTarget
    if (!(target instanceof HTMLElement)) return null
    return target.previousElementSibling as HTMLElement | null
  }

  /** Drag start from auto mode: take over at the currently rendered width so
   *  the pane does not jump before the pointer moves. */
  function beginManualTreeWidth(wrap: HTMLElement | null | undefined): number {
    const startW = wrap?.getBoundingClientRect().width ?? treePaneWidth.value
    treeWidthMode.value = 'manual'
    treePaneWidth.value = startW
    return startW
  }

  function maxTreeWidth(body: HTMLElement): number {
    return Math.min(body.getBoundingClientRect().width * 0.78, TREE_DRAG_MAX_WIDTH)
  }

  function clampTreePaneWidth(body: HTMLElement | null) {
    // Auto mode is capped by max-width; there is no stored number to clamp.
    if (!body || treeWidthMode.value !== 'manual') return
    const maxW = maxTreeWidth(body)
    if (treePaneWidth.value > maxW) {
      treePaneWidth.value = Math.max(TREE_MIN_WIDTH, maxW)
    }
  }

  function resetTreeWidthToAuto() {
    treeWidthMode.value = 'auto'
    try {
      localStorage.removeItem(TREE_WIDTH_STORAGE)
    } catch {}
  }

  function startTreeWidthDrag(e: MouseEvent, body: HTMLElement | null, wrap?: HTMLElement | null) {
    if (!body) return
    const startX = e.clientX
    const prevMode = treeWidthMode.value
    const startW = beginManualTreeWidth(resolveTreeWrap(e, wrap))
    let moved = false
    const overlay = document.createElement('div')
    overlay.style.cssText = 'position:fixed;inset:0;z-index:9999;cursor:col-resize;'
    document.body.appendChild(overlay)
    const onMove = (ev: MouseEvent) => {
      const dx = ev.clientX - startX
      if (dx !== 0) moved = true
      treePaneWidth.value = Math.max(TREE_MIN_WIDTH, Math.min(maxTreeWidth(body), startW + dx))
    }
    const onUp = () => {
      overlay.remove()
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      // A plain click on the splitter must not turn auto-fit into a manual
      // width; only an actual drag persists an override.
      if (!moved && prevMode === 'auto') {
        treeWidthMode.value = 'auto'
        return
      }
      persistTreePaneWidth(treePaneWidth.value)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  function startTreeWidthDragTouch(
    e: TouchEvent,
    body: HTMLElement | null,
    wrap?: HTMLElement | null
  ) {
    if (!body) return
    const startX = e.touches[0].clientX
    const prevMode = treeWidthMode.value
    const startW = beginManualTreeWidth(resolveTreeWrap(e, wrap))
    let moved = false
    const onMove = (ev: TouchEvent) => {
      ev.preventDefault()
      const touch = ev.touches[0]
      const dx = touch.clientX - startX
      if (dx !== 0) moved = true
      treePaneWidth.value = Math.max(TREE_MIN_WIDTH, Math.min(maxTreeWidth(body), startW + dx))
    }
    const onEnd = () => {
      window.removeEventListener('touchmove', onMove)
      window.removeEventListener('touchend', onEnd)
      if (!moved && prevMode === 'auto') {
        treeWidthMode.value = 'auto'
        return
      }
      persistTreePaneWidth(treePaneWidth.value)
    }
    window.addEventListener('touchmove', onMove, { passive: false })
    window.addEventListener('touchend', onEnd)
  }

  function onResize() {
    isLandscape.value = window.innerWidth > window.innerHeight
    narrow.value = isNarrowViewport()
  }

  function toggleDrawer() {
    if (!narrow.value) return
    drawerOpen.value = !drawerOpen.value
  }

  function openDrawer() {
    if (!narrow.value) return
    drawerOpen.value = true
  }

  function closeDrawer() {
    drawerOpen.value = false
  }

  return {
    narrow,
    isLandscape,
    drawerOpen,
    treePaneWidth,
    treeWidthMode,
    direction,
    treeWrapStyle,
    startTreeWidthDrag,
    startTreeWidthDragTouch,
    clampTreePaneWidth,
    resetTreeWidthToAuto,
    onResize,
    toggleDrawer,
    openDrawer,
    closeDrawer,
  }
}
