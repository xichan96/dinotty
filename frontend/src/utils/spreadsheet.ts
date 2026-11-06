/**
 * Pure helpers for the spreadsheet preview.
 *
 * officeparser flattens an XLSX workbook into `sheet -> row -> cell` nodes. The
 * cell metadata carries a 0-based row and column, but its column is computed
 * from the first letter of the cell reference only, so `AB12` is reported as
 * column 0. When the AST is parsed with `includeRawContent`, the cell's XML
 * (`<c r="AB12" …>`) is available and lets us recover the real column.
 *
 * Everything here is dependency-free so it can be unit-tested without parsing
 * a real workbook.
 */

export interface SpreadsheetLimits {
  /** Largest file handed to officeparser, in bytes. */
  maxBytes: number
  /** Sheets shown per workbook. */
  maxSheets: number
  /** Rows materialized per sheet (by absolute row index). */
  maxRowsPerSheet: number
  /** Columns materialized per sheet (by absolute column index). */
  maxColumnsPerSheet: number
  /** Dense grid cells materialized per sheet (`rowCount * columnCount`). */
  maxCellsPerSheet: number
  /** Dense grid cells materialized across the whole workbook. */
  maxTotalCells: number
}

export interface SheetTable {
  name: string
  /** Dense rows; gaps are filled with `''`. */
  rows: string[][]
  rowCount: number
  columnCount: number
  /** Dense grid size (`rowCount * columnCount`). */
  cellCount: number
  /** Some rows, columns, or cells were dropped by a limit. */
  truncated: boolean
}

export interface SpreadsheetData {
  sheets: SheetTable[]
  /** Any sheet was truncated, or the workbook itself was. */
  truncated: boolean
  /** Some sheets were dropped by `maxSheets`. */
  sheetsTruncated: boolean
  totalCells: number
}

export const SPREADSHEET_LIMITS: SpreadsheetLimits = Object.freeze({
  maxBytes: 16 * 1024 * 1024,
  maxSheets: 50,
  maxRowsPerSheet: 5000,
  maxColumnsPerSheet: 200,
  maxCellsPerSheet: 200_000,
  maxTotalCells: 400_000,
})

/**
 * Minimal structural view of an officeparser node. Typed structurally (instead
 * of importing `OfficeContentNode`) so tests can build tiny fixtures and the
 * metadata union does not need narrowing at every call site.
 */
export interface SpreadsheetNode {
  type: string
  text?: string
  rawContent?: string
  metadata?: unknown
  children?: SpreadsheetNode[]
}

export interface SpreadsheetAst {
  content?: SpreadsheetNode[]
}

function extensionOf(path: string): string {
  const base = path.split(/[\\/]/).pop() ?? ''
  const dot = base.lastIndexOf('.')
  if (dot <= 0) return ''
  return base.slice(dot + 1).toLowerCase()
}

/** `.xlsx` and legacy `.xls` files are handled by the spreadsheet preview. */
export function isSpreadsheetPath(path: string): boolean {
  const extension = extensionOf(path)
  return extension === 'xlsx' || extension === 'xls'
}

/** Legacy CFB `.xls` files are not supported by officeparser. */
export function isLegacyXlsPath(path: string): boolean {
  return extensionOf(path) === 'xls'
}

function normalizeColumn(fallback: number | undefined): number {
  if (typeof fallback !== 'number' || !Number.isFinite(fallback) || fallback < 0) return 0
  return Math.floor(fallback)
}

const CELL_REF_PATTERN = /r="([A-Za-z]+)\d+"/
/** Accepts a bare reference too, which keeps the helper easy to exercise. */
const BARE_CELL_REF_PATTERN = /^([A-Za-z]+)\d+$/

/**
 * Resolve the 0-based column index from a cell's raw XML reference (`AB12`).
 *
 * Falls back to the given index when the raw content is missing or malformed.
 */
export function columnIndexFromCellRef(rawContent: string | undefined, fallback = 0): number {
  if (!rawContent) return normalizeColumn(fallback)
  const match = CELL_REF_PATTERN.exec(rawContent) ?? BARE_CELL_REF_PATTERN.exec(rawContent.trim())
  if (!match) return normalizeColumn(fallback)

  let index = 0
  for (let position = 0; position < match[1].length; position += 1) {
    const code = match[1].charCodeAt(position)
    let value: number
    if (code >= 65 && code <= 90) value = code - 64
    else if (code >= 97 && code <= 122) value = code - 96
    else return normalizeColumn(fallback)
    index = index * 26 + value
  }
  if (!Number.isSafeInteger(index) || index < 1) return normalizeColumn(fallback)
  return index - 1
}

function readMetadataNumber(metadata: unknown, key: 'row' | 'col'): number | undefined {
  if (!metadata || typeof metadata !== 'object') return undefined
  const value = (metadata as Record<string, unknown>)[key]
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return undefined
  return Math.floor(value)
}

function readSheetName(metadata: unknown): string {
  if (!metadata || typeof metadata !== 'object') return ''
  const value = (metadata as Record<string, unknown>).sheetName
  return typeof value === 'string' ? value.trim() : ''
}

function mergeLimits(overrides: Partial<SpreadsheetLimits>): SpreadsheetLimits {
  return { ...SPREADSHEET_LIMITS, ...overrides }
}

interface CellEntry {
  row: number
  col: number
  text: string
}

function collectCells(
  sheetNode: SpreadsheetNode,
  limits: SpreadsheetLimits
): { cells: CellEntry[]; truncated: boolean } {
  const cells: CellEntry[] = []
  let truncated = false
  let fallbackRow = 0

  for (const child of sheetNode.children ?? []) {
    if (child.type !== 'row') continue // images/charts are not tabular data
    const rowCells = (child.children ?? []).filter((cell) => cell.type === 'cell')
    if (rowCells.length === 0) continue

    // Rows carry no metadata of their own; the first cell knows the row.
    let rowIndex: number | undefined
    for (const cell of rowCells) {
      rowIndex = readMetadataNumber(cell.metadata, 'row')
      if (rowIndex !== undefined) break
    }
    if (rowIndex === undefined) rowIndex = fallbackRow
    fallbackRow = rowIndex + 1

    if (rowIndex >= limits.maxRowsPerSheet) {
      truncated = true
      continue
    }

    for (const cell of rowCells) {
      const col = columnIndexFromCellRef(
        cell.rawContent,
        readMetadataNumber(cell.metadata, 'col') ?? 0
      )
      if (col >= limits.maxColumnsPerSheet) {
        truncated = true
        continue
      }
      cells.push({ row: rowIndex, col, text: cell.text ?? '' })
    }
  }

  return { cells, truncated }
}

/**
 * Build one dense sheet table.
 *
 * Leading empty rows are preserved (a cell at row 5 still renders below four
 * blank rows), trailing all-empty rows are dropped, and every limit is applied.
 */
export function buildSheetTable(
  sheetNode: SpreadsheetNode,
  fallbackName: string,
  overrides: Partial<SpreadsheetLimits> = {}
): SheetTable {
  const limits = mergeLimits(overrides)
  const { cells, truncated: limitsTruncated } = collectCells(sheetNode, limits)
  let truncated = limitsTruncated

  const name = readSheetName(sheetNode.metadata) || fallbackName

  let lastRow = -1
  let columnCount = 0
  for (const cell of cells) {
    if (cell.row > lastRow) lastRow = cell.row
    if (cell.col + 1 > columnCount) columnCount = cell.col + 1
  }

  const rows: string[][] = []
  if (lastRow >= 0 && columnCount > 0) {
    for (let rowIndex = 0; rowIndex <= lastRow; rowIndex += 1) {
      rows.push(new Array<string>(columnCount).fill(''))
    }
    for (const cell of cells) {
      rows[cell.row][cell.col] = cell.text
    }
  }

  while (rows.length > 0 && rows[rows.length - 1].every((value) => value === '')) {
    rows.pop()
  }

  let cellCount = rows.length * columnCount
  if (cellCount > limits.maxCellsPerSheet) {
    const keepRows = columnCount > 0 ? Math.floor(limits.maxCellsPerSheet / columnCount) : 0
    if (keepRows < rows.length) {
      rows.length = keepRows
      cellCount = rows.length * columnCount
      truncated = true
    }
  }

  return {
    name,
    rows,
    rowCount: rows.length,
    columnCount,
    cellCount,
    truncated,
  }
}

function uniqueSheetName(name: string, fallbackName: string, used: Set<string>): string {
  let candidate = name || fallbackName
  if (!used.has(candidate)) return candidate

  candidate = fallbackName
  let suffix = 2
  while (used.has(candidate)) {
    candidate = `${fallbackName} (${suffix})`
    suffix += 1
  }
  return candidate
}

/** Build every sheet of a parsed workbook, enforcing workbook-wide limits. */
export function buildSpreadsheet(
  ast: SpreadsheetAst | null | undefined,
  overrides: Partial<SpreadsheetLimits> = {}
): SpreadsheetData {
  const limits = mergeLimits(overrides)
  const sheetNodes = (ast?.content ?? []).filter(
    (node): node is SpreadsheetNode => !!node && node.type === 'sheet'
  )
  const sheetsTruncated = sheetNodes.length > limits.maxSheets

  const usedNames = new Set<string>()
  const sheets: SheetTable[] = []
  for (const [index, node] of sheetNodes.slice(0, limits.maxSheets).entries()) {
    const fallbackName = `Sheet ${index + 1}`
    const sheet = buildSheetTable(node, fallbackName, limits)
    sheet.name = uniqueSheetName(sheet.name, fallbackName, usedNames)
    usedNames.add(sheet.name)
    sheets.push(sheet)
  }

  let totalCells = sheets.reduce((sum, sheet) => sum + sheet.cellCount, 0)
  let truncated = sheetsTruncated

  if (totalCells > limits.maxTotalCells) {
    truncated = true
    let remaining = limits.maxTotalCells
    totalCells = 0
    for (const sheet of sheets) {
      if (sheet.cellCount > remaining) {
        const keepRows = sheet.columnCount > 0 ? Math.floor(remaining / sheet.columnCount) : 0
        sheet.rows = keepRows > 0 ? sheet.rows.slice(0, keepRows) : []
        sheet.rowCount = sheet.rows.length
        sheet.cellCount = sheet.rowCount * sheet.columnCount
        sheet.truncated = true
      }
      totalCells += sheet.cellCount
      remaining = Math.max(0, remaining - sheet.cellCount)
    }
  }

  return {
    sheets,
    truncated: truncated || sheets.some((sheet) => sheet.truncated),
    sheetsTruncated,
    totalCells,
  }
}
