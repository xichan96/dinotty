import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import CsvPreview from '../components/workspace/CsvPreview.vue'
import FilePreviewContent from '../components/workspace/FilePreviewContent.vue'
import { detectCsvDelimiter, isCsvPreviewFile, parseCsvText } from '../utils/csvPreview'
import { settings } from '../composables/useSettings'

// This suite asserts Chinese UI strings; pin the locale explicitly since the
// default is now 'auto' (which jsdom resolves to English).
beforeEach(() => {
  settings.locale = 'zh'
})

describe('CSV preview utilities', function csvPreviewUtilitiesSuite() {
  it('recognizes CSV and TSV paths without matching spreadsheet files', function recognizesPaths() {
    // 步骤1：验证支持的文件后缀和大小写。
    expect(isCsvPreviewFile('reports/users.csv')).toBe(true)
    expect(isCsvPreviewFile('reports/users.TSV')).toBe(true)

    // 步骤2：验证其他表格和普通文本不会进入 CSV 预览。
    expect(isCsvPreviewFile('reports/users.xlsx')).toBe(false)
    expect(isCsvPreviewFile('reports/users.csv.md')).toBe(false)
  })

  it('detects delimiters outside quoted fields', function detectsDelimiter() {
    // 步骤1：引号内的逗号不参与分隔符统计。
    const semicolonText = 'name;note\nAlice;"Shanghai, China"'
    expect(detectCsvDelimiter(semicolonText, 'people.csv')).toBe(';')

    // 步骤2：TSV 文件优先使用制表符。
    expect(detectCsvDelimiter('name\tage\nAlice\t30', 'people.tsv')).toBe('\t')
  })

  it('parses quoted delimiters, escaped quotes, and line breaks', function parsesQuotedFields() {
    // 步骤1：解析包含特殊字符的两行 CSV。
    const csvText = 'name,note\r\n"Doe, Jane","said ""hello""\nagain"\r\n'
    const parsedRows = parseCsvText(csvText, ',')

    // 步骤2：确认字段内容和尾部空行处理正确。
    expect(parsedRows).toEqual([
      ['name', 'note'],
      ['Doe, Jane', 'said "hello"\nagain'],
    ])
  })
})

describe('CsvPreview', function csvPreviewComponentSuite() {
  afterEach(function restoreBrowserMocks() {
    // 步骤1：清理当前用例替换的浏览器 API。
    vi.unstubAllGlobals()
  })

  it('uses the first row as headers and filters matching records', async function rendersAndFilters() {
    // 步骤1：挂载一个包含三条记录的 CSV 表格。
    const wrapper = mount(CsvPreview, {
      props: {
        content: 'name,city\nAlice,Shanghai\nBob,Beijing\nCarol,Shenzhen',
        filePath: 'people.csv',
        truncated: false,
      },
    })

    // 步骤2：确认首行成为表头，数据行正常显示。
    const headerCells = wrapper.findAll('thead th')
    expect(headerCells[1].text()).toBe('name')
    expect(headerCells[2].text()).toBe('city')
    expect(wrapper.findAll('tbody tr')).toHaveLength(3)

    // 步骤3：搜索后只保留匹配记录。
    await wrapper.get('input[type="search"]').setValue('beijing')
    expect(wrapper.findAll('tbody tr')).toHaveLength(1)
    expect(wrapper.find('tbody').text()).toContain('Bob')
    expect(wrapper.find('tbody').text()).not.toContain('Alice')
  })

  it('combines multiple conditions with AND and OR', async function combinesConditions() {
    // 步骤1：挂载包含城市和状态字段的 CSV 表格。
    const wrapper = mount(CsvPreview, {
      props: {
        content:
          'name,city,status\nAlice,Shanghai,active\nBob,Shanghai,inactive\nCarol,Beijing,active\nDavid,Shenzhen,inactive',
        filePath: 'people.csv',
        truncated: false,
      },
    })

    // 步骤2：添加“城市等于 Shanghai”和“状态等于 active”两个条件。
    await wrapper.get('[data-testid="csv-filter-toggle"]').trigger('click')
    await wrapper.get('[data-testid="csv-filter-column-0"]').setValue('1')
    await wrapper.get('[data-testid="csv-filter-operator-0"]').setValue('equals')
    await wrapper.get('[data-testid="csv-filter-value-0"]').setValue('Shanghai')
    await wrapper.get('[data-testid="csv-filter-add"]').trigger('click')
    await wrapper.get('[data-testid="csv-filter-column-1"]').setValue('2')
    await wrapper.get('[data-testid="csv-filter-operator-1"]').setValue('equals')
    await wrapper.get('[data-testid="csv-filter-value-1"]').setValue('active')

    // 步骤3：AND 模式只保留同时满足两个条件的 Alice。
    expect(wrapper.findAll('tbody tr')).toHaveLength(1)
    expect(wrapper.find('tbody').text()).toContain('Alice')
    expect(wrapper.find('tbody').text()).not.toContain('Bob')
    expect(wrapper.find('tbody').text()).not.toContain('Carol')

    // 步骤4：切换 OR 模式后保留满足任一条件的三行。
    await wrapper.get('[data-testid="csv-filter-logic-or"]').trigger('click')
    expect(wrapper.findAll('tbody tr')).toHaveLength(3)
    expect(wrapper.find('tbody').text()).toContain('Alice')
    expect(wrapper.find('tbody').text()).toContain('Bob')
    expect(wrapper.find('tbody').text()).toContain('Carol')
    expect(wrapper.find('tbody').text()).not.toContain('David')
  })

  it('negates an individual filter condition', async function negatesCondition() {
    // 步骤1：挂载包含状态字段的 CSV 表格并设置状态等于 active。
    const wrapper = mount(CsvPreview, {
      props: {
        content: 'name,status\nAlice,active\nBob,inactive\nCarol,active',
        filePath: 'people.csv',
        truncated: false,
      },
    })
    await wrapper.get('[data-testid="csv-filter-toggle"]').trigger('click')
    await wrapper.get('[data-testid="csv-filter-column-0"]').setValue('1')
    await wrapper.get('[data-testid="csv-filter-operator-0"]').setValue('equals')
    await wrapper.get('[data-testid="csv-filter-value-0"]').setValue('active')

    // 步骤2：启用“非”后只保留不满足该条件的 Bob。
    await wrapper.get('[data-testid="csv-filter-negate-0"]').setValue(true)
    expect(wrapper.findAll('tbody tr')).toHaveLength(1)
    expect(wrapper.find('tbody').text()).toContain('Bob')
    expect(wrapper.find('tbody').text()).not.toContain('Alice')
    expect(wrapper.find('tbody').text()).not.toContain('Carol')
  })

  it('excludes rows whose selected column contains the filter text', async function excludesContainedText() {
    // 步骤1：挂载包含不同城市的 CSV 表格并打开筛选面板。
    const wrapper = mount(CsvPreview, {
      props: {
        content: 'name,city\nAlice,Shanghai\nBob,Beijing\nCarol,Shanghai',
        filePath: 'people.csv',
        truncated: false,
      },
    })
    await wrapper.get('[data-testid="csv-filter-toggle"]').trigger('click')

    // 步骤2：确认存在“不包含”运算符，再设置城市列不包含 hai。
    expect(wrapper.find('option[value="notContains"]').exists()).toBe(true)
    await wrapper.get('[data-testid="csv-filter-column-0"]').setValue('1')
    await wrapper.get('[data-testid="csv-filter-operator-0"]').setValue('notContains')
    await wrapper.get('[data-testid="csv-filter-value-0"]').setValue('hai')

    // 步骤3：确认排除包含 hai 的上海记录，只保留北京记录。
    expect(wrapper.findAll('tbody tr')).toHaveLength(1)
    expect(wrapper.find('tbody').text()).toContain('Bob')
    expect(wrapper.find('tbody').text()).not.toContain('Alice')
    expect(wrapper.find('tbody').text()).not.toContain('Carol')
  })

  it('excludes a row when any column contains the filter text', async function excludesAcrossAllColumns() {
    // 步骤1：挂载在不同列中包含 Shanghai 的 CSV 表格并打开筛选面板。
    const wrapper = mount(CsvPreview, {
      props: {
        content:
          'name,city,note\nAlice,Shanghai,active\nBob,Beijing,Shanghai trip\nCarol,Shenzhen,active',
        filePath: 'people.csv',
        truncated: false,
      },
    })
    await wrapper.get('[data-testid="csv-filter-toggle"]').trigger('click')

    // 步骤2：保持默认“所有列”，设置不包含 Shanghai。
    await wrapper.get('[data-testid="csv-filter-operator-0"]').setValue('notContains')
    await wrapper.get('[data-testid="csv-filter-value-0"]').setValue('Shanghai')

    // 步骤3：确认城市列或备注列命中的记录都被排除。
    expect(wrapper.findAll('tbody tr')).toHaveLength(1)
    expect(wrapper.find('tbody').text()).toContain('Carol')
    expect(wrapper.find('tbody').text()).not.toContain('Alice')
    expect(wrapper.find('tbody').text()).not.toContain('Bob')
  })

  it('applies column choices only after confirming the dialog', async function confirmsColumns() {
    // 步骤1：挂载包含三列的 CSV 表格并打开列显示弹窗。
    const wrapper = mount(CsvPreview, {
      props: {
        content: 'name,city,status\nAlice,Shanghai,active',
        filePath: 'people.csv',
        truncated: false,
      },
    })
    await wrapper.get('[data-testid="csv-columns-toggle"]').trigger('click')
    expect(wrapper.get('[data-testid="csv-columns-dialog"]').attributes('role')).toBe('dialog')

    // 步骤2：取消弹窗后不应用临时取消的城市列。
    await wrapper.get('[data-testid="csv-column-option-1"]').setValue(false)
    await wrapper.get('[data-testid="csv-columns-cancel"]').trigger('click')
    expect(wrapper.find('[data-testid="csv-columns-dialog"]').exists()).toBe(false)
    expect(wrapper.findAll('thead th')).toHaveLength(4)
    expect(wrapper.find('thead').text()).toContain('city')

    // 步骤3：重新打开弹窗，确定后只显示姓名列。
    await wrapper.get('[data-testid="csv-columns-toggle"]').trigger('click')
    await wrapper.get('[data-testid="csv-column-option-1"]').setValue(false)
    await wrapper.get('[data-testid="csv-column-option-2"]').setValue(false)
    await wrapper.get('[data-testid="csv-columns-confirm"]').trigger('click')
    expect(wrapper.findAll('thead th')).toHaveLength(2)
    expect(wrapper.find('thead').text()).toContain('name')
    expect(wrapper.find('thead').text()).not.toContain('city')
    expect(wrapper.findAll('tbody td')).toHaveLength(1)

    // 步骤4：在弹窗中全选并确定后恢复全部三列。
    await wrapper.get('[data-testid="csv-columns-toggle"]').trigger('click')
    await wrapper.get('[data-testid="csv-columns-select-all"]').trigger('click')
    await wrapper.get('[data-testid="csv-columns-confirm"]').trigger('click')
    expect(wrapper.findAll('thead th')).toHaveLength(4)
    expect(wrapper.find('thead').text()).toContain('city')
    expect(wrapper.find('thead').text()).toContain('status')
  })

  it('can hide every data column and restore all columns', async function hidesEveryColumn() {
    // 步骤1：打开列选择弹窗并使用“全不选”。
    const wrapper = mount(CsvPreview, {
      props: {
        content: 'name,city,status\nAlice,Shanghai,active',
        filePath: 'people.csv',
        truncated: false,
      },
    })
    await wrapper.get('[data-testid="csv-columns-toggle"]').trigger('click')
    await wrapper.get('[data-testid="csv-columns-select-none"]').trigger('click')
    await wrapper.get('[data-testid="csv-columns-confirm"]').trigger('click')

    // 步骤2：确认后仅保留行号表头和行号单元格。
    expect(wrapper.findAll('thead th')).toHaveLength(1)
    expect(wrapper.findAll('tbody td')).toHaveLength(0)
    expect(wrapper.findAll('tbody th')).toHaveLength(1)

    // 步骤3：重新全选并确认后恢复全部数据列。
    await wrapper.get('[data-testid="csv-columns-toggle"]').trigger('click')
    await wrapper.get('[data-testid="csv-columns-select-all"]').trigger('click')
    await wrapper.get('[data-testid="csv-columns-confirm"]').trigger('click')
    expect(wrapper.findAll('thead th')).toHaveLength(4)
    expect(wrapper.findAll('tbody td')).toHaveLength(3)
  })

  it('filters rows with numeric and date comparisons', async function filtersNumbersAndDates() {
    // 步骤1：打开包含数值列和日期列的 CSV 表格筛选面板。
    const wrapper = mount(CsvPreview, {
      props: {
        content: 'name,amount,date\nAlice,10,2025-01-10\nBob,25.5,2025-02-15\nCarol,100,2025-03-20',
        filePath: 'payments.csv',
        truncated: false,
      },
    })
    await wrapper.get('[data-testid="csv-filter-toggle"]').trigger('click')

    // 步骤2：设置“金额大于 20”，并确认输入框使用数值类型。
    await wrapper.get('[data-testid="csv-filter-column-0"]').setValue('1')
    await wrapper.get('[data-testid="csv-filter-operator-0"]').setValue('numberGreaterThan')
    expect(wrapper.get('[data-testid="csv-filter-value-0"]').attributes('type')).toBe('number')
    await wrapper.get('[data-testid="csv-filter-value-0"]').setValue('20')

    // 步骤3：添加“日期早于 2025-03-01”，并确认输入框使用日期类型。
    await wrapper.get('[data-testid="csv-filter-add"]').trigger('click')
    await wrapper.get('[data-testid="csv-filter-column-1"]').setValue('2')
    await wrapper.get('[data-testid="csv-filter-operator-1"]').setValue('dateBefore')
    expect(wrapper.get('[data-testid="csv-filter-value-1"]').attributes('type')).toBe('date')
    await wrapper.get('[data-testid="csv-filter-value-1"]').setValue('2025-03-01')

    // 步骤4：AND 组合只保留同时满足两个条件的 Bob。
    expect(wrapper.findAll('tbody tr')).toHaveLength(1)
    expect(wrapper.find('tbody').text()).toContain('Bob')
    expect(wrapper.find('tbody').text()).not.toContain('Alice')
    expect(wrapper.find('tbody').text()).not.toContain('Carol')
  })

  it('emits a source request from the toolbar', async function emitsSourceRequest() {
    // 步骤1：挂载最小 CSV 内容。
    const wrapper = mount(CsvPreview, {
      props: {
        content: 'name\nAlice',
        filePath: 'people.csv',
        truncated: false,
      },
    })

    // 步骤2：点击源码按钮并检查事件。
    await wrapper.get('[data-testid="csv-source-button"]').trigger('click')
    expect(wrapper.emitted('showSource')).toHaveLength(1)
  })

  it('loads raw bytes and decodes GBK', async function decodesGbk() {
    // 步骤1：准备包含“中文”的 GBK 原始字节。
    const gbkBytes = new Uint8Array([0x6e, 0x61, 0x6d, 0x65, 0x0a, 0xd6, 0xd0, 0xce, 0xc4])
    const fetchMock = vi.fn(async function fetchRawCsv() {
      return {
        ok: true,
        arrayBuffer: async function readRawBuffer() {
          return gbkBytes.buffer
        },
      }
    })
    vi.stubGlobal('fetch', fetchMock)

    // 步骤2：切换编码并等待原始内容加载。
    const wrapper = mount(CsvPreview, {
      props: {
        content: 'name\nAlice',
        filePath: 'people.csv',
        rawUrl: '/api/workspace/raw?path=people.csv',
        truncated: false,
      },
    })
    await wrapper.get('[data-testid="csv-encoding-select"]').setValue('gbk')
    await flushPromises()

    // 步骤3：确认读取原文件并显示 GBK 文本。
    expect(fetchMock).toHaveBeenCalledWith('/api/workspace/raw?path=people.csv')
    expect(wrapper.find('tbody').text()).toContain('中文')
  })

  it('loads raw UTF-8 when metadata has no decoded content', async function loadsMissingContent() {
    // 步骤1：准备后端未提供文本时可读取的 UTF-8 原始内容。
    const utf8Bytes = new TextEncoder().encode('name\nAlice')
    const fetchMock = vi.fn(async function fetchRawCsv() {
      return {
        ok: true,
        arrayBuffer: async function readRawBuffer() {
          return utf8Bytes.buffer
        },
      }
    })
    vi.stubGlobal('fetch', fetchMock)

    // 步骤2：挂载没有已解码内容的 CSV 并等待自动加载。
    const wrapper = mount(CsvPreview, {
      props: {
        content: '',
        filePath: 'people.csv',
        rawUrl: '/api/workspace/raw?path=people.csv',
        truncated: false,
      },
    })
    await flushPromises()

    // 步骤3：确认表格显示原始 UTF-8 内容。
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(wrapper.find('tbody').text()).toContain('Alice')
  })

  it('loads the full raw file when metadata content is truncated', async function loadsTruncatedContent() {
    // 步骤1：准备比元数据预览多一行的完整 CSV 内容。
    const completeBytes = new TextEncoder().encode('name\nAlice\nBob')
    const fetchMock = vi.fn(async function fetchRawCsv() {
      return {
        ok: true,
        arrayBuffer: async function readRawBuffer() {
          return completeBytes.buffer
        },
      }
    })
    vi.stubGlobal('fetch', fetchMock)

    // 步骤2：用已截断的元数据内容挂载表格并等待原文件加载。
    const wrapper = mount(CsvPreview, {
      props: {
        content: 'name\nAlice',
        filePath: 'people.csv',
        rawUrl: '/api/workspace/raw?path=people.csv',
        truncated: true,
      },
    })
    await flushPromises()

    // 步骤3：确认读取完整文件、显示后续记录并移除截断提示。
    expect(fetchMock).toHaveBeenCalledWith('/api/workspace/raw?path=people.csv')
    expect(wrapper.find('tbody').text()).toContain('Bob')
    expect(wrapper.find('.csv-preview-notice').exists()).toBe(false)
  })

  it('replaces table data when the selected file changes', async function replacesFileContent() {
    // 步骤1：先显示第一个文件的数据。
    const wrapper = mount(CsvPreview, {
      props: {
        content: 'name\nAlice',
        filePath: 'first.csv',
        truncated: false,
      },
    })
    expect(wrapper.find('tbody').text()).toContain('Alice')

    // 步骤2：复用组件并传入另一个文件。
    await wrapper.setProps({
      content: 'name\nBob',
      filePath: 'second.csv',
    })

    // 步骤3：确认旧文件数据被完全替换。
    expect(wrapper.find('tbody').text()).toContain('Bob')
    expect(wrapper.find('tbody').text()).not.toContain('Alice')
  })

  it('paginates rows without rendering the whole file', async function paginatesRows() {
    // 步骤1：把每页大小缩小到两行以验证分页。
    const wrapper = mount(CsvPreview, {
      props: {
        content: 'name\nAlice\nBob\nCarol',
        filePath: 'people.csv',
        truncated: false,
        pageSize: 2,
      },
    })
    expect(wrapper.findAll('tbody tr')).toHaveLength(2)
    expect(wrapper.find('tbody').text()).toContain('Alice')

    // 步骤2：进入下一页后只显示最后一条记录。
    const paginationButtons = wrapper.findAll('.csv-preview-pagination button')
    expect(paginationButtons).toHaveLength(2)
    await paginationButtons[1].trigger('click')
    expect(wrapper.findAll('tbody tr')).toHaveLength(1)
    expect(wrapper.find('tbody').text()).toContain('Carol')

    // 步骤3：返回上一页后恢复前两条记录。
    await paginationButtons[0].trigger('click')
    expect(wrapper.find('tbody').text()).toContain('Alice')
  })

  it('can treat the first record as table data', async function togglesHeaderRow() {
    // 步骤1：确认默认模式把首行作为表头。
    const wrapper = mount(CsvPreview, {
      props: {
        content: 'name\nAlice',
        filePath: 'people.csv',
        truncated: false,
      },
    })
    expect(wrapper.findAll('tbody tr')).toHaveLength(1)

    // 步骤2：关闭表头模式后首行进入数据区。
    await wrapper.get('.csv-preview-header-toggle input').setValue(false)
    expect(wrapper.findAll('tbody tr')).toHaveLength(2)
    expect(wrapper.find('thead').text()).toContain('列 1')
  })
})

describe('FilePreviewContent CSV integration', function csvPreviewIntegrationSuite() {
  afterEach(function restoreBrowserMocks() {
    // 步骤1：清理当前用例替换的浏览器 API。
    vi.unstubAllGlobals()
  })

  it('opens CSV as a table and can switch between table and source', async function switchesViews() {
    // 步骤1：用文件导航器实际传入的文本元数据挂载预览组件。
    const csvContent = 'name,city\nAlice,Shanghai'
    const wrapper = mount(FilePreviewContent, {
      props: {
        previewLoading: false,
        previewErr: '',
        selectedRel: 'people.csv',
        selectedIsDir: false,
        meta: { kind: 'text', content: csvContent, language: 'plaintext', truncated: false },
        rawUrl: '/api/workspace/raw?path=people.csv',
        showSave: true,
        audioTitle: '',
        audioSub: '',
        audioTimeNow: '0:00',
        audioTimeTotal: '0:00',
        audioSeekValue: 0,
        audioVolValue: 100,
        audioPlaying: false,
        editorDirty: false,
        editorText: csvContent,
        canSaveEditor: true,
        mdShowPreview: false,
        htmlShowPreview: false,
        markdownEditorHtml: '',
        officeLoading: false,
        officeErr: '',
        officeHtml: '',
        paneId: 'pane-1',
        filePath: 'people.csv',
      },
      global: {
        stubs: {
          MonacoEditor: true,
        },
      },
    })

    // 步骤2：CSV 默认显示表格预览。
    expect(wrapper.findComponent(CsvPreview).exists()).toBe(true)

    // 步骤3：从表格切换到源码视图。
    await wrapper.get('[data-testid="csv-source-button"]').trigger('click')
    expect(wrapper.findComponent(CsvPreview).exists()).toBe(false)
    expect(wrapper.find('.file-editor-root').exists()).toBe(true)

    // 步骤4：选择另一个 CSV 时默认恢复表格视图。
    await wrapper.setProps({
      selectedRel: 'next.csv',
      filePath: 'next.csv',
      meta: { kind: 'text', content: 'name\nBob', language: 'plaintext', truncated: false },
      editorText: 'name\nBob',
    })
    expect(wrapper.findComponent(CsvPreview).exists()).toBe(true)

    // 步骤5：仍可从源码工具栏手动切回表格视图。
    await wrapper.get('[data-testid="csv-source-button"]').trigger('click')
    await wrapper.get('[data-testid="csv-table-button"]').trigger('click')
    expect(wrapper.findComponent(CsvPreview).exists()).toBe(true)
  })

  it('opens backend-unsupported CSV files in the table preview', async function opensUnsupportedCsv() {
    // 步骤1：模拟后端无法按 UTF-8 解码文件的元数据和原始内容。
    const emptyBytes = new Uint8Array(0)
    const fetchMock = vi.fn(async function fetchRawCsv() {
      return {
        ok: true,
        arrayBuffer: async function readRawBuffer() {
          return emptyBytes.buffer
        },
      }
    })
    vi.stubGlobal('fetch', fetchMock)

    const wrapper = mount(FilePreviewContent, {
      props: {
        previewLoading: false,
        previewErr: '',
        selectedRel: 'legacy.csv',
        selectedIsDir: false,
        meta: { kind: 'unsupported', message: 'binary file', truncated: false },
        rawUrl: '/api/workspace/raw?path=legacy.csv',
        showSave: true,
        audioTitle: '',
        audioSub: '',
        audioTimeNow: '0:00',
        audioTimeTotal: '0:00',
        audioSeekValue: 0,
        audioVolValue: 100,
        audioPlaying: false,
        editorDirty: false,
        editorText: '',
        canSaveEditor: false,
        mdShowPreview: false,
        htmlShowPreview: false,
        markdownEditorHtml: '',
        officeLoading: false,
        officeErr: '',
        officeHtml: '',
        paneId: 'pane-1',
        filePath: 'legacy.csv',
      },
    })
    await flushPromises()

    // 步骤2：仍然显示 CSV 表格入口，且不提供无效的源码按钮。
    expect(wrapper.findComponent(CsvPreview).exists()).toBe(true)
    expect(wrapper.find('[data-testid="csv-source-button"]').exists()).toBe(false)
  })
})
