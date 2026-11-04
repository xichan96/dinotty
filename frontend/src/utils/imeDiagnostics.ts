// Opt-in diagnostics for the Windows ConPTY IME-anchor bug (#323).
//
// The anchor heuristic in imeAnchor.ts depends on the state of the xterm
// buffer at the exact moment a composition starts, which we cannot reproduce
// without Windows + a Chinese IME. This module records that state (plus where
// the helper textarea actually ended up and which input path forwarded the
// commit) so a reporter can reproduce once with `#ime-debug` and paste the
// dump.
//
// It is inert unless enabled, and the ring buffer is bounded so an accidentally
// left-on flag cannot grow without limit.

export type ImeDiagAnchor = { source: string; col: number; row: number }

export interface ImeDiagCellLine {
  length: number
  getCell(x: number): { isInverse(): number; getChars?(): string; getWidth?(): number } | undefined
  translateToString?(trimRight?: boolean): string
}

export interface ImeDiagBuffer {
  viewportY: number
  cursorX: number
  cursorY: number
  baseY?: number
  getLine(y: number): ImeDiagCellLine | undefined
}

export type ImeDiagRow = {
  row: number
  text: string
  inverseCols: number[]
  contentEnd: number | null
}

export type ImeDiagEntry = {
  at: string
  kind: 'start' | 'end' | 'input' | 'dom'
  anchor?: ImeDiagAnchor
  hit?: { col: number; row: number } | null
  cached?: { col: number; row: number; ageMs: number } | null
  cursor?: { x: number; y: number }
  viewportY?: number
  baseY?: number
  cols?: number
  rows?: number
  rowsAround?: ImeDiagRow[]
  dom?: {
    taLeft: string
    taTop: string
    cvLeft: string
    cvTop: string
    /** Rects relative to the xterm root, rounded to whole pixels. */
    taRect?: string
    cvRect?: string
  }
  input?: { path: 'onData' | 'ime229' | 'emit'; len: number }
  note?: string
}

const MAX_ENTRIES = 200
const MAX_ROW_TEXT = 240
const MAX_INVERSE_COLS = 40
const SNAPSHOT_RADIUS = 5

let enabled = false
let entries: ImeDiagEntry[] = []

export function isImeDiagnosticsEnabled(): boolean {
  return enabled
}

export function setImeDiagnosticsEnabled(value: boolean): void {
  enabled = value
  if (enabled) installImeDiagnosticsBridge()
  else if (typeof window !== 'undefined' && window.__dinottyImeDiag) {
    window.__dinottyImeDiag.enabled = false
  }
}

// `#ime-debug` / `?ime-debug` enables the recorder; the same switch is read on
// `hashchange` so a reporter can turn it on without restarting the app.
export function syncImeDiagnosticsFromLocation(search: string, hash: string): boolean {
  const on = /(?:^|[#&?])ime-?debug(?:$|[&=])/i.test(search + hash)
  setImeDiagnosticsEnabled(on)
  return on
}

function stamp(): string {
  return new Date().toISOString()
}

function push(entry: ImeDiagEntry): void {
  if (!enabled) return
  entries.push(entry)
  if (entries.length > MAX_ENTRIES) entries = entries.slice(entries.length - MAX_ENTRIES)
}

export function recordImeAnchorDecision(info: {
  anchor: ImeDiagAnchor
  hit: { col: number; row: number } | null
  cached: { col: number; row: number; ageMs: number } | null
  buffer: ImeDiagBuffer
  cols: number
  rows: number
}): void {
  if (!enabled) return
  const buffer = info.buffer
  push({
    at: stamp(),
    kind: 'start',
    anchor: { ...info.anchor },
    hit: info.hit,
    cached: info.cached,
    cursor: { x: buffer.cursorX, y: buffer.cursorY },
    viewportY: buffer.viewportY,
    baseY: buffer.baseY,
    cols: info.cols,
    rows: info.rows,
    rowsAround: snapshotImeRows(buffer, {
      cols: info.cols,
      rows: info.rows,
      aroundRow: buffer.cursorY,
    }),
  })
}

export function recordImeCompositionEnd(): void {
  push({ at: stamp(), kind: 'end' })
}

// Where the helper textarea / composition view actually sit after the pin had
// a frame to settle. Distinguishes a wrong decision from a decision that xterm
// overwrote afterwards.
export function recordImeDomPlacement(anchor: ImeDiagAnchor, root: HTMLElement | null): void {
  if (!enabled) return
  const textarea = root?.querySelector('.xterm-helper-textarea')
  const view = root?.querySelector('.composition-view')
  const ta = textarea instanceof HTMLElement ? textarea : null
  const cv = view instanceof HTMLElement ? view : null
  const rootRect = root?.getBoundingClientRect()
  const rel = (el: HTMLElement | null): string | undefined => {
    if (!el || !rootRect) return undefined
    const r = el.getBoundingClientRect()
    return `${Math.round(r.left - rootRect.left)},${Math.round(r.top - rootRect.top)} ${Math.round(r.width)}x${Math.round(r.height)}`
  }
  push({
    at: stamp(),
    kind: 'dom',
    anchor: { ...anchor },
    dom: {
      taLeft: ta?.style.getPropertyValue('left') ?? '',
      taTop: ta?.style.getPropertyValue('top') ?? '',
      cvLeft: cv?.style.getPropertyValue('left') ?? '',
      cvTop: cv?.style.getPropertyValue('top') ?? '',
      taRect: rel(ta),
      cvRect: rel(cv),
    },
  })
}

const MAX_INPUT_NOTE = 64

export function recordImeInput(path: 'onData' | 'ime229' | 'emit', data: string): void {
  if (!enabled) return
  // Cap the echo so a diagnostic dump never carries a long paste; 64 chars is
  // enough to prove a duplicated commit.
  const note = data.length > MAX_INPUT_NOTE ? data.slice(0, MAX_INPUT_NOTE) + '…' : data
  push({ at: stamp(), kind: 'input', input: { path, len: data.length }, note })
}

// Smallest useful snapshot of the rows around the parked cursor: text, the
// columns carrying inverse video (Ink/pi's fake caret), and the content end.
export function snapshotImeRows(
  buffer: ImeDiagBuffer,
  opts: { cols: number; rows: number; aroundRow: number; radius?: number }
): ImeDiagRow[] {
  const radius = opts.radius ?? SNAPSHOT_RADIUS
  const first = Math.max(0, opts.aroundRow - radius)
  const last = Math.min(opts.rows - 1, opts.aroundRow + radius)
  const out: ImeDiagRow[] = []
  for (let row = first; row <= last; row++) {
    const line = buffer.getLine(buffer.viewportY + row)
    if (!line) {
      out.push({ row, text: '(missing)', inverseCols: [], contentEnd: null })
      continue
    }
    const inverseCols: number[] = []
    for (let x = 0; x < line.length && x < opts.cols; x++) {
      const cell = line.getCell(x)
      if (cell?.isInverse()) inverseCols.push(x)
      if (inverseCols.length >= MAX_INVERSE_COLS) break
    }
    let text: string
    try {
      text = line.translateToString?.(true) ?? ''
    } catch {
      text = ''
    }
    out.push({
      row,
      text: text.length > MAX_ROW_TEXT ? text.slice(0, MAX_ROW_TEXT) + '…' : text,
      inverseCols,
      contentEnd: rowContentEnd(line),
    })
  }
  return out
}

// Mirrors findRowContentEnd in imeAnchor.ts. Kept local so diagnostics stays
// independent of the anchor module (which imports this one).
function rowContentEnd(line: ImeDiagCellLine): number | null {
  for (let x = line.length - 1; x >= 0; x--) {
    const cell = line.getCell(x)
    if (!cell) continue
    const width = cell.getWidth?.() ?? 1
    if (width === 0) continue
    const inverse = !!cell.isInverse()
    if (!inverse && (cell.getChars?.() ?? '').trim() === '') continue
    return x + Math.max(width, 1)
  }
  return null
}

export function imeDiagnosticsEntries(): ImeDiagEntry[] {
  return entries
}

export function clearImeDiagnostics(): void {
  entries = []
}

export function imeDiagnosticsDump(): string {
  const meta = {
    at: stamp(),
    href: typeof location !== 'undefined' ? location.href : '',
    ua: typeof navigator !== 'undefined' ? navigator.userAgent : '',
    viewport:
      typeof window !== 'undefined'
        ? `${window.innerWidth}x${window.innerHeight} dpr=${window.devicePixelRatio}`
        : '',
  }
  return JSON.stringify({ meta, entries }, null, 2)
}

export async function copyImeDiagnostics(): Promise<boolean> {
  const dump = imeDiagnosticsDump()
  try {
    await navigator.clipboard.writeText(dump)
    return true
  } catch {
    // WebView2 can refuse the async clipboard API outside a user gesture or a
    // secure context; the legacy path still works there.
  }
  try {
    const area = document.createElement('textarea')
    area.value = dump
    area.style.position = 'fixed'
    area.style.opacity = '0'
    document.body.appendChild(area)
    area.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(area)
    return ok
  } catch {
    return false
  }
}

export type ImeDiagnosticsBridge = {
  enabled: boolean
  count: () => number
  dump: () => string
  clear: () => void
  copy: () => Promise<boolean>
}

declare global {
  interface Window {
    __dinottyImeDiag?: ImeDiagnosticsBridge
  }
}

function installImeDiagnosticsBridge(): void {
  if (typeof window === 'undefined') return
  window.__dinottyImeDiag = {
    enabled: true,
    count: () => entries.length,
    dump: imeDiagnosticsDump,
    clear: clearImeDiagnostics,
    copy: copyImeDiagnostics,
  }
}
