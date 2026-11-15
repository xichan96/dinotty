import { Terminal } from '@xterm/xterm'
import { describe, expect, it } from 'vitest'
import { findTerminalFileLinks } from '../utils/terminalFileLink'
import { readLogicalTerminalLine, type TerminalLineRow } from '../utils/terminalLogicalLine'

interface FakeCell {
  chars: string
  width: number
}

function cellsRow(cells: FakeCell[], isWrapped: boolean): TerminalLineRow {
  return {
    isWrapped,
    length: cells.length,
    getCell: (x) => {
      const cell = cells[x]
      return cell ? { getChars: () => cell.chars, getWidth: () => cell.width } : undefined
    },
  }
}

function textRow(text: string, isWrapped: boolean): TerminalLineRow {
  return cellsRow(
    Array.from(text, (ch) => ({ chars: ch, width: 1 })),
    isWrapped
  )
}

function buffer(rows: Array<TerminalLineRow | undefined>) {
  return { getLine: (y: number) => rows[y] }
}

describe('readLogicalTerminalLine', () => {
  it('joins soft-wrapped rows and maps each character to its buffer cell', () => {
    const lines = buffer([textRow('see /User', false), textRow('s/a.ts:3', true)])
    const line = readLogicalTerminalLine(lines, 1, 10)

    expect(line?.text).toBe('see /Users/a.ts:3')
    expect(line?.cells[0]).toEqual({ x: 1, y: 1, width: 1 })
    // First character of the continuation row lands on row 2, column 1.
    expect(line?.cells[9]).toEqual({ x: 1, y: 2, width: 1 })
  })

  it('returns the whole logical line when asked for a continuation row', () => {
    const lines = buffer([textRow('see /User', false), textRow('s/a.ts:3', true)])
    const fromFirst = readLogicalTerminalLine(lines, 1, 10)
    const fromSecond = readLogicalTerminalLine(lines, 2, 10)

    expect(fromSecond?.text).toBe(fromFirst?.text)
    expect(fromSecond?.cells[0]).toEqual({ x: 1, y: 1, width: 1 })
  })

  it('does not join a following row that is not wrapped', () => {
    const lines = buffer([textRow('src/a.ts', false), textRow('next line', false)])
    expect(readLogicalTerminalLine(lines, 1, 10)?.text).toBe('src/a.ts')
  })

  it('maps wide glyphs by cell width, not string length', () => {
    const lines = buffer([
      cellsRow(
        [
          { chars: '中', width: 2 },
          { chars: '', width: 0 },
          { chars: 'a', width: 1 },
          { chars: '.', width: 1 },
          { chars: 't', width: 1 },
          { chars: 's', width: 1 },
        ],
        false
      ),
    ])
    const line = readLogicalTerminalLine(lines, 1, 10)

    expect(line?.text).toBe('中a.ts')
    expect(line?.cells[0]).toEqual({ x: 1, y: 1, width: 2 })
    // The wide glyph occupies two columns, so `a` starts at column 3.
    expect(line?.cells[1]).toEqual({ x: 3, y: 1, width: 1 })
  })

  it('bounds the wrap-chain walk so a hover cannot scan the whole buffer', () => {
    // Full-width TUI repaints can flag every following row as wrapped.
    const rows = Array.from({ length: 5000 }, (_, index) => textRow('x'.repeat(40), index > 0))
    const line = readLogicalTerminalLine(buffer(rows), 2500, 40)

    // At most 4 rows back + the hovered row + 4 rows forward.
    expect(line?.text.length).toBeLessThanOrEqual(9 * 40)
    expect(line?.cells.length).toBe(line?.text.length)
  })

  it('keeps a path that xterm soft-wraps detectable as one link', async () => {
    const term = new Terminal({ cols: 20, rows: 6 })
    const path = '/Users/chenxi/very/long/path/that/wraps/main.rs'
    await new Promise<void>((resolve) => term.write(`see ${path}:42 now\r\n`, resolve))

    try {
      for (const bufferLineNumber of [1, 2, 3]) {
        const line = readLogicalTerminalLine(term.buffer.active, bufferLineNumber, term.cols)
        expect(line?.text).toBe(`see ${path}:42 now`)
        expect(findTerminalFileLinks(line!.text).map((m) => m.path)).toEqual([path])
      }
    } finally {
      term.dispose()
    }
  })
})
