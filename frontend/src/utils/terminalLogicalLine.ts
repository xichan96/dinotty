/**
 * Reconstruct a terminal "logical line" from xterm buffer rows.
 *
 * xterm stores a soft-wrapped line as several physical buffer rows and only
 * flags the continuation rows with `isWrapped`. Link providers are asked for a
 * single row, so scanning that row alone truncates any token that crosses the
 * wrap boundary (e.g. a long path or URL). Joining the wrapped rows first lets
 * the path/URL detectors see the whole token.
 *
 * The reader also records the buffer cell each character came from, so link
 * ranges can span rows and stay aligned on lines that contain wide (CJK)
 * glyphs — a plain string offset is not a cell column in that case.
 */

/** Minimal shape of an xterm buffer row; keeps this module unit-testable. */
export interface TerminalLineRow {
  readonly isWrapped: boolean
  readonly length: number
  getCell(x: number): { getChars(): string; getWidth(): number } | undefined
}

/** Minimal shape of the xterm active buffer. */
export interface TerminalBufferSource {
  getLine(y: number): TerminalLineRow | undefined
}

export interface LogicalLineCell {
  /** 1-based buffer column where this character starts. */
  x: number
  /** 1-based buffer row. */
  y: number
  /** Cell width in columns: 1 normally, 2 for wide glyphs. */
  width: number
}

export interface LogicalTerminalLine {
  /** Text of the whole logical line, soft-wrapped rows included. */
  text: string
  /**
   * One entry per string index in `text` (code units) giving the cell where
   * that character starts, so `cells[match.end - 1]` addresses the last cell
   * of a match.
   */
  cells: LogicalLineCell[]
}

/** Link providers run on every hover/move. A TUI that repaints full-width rows
 * (opencode does) leaves one soft-wrap chain spanning the whole buffer, and
 * walking it made every hover a full-buffer scan - enough to wedge the main
 * thread on touch, where a tap also generates mouse moves. A token never needs
 * more than a few rows, so the join is bounded. */
const MAX_WRAP_ROWS_BACK = 4
const MAX_WRAP_ROWS_FORWARD = 4
const MAX_LOGICAL_LINE_CHARS = 4096

/**
 * Build the logical line containing `bufferLineNumber` (1-based, the value
 * xterm passes to link providers). Returns undefined when the row has no
 * content.
 */
export function readLogicalTerminalLine(
  buffer: TerminalBufferSource,
  bufferLineNumber: number,
  cols: number
): LogicalTerminalLine | undefined {
  const row = bufferLineNumber - 1
  if (!buffer.getLine(row)) return undefined

  // A continuation row carries isWrapped; walk back to the row the wrapped
  // line started on, then forward to its last physical row. Stop after a few
  // rows: the chain is unbounded in a full-width TUI.
  let first = row
  for (let step = 0; step < MAX_WRAP_ROWS_BACK; step += 1) {
    if (first <= 0 || !buffer.getLine(first)?.isWrapped) break
    first -= 1
  }
  let last = row
  for (let step = 0; step < MAX_WRAP_ROWS_FORWARD; step += 1) {
    if (!buffer.getLine(last + 1)?.isWrapped) break
    last += 1
  }

  const parts: string[] = []
  const cells: LogicalLineCell[] = []
  let charCount = 0

  for (let y = first; y <= last; y += 1) {
    const line = buffer.getLine(y)
    if (!line) break
    // Continuation rows use the full terminal width; the last row carries the
    // line's real end (trailing blanks are trimmed below).
    const limit = y === last ? line.length : cols
    for (let x = 0; x < limit; x += 1) {
      const cell = line.getCell(x)
      if (!cell) break
      const width = cell.getWidth()
      // The second half of a wide glyph has width 0 and no text of its own.
      if (width === 0) continue
      if (charCount >= MAX_LOGICAL_LINE_CHARS) break
      const chars = cell.getChars() || ' '
      for (let i = 0; i < chars.length; i += 1) {
        cells.push({ x: x + 1, y: y + 1, width: width || 1 })
      }
      parts.push(chars)
      charCount += chars.length
    }
    if (charCount >= MAX_LOGICAL_LINE_CHARS) break
  }

  const joined = parts.join('')
  let end = joined.length
  while (end > 0 && joined[end - 1] === ' ') end -= 1
  if (end === 0) return { text: '', cells: [] }
  return { text: joined.slice(0, end), cells: cells.slice(0, end) }
}
