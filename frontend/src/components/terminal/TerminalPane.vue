<template>
  <div
    ref="containerRef"
    class="terminal-pane-container"
    @contextmenu.prevent="onContextMenu"
    @touchstart="onTouchStart"
    @touchmove="onTouchMove"
    @touchend="onTouchEnd"
    @touchcancel="onTouchCancel"
  >
    <div ref="wrapperRef" class="terminal-pane"></div>
    <button
      v-if="scrollPos && !scrollPos.state.isAltScreen && !scrollPos.state.atBottom"
      class="back-to-bottom-pill"
      type="button"
      aria-label="Scroll to bottom"
      tabindex="-1"
      @click.stop="scrollToBottom"
      @mousedown.prevent
      @touchstart.stop
    >
      <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
    </button>
    <div
      v-if="showScrollbar"
      ref="scrollbarTrackRef"
      class="terminal-scrollbar"
      :class="{ 'is-active': scrollbarVisible }"
      :style="{ '--terminal-scrollbar-width': scrollbarWidthPx }"
    >
      <div
        ref="scrollbarThumbRef"
        class="terminal-scrollbar-thumb"
        :style="{ height: `${thumbHeightPct}%`, top: `${thumbTopPct}%` }"
        @touchstart.stop.prevent="onScrollbarTouchStart"
        @touchmove.stop.prevent="onScrollbarTouchMove"
        @touchend.stop="onScrollbarTouchEnd"
        @touchcancel.stop="onScrollbarTouchEnd"
      ></div>
    </div>
    <div v-if="uploadInProgress" class="terminal-upload-progress">
      <div class="terminal-upload-progress-track">
        <div class="terminal-upload-progress-fill" :style="{ width: `${uploadProgress}%` }"></div>
      </div>
      <span>{{ uploadProgressLabel() }}</span>
    </div>
    <SearchBar
      v-if="searchVisible && terminal"
      :terminal="terminal"
      @close="searchVisible = false"
    />
  </div>
  <TerminalContextMenu
    :visible="menuVisible"
    :x="menuX"
    :y="menuY"
    :selected-text="menuSelectedText"
    :link-type="linkType"
    :link-target="linkTarget"
    :is-ssh="!!props.sshHost"
    @close="closeMenu"
    @copy="onMenuCopy"
    @paste="onMenuPaste"
    @select-all="onMenuSelectAll"
    @open-file="onMenuOpenFile"
    @open-link="onMenuOpenLink"
    @split-horizontal="emit('splitHorizontal')"
    @split-vertical="emit('splitVertical')"
    @toggle-broadcast="emit('toggleBroadcast')"
    @new-local-terminal="emit('newLocalTerminal')"
  />
  <SelectionHandles
    :visible="handlesVisible"
    :start-x="handleStartX"
    :start-y="handleStartY"
    :end-x="handleEndX"
    :end-y="handleEndY"
    @drag="onHandleDrag"
    @drag-end="onHandleDragEnd"
  />
</template>

<script setup lang="ts">
import { ref, shallowRef, onMounted, onBeforeUnmount, nextTick } from 'vue'
import type { Terminal } from '@xterm/xterm'
import { TerminalInstance } from '../../composables/useTerminal'
import { copyToClipboard } from '../../utils/clipboard'
import { readText as readClipboardText } from '@tauri-apps/plugin-clipboard-manager'
import { isTauri } from '../../composables/useTransport'
import SearchBar from './SearchBar.vue'
import TerminalContextMenu from './TerminalContextMenu.vue'
import SelectionHandles from './SelectionHandles.vue'
import { shellEscapePath } from '../../utils/shell'
import { POSITION, useToast } from 'vue-toastification'
import { useI18n } from '../../composables/useI18n'
import { useUpload } from '../../composables/useUpload'
import { useScrollPosition, type ScrollPositionHandle } from '../../composables/useScrollPosition'
import { useIsMobile } from '../../composables/useIsMobile'
import { useSettings } from '../../composables/useSettings'
import { useUploadProgress } from '../../composables/useUploadProgress'
import { useScrollbarState } from '../../composables/useScrollbarState'

const props = defineProps<{
  paneId: string
  sshHost?: string // "user@host:port" for SSH tabs
}>()

const emit = defineEmits<{
  titleChange: [title: string]
  shellInfo: [shell: string]
  connect: []
  disconnect: []
  fileClick: [path: string]
  previewLink: [url: string]
  linkActivate: []
  input: [data: string]
  reconnect: []
  splitHorizontal: []
  splitVertical: []
  toggleBroadcast: []
  newLocalTerminal: []
}>()

const wrapperRef = ref<HTMLElement>()
const containerRef = ref<HTMLElement>()
const scrollbarTrackRef = ref<HTMLElement>()
const scrollbarThumbRef = ref<HTMLElement>()
const scrollPos = shallowRef<ScrollPositionHandle | null>(null)
const { isMobile } = useIsMobile()
const { settings } = useSettings()

// F2 - mobile-web custom scrollbar (scrollback only). Reuses the step-0 observer.
const {
  scrollbarVisible,
  scrollbarWidthPx,
  showScrollbar,
  thumbHeightPct,
  thumbTopPct,
  bumpScrollbarActivity,
  scrollbarLineFromClientY,
  onScrollbarDragTo,
  onScrollbarTouchStart,
  onScrollbarTouchMove,
  onScrollbarTouchEnd,
  dispose: disposeScrollbar,
} = useScrollbarState({
  scrollPos,
  scrollbarTrackRef,
  scrollbarThumbRef,
  isMobile,
  settings,
  onScrollToLine: (line: number) => {
    terminal?.xterm?.scrollToLine(line)
  },
})

let terminal: TerminalInstance | null = null
let pendingFocus = false
let paneAlive = true
let insertQueue = Promise.resolve()
const searchVisible = ref(false)
const toast = useToast()
const { t } = useI18n()
const { uploadFiles, uploadErrorStatus } = useUpload()
const {
  uploadInProgress,
  uploadProgress,
  uploadLoaded,
  uploadTotal,
  uploadProcessing,
  beginUploadProgress,
  uploadProgressLabel,
  updateUploadProgress,
  finishUploadProgress,
  uploadErrorMessage,
} = useUploadProgress({ t, uploadErrorStatus })

// Context menu state
const menuVisible = ref(false)
const menuX = ref(0)
const menuY = ref(0)
const menuSelectedText = ref('')

// Long-press state (mobile)
let longPressTimer: ReturnType<typeof setTimeout> | null = null
let longPressStartX = 0
let longPressStartY = 0
let longPressFired = false
let touchScrolling = false

// Selection handles state
const handlesVisible = ref(false)
const handleStartX = ref(0)
const handleStartY = ref(0)
const handleEndX = ref(0)
const handleEndY = ref(0)
let selAnchorRow = 0
let selAnchorCol = 0
// Long-pressed word range — keeps the whole word selected regardless of drag
// direction (DT8 #2). selWordRow < 0 means "no active word selection".
let selWordRow = -1
let selWordStartCol = -1
let selWordEndCol = -1
let dragHandle: 'start' | 'end' | null = null
let selectionTouched = false


// Edge auto-scroll during selection drag (A4) — repeating scroll while the
// finger is held in the top/bottom edge band, so selection can extend past the
// visible viewport. lastDrag* hold the RAW (unclamped) touch coords: edge
// detection needs the real off-edge position, while selection math clamps.
let autoScrollTimer: ReturnType<typeof setInterval> | null = null
let lastDragClientX = 0
let lastDragClientY = 0
const EDGE_SCROLL_ZONE_CELLS = 1.5
const EDGE_SCROLL_INTERVAL_MS = 60

// Link context menu state
const linkType = ref<'file' | 'link'>()
const linkTarget = ref<string>()

const DT8_TOUCH_DEBUG = import.meta.env.DEV && (typeof localStorage !== 'undefined') && localStorage.getItem('dt8-touch-select-debug') === '1'

function debugTouchSelect(branch: string, data: Record<string, unknown>) {
  if (DT8_TOUCH_DEBUG) console.debug('[dt8-touch-select]', branch, data)
}

function getTerminal() {
  return terminal
}

function focus() {
  if (terminal?.xterm) {
    pendingFocus = false
    terminal.focus()
    return
  }
  pendingFocus = true
}

function blur() {
  pendingFocus = false
  terminal?.blur()
}

function fit() {
  terminal?.fit()
}

function isComposing(): boolean {
  return terminal?.isComposing ?? false
}

function sendData(data: string, force?: boolean) {
  return terminal?.sendData(data, force)
}

function pasteFromClipboard(text: string, autoEnter = false): boolean {
  if (!paneAlive || !terminal || !text) return false
  terminal.focus()
  terminal.pasteText(text)
  if (autoEnter && !/[\r\n]/.test(text)) terminal.sendInput('\r')
  return true
}

function setOutputListener(cb: ((data: string) => void) | null) {
  if (terminal) terminal.onRawOutput = cb
}

function toggleSearch() {
  searchVisible.value = !searchVisible.value
}

function scrollToBottom() {
  terminal?.xterm?.scrollToBottom()
  scrollPos.value?.kick()
}


function adjustFontSize(delta: number) {
  terminal?.adjustFontSize(delta)
}

function resetFontSize() {
  terminal?.resetFontSize()
}

function onContextMenu(e: MouseEvent) {
  if (!terminal) return
  const text = terminal.getSelection()
  if (terminal.isMouseModeEnabled() && !text) return
  menuSelectedText.value = text
  menuX.value = e.clientX
  menuY.value = e.clientY
  menuVisible.value = true
}

function closeMenu() {
  menuVisible.value = false
  handlesVisible.value = false
  linkType.value = undefined
  linkTarget.value = undefined
  nextTick(() => terminal?.focus())
}

function onMenuCopy() {
  // copy already handled in TerminalContextMenu
}

async function onMenuPaste() {
  if (!terminal) return
  let text: string | null = null
  if (isTauri()) {
    try {
      text = await readClipboardText()
    } catch {}
  }
  if (text === null) {
    try {
      text = await navigator.clipboard.readText()
    } catch {}
  }
  if (text === null) {
    toast.error(t('mobileKb.pasteFailed'), { position: POSITION.BOTTOM_CENTER })
    return
  }
  if (text === '') {
    toast.info(t('mobileKb.clipboardEmpty'), { position: POSITION.BOTTOM_CENTER })
    return
  }
  pasteFromClipboard(text, false)
}

function onMenuSelectAll() {
  terminal?.selectAll()
}

function onMenuOpenFile(path: string) {
  emit('fileClick', path)
}

function onMenuOpenLink(url: string) {
  emit('previewLink', url)
}

// Cached cell dimensions for touch selection
let cachedCellW = 0
let cachedCellH = 0
let cachedScreenRect: DOMRect | null = null

type ScreenCellGeometry = { cellW: number; cellH: number; screenRect: DOMRect }

function getScreenCellGeometry(xt: NonNullable<TerminalInstance['xterm']>): ScreenCellGeometry | null {
  const screen = xt.element?.querySelector('.xterm-screen') as HTMLElement | null
  if (!screen) {
    debugTouchSelect('geometry:null-screen', { cols: xt.cols, rows: xt.rows })
    return null
  }
  const screenRect = screen.getBoundingClientRect()
  if (screenRect.width <= 0 || screenRect.height <= 0 || xt.cols <= 0 || xt.rows <= 0) {
    debugTouchSelect('geometry:null-rect', {
      width: screenRect.width,
      height: screenRect.height,
      cols: xt.cols,
      rows: xt.rows,
    })
    return null
  }
  const cellW = screenRect.width / xt.cols
  const cellH = screenRect.height / xt.rows
  if (!(cellW > 0) || !(cellH > 0)) {
    debugTouchSelect('geometry:null-cell', {
      cellW,
      cellH,
      width: screenRect.width,
      height: screenRect.height,
      cols: xt.cols,
      rows: xt.rows,
    })
    return null
  }
  return { cellW, cellH, screenRect }
}

function cacheCellDims(geom?: ScreenCellGeometry) {
  const xt = terminal?.xterm
  if (!xt) return false
  const geometry = geom ?? getScreenCellGeometry(xt)
  if (!geometry) return false
  cachedCellW = geometry.cellW
  cachedCellH = geometry.cellH
  cachedScreenRect = geometry.screenRect
  return true
}

function touchToBufferPos(clientX: number, clientY: number): { col: number; row: number } | null {
  const xt = terminal?.xterm
  if (!xt || !cachedScreenRect || !cachedCellW || !cachedCellH) return null
  const col = Math.max(0, Math.floor((clientX - cachedScreenRect.left) / cachedCellW))
  const row = Math.max(0, Math.floor((clientY - cachedScreenRect.top) / cachedCellH))
  return { col: Math.min(col, xt.cols - 1), row: Math.min(row, xt.rows - 1) }
}

function findWordAt(bufferRow: number, col: number): { start: number; length: number } | null {
  const xt = terminal?.xterm
  if (!xt) return null
  const line = xt.buffer.active.getLine(bufferRow)
  if (!line) return null
  const lineText = line.translateToString(true)
  if (!lineText) return null
  const wordRegex = /[\w.:/@-]+/g
  let match: RegExpExecArray | null
  while ((match = wordRegex.exec(lineText)) !== null) {
    if (col >= match.index && col < match.index + match[0].length) {
      return { start: match.index, length: match[0].length }
    }
  }
  return null
}

function calcSelectionLength(startCol: number, startRow: number, endCol: number, endRow: number): number {
  const xt = terminal?.xterm
  if (!xt) return 0
  const cols = xt.cols
  if (startRow === endRow) {
    return Math.max(1, endCol - startCol + 1)
  }
  // xterm.js wraps at `cols` columns — use cols for intermediate lines, not content length
  let len = cols - startCol
  for (let r = startRow + 1; r < endRow; r++) {
    len += cols
  }
  len += Math.min(endCol + 1, cols)
  return Math.max(1, len)
}

// True if buffer position (r1,c1) is strictly before (r2,c2).
function beforePos(r1: number, c1: number, r2: number, c2: number): boolean {
  return r1 < r2 || (r1 === r2 && c1 < c2)
}

function updateSelectionTo(clientX: number, clientY: number) {
  const xt = terminal?.xterm
  if (!xt) return
  const pos = touchToBufferPos(clientX, clientY)
  if (!pos) return
  const endRow = xt.buffer.active.viewportY + pos.row
  const endCol = pos.col
  // Always keep the originally long-pressed word fully selected, regardless of
  // drag direction: span from the earlier of {drag point, word start} to the
  // later of {drag point, word end}. Leftward drag used to anchor at the word
  // start and drop the word body (DT8 #2).
  let loR = endRow
  let loC = endCol
  let hiR = endRow
  let hiC = endCol
  if (selWordRow >= 0) {
    if (beforePos(selWordRow, selWordStartCol, loR, loC)) {
      loR = selWordRow
      loC = selWordStartCol
    }
    if (beforePos(hiR, hiC, selWordRow, selWordEndCol)) {
      hiR = selWordRow
      hiC = selWordEndCol
    }
  }
  xt.select(loC, loR, calcSelectionLength(loC, loR, hiC, hiR))
  // Keep selStart pointing at the selection's low point so the handle-drag
  // 'end' anchor stays consistent after a leftward drag.
  terminal!.selStartRow = loR
  terminal!.selStartCol = loC
}

function bufferToPixel(col: number, bufferRow: number): { x: number; y: number } {
  const xt = terminal?.xterm
  if (!xt || !cachedScreenRect || !cachedCellW || !cachedCellH) return { x: 0, y: 0 }
  const viewportY = xt.buffer.active.viewportY
  const row = bufferRow - viewportY
  return {
    x: cachedScreenRect.left + col * cachedCellW,
    y: cachedScreenRect.top + row * cachedCellH,
  }
}

function selectionToPixelCoords(): { start: { x: number; y: number }; end: { x: number; y: number } } {
  const xt = terminal?.xterm
  if (!xt) return { start: { x: 0, y: 0 }, end: { x: 0, y: 0 } }
  const selection = xt.getSelectionPosition()
  if (!selection) return { start: { x: 0, y: 0 }, end: { x: 0, y: 0 } }
  // getSelectionPosition() returns 0-based coordinates (despite type definition saying 1-based)
  // start handle: left edge of first selected char
  // end handle: right edge of last selected char (end.x is one past last selected)
  const start = bufferToPixel(selection.start.x, selection.start.y)
  const end = bufferToPixel(selection.end.x, selection.end.y)
  return { start, end }
}

// Mobile long-press to start touch selection
function onTouchStart(e: TouchEvent) {
  if (!terminal) return
  if (handlesVisible.value) return // selection mode active, don't start new long-press
  if (longPressTimer) clearTimeout(longPressTimer)
  longPressFired = false
  selWordRow = -1
  touchScrolling = false
  terminal.touchMoved = false
  const touch = e.touches[0]
  longPressStartX = touch.clientX
  longPressStartY = touch.clientY
  longPressTimer = setTimeout(() => {
    const xt = terminal?.xterm
    if (!xt) return
    const geom = getScreenCellGeometry(xt)
    if (!geom) return

    const wordPos = selectWordAtTouch(longPressStartX, longPressStartY, geom)
    if (!wordPos) return

    // Enter selection mode
    cacheCellDims(geom)
    terminal!.inTouchSelection = true
    terminal!.selStartRow = wordPos.bufferRow
    terminal!.selStartCol = wordPos.startCol
    selAnchorRow = wordPos.bufferRow
    selAnchorCol = wordPos.startCol
    selWordRow = wordPos.bufferRow
    selWordStartCol = wordPos.startCol
    selWordEndCol = wordPos.endCol
    longPressFired = true // set only after a word is actually selected (DT8 #5)
    selectionTouched = false

    // Show handles at selection boundaries
    const coords = selectionToPixelCoords()
    handleStartX.value = coords.start.x
    handleStartY.value = coords.start.y
    handleEndX.value = coords.end.x
    handleEndY.value = coords.end.y
    handlesVisible.value = true
    dragHandle = null

    // Also show context menu (standard long-press UX)
    const text = terminal!.getSelection()
    menuSelectedText.value = text
    menuX.value = longPressStartX
    menuY.value = longPressStartY
    menuVisible.value = true
  }, 500)
}

function buildColumnMaps(line: NonNullable<ReturnType<Terminal['buffer']['active']['getLine']>>, cols: number) {
  const colToStrIdx: number[] = new Array(cols)
  const strIdxToCol: number[] = []
  let strIdx = 0
  let lastStartStrIdx = -1
  for (let col = 0; col < cols; col++) {
    const cell = line.getCell(col)
    const width = cell ? cell.getWidth() : 1
    if (width === 0) {
      // continuation column of the previous wide char — shares that char's start index
      colToStrIdx[col] = lastStartStrIdx
      continue
    }
    const codeUnits = cell?.getChars().length || 1
    lastStartStrIdx = strIdx
    colToStrIdx[col] = strIdx
    for (let i = 0; i < codeUnits; i++) strIdxToCol[strIdx + i] = col
    strIdx += codeUnits
  }
  return { colToStrIdx, strIdxToCol }
}

function selectWordAtTouch(clientX: number, clientY: number, geom: ScreenCellGeometry): { bufferRow: number; startCol: number; endCol: number } | null {
  const xterm = terminal?.xterm
  if (!xterm) {
    debugTouchSelect('select:null-xterm', {})
    return null
  }

  const col = Math.floor((clientX - geom.screenRect.left) / geom.cellW)
  const row = Math.floor((clientY - geom.screenRect.top) / geom.cellH)
  const geometryFacts = {
    cellW: geom.cellW,
    cellH: geom.cellH,
    screenLeft: geom.screenRect.left,
    screenTop: geom.screenRect.top,
    screenWidth: geom.screenRect.width,
    screenHeight: geom.screenRect.height,
    col,
    row,
    cols: xterm.cols,
    rows: xterm.rows,
  }

  if (col < 0 || row < 0 || col >= xterm.cols || row >= xterm.rows) {
    debugTouchSelect('select:out-of-bounds', geometryFacts)
    return null
  }

  const buffer = xterm.buffer.active
  const bufferRow = buffer.viewportY + row
  const line = buffer.getLine(bufferRow)
  if (!line) {
    debugTouchSelect('select:null-line', { ...geometryFacts, bufferRow })
    return null
  }

  const lineText = line.translateToString(true)
  if (!lineText) {
    debugTouchSelect('select:empty-line', { ...geometryFacts, bufferRow })
    return null
  }

  const { colToStrIdx, strIdxToCol } = buildColumnMaps(line, xterm.cols)
  const strCol = colToStrIdx[col]
  if (strCol === undefined || strCol < 0) {
    debugTouchSelect('select:no-word', { ...geometryFacts, bufferRow })
    return null
  }

  const wordRegex = /[\w.:/@-]+|[一-鿿]+/g
  let match: RegExpExecArray | null
  while ((match = wordRegex.exec(lineText)) !== null) {
    if (strCol >= match.index && strCol < match.index + match[0].length) {
      const startCol = strIdxToCol[match.index]
      const lastStrIdx = match.index + match[0].length - 1
      const lastCol = strIdxToCol[lastStrIdx]
      if (startCol == null || lastCol == null) return null
      const lastWidth = line.getCell(lastCol)?.getWidth() ?? 1
      const columnLength = lastCol - startCol + Math.max(lastWidth, 1)
      const endCol = startCol + columnLength - 1
      xterm.select(startCol, bufferRow, columnLength)
      debugTouchSelect('select:success', {
        ...geometryFacts,
        bufferRow,
        startCol,
        length: columnLength,
      })
      return { bufferRow, startCol, endCol }
    }
  }
  debugTouchSelect('select:no-word', { ...geometryFacts, bufferRow })
  return null
}

// Clamp a client Y into the terminal screen so the selection endpoint always
// lands on visible content (A3) — prevents the drag from "leaking" into the
// input row / status bar below the terminal. Edge auto-scroll (A4) reveals the
// off-screen content instead.
function clampClientYToScreen(clientY: number): number {
  if (!cachedScreenRect) return clientY
  return Math.min(Math.max(clientY, cachedScreenRect.top), cachedScreenRect.bottom - 1)
}

// Which edge band the RAW touch Y sits in: -1 = top (scroll up), 1 = bottom
// (scroll down), 0 = middle (no auto-scroll).
function edgeScrollDir(clientY: number): -1 | 0 | 1 {
  if (!cachedScreenRect || !cachedCellH) return 0
  const zone = cachedCellH * EDGE_SCROLL_ZONE_CELLS
  if (clientY < cachedScreenRect.top + zone) return -1
  if (clientY > cachedScreenRect.bottom - zone) return 1
  return 0
}

function stopAutoScroll() {
  if (autoScrollTimer) {
    clearInterval(autoScrollTimer)
    autoScrollTimer = null
  }
}

function startAutoScrollIfEdge() {
  if (edgeScrollDir(lastDragClientY) !== 0) {
    if (!autoScrollTimer) autoScrollTimer = setInterval(autoScrollTick, EDGE_SCROLL_INTERVAL_MS)
  } else {
    stopAutoScroll()
  }
}

// Re-extend the selection to the current (clamped) drag point without touching
// lastDrag* — used by both live touch/handle drag and the auto-scroll timer.
function applyTouchSelection(clientX: number, clientY: number) {
  updateSelectionTo(clientX, clampClientYToScreen(clientY))
  menuSelectedText.value = terminal!.xterm?.getSelection() ?? ''
  const coords = selectionToPixelCoords()
  handleStartX.value = coords.start.x
  handleStartY.value = coords.start.y
  handleEndX.value = coords.end.x
  handleEndY.value = coords.end.y
}

function autoScrollTick() {
  const xt = terminal?.xterm
  if (!xt) { stopAutoScroll(); return }
  const dir = edgeScrollDir(lastDragClientY)
  if (dir === 0) { stopAutoScroll(); return }
  const before = xt.buffer.active.viewportY
  xt.scrollLines(dir)
  if (xt.buffer.active.viewportY === before) { stopAutoScroll(); return } // hit top/bottom
  if (dragHandle) {
    applyHandleDrag(lastDragClientX, lastDragClientY)
  } else if (terminal?.inTouchSelection) {
    applyTouchSelection(lastDragClientX, lastDragClientY)
  } else {
    stopAutoScroll()
  }
}

function onTouchMove(e: TouchEvent) {
  if (dragHandle) return // handle drag in progress, ignore terminal touch
  if (terminal?.inTouchSelection) {
    e.preventDefault()
    if (!selectionTouched) {
      selectionTouched = true
      menuVisible.value = false // Close menu when user starts adjusting
    }
    const touch = e.touches[0]
    lastDragClientX = touch.clientX
    lastDragClientY = touch.clientY
    applyTouchSelection(touch.clientX, touch.clientY)
    startAutoScrollIfEdge()
    return
  }
  const touch = e.touches[0]
  // Cancel long-press timer on any movement > 10px
  if (longPressTimer && !longPressFired) {
    if (
      Math.abs(touch.clientX - longPressStartX) > 10 ||
      Math.abs(touch.clientY - longPressStartY) > 10
    ) {
      clearTimeout(longPressTimer)
      longPressTimer = null
    }
  }
  // Detect scroll gesture (vertical movement > horizontal) —
  // dispatch terminal-scroll so App.vue's keyboard guard works.
  // The viewport handlers in useTerminal.ts don't fire because
  // .xterm-screen overlays .xterm-viewport in the DOM.
  if (!touchScrolling) {
    const dx = Math.abs(touch.clientX - longPressStartX)
    const dy = Math.abs(touch.clientY - longPressStartY)
    if (dy > dx && dy > 15) {
      touchScrolling = true
      if (terminal) terminal.touchMoved = true;
      (e.currentTarget as HTMLElement).dispatchEvent(
        new CustomEvent('terminal-scroll', { bubbles: true })
      )
    }
  }
}

function onTouchEnd(e: TouchEvent) {
  if (dragHandle) return // handle drag in progress, ignore terminal touch
  if (terminal?.inTouchSelection) {
    e.preventDefault()
    stopAutoScroll()
    terminal.inTouchSelection = false
    const text = terminal.xterm?.getSelection() ?? ''
    const target = e.currentTarget as HTMLElement
    if (text) {
      // Dispatch synchronously (not inside the copy .then()) so App.vue's
      // onTerminalTouch sees scrollGestureDetected before it decides whether
      // to show the on-screen keyboard toolbar — an async dispatch arrives
      // after kbVisible is already set, causing a visible flash.
      target.dispatchEvent(new CustomEvent('terminal-scroll', { bubbles: true }))
      void copyToClipboard(text).then(
        () => debugTouchSelect('copy:touch-end', { success: true }),
        () => debugTouchSelect('copy:touch-end', { success: false }),
      )
    }
    menuSelectedText.value = text
    if (selectionTouched) {
      if (text) {
        // User dragged to adjust → show menu at end handle (clamp into
        // viewport so it doesn't render under the bottom status bar, A3)
        menuX.value = handleEndX.value
        menuY.value = Math.min(handleEndY.value + 24, window.innerHeight - 8)
        menuVisible.value = true
      } else {
        handlesVisible.value = false
      }
    }
    // If not touched: menu already visible from long press, keep it
    selectionTouched = false
    longPressFired = false
    return
  }
  if (longPressFired) {
    // A long-press that entered selection mode is handled in the branch above;
    // reaching here means it did not — just clear the flag (DT8 #5).
    longPressFired = false
  }
  if (longPressTimer) {
    clearTimeout(longPressTimer)
    longPressTimer = null
  }
  if (touchScrolling) {
    touchScrolling = false;
    (e.currentTarget as HTMLElement).dispatchEvent(
      new CustomEvent('terminal-scroll', { bubbles: true })
    )
  }
}

function onTouchCancel() {
  stopAutoScroll()
  if (longPressTimer) {
    clearTimeout(longPressTimer)
    longPressTimer = null
  }
  longPressFired = false
  touchScrolling = false
  selectionTouched = false
  dragHandle = null
  if (terminal) terminal.inTouchSelection = false
  handlesVisible.value = false
}

// Handle drag from selection handles
function onHandleDrag(handle: 'start' | 'end', clientX: number, clientY: number) {
  const xt = terminal?.xterm
  if (!xt) return
  selectionTouched = true
  if (!dragHandle) {
    dragHandle = handle
    // Block scroll handler during handle drag
    terminal!.inTouchSelection = true
    menuVisible.value = false
    if (handle === 'end') {
      selAnchorRow = terminal!.selStartRow
      selAnchorCol = terminal!.selStartCol
    } else {
      const selPos = xt.getSelectionPosition()
      if (selPos) {
        selAnchorRow = selPos.end.y
        selAnchorCol = selPos.end.x - 1 // end.x is one past last selected
      }
    }
  }
  lastDragClientX = clientX
  lastDragClientY = clientY
  applyHandleDrag(clientX, clientY)
  startAutoScrollIfEdge()
}

// Extend the handle-drag selection to the (clamped) point. Anchor is already
// fixed in selAnchorRow/Col by onHandleDrag's init block. Does not touch
// lastDrag* — safe to call from the auto-scroll timer.
function applyHandleDrag(clientX: number, clientY: number) {
  const xt = terminal?.xterm
  if (!xt) return
  const pos = touchToBufferPos(clientX, clampClientYToScreen(clientY))
  if (!pos) return
  // Convert viewport-relative to absolute buffer coordinates
  const moveRow = xt.buffer.active.viewportY + pos.row
  const moveCol = pos.col
  if (moveRow < selAnchorRow || (moveRow === selAnchorRow && moveCol < selAnchorCol)) {
    xt.select(moveCol, moveRow, calcSelectionLength(moveCol, moveRow, selAnchorCol, selAnchorRow))
    terminal!.selStartRow = moveRow
    terminal!.selStartCol = moveCol
  } else {
    xt.select(selAnchorCol, selAnchorRow, calcSelectionLength(selAnchorCol, selAnchorRow, moveCol, moveRow))
    terminal!.selStartRow = selAnchorRow
    terminal!.selStartCol = selAnchorCol
  }
  menuSelectedText.value = xt.getSelection() ?? ''
  const coords = selectionToPixelCoords()
  handleStartX.value = coords.start.x
  handleStartY.value = coords.start.y
  handleEndX.value = coords.end.x
  handleEndY.value = coords.end.y
}

function onHandleDragEnd(canceled = false) {
  stopAutoScroll()
  if (terminal) terminal.inTouchSelection = false
  dragHandle = null
  const text = terminal?.xterm?.getSelection() ?? ''
  if (!canceled && text) {
    // Dispatch synchronously — see onTouchEnd for why (avoids a keyboard-toolbar flash).
    containerRef.value?.dispatchEvent(new CustomEvent('terminal-scroll', { bubbles: true }))
    void copyToClipboard(text).then(
      () => debugTouchSelect('copy:handle-drag-end', { success: true }),
      () => debugTouchSelect('copy:handle-drag-end', { success: false }),
    )
  }
  menuSelectedText.value = text
  if (text) {
    menuX.value = handleEndX.value
    menuY.value = Math.min(handleEndY.value + 24, window.innerHeight - 8)
    menuVisible.value = true
  } else {
    handlesVisible.value = false
  }
}

onMounted(() => {
  terminal = new TerminalInstance(props.paneId)
  paneAlive = true
  const self = terminal
  if (props.sshHost) self.sshHost = props.sshHost
  self.onTitleChange = (tv) => emit('titleChange', tv)
  self.onShellInfo = (s) => emit('shellInfo', s)
  self.onConnect = () => emit('connect')
  self.onDisconnect = () => emit('disconnect')
  self.onInput = (data) => emit('input', data)
  self.onReconnect = () => emit('reconnect')
  self.onFileClick = (path, x, y) => {
    emit('linkActivate')
    linkType.value = 'file'
    linkTarget.value = path
    if (x != null && y != null) {
      menuX.value = x
      menuY.value = y
    }
    menuSelectedText.value = ''
    menuVisible.value = true
  }
  self.onPreviewLink = (url, x, y) => {
    emit('linkActivate')
    linkType.value = 'link'
    linkTarget.value = url
    if (x != null && y != null) {
      menuX.value = x
      menuY.value = y
    }
    menuSelectedText.value = ''
    menuVisible.value = true
  }
  self.onFileUpload = async (files) => {
    // Attach the settle handlers synchronously so a fast-rejecting upload can never
    // surface as an unhandled rejection while an earlier insert is still queued.
    beginUploadProgress()
    const uploadResult = uploadFiles(files, {
      synthesizeNames: true,
      onProgress: updateUploadProgress,
    })
      .then(
        (data) => ({ data }),
        (err) => ({ err })
      )
      .finally(finishUploadProgress)
    const doInsert = async () => {
      try {
        const result = await uploadResult
        if ('err' in result) throw result.err
        const data = result.data
        if (!paneAlive) return
        const saved = data.saved ?? []
        if (saved.length) self.sendData(saved.map(shellEscapePath).join(' ') + ' ', true)
        window.dispatchEvent(new CustomEvent('dinotty-upload-status', { detail: data }))
        toast.success(t('mobileKb.uploadDone'), { position: POSITION.BOTTOM_CENTER })
      } catch (err) {
        if (!paneAlive) return
        toast.error(uploadErrorMessage(err), { position: POSITION.BOTTOM_CENTER })
      }
    }
    const insertTurn = insertQueue.then(() => doInsert()).catch(() => undefined)
    insertQueue = insertTurn
    await insertTurn
  }

  requestAnimationFrame(() => {
    if (wrapperRef.value) {
      terminal!.attach(wrapperRef.value)
      if (terminal!.xterm) scrollPos.value = useScrollPosition(terminal!.xterm)
      if (pendingFocus) {
        pendingFocus = false
        terminal!.focus()
      }
    }
  })
})

onBeforeUnmount(() => {
  paneAlive = false
  stopAutoScroll()
  scrollPos.value?.dispose()
  scrollPos.value = null
  disposeScrollbar()
  terminal?.destroy()
  terminal = null
})

defineExpose({ getTerminal, focus, blur, fit, sendData, pasteFromClipboard, setOutputListener, toggleSearch, adjustFontSize, resetFontSize, isComposing })
</script>

<style scoped>
.terminal-pane-container {
  width: 100%;
  flex: 1;
  min-height: 0;
  position: relative;
}
.terminal-pane {
  width: 100%;
  height: 100%;
  overflow: hidden;
}

.terminal-upload-progress {
  position: fixed;
  right: 16px;
  bottom: 20vh;
  z-index: 600;
  display: flex;
  align-items: center;
  gap: 8px;
  width: 180px;
  padding: 7px 9px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-surface);
  color: var(--fg);
  font-size: 12px;
  pointer-events: none;
}

.terminal-upload-progress-track {
  flex: 1;
  height: 4px;
  overflow: hidden;
  border-radius: 999px;
  background: var(--bg-hover);
}

.terminal-upload-progress-fill {
  height: 100%;
  border-radius: inherit;
  background: #4da3ff;
  transition: width 0.16s ease;
}

.back-to-bottom-pill {
  position: absolute;
  left: 12px;
  bottom: 12px;
  width: 32px;
  height: 32px;
  border-radius: 999px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  z-index: 5;
  pointer-events: auto;
  background: var(--bg-surface);
  border: 1px solid var(--border);
  color: var(--fg);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
  transition: opacity 0.15s ease, transform 0.15s ease;
}

.back-to-bottom-pill:hover {
  background: var(--bg-hover);
}

.terminal-scrollbar {
  position: absolute;
  top: 4px;
  right: 2px;
  bottom: 4px;
  width: var(--terminal-scrollbar-width, 8px);
  z-index: 5;
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.2s ease;
}

.terminal-scrollbar.is-active {
  opacity: 1;
}

/* Rail never captures touches (would swallow terminal scroll / trigger long-press on the
   dead strip); only the visible thumb is targetable. */
.terminal-scrollbar-thumb {
  position: absolute;
  left: 1px;
  right: 1px;
  min-height: 24px;
  border-radius: 999px;
  background: var(--scrollbar-thumb);
  border: 1px solid var(--border);
  pointer-events: none;
}

.terminal-scrollbar.is-active .terminal-scrollbar-thumb {
  pointer-events: auto;
}
</style>
