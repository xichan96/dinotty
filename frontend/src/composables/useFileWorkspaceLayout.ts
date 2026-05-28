import { ref, computed, type Ref, type ComputedRef } from 'vue'
import { isNarrowViewport } from '../utils/viewport'

const TREE_WIDTH_STORAGE = 'dinotty_tree_pane_width'

export interface FileWorkspaceLayout {
  narrow: Ref<boolean>
  isLandscape: Ref<boolean>
  drawerOpen: Ref<boolean>
  treePaneWidth: Ref<number>
  direction: ComputedRef<'horizontal' | 'vertical'>
  treeWrapStyle: ComputedRef<Record<string, string>>
  startTreeWidthDrag: (e: MouseEvent, body: HTMLElement | null) => void
  startTreeWidthDragTouch: (e: TouchEvent, body: HTMLElement | null) => void
  clampTreePaneWidth: (body: HTMLElement | null) => void
  onResize: () => void
  toggleDrawer: () => void
  openDrawer: () => void
}

function loadTreePaneWidth(): number {
  try {
    const v = parseInt(localStorage.getItem(TREE_WIDTH_STORAGE) || '', 10)
    if (Number.isFinite(v) && v >= 120 && v <= 720) return v
  } catch {}
  return 260
}

function persistTreePaneWidth(w: number) {
  try { localStorage.setItem(TREE_WIDTH_STORAGE, String(w)) } catch {}
}

export function useFileWorkspaceLayout(): FileWorkspaceLayout {
  const narrow = ref(isNarrowViewport())
  const isLandscape = ref(window.innerWidth > window.innerHeight)
  const drawerOpen = ref(isNarrowViewport())
  const treePaneWidth = ref(loadTreePaneWidth())

  const direction = computed(() => (isLandscape.value ? 'horizontal' : 'vertical') as 'horizontal' | 'vertical')

  const treeWrapStyle = computed((): Record<string, string> => {
    if (narrow.value) return { width: `${treePaneWidth.value}px` }
    return { width: `${treePaneWidth.value}px` }
  })

  function clampTreePaneWidth(body: HTMLElement | null) {
    if (!body) return
    const maxW = Math.min(body.getBoundingClientRect().width * 0.78, 560)
    if (treePaneWidth.value > maxW) treePaneWidth.value = Math.max(120, maxW)
  }

  function startTreeWidthDrag(e: MouseEvent, body: HTMLElement | null) {
    if (!body) return
    const startX = e.clientX
    const startW = treePaneWidth.value
    const overlay = document.createElement('div')
    overlay.style.cssText = 'position:fixed;inset:0;z-index:9999;cursor:col-resize;'
    document.body.appendChild(overlay)
    const onMove = (ev: MouseEvent) => {
      const rect = body.getBoundingClientRect()
      const maxW = Math.min(rect.width * 0.78, 560)
      const dx = ev.clientX - startX
      treePaneWidth.value = Math.max(120, Math.min(maxW, startW + dx))
    }
    const onUp = () => {
      overlay.remove()
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      persistTreePaneWidth(treePaneWidth.value)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  function startTreeWidthDragTouch(e: TouchEvent, body: HTMLElement | null) {
    if (!body) return
    const startX = e.touches[0].clientX
    const startW = treePaneWidth.value
    const onMove = (ev: TouchEvent) => {
      const touch = ev.touches[0]
      const rect = body.getBoundingClientRect()
      const maxW = Math.min(rect.width * 0.78, 560)
      const dx = touch.clientX - startX
      treePaneWidth.value = Math.max(120, Math.min(maxW, startW + dx))
    }
    const onEnd = () => {
      window.removeEventListener('touchmove', onMove)
      window.removeEventListener('touchend', onEnd)
      persistTreePaneWidth(treePaneWidth.value)
    }
    window.addEventListener('touchmove', onMove, { passive: true })
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

  return {
    narrow, isLandscape, drawerOpen, treePaneWidth,
    direction, treeWrapStyle,
    startTreeWidthDrag, startTreeWidthDragTouch, clampTreePaneWidth,
    onResize, toggleDrawer, openDrawer,
  }
}
