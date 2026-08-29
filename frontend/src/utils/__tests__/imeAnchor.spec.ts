import { describe, it, expect, vi } from 'vitest'
import type { Terminal } from '@xterm/xterm'
import {
  attachImeHeuristic,
  computeCellSize,
  findInverseCell,
  resolveImeAnchor,
} from '../imeAnchor'

type CellMark = 'inv' | 'norm'

// Pure scan tests use a fake buffer; the real IBuffer is structurally
// compatible with this shape (see ImeBufferScan in imeAnchor.ts).
function fakeLine(cells: CellMark[]) {
  return {
    length: cells.length,
    getCell(x: number) {
      const c = cells[x]
      if (c === undefined) return undefined
      return { isInverse: () => (c === 'inv' ? 1 : 0) }
    },
  }
}

function fakeBuffer(lines: CellMark[][], viewportY = 0) {
  const rows = lines.map(fakeLine)
  return {
    viewportY,
    getLine: (y: number) => rows[y],
  }
}

describe('findInverseCell (scan order and isolation)', () => {
  it('returns the lone inverse cell with viewport-relative row', () => {
    const buf = fakeBuffer(
      [
        ['norm', 'norm', 'norm'],
        ['norm', 'inv', 'norm'],
        ['norm', 'norm', 'norm'],
      ],
      1
    )
    // Absolute buffer row 1 is viewport row 0 when viewportY = 1.
    expect(findInverseCell(buf, 3)).toEqual({ col: 1, row: 0 })
  })

  it('scans bottom-up: the lowest inverse cell wins', () => {
    const buf = fakeBuffer([
      ['inv', 'norm', 'norm'],
      ['norm', 'norm', 'norm'],
      ['norm', 'inv', 'norm'],
    ])
    expect(findInverseCell(buf, 3)).toEqual({ col: 1, row: 2 })
  })

  it('scans right-to-left: the rightmost inverse cell wins on a row', () => {
    const buf = fakeBuffer([['norm', 'inv', 'norm', 'inv', 'norm']])
    expect(findInverseCell(buf, 1)).toEqual({ col: 3, row: 0 })
  })

  it('skips a cell whose BOTH neighbours are inverse (selection bar)', () => {
    // Row of three inverse cells = highlight row; the middle must be skipped,
    // and the isolated cell on the row above is the real caret.
    const buf = fakeBuffer([
      ['norm', 'norm', 'inv', 'norm', 'norm'],
      ['inv', 'inv', 'inv', 'inv', 'inv'],
    ])
    expect(findInverseCell(buf, 2)).toEqual({ col: 2, row: 0 })
  })

  it('skips a run at the line edge (non-isolated), returning null', () => {
    // A caret must be a LONE inverse cell: a run of two (or more) inverse cells
    // at the edge is a highlight/selection run, so no anchor from this row.
    const buf = fakeBuffer([['norm', 'inv', 'inv']])
    expect(findInverseCell(buf, 1)).toBeNull()
  })

  it('keeps a caret at column 0 (no left neighbour, normal right neighbour)', () => {
    const buf = fakeBuffer([['inv', 'norm', 'norm']])
    expect(findInverseCell(buf, 1)).toEqual({ col: 0, row: 0 })
  })

  it('returns null when nothing is inverse', () => {
    const buf = fakeBuffer([
      ['norm', 'norm', 'norm'],
      ['norm', 'norm', 'norm'],
    ])
    expect(findInverseCell(buf, 2)).toBeNull()
  })

  it('respects requireIsolatedCell=false', () => {
    const buf = fakeBuffer([['inv', 'inv', 'inv']])
    expect(findInverseCell(buf, 1, false)).toEqual({ col: 2, row: 0 })
  })
})

describe('resolveImeAnchor (heuristic vs hardware fallback)', () => {
  it('reports heuristic with the inverse-cell coords when found', () => {
    expect(resolveImeAnchor({ col: 3, row: 1 }, { col: 9, row: 2 })).toEqual({
      source: 'heuristic',
      col: 3,
      row: 1,
    })
  })

  it('falls back to the hardware cursor when no inverse cell exists', () => {
    expect(resolveImeAnchor(null, { col: 9, row: 2 })).toEqual({
      source: 'hardware',
      col: 9,
      row: 2,
    })
  })
})

describe('computeCellSize (render-service cell vs rect fallback)', () => {
  it('prefers the render-service CSS cell size (letter_spacing/line_height correct)', () => {
    const screen = { getBoundingClientRect: () => ({ width: 900, height: 300 }) }
    expect(computeCellSize(screen, 120, 30, { width: 8.5, height: 24 })).toEqual({ w: 8.5, h: 24 })
  })

  it('falls back to rect/cols division when the render cell is missing', () => {
    const screen = { getBoundingClientRect: () => ({ width: 900, height: 300 }) }
    expect(computeCellSize(screen, 120, 30)).toEqual({ w: 7.5, h: 10 })
  })

  it('guards against a zero render cell', () => {
    const screen = { getBoundingClientRect: () => ({ width: 900, height: 300 }) }
    expect(computeCellSize(screen, 120, 30, { width: 0, height: 0 })).toEqual({ w: 7.5, h: 10 })
  })
})

// ── DOM integration ──────────────────────────────────────────────

function makeDom() {
  document.body.innerHTML = ''
  const root = document.createElement('div')
  root.className = 'xterm'
  root.innerHTML = [
    '<div class="xterm-screen"></div>',
    '<div class="xterm-helpers">',
    '  <textarea class="xterm-helper-textarea"></textarea>',
    '  <div class="composition-view"></div>',
    '</div>',
  ].join('')
  document.body.appendChild(root)
  const textarea = root.querySelector('.xterm-helper-textarea') as HTMLTextAreaElement
  const compositionView = root.querySelector('.composition-view') as HTMLElement
  return { root, textarea, compositionView }
}

function setup(opts: {
  lines: CellMark[][]
  rows?: number
  cols?: number
  viewportY?: number
  cursorX?: number
  cursorY?: number
  cellW?: number
  cellH?: number
}) {
  const dom = makeDom()
  const rows = opts.rows ?? 3
  const cols = opts.cols ?? 10
  const lines = opts.lines.map(fakeLine)
  let renderCb: (() => void) | null = null
  const buffer = {
    viewportY: opts.viewportY ?? 0,
    cursorX: opts.cursorX ?? 0,
    cursorY: opts.cursorY ?? 0,
    getLine: (y: number) => lines[y],
  }
  const terminal = {
    element: dom.root,
    cols,
    rows,
    buffer: { active: buffer },
    onRender(cb: () => void) {
      renderCb = cb
      return {
        dispose() {
          renderCb = null
        },
      }
    },
    _core: {
      _renderService: {
        dimensions: {
          css: { cell: { width: opts.cellW ?? 8, height: opts.cellH ?? 20 } },
        },
      },
    },
  }
  return {
    ...dom,
    terminal,
    buffer,
    setLine: (y: number, cells: CellMark[]) => {
      lines[y] = fakeLine(cells)
    },
    fireRender: () => renderCb?.(),
  }
}

const tick = () => new Promise((r) => setTimeout(r, 0))

describe('attachImeHeuristic (DOM integration)', () => {
  it('pins textarea + composition-view to the inverse cell with !important', () => {
    const { terminal, textarea, compositionView, buffer } = setup({
      lines: [
        ['norm', 'norm', 'norm'],
        ['norm', 'norm', 'inv', 'norm'],
        ['norm', 'norm', 'norm'],
      ],
      cellW: 8,
      cellH: 20,
    })
    const onAnchor = vi.fn()
    attachImeHeuristic(terminal as unknown as Terminal, { onAnchor })
    textarea.dispatchEvent(new Event('compositionstart'))

    // col=2 -> left 16px, row=1 -> top 20px (viewport-relative)
    expect(textarea.style.getPropertyValue('left')).toBe('16px')
    expect(textarea.style.getPropertyPriority('left')).toBe('important')
    expect(textarea.style.getPropertyValue('top')).toBe('20px')
    expect(textarea.style.getPropertyPriority('top')).toBe('important')
    expect(compositionView.style.getPropertyValue('left')).toBe('16px')
    expect(compositionView.style.getPropertyValue('top')).toBe('20px')
    expect(onAnchor).toHaveBeenCalledWith({ source: 'heuristic', col: 2, row: 1 })
    expect(buffer.cursorX).not.toBe(2) // sanity: cursor was somewhere else
  })

  it('re-applies the pin when xterm overwrites the style during composition', async () => {
    const { terminal, textarea } = setup({
      lines: [['norm', 'inv', 'norm', 'norm']],
      cellW: 10,
      cellH: 20,
    })
    attachImeHeuristic(terminal as unknown as Terminal)
    textarea.dispatchEvent(new Event('compositionstart'))
    expect(textarea.style.getPropertyValue('left')).toBe('10px')

    textarea.style.left = '0px' // simulate xterm's recursive setTimeout write
    await tick()
    expect(textarea.style.getPropertyValue('left')).toBe('10px')
    expect(textarea.style.getPropertyPriority('left')).toBe('important')
  })

  it('falls back to the hardware cursor (no style pin) when no inverse cell exists', () => {
    const { terminal, textarea, compositionView } = setup({
      lines: [
        ['norm', 'norm', 'norm'],
        ['norm', 'norm', 'norm'],
        ['norm', 'norm', 'norm'],
      ],
      cursorX: 7,
      cursorY: 2,
    })
    const onAnchor = vi.fn()
    attachImeHeuristic(terminal as unknown as Terminal, { onAnchor })
    textarea.dispatchEvent(new Event('compositionstart'))

    expect(onAnchor).toHaveBeenCalledWith({ source: 'hardware', col: 7, row: 2 })
    expect(textarea.style.getPropertyValue('left')).toBe('')
    expect(compositionView.style.getPropertyValue('top')).toBe('')
  })

  it('follows the caret on render (IME partial commit) but keeps the last pin if it transiently disappears', () => {
    const { terminal, textarea, setLine, fireRender } = setup({
      lines: [
        ['norm', 'norm', 'norm'],
        ['norm', 'norm', 'norm', 'norm', 'norm', 'inv', 'norm'],
        ['norm', 'norm', 'norm'],
      ],
      cellW: 8,
      cellH: 20,
    })
    attachImeHeuristic(terminal as unknown as Terminal)
    textarea.dispatchEvent(new Event('compositionstart'))
    expect(textarea.style.getPropertyValue('left')).toBe('40px') // col 5

    // Ink redraws the caret one cell right mid-composition.
    setLine(1, ['norm', 'norm', 'norm', 'norm', 'norm', 'norm', 'inv', 'norm'])
    fireRender()
    expect(textarea.style.getPropertyValue('left')).toBe('48px') // col 6

    // Transient clear-then-redraw: no inverse cell this tick -> keep last pin.
    setLine(1, ['norm', 'norm', 'norm', 'norm', 'norm', 'norm', 'norm', 'norm'])
    fireRender()
    expect(textarea.style.getPropertyValue('left')).toBe('48px')
  })

  it('stops re-pinning after compositionend', async () => {
    const { terminal, textarea } = setup({
      lines: [['norm', 'inv', 'norm', 'norm']],
      cellW: 10,
      cellH: 20,
    })
    attachImeHeuristic(terminal as unknown as Terminal)
    textarea.dispatchEvent(new Event('compositionstart'))
    expect(textarea.style.getPropertyValue('left')).toBe('10px')

    textarea.dispatchEvent(new Event('compositionend'))
    textarea.style.left = '5px'
    await tick()
    expect(textarea.style.getPropertyValue('left')).toBe('5px')
  })

  it('detach removes listeners, observers, and the render subscription', () => {
    const { terminal, textarea, fireRender } = setup({
      lines: [['norm', 'inv', 'norm', 'norm']],
      cellW: 10,
      cellH: 20,
    })
    const attached = attachImeHeuristic(terminal as unknown as Terminal)
    textarea.dispatchEvent(new Event('compositionstart'))
    expect(textarea.style.getPropertyValue('left')).toBe('10px')

    attached.detach()
    // Listener removed: a fresh compositionstart must not re-pin.
    textarea.style.removeProperty('left')
    textarea.dispatchEvent(new Event('compositionstart'))
    expect(textarea.style.getPropertyValue('left')).toBe('')

    // Render subscription disposed: firing a render must not re-pin.
    fireRender()
    expect(textarea.style.getPropertyValue('left')).toBe('')
  })
})
