import type { Terminal } from '@xterm/xterm'

// IME anchor heuristic ported from
// https://github.com/msdshsk/xterm-ime-anchor (MIT).
//
// Problem: Ink-based TUIs (Claude Code, inkchat, …) don't cursor-park at the
// input field after rendering, so the terminal's hardware cursor — and
// therefore xterm.js's IME anchor — ends up at the wrong place (on Windows
// ConPTY, typically the right edge / end of a status row). The preedit and
// candidate window then anchor at the right edge and the UI appears to shift
// left as the composed text grows.
//
// Observation: every Ink <TextInput> draws its caret as a single inverse-video
// space (SGR 7 + ' ' + SGR 27) on the input row. That inverse cell reliably
// marks the visual input position regardless of the hardware cursor.
//
// The same problem hits TUIs that DO try to cursor-park (pi's editor emits an
// APC marker at the caret and positions the hardware cursor there): ConPTY is
// not a passthrough — conhost rebuilds the VT stream from its own screen
// buffer and drops sequences it does not understand (including the APC
// marker), then leaves the cursor at the end of its last screen sweep (the
// right edge of the last changed row). pi's caret is an inverse cell too, but
// on an empty input it is a trailing inverse space, which old conhost sweeps
// away as "styled trailing whitespace". When the inverse scan finds nothing,
// a second heuristic bridges the gap (#323): if the hardware cursor sits
// past the end of its row's visible content, it is a parked sweep artifact —
// the true input position is the content end of that row (right after the
// prompt/committed text of an input line). Shells cursor-park exactly at the
// content end, so they keep xterm's hardware anchor untouched.
//
// xterm.js's CompositionHelper owns TWO DOM elements that both need to be at
// "where the user expects IME to appear":
//   1. `.xterm-helper-textarea` — the hidden input that receives IME events.
//      The browser anchors the IME candidate panel to this element.
//   2. `.composition-view` — a visible <div> that xterm.js renders the preedit
//      INTO, positioned absolutely inside `.xterm-helpers`.
//
// xterm's internal updateCompositionElements() writes style.left/top on both
// elements every ~0 ms via setTimeout recursion while composing, always based
// on buffer.x/y (the hardware cursor). We therefore:
//   a) compute the anchor on compositionstart,
//   b) pin both elements' left/top to that anchor with !important, and
//   c) observe the style attribute of each and re-pin when xterm overwrites.
//
// Fall-through: if no inverse cell is in the visible viewport AND the hardware
// cursor looks legitimately parked (at the content end), we do nothing and let
// xterm.js keep its default hardware-cursor anchor (correct for normal
// shells, because shells naturally cursor-park after their prompt).

export type ImeAnchorSource = 'heuristic' | 'hardware' | 'contentEnd'

export type ImeAnchor = {
  source: ImeAnchorSource
  col: number
  row: number
}

export type AttachOptions = {
  onAnchor?: (a: ImeAnchor) => void
  // If the inverse cell we're about to anchor on is adjacent to ANOTHER inverse
  // cell, we've latched onto a highlight/selection run rather than an Ink caret
  // (caret = one lone inverse cell). Default: true. The original xterm-ime-anchor
  // checked `leftInv && rightInv` here, but in a right-to-left scan that is
  // unreachable — the first inverse cell found always has a non-inverse right
  // neighbour — so the selection-run skip never fired. Skipping on EITHER
  // neighbour makes the run-skip actually work.
  requireIsolatedCell?: boolean
}

export type Detached = { detach(): void }

// Minimal structural slice of xterm's IBufferCell/IBufferLine/IBuffer. The
// real xterm types satisfy these, and a fake does too — so the pure scans
// below are unit-testable without spinning up a terminal.
export interface ImeBufferCellLike {
  isInverse(): number
  // xterm IBufferCell: '' for never-written cells, the glyph otherwise.
  // Optional so legacy fakes (inverse-only) still satisfy the slice.
  getChars?(): string
  getWidth?(): number
}

export interface ImeBufferLineLike {
  length: number
  getCell(x: number): ImeBufferCellLike | undefined
}

export interface ImeBufferScan {
  viewportY: number
  getLine(y: number): ImeBufferLineLike | undefined
}

// Scan the visible buffer for the lone inverse cell that marks an Ink caret.
// Right-to-left, bottom-up: trailing caret indicators win over earlier
// decorative inverse runs. Returns viewport-relative coordinates.
export function findInverseCell(
  buffer: ImeBufferScan,
  rows: number,
  requireIsolatedCell = true
): { col: number; row: number } | null {
  const startY = buffer.viewportY
  for (let y = startY + rows - 1; y >= startY; y--) {
    const line = buffer.getLine(y)
    if (!line) continue
    for (let x = line.length - 1; x >= 0; x--) {
      const cell = line.getCell(x)
      if (!cell || !cell.isInverse()) continue

      if (requireIsolatedCell) {
        const left = x > 0 ? line.getCell(x - 1) : null
        const right = x + 1 < line.length ? line.getCell(x + 1) : null
        const leftInv = !!left && !!left.isInverse()
        const rightInv = !!right && !!right.isInverse()
        // Not a lone caret -> highlight/selection run. Skip.
        if (leftInv || rightInv) continue
      }

      return { col: x, row: y - startY }
    }
  }
  return null
}

export function resolveImeAnchor(
  hit: { col: number; row: number } | null,
  hardwareCursor: { col: number; row: number }
): ImeAnchor {
  if (!hit) return { source: 'hardware', col: hardwareCursor.col, row: hardwareCursor.row }
  return { source: 'heuristic', col: hit.col, row: hit.row }
}

// Exclusive column where the row's visible content ends — where an input
// caret visually sits on a prompt/typed-text line. An inverse cell counts as
// content even when it is a space (a fake caret is visible). null when the
// whole row is blank.
export function findRowContentEnd(line: ImeBufferLineLike | undefined): number | null {
  if (!line) return null
  for (let x = line.length - 1; x >= 0; x--) {
    const cell = line.getCell(x)
    if (!cell) continue
    const width = cell.getWidth?.() ?? 1
    // getWidth() === 0 marks the continuation half of a wide glyph.
    if (width === 0) continue
    const chars = cell.getChars?.() ?? ''
    const inverse = !!cell.isInverse()
    if (!inverse && chars.trim() === '') continue
    return x + Math.max(width, 1)
  }
  return null
}

export interface AnchorFallbackContext {
  cols: number
  rows: number
  viewportY: number
  // Viewport-relative hardware cursor (xterm's buffer.active.cursorX/Y).
  hardwareCursor: { col: number; row: number }
  lineAt(viewportRow: number): ImeBufferLineLike | undefined
}

// Second-chance anchor for when the inverse-cell scan found nothing (#323).
// Returns null to keep xterm's hardware-cursor anchor, which is correct
// whenever the cursor is legitimately parked — shells park exactly at the end
// of the typed text (within one cell, to allow a space before the caret).
// A hardware cursor further past the content end is a ConPTY sweep artifact;
// then the plausible input position is the content end of the cursor's row.
export function resolveFallbackAnchor(ctx: AnchorFallbackContext): ImeAnchor | null {
  const hw = ctx.hardwareCursor
  if (hw.row < 0 || hw.row >= ctx.rows) return null
  const end = findRowContentEnd(ctx.lineAt(hw.row))
  // +1 tolerance: prompts like "> " park the caret one cell past the text.
  const suspect = end === null ? hw.col > 1 : hw.col > end + 1
  if (!suspect) return null
  if (end === null) {
    // Blank row (ConPTY swept an empty input's inverse-space caret away):
    // anchor at the row start rather than the right edge. The candidate
    // window lands at the prompt's leading edge — near the input, no stretch.
    return { source: 'contentEnd', col: 0, row: hw.row }
  }
  return { source: 'contentEnd', col: Math.min(end, ctx.cols - 1), row: hw.row }
}

export function computeCellSize(
  screen: { getBoundingClientRect(): { width: number; height: number } },
  cols: number,
  rows: number,
  renderCell?: { width: number; height: number }
): { w: number; h: number } {
  // Prefer the render service's CSS cell size — it accounts for
  // letter_spacing/line_height, which a plain rect/cols division does not.
  if (renderCell && renderCell.width > 0 && renderCell.height > 0) {
    return { w: renderCell.width, h: renderCell.height }
  }
  const rect = screen.getBoundingClientRect()
  return {
    w: rect.width / Math.max(cols, 1),
    h: rect.height / Math.max(rows, 1),
  }
}

function renderCellSize(terminal: Terminal): { width: number; height: number } | null {
  try {
    const core = (
      terminal as {
        _core?: {
          _renderService?: { dimensions?: { css?: { cell?: { width?: number; height?: number } } } }
        }
      }
    )._core
    const cell = core?._renderService?.dimensions?.css?.cell
    if (cell && (cell.width ?? 0) > 0 && (cell.height ?? 0) > 0) {
      return { width: cell.width as number, height: cell.height as number }
    }
  } catch {
    /* fall through to rect-based estimate */
  }
  return null
}

export function attachImeHeuristic(terminal: Terminal, options: AttachOptions = {}): Detached {
  const { onAnchor, requireIsolatedCell = true } = options

  const root = terminal.element
  if (!root) return { detach() {} }

  // xterm.js stable DOM structure (since 4.x):
  //   .xterm
  //     .xterm-screen
  //       .xterm-helpers
  //         .xterm-helper-textarea   (hidden input for IME capture)
  //         .composition-view        (visible div for preedit text)
  const textarea = root.querySelector('.xterm-helper-textarea') as HTMLTextAreaElement | null
  const screen = root.querySelector('.xterm-screen') as HTMLElement | null
  const compositionView = root.querySelector('.composition-view') as HTMLElement | null

  if (!textarea || !screen || !compositionView) {
    return { detach() {} }
  }

  let composing = false
  let pinned: { left: string; top: string } | null = null
  let renderDisposable: { dispose(): void } | null = null

  // A single MutationObserver routed at both elements — we re-apply whenever
  // xterm's recursive setTimeout writes the hardware-cursor coordinates back.
  const reapply = (el: HTMLElement) => {
    if (!composing || !pinned) return
    if (el.style.left !== pinned.left || el.style.top !== pinned.top) {
      el.style.setProperty('left', pinned.left, 'important')
      el.style.setProperty('top', pinned.top, 'important')
    }
  }
  const moTa = new MutationObserver(() => reapply(textarea))
  const moCv = new MutationObserver(() => reapply(compositionView))

  const cellSize = () => {
    const rc = renderCellSize(terminal)
    return computeCellSize(screen, terminal.cols, terminal.rows, rc ?? undefined)
  }

  // Pin both elements to `anchor` (viewport-relative cells, clamped to the
  // screen so a stale anchor can never push the preedit outside the pane).
  function pin(anchor: ImeAnchor) {
    const { w, h } = cellSize()
    const col = Math.min(Math.max(anchor.col, 0), terminal.cols - 1)
    const row = Math.min(Math.max(anchor.row, 0), terminal.rows - 1)
    const left = `${Math.round(col * w)}px`
    const top = `${Math.round(row * h)}px`
    if (pinned && pinned.left === left && pinned.top === top) return

    pinned = { left, top }
    textarea!.style.setProperty('left', left, 'important')
    textarea!.style.setProperty('top', top, 'important')
    compositionView!.style.setProperty('left', left, 'important')
    compositionView!.style.setProperty('top', top, 'important')

    onAnchor?.({ ...anchor, col, row })
  }

  // Re-scan the buffer and update the pin. Called on compositionstart AND on
  // every render while composing. The latter is required for IME partial
  // commit: when the user keeps typing mid-conversion, the browser emits a
  // compositionend+compositionstart pair; Ink hasn't redrawn yet at that
  // instant (the just-committed text is still in flight to the PTY), so the
  // caret's inverse cell is at the OLD position. A couple of render ticks
  // later Ink redraws with the new caret — this handler follows it.
  function recomputeAndPin() {
    if (!composing) return

    const hit = findInverseCell(terminal.buffer.active, terminal.rows, requireIsolatedCell)
    if (!hit) {
      // Don't reset `pinned` here: the buffer state between partial-commit
      // render cycles can transiently lose the inverse cell (Ink sometimes
      // clears-then-redraws). Keep the last known anchor until composition
      // ends or a new inverse cell is found.
      return
    }

    pin({ source: 'heuristic', col: hit.col, row: hit.row })
  }

  // Resolve the compositionstart anchor when the inverse-cell scan found
  // nothing: hardware cursor if it looks legitimately parked, otherwise the
  // content-end heuristic (#323: ConPTY-parked cursors on TUI input rows).
  function resolveStartAnchor(): ImeAnchor {
    const buffer = terminal.buffer.active
    const fallback = resolveFallbackAnchor({
      cols: terminal.cols,
      rows: terminal.rows,
      viewportY: buffer.viewportY,
      hardwareCursor: { col: buffer.cursorX, row: buffer.cursorY },
      lineAt: (row) => buffer.getLine(buffer.viewportY + row),
    })
    return fallback ?? { source: 'hardware', col: buffer.cursorX, row: buffer.cursorY }
  }

  function onCompositionStart() {
    composing = true

    // Initial scan. If no inverse cell is present right now, try the
    // content-end fallback before deferring to xterm's hardware anchor.
    const hit = findInverseCell(terminal.buffer.active, terminal.rows, requireIsolatedCell)
    if (hit) {
      recomputeAndPin()
    } else {
      const anchor = resolveStartAnchor()
      if (anchor.source === 'hardware') {
        // Let xterm.js position the elements (correct for normal shells).
        pinned = null
        onAnchor?.(anchor)
      } else {
        pin(anchor)
      }
    }

    // Follow subsequent renders — catches the partial-commit case where Ink
    // redraws its caret mid-composition, and picks up the inverse caret as
    // soon as a blinking one comes back on.
    renderDisposable = terminal.onRender(() => recomputeAndPin())
  }

  function onCompositionEnd() {
    composing = false
    pinned = null
    renderDisposable?.dispose()
    renderDisposable = null
    // Let xterm.js take its natural position back on the next cursor tick.
  }

  textarea.addEventListener('compositionstart', onCompositionStart)
  textarea.addEventListener('compositionend', onCompositionEnd)
  moTa.observe(textarea, { attributes: true, attributeFilter: ['style'] })
  moCv.observe(compositionView, { attributes: true, attributeFilter: ['style'] })

  return {
    detach() {
      composing = false
      pinned = null
      renderDisposable?.dispose()
      renderDisposable = null
      textarea.removeEventListener('compositionstart', onCompositionStart)
      textarea.removeEventListener('compositionend', onCompositionEnd)
      moTa.disconnect()
      moCv.disconnect()
    },
  }
}
