import { beforeEach, describe, expect, it } from 'vitest'
import {
  clearImeDiagnostics,
  imeDiagnosticsDump,
  imeDiagnosticsEntries,
  isImeDiagnosticsEnabled,
  recordImeAnchorDecision,
  recordImeCompositionEnd,
  recordImeInput,
  setImeDiagnosticsEnabled,
  snapshotImeRows,
  syncImeDiagnosticsFromLocation,
} from '../imeDiagnostics'

function diagLine(chars: string, inverseCols: number[] = []) {
  return {
    length: chars.length,
    translateToString: (trimRight?: boolean) => (trimRight ? chars.replace(/\s+$/, '') : chars),
    getCell(x: number) {
      return {
        isInverse: () => (inverseCols.includes(x) ? 1 : 0),
        getChars: () => chars[x] ?? '',
        getWidth: () => 1,
      }
    },
  }
}

function diagBuffer(lines: ReturnType<typeof diagLine>[], viewportY = 0) {
  return {
    viewportY,
    cursorX: 2,
    cursorY: 1,
    baseY: viewportY,
    getLine: (y: number) => lines[y],
  }
}

describe('IME diagnostics gating', () => {
  beforeEach(() => {
    setImeDiagnosticsEnabled(false)
    clearImeDiagnostics()
  })

  it('records nothing while disabled', () => {
    recordImeCompositionEnd()
    recordImeInput('onData', 'x')
    expect(imeDiagnosticsEntries()).toHaveLength(0)
  })

  it('reads the #ime-debug switch from the location', () => {
    expect(isImeDiagnosticsEnabled()).toBe(false)
    expect(syncImeDiagnosticsFromLocation('', '#ime-debug')).toBe(true)
    expect(isImeDiagnosticsEnabled()).toBe(true)
    expect(syncImeDiagnosticsFromLocation('?imeDebug=1', '')).toBe(true)
    expect(syncImeDiagnosticsFromLocation('?x=1', '#tab')).toBe(false)
    expect(syncImeDiagnosticsFromLocation('?time-debug=1', '')).toBe(false)
    expect(isImeDiagnosticsEnabled()).toBe(false)
  })
})

describe('snapshotImeRows', () => {
  it('captures text, inverse columns, and content end around the cursor row', () => {
    const buffer = diagBuffer([
      diagLine('top line'),
      diagLine('ab  ', [1]),
      diagLine('prompt> x'),
      diagLine('   '),
    ])
    const rows = snapshotImeRows(buffer, { cols: 10, rows: 4, aroundRow: 1, radius: 1 })
    expect(rows.map((r) => r.row)).toEqual([0, 1, 2])
    expect(rows[1]).toEqual({ row: 1, text: 'ab', inverseCols: [1], contentEnd: 2 })
    expect(rows[2].text).toBe('prompt> x')
    expect(rows[2].contentEnd).toBe(9)
  })

  it('marks rows missing from the buffer', () => {
    const buffer = diagBuffer([diagLine('x')])
    const rows = snapshotImeRows(buffer, { cols: 10, rows: 3, aroundRow: 1, radius: 1 })
    expect(rows.find((r) => r.row === 2)?.text).toBe('(missing)')
  })
})

describe('recording and dumping', () => {
  beforeEach(() => {
    setImeDiagnosticsEnabled(true)
    clearImeDiagnostics()
  })

  it('records an anchor decision with the buffer snapshot', () => {
    const buffer = diagBuffer([diagLine('a'), diagLine('> b ', [3]), diagLine('')])
    recordImeAnchorDecision({
      anchor: { source: 'contentEnd', col: 2, row: 1 },
      hit: null,
      cached: null,
      buffer,
      cols: 10,
      rows: 3,
    })
    const entries = imeDiagnosticsEntries()
    expect(entries).toHaveLength(1)
    expect(entries[0].kind).toBe('start')
    expect(entries[0].anchor).toEqual({ source: 'contentEnd', col: 2, row: 1 })
    expect(entries[0].cursor).toEqual({ x: 2, y: 1 })
    expect(entries[0].rowsAround?.some((r) => r.row === 1 && r.inverseCols[0] === 3)).toBe(true)

    const dump = imeDiagnosticsDump()
    expect(dump).toContain('"source": "contentEnd"')
    expect(dump).toContain('"meta"')
    expect(dump).toContain('"entries"')
  })

  it('records input-path events so a double commit can be proven', () => {
    recordImeInput('onData', '你好')
    recordImeInput('ime229', '你好')
    recordImeInput('emit', '你好')
    const paths = imeDiagnosticsEntries().map((e) => e.input?.path)
    expect(paths).toEqual(['onData', 'ime229', 'emit'])
    expect(imeDiagnosticsEntries()[0].input?.len).toBe(2)
  })

  it('caps the ring buffer', () => {
    for (let i = 0; i < 300; i++) recordImeCompositionEnd()
    expect(imeDiagnosticsEntries()).toHaveLength(200)
  })
})
