import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { authFetch } from '../composables/apiBase'
import { settings } from '../composables/useSettings'
import {
  SPREADSHEET_LIMITS,
  buildSheetTable,
  buildSpreadsheet,
  columnIndexFromCellRef,
  isLegacyXlsPath,
  isSpreadsheetPath,
  type SpreadsheetNode,
} from '../utils/spreadsheet'

vi.mock('../composables/apiBase', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../composables/apiBase')>()
  return { ...actual, authFetch: vi.fn() }
})

vi.mock('officeparser', () => ({ parseOffice: vi.fn() }))

vi.mock('../components/workspace/CsvPreview.vue', () => ({
  __esModule: true,
  default: {
    name: 'CsvPreview',
    props: [
      'content',
      'filePath',
      'rawUrl',
      'sourceAvailable',
      'truncated',
      'rows',
      'encodingAvailable',
      'truncatedMessage',
      'pageSize',
    ],
    template:
      '<div class="csv-preview-stub" :data-encoding="String(encodingAvailable)" ' +
      ':data-source="String(sourceAvailable)" :data-truncated="String(truncated)" ' +
      ':data-message="truncatedMessage" :data-rows="JSON.stringify(rows)" />',
  },
}))

import { parseOffice } from 'officeparser'
import SpreadsheetPreview from '../components/workspace/SpreadsheetPreview.vue'

const authFetchMock = vi.mocked(authFetch)
const parseOfficeMock = vi.mocked(parseOffice)

beforeEach(function resetMocks() {
  settings.locale = 'en'
  authFetchMock.mockReset()
  parseOfficeMock.mockReset()
})

function responseOf(bytes = 8, declared?: number, ok = true): Response {
  return {
    ok,
    status: ok ? 200 : 500,
    headers: {
      get(name: string) {
        return name.toLowerCase() === 'content-length' && declared !== undefined
          ? String(declared)
          : null
      },
    },
    arrayBuffer: async () => new ArrayBuffer(bytes),
  } as unknown as Response
}

function cellNode(row: number, col: number, text: string, rawContent?: string): SpreadsheetNode {
  return { type: 'cell', text, metadata: { row, col }, rawContent }
}

function rowNode(...cells: SpreadsheetNode[]): SpreadsheetNode {
  return { type: 'row', children: cells }
}

function sheetNode(name: string | undefined, rows: SpreadsheetNode[]): SpreadsheetNode {
  return {
    type: 'sheet',
    metadata: name === undefined ? undefined : { sheetName: name },
    children: rows,
  }
}

function astOf(...sheets: SpreadsheetNode[]) {
  return { content: sheets }
}

function mountPreview(filePath = 'book.xlsx', rawUrl = '/api/workspace/raw?path=book.xlsx') {
  return mount(SpreadsheetPreview, { props: { rawUrl, filePath } })
}

describe('spreadsheet utilities', function spreadsheetUtilitySuite() {
  it('recognizes spreadsheet paths case-insensitively', function recognizesPaths() {
    expect(isSpreadsheetPath('reports/book.xlsx')).toBe(true)
    expect(isSpreadsheetPath('reports/book.XLS')).toBe(true)
    expect(isSpreadsheetPath('reports/book.csv')).toBe(false)
    expect(isSpreadsheetPath('reports/book.xlsx.md')).toBe(false)
    expect(isSpreadsheetPath('reports/book')).toBe(false)

    expect(isLegacyXlsPath('reports/book.xls')).toBe(true)
    expect(isLegacyXlsPath('reports/book.XLS')).toBe(true)
    expect(isLegacyXlsPath('reports/book.xlsx')).toBe(false)
  })

  it('decodes column references beyond Z', function decodesColumns() {
    expect(columnIndexFromCellRef('<c r="A1" s="1"><v>1</v></c>', 5)).toBe(0)
    expect(columnIndexFromCellRef('<c r="Z12"><v>1</v></c>', 5)).toBe(25)
    expect(columnIndexFromCellRef('<c r="AA3"><v>1</v></c>', 5)).toBe(26)
    expect(columnIndexFromCellRef('<c r="AB12"><v>1</v></c>', 5)).toBe(27)
    expect(columnIndexFromCellRef('<c r="ab1"><v>1</v></c>', 5)).toBe(27)
    expect(columnIndexFromCellRef('AB12', 5)).toBe(27)

    // No usable raw content falls back to the metadata column.
    expect(columnIndexFromCellRef(undefined, 7)).toBe(7)
    expect(columnIndexFromCellRef('<c s="2"><v>1</v></c>', 7)).toBe(7)
    expect(columnIndexFromCellRef('<c r="AB12">', 7)).toBe(27)
  })

  it('corrects the officeparser first-letter column bug with rawContent', function fixesColumnBug() {
    const table = buildSheetTable(
      sheetNode('Data', [rowNode(cellNode(0, 0, 'wide', '<c r="AB1" t="s"><v>0</v></c>'))]),
      'Sheet 1'
    )

    expect(table.rows[0][27]).toBe('wide')
    expect(table.columnCount).toBe(28)
  })

  it('builds dense rows, keeps leading blanks, and fills gaps with empty strings', function buildsDense() {
    const table = buildSheetTable(
      sheetNode('Data', [
        rowNode(cellNode(2, 0, 'a'), cellNode(2, 2, 'c')),
      ]),
      'Sheet 1'
    )

    expect(table.rows).toEqual([
      ['', '', ''],
      ['', '', ''],
      ['a', '', 'c'],
    ])
    expect(table.rowCount).toBe(3)
    expect(table.columnCount).toBe(3)
    expect(table.cellCount).toBe(9)
    expect(table.truncated).toBe(false)
  })

  it('drops trailing empty rows and ignores non-row children', function dropsTrailingBlanks() {
    const table = buildSheetTable(
      sheetNode('Data', [
        rowNode(cellNode(0, 0, 'title')),
        { type: 'image', text: '', metadata: { attachmentName: 'logo.png' } },
        rowNode(cellNode(3, 0, '')),
      ]),
      'Sheet 1'
    )

    expect(table.rows).toEqual([['title']])
    expect(table.rowCount).toBe(1)
  })

  it('falls back to the positional sheet name when metadata is missing', function fallsBackName() {
    const unnamed = buildSheetTable(sheetNode(undefined, [rowNode(cellNode(0, 0, 'a'))]), 'Sheet 4')
    expect(unnamed.name).toBe('Sheet 4')

    const blank = buildSheetTable(sheetNode('   ', [rowNode(cellNode(0, 0, 'a'))]), 'Sheet 5')
    expect(blank.name).toBe('Sheet 5')
  })

  it('applies row and column limits', function appliesRowColumnLimits() {
    const rowLimited = buildSheetTable(
      sheetNode('Data', [
        rowNode(cellNode(0, 0, 'a')),
        rowNode(cellNode(1, 0, 'b')),
        rowNode(cellNode(2, 0, 'c')),
      ]),
      'Sheet 1',
      { maxRowsPerSheet: 2 }
    )
    expect(rowLimited.rows).toEqual([['a'], ['b']])
    expect(rowLimited.truncated).toBe(true)

    const columnLimited = buildSheetTable(
      sheetNode('Data', [rowNode(cellNode(0, 0, 'a'), cellNode(0, 2, 'c'))]),
      'Sheet 1',
      { maxColumnsPerSheet: 2 }
    )
    // Column C is dropped; the table keeps only the columns that still hold data.
    expect(columnLimited.rows).toEqual([['a']])
    expect(columnLimited.columnCount).toBe(1)
    expect(columnLimited.truncated).toBe(true)
  })

  it('applies the per-sheet dense cell limit', function appliesSheetCellLimit() {
    const table = buildSheetTable(
      sheetNode('Data', [
        rowNode(cellNode(0, 0, 'a'), cellNode(0, 1, 'b')),
        rowNode(cellNode(1, 0, 'c'), cellNode(1, 1, 'd')),
        rowNode(cellNode(2, 0, 'e'), cellNode(2, 1, 'f')),
      ]),
      'Sheet 1',
      { maxCellsPerSheet: 4 }
    )

    expect(table.rows).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ])
    expect(table.cellCount).toBe(4)
    expect(table.truncated).toBe(true)
  })

  it('deduplicates sheet names and drops sheets over the workbook limit', function appliesSheetLimits() {
    const data = buildSpreadsheet(
      astOf(
        sheetNode(undefined, [rowNode(cellNode(0, 0, 'a'))]),
        sheetNode('Data', [rowNode(cellNode(0, 0, 'b'))]),
        sheetNode('Data', [rowNode(cellNode(0, 0, 'c'))])
      )
    )

    expect(data.sheets.map((sheet) => sheet.name)).toEqual(['Sheet 1', 'Data', 'Sheet 3'])

    const limited = buildSpreadsheet(
      astOf(
        sheetNode('First', [rowNode(cellNode(0, 0, 'a'))]),
        sheetNode('Second', [rowNode(cellNode(0, 0, 'b'))])
      ),
      { maxSheets: 1 }
    )
    expect(limited.sheets.map((sheet) => sheet.name)).toEqual(['First'])
    expect(limited.sheetsTruncated).toBe(true)
    expect(limited.truncated).toBe(true)
  })

  it('applies the workbook-wide dense cell limit', function appliesTotalCellLimit() {
    function twoByTwo(name: string): SpreadsheetNode {
      return sheetNode(name, [
        rowNode(cellNode(0, 0, 'a'), cellNode(0, 1, 'b')),
        rowNode(cellNode(1, 0, 'c'), cellNode(1, 1, 'd')),
      ])
    }

    const data = buildSpreadsheet(astOf(twoByTwo('One'), twoByTwo('Two')), { maxTotalCells: 4 })

    expect(data.sheets[0].cellCount).toBe(4)
    expect(data.sheets[1].rowCount).toBe(0)
    expect(data.sheets[1].truncated).toBe(true)
    expect(data.totalCells).toBe(4)
    expect(data.truncated).toBe(true)
    expect(data.sheetsTruncated).toBe(false)
  })
})

describe('SpreadsheetPreview', function spreadsheetPreviewSuite() {
  it('shows the loading placeholder before the response arrives', function showsLoading() {
    authFetchMock.mockReturnValue(new Promise<Response>(() => {}))

    const wrapper = mountPreview()

    expect(wrapper.text()).toContain('Loading…')
    expect(parseOfficeMock).not.toHaveBeenCalled()
  })

  it('never fetches or parses legacy .xls files', async function handlesLegacy() {
    const wrapper = mountPreview('reports/legacy.xls')
    await flushPromises()

    expect(wrapper.text()).toContain('Legacy .xls files are not supported')
    expect(authFetchMock).not.toHaveBeenCalled()
    expect(parseOfficeMock).not.toHaveBeenCalled()
  })

  it('renders sheet tabs, switches sheets, and hides encoding/source controls', async function rendersTabs() {
    authFetchMock.mockResolvedValue(responseOf(16))
    parseOfficeMock.mockResolvedValue(
      astOf(
        sheetNode('Alpha', [
          rowNode(cellNode(0, 0, 'name'), cellNode(0, 1, 'age')),
          rowNode(cellNode(1, 0, 'Alice'), cellNode(1, 1, '30')),
        ]),
        sheetNode('Beta', [rowNode(cellNode(0, 0, 'only-beta'))])
      ) as never
    )

    const wrapper = mountPreview()
    await flushPromises()

    const tabs = wrapper.findAll('[role="tab"]')
    expect(tabs).toHaveLength(2)
    expect(tabs[0].attributes('data-testid')).toBe('sheet-tab-0')
    expect(tabs[0].attributes('aria-selected')).toBe('true')
    expect(tabs[1].attributes('data-testid')).toBe('sheet-tab-1')
    expect(tabs[1].attributes('aria-selected')).toBe('false')

    const stub = wrapper.get('.csv-preview-stub')
    expect(stub.attributes('data-rows')).toContain('Alice')
    expect(stub.attributes('data-encoding')).toBe('false')
    expect(stub.attributes('data-source')).toBe('false')
    expect(stub.attributes('data-message')).toBe('Only the start of this sheet is shown')
    expect(stub.attributes('data-truncated')).toBe('false')
    expect(parseOfficeMock).toHaveBeenCalledWith(expect.any(ArrayBuffer), {
      includeRawContent: true,
    })

    await tabs[1].trigger('click')

    expect(wrapper.findAll('[role="tab"]')[1].attributes('aria-selected')).toBe('true')
    expect(wrapper.findAll('[role="tab"]')[0].attributes('aria-selected')).toBe('false')
    expect(wrapper.get('.csv-preview-stub').attributes('data-rows')).toContain('only-beta')
    expect(wrapper.get('.csv-preview-stub').attributes('data-rows')).not.toContain('Alice')
  })

  it('rejects files above the size limit before parsing', async function rejectsTooLarge() {
    authFetchMock.mockResolvedValue(responseOf(8, SPREADSHEET_LIMITS.maxBytes + 1))
    const declared = mountPreview('book.xlsx', '/raw/declared')
    await flushPromises()

    expect(declared.text()).toContain('too large to preview')
    expect(parseOfficeMock).not.toHaveBeenCalled()

    authFetchMock.mockResolvedValue(responseOf(SPREADSHEET_LIMITS.maxBytes + 1))
    const actual = mountPreview('book.xlsx', '/raw/actual')
    await flushPromises()

    expect(actual.text()).toContain('too large to preview')
    expect(parseOfficeMock).not.toHaveBeenCalled()
  })

  it('shows a parse error when officeparser fails', async function handlesParseError() {
    authFetchMock.mockResolvedValue(responseOf(16))
    parseOfficeMock.mockRejectedValue(new Error('bad zip'))

    const wrapper = mountPreview()
    await flushPromises()

    expect(wrapper.text()).toContain('Could not parse this spreadsheet')
    expect(wrapper.findAll('[role="tab"]')).toHaveLength(0)
  })

  it('shows the empty message for workbooks without sheets', async function handlesEmpty() {
    authFetchMock.mockResolvedValue(responseOf(16))
    parseOfficeMock.mockResolvedValue(astOf() as never)

    const wrapper = mountPreview()
    await flushPromises()

    expect(wrapper.text()).toContain('This spreadsheet has no data')
    expect(wrapper.findAll('[role="tab"]')).toHaveLength(0)
  })

  it('notes when the workbook exceeds the sheet limit', async function notesSheetTruncation() {
    authFetchMock.mockResolvedValue(responseOf(16))
    const sheets = Array.from({ length: SPREADSHEET_LIMITS.maxSheets + 1 }, (_, index) =>
      sheetNode(`Sheet${index + 1}`, [rowNode(cellNode(0, 0, `v${index}`))])
    )
    parseOfficeMock.mockResolvedValue(astOf(...sheets) as never)

    const wrapper = mountPreview()
    await flushPromises()

    expect(wrapper.text()).toContain('Only the first 50 sheets are shown')
    expect(wrapper.findAll('[role="tab"]')).toHaveLength(SPREADSHEET_LIMITS.maxSheets)
  })

  it('discards results for a file that changed mid-load', async function discardsStaleResults() {
    let resolveFirst: ((response: Response) => void) | undefined
    authFetchMock.mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          resolveFirst = resolve
        })
    )
    authFetchMock.mockResolvedValueOnce(responseOf(8))
    parseOfficeMock.mockResolvedValueOnce(
      astOf(sheetNode('New', [rowNode(cellNode(0, 0, 'new-data'))])) as never
    )

    const wrapper = mountPreview('book.xlsx', '/raw/first')
    await wrapper.setProps({ rawUrl: '/raw/second' })
    await flushPromises()

    expect(wrapper.text()).toContain('New')
    expect(parseOfficeMock).toHaveBeenCalledTimes(1)

    resolveFirst?.(responseOf(8))
    await flushPromises()

    expect(wrapper.text()).toContain('New')
    expect(wrapper.text()).not.toContain('Old')
    expect(parseOfficeMock).toHaveBeenCalledTimes(1)
  })

  it('shows a parse error for non-OK responses', async function handlesHttpError() {
    authFetchMock.mockResolvedValue(responseOf(8, undefined, false))

    const wrapper = mountPreview()
    await flushPromises()

    expect(wrapper.text()).toContain('Could not parse this spreadsheet')
    expect(parseOfficeMock).not.toHaveBeenCalled()
  })
})
