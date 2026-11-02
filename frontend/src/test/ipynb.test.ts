import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import FilePreviewContent from '../components/workspace/FilePreviewContent.vue'
import IpynbPreview from '../components/workspace/IpynbPreview.vue'
import { authFetch } from '../composables/apiBase'
import { settings } from '../composables/useSettings'
import {
  imageDataUrl,
  isIpynbFile,
  jsonText,
  mimeText,
  outputText,
  parseIpynb,
  stripAnsi,
  type IpynbOutput,
} from '../utils/ipynb'

vi.mock('../components/workspace/MonacoEditor.vue', () => ({
  __esModule: true,
  default: {
    name: 'MonacoEditor',
    props: ['modelValue', 'language', 'readonly', 'filePath', 'paneId', 'leafId'],
    template: '<div class="monaco-stub"></div>',
  },
}))

vi.mock('../composables/apiBase', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../composables/apiBase')>()
  return { ...actual, authFetch: vi.fn() }
})

const authFetchMock = vi.mocked(authFetch)

beforeEach(function resetLocale() {
  settings.locale = 'en'
  authFetchMock.mockReset()
})

function notebookV4(cells: unknown[], language = 'python'): string {
  return JSON.stringify({
    nbformat: 4,
    nbformat_minor: 5,
    metadata: { kernelspec: { display_name: language, language, name: language } },
    cells,
  })
}

function mountPreview(content: string, overrides: Record<string, unknown> = {}) {
  return mount(IpynbPreview, {
    props: {
      content,
      filePath: 'notebooks/demo.ipynb',
      rawUrl: '/api/workspace/raw?pane_id=p1&path=notebooks%2Fdemo.ipynb',
      paneId: 'p1',
      editorText: content,
      ...overrides,
    },
  })
}

/** Wait for lazily imported renderers (marked, DOMPurify, highlight.js) to land. */
function waitFor(check: () => void): Promise<void> {
  return vi.waitFor(check, { timeout: 5000, interval: 20 })
}

describe('ipynb utilities', function ipynbUtilitiesSuite() {
  it('recognizes notebook paths only', function recognizesPaths() {
    expect(isIpynbFile('notebooks/demo.ipynb')).toBe(true)
    expect(isIpynbFile('DEMO.IPYNB')).toBe(true)
    expect(isIpynbFile('notebooks/demo.ipynb.md')).toBe(false)
    expect(isIpynbFile('notebooks/demo.json')).toBe(false)
  })

  it('parses nbformat 4 cells, source arrays and outputs', function parsesV4() {
    const result = parseIpynb(
      notebookV4([
        { cell_type: 'markdown', source: ['# Title\n', 'Body'] },
        {
          cell_type: 'code',
          execution_count: 3,
          source: ['print(1)\n', 'print(2)'],
          outputs: [
            { output_type: 'stream', name: 'stdout', text: ['hello\n', 'world'] },
            { output_type: 'stream', name: 'stderr', text: 'oops' },
            {
              output_type: 'error',
              ename: 'ValueError',
              evalue: 'bad',
              traceback: ['\u001b[31mTraceback\u001b[0m', 'ValueError: bad'],
            },
            {
              output_type: 'execute_result',
              execution_count: 3,
              data: { 'text/plain': '42', 'text/html': '<b>42</b>' },
            },
            {
              output_type: 'display_data',
              data: { 'image/png': 'iVBOR', 'text/plain': '<Figure>' },
            },
            {
              output_type: 'display_data',
              data: { 'text/plain': 'x', 'text/latex': '\\alpha' },
            },
          ],
        },
        { cell_type: 'raw', source: 'raw payload' },
      ])
    )

    expect(result.status).toBe('ok')
    expect(result.language).toBe('python')
    expect(result.cells.map((cell) => cell.type)).toEqual(['markdown', 'code', 'raw'])
    expect(result.cells[0].source).toBe('# Title\nBody')

    const code = result.cells[1]
    expect(code.source).toBe('print(1)\nprint(2)')
    expect(code.executionCount).toBe(3)
    expect(code.language).toBe('python')
    expect(code.outputs.map((output) => output.kind)).toEqual([
      'stream',
      'stream',
      'error',
      'result',
      'display',
      'display',
    ])
    expect(code.outputs[0].stream).toBe('stdout')
    expect(code.outputs[0].text).toBe('hello\nworld')
    expect(code.outputs[1].stream).toBe('stderr')
    expect(code.outputs[2].traceback).toEqual(['\u001b[31mTraceback\u001b[0m', 'ValueError: bad'])
    expect(code.outputs[3].mime).toBe('text/html')
    expect(code.outputs[3].data).toBe('<b>42</b>')
    expect(code.outputs[3].bundle['text/plain']).toBe('42')
    expect(code.outputs[4].mime).toBe('image/png')
    expect(code.outputs[5].mime).toBe('text/latex')
  })

  it('prefers png, html, json and latex over plain text', function prefersMimes() {
    const result = parseIpynb(
      notebookV4([
        {
          cell_type: 'code',
          source: 'x',
          outputs: [
            {
              output_type: 'display_data',
              data: { 'text/plain': 'p', 'image/jpeg': 'j', 'image/png': 'png' },
            },
            {
              output_type: 'display_data',
              data: { 'text/html': '<b>x</b>', 'text/plain': 'p' },
            },
            {
              output_type: 'display_data',
              data: { 'application/json': { a: 1 }, 'text/plain': 'p' },
            },
            {
              output_type: 'display_data',
              data: { 'text/plain': 'p', 'text/latex': 'l' },
            },
          ],
        },
      ])
    )

    const outputs = result.cells[0].outputs
    expect(outputs.map((output) => output.mime)).toEqual([
      'image/png',
      'text/html',
      'application/json',
      'text/latex',
    ])
    expect(jsonText(outputs[2].data)).toContain('"a": 1')
  })

  it('parses the nbformat 3 worksheets shape', function parsesV3() {
    const result = parseIpynb(
      JSON.stringify({
        nbformat: 3,
        nbformat_minor: 0,
        metadata: { language: 'python' },
        worksheets: [
          {
            cells: [
              {
                cell_type: 'code',
                input: ['x = 1\n', 'y = 2'],
                outputs: [
                  { output_type: 'pyout', text: '3', html: '<b>3</b>' },
                  { output_type: 'pyerr', ename: 'E', evalue: 'bad', traceback: ['E: bad'] },
                  { output_type: 'stream', stream: 'stderr', text: 'err' },
                ],
              },
              { cell_type: 'markdown', source: '# hi' },
              { cell_type: 'heading', level: 2, source: 'Sub' },
              { cell_type: 'raw', source: 'raw' },
            ],
          },
        ],
      })
    )

    expect(result.status).toBe('ok')
    expect(result.version).toBe(3)
    expect(result.language).toBe('python')
    expect(result.cells).toHaveLength(4)
    expect(result.cells[0].source).toBe('x = 1\ny = 2')
    expect(result.cells[0].language).toBe('python')
    expect(result.cells[0].outputs.map((output) => output.kind)).toEqual([
      'result',
      'error',
      'stream',
    ])
    expect(result.cells[0].outputs[0].mime).toBe('text/html')
    expect(result.cells[0].outputs[1].traceback).toEqual(['E: bad'])
    expect(result.cells[0].outputs[2].stream).toBe('stderr')
    expect(result.cells[1].source).toBe('# hi')
    expect(result.cells[2].source).toBe('## Sub')
    expect(result.cells[3].type).toBe('raw')
  })

  it('reports malformed JSON and unsupported shapes', function reportsMalformed() {
    const malformed = parseIpynb('{"nbformat": 4, "cells": [')
    expect(malformed.status).toBe('invalid-json')
    expect(malformed.cells).toEqual([])
    expect(malformed.error).toBeTruthy()

    const notAnObject = parseIpynb('[]')
    expect(notAnObject.status).toBe('unsupported-shape')
    expect(notAnObject.error).toBeTruthy()

    const noCells = parseIpynb(JSON.stringify({ metadata: {} }))
    expect(noCells.status).toBe('unsupported-shape')
  })

  it('reports unsupported versions and accepts empty notebooks', function reportsVersions() {
    const unsupported = parseIpynb(JSON.stringify({ nbformat: 5, cells: [] }))
    expect(unsupported.status).toBe('unsupported-version')
    expect(unsupported.version).toBe(5)

    const empty = parseIpynb(notebookV4([]))
    expect(empty.status).toBe('ok')
    expect(empty.cells).toEqual([])
  })

  it('normalizes stream, error and image payloads', function normalizesPayloads() {
    const stream: IpynbOutput = {
      kind: 'stream',
      stream: 'stderr',
      text: '\u001b[31mboom\u001b[0m',
      bundle: {},
    }
    expect(stripAnsi('\u001b[31mred\u001b[0m')).toBe('red')
    expect(outputText(stream)).toBe('boom')

    const error: IpynbOutput = {
      kind: 'error',
      ename: 'ValueError',
      evalue: 'bad',
      traceback: ['ValueError: bad'],
      bundle: {},
    }
    expect(outputText(error)).toContain('ValueError: bad')

    const image: IpynbOutput = {
      kind: 'display',
      mime: 'image/png',
      data: ['iVBOR', 'AAAA'],
      bundle: { 'image/png': ['iVBOR', 'AAAA'] },
    }
    expect(mimeText(image.data)).toBe('iVBORAAAA')
    expect(imageDataUrl(image)).toBe('data:image/png;base64,iVBORAAAA')
  })
})

describe('IpynbPreview', function ipynbPreviewSuite() {
  it('renders markdown cells, code labels and outputs', async function rendersCells() {
    const wrapper = mountPreview(
      notebookV4([
        { cell_type: 'markdown', source: '# Hello notebook\n\nSome **text**.' },
        {
          cell_type: 'code',
          execution_count: 2,
          source: 'print("hi")',
          outputs: [
            { output_type: 'stream', name: 'stdout', text: 'hi\n' },
            { output_type: 'display_data', data: { 'image/png': 'AAAA' } },
          ],
        },
      ])
    )
    await waitFor(() => expect(wrapper.text()).toContain('Hello notebook'))

    expect(wrapper.find('.ipynb-preview').exists()).toBe(true)
    expect(wrapper.find('.ipynb-markdown').text()).toContain('Hello notebook')
    expect(wrapper.find('.ipynb-markdown strong').text()).toBe('text')
    expect(wrapper.find('.ipynb-lang').text()).toBe('python')
    expect(wrapper.find('.ipynb-exec').text()).toContain('2')
    expect(wrapper.findAll('.ipynb-output')).toHaveLength(2)
    expect(wrapper.find('.ipynb-output-text').text()).toContain('hi')
    expect(wrapper.find('img.ipynb-output-image').attributes('src')).toBe(
      'data:image/png;base64,AAAA'
    )
    wrapper.unmount()
  })

  it('toggles between Notebook and Source views', async function togglesSource() {
    const wrapper = mountPreview(notebookV4([{ cell_type: 'markdown', source: '# Cell' }]))
    await waitFor(() => expect(wrapper.text()).toContain('Cell'))
    expect(wrapper.find('.ipynb-notebook').exists()).toBe(true)

    await wrapper.get('[data-testid="ipynb-source-tab"]').trigger('click')
    await waitFor(() => expect(wrapper.find('.monaco-stub').exists()).toBe(true))
    expect(wrapper.find('.ipynb-notebook').exists()).toBe(false)

    await wrapper.get('[data-testid="ipynb-notebook-tab"]').trigger('click')
    await waitFor(() => expect(wrapper.find('.ipynb-notebook').exists()).toBe(true))
    wrapper.unmount()
  })

  it('shows a parse error with the parser detail', async function showsParseError() {
    const wrapper = mountPreview('{"nbformat": 4, "cells": [')
    await flushPromises()

    expect(wrapper.text()).toContain('Could not parse this notebook')
    expect(wrapper.find('.ipynb-error-detail').text()).toContain('JSON')
    wrapper.unmount()
  })

  it('shows the unsupported-version state', function showsUnsupportedVersion() {
    const wrapper = mountPreview(JSON.stringify({ nbformat: 5, cells: [] }))
    expect(wrapper.text()).toContain('Unsupported notebook format version: 5')
    wrapper.unmount()
  })

  it('shows the empty state', function showsEmpty() {
    const wrapper = mountPreview(notebookV4([]))
    expect(wrapper.text()).toContain('This notebook has no cells')
    wrapper.unmount()
  })

  it('sanitizes html outputs before rendering', async function sanitizesHtml() {
    const wrapper = mountPreview(
      notebookV4([
        {
          cell_type: 'code',
          source: 'df',
          outputs: [
            {
              output_type: 'display_data',
              data: {
                'text/html':
                  '<b>safe</b><img src="x" onerror="alert(1)"><a href="javascript:alert(1)">x</a>',
              },
            },
          ],
        },
      ])
    )
    await waitFor(() => expect(wrapper.find('.ipynb-output-html').exists()).toBe(true))

    const markup = wrapper.find('.ipynb-output-html').html()
    expect(markup).toContain('<b>safe</b>')
    expect(markup).not.toContain('onerror')
    expect(markup).not.toContain('javascript:')
    wrapper.unmount()
  })

  it('never renders script tags from html outputs', async function dropsScripts() {
    // happy-dom's DOMPurify empties a fragment that contains <script>; the
    // component falls back to escaped text, so the markup must still be inert.
    const wrapper = mountPreview(
      notebookV4([
        {
          cell_type: 'code',
          source: 'boom',
          outputs: [
            {
              output_type: 'display_data',
              data: { 'text/html': '<script>alert(1)</script><b>after</b>' },
            },
          ],
        },
      ])
    )
    await waitFor(() => expect(wrapper.find('.ipynb-output-text').text()).toContain('<script>'))

    expect(wrapper.html()).not.toContain('<script')
    expect(wrapper.find('.ipynb-output-text').text()).toContain('alert(1)')
    wrapper.unmount()
  })

  it('loads the full notebook once when the preview is truncated', async function loadsFullFile() {
    const full = notebookV4([{ cell_type: 'markdown', source: '# Full notebook body' }])
    const bytes = new TextEncoder().encode(full)
    authFetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => String(bytes.byteLength) },
      arrayBuffer: async () => bytes.buffer,
    } as unknown as Response)

    const wrapper = mountPreview('{"nbformat": 4, "cells": [', {
      content: '{"nbformat": 4, "cells": [',
      editorText: '',
      truncated: true,
    })
    await waitFor(() => expect(wrapper.text()).toContain('Full notebook body'))

    expect(authFetchMock).toHaveBeenCalledTimes(1)
    expect(authFetchMock).toHaveBeenCalledWith(
      '/api/workspace/raw?pane_id=p1&path=notebooks%2Fdemo.ipynb'
    )
    expect(wrapper.text()).toContain('Full notebook body')
    expect(wrapper.find('.ipynb-banner').exists()).toBe(false)
    wrapper.unmount()
  })

  it('explains when the full notebook cannot be loaded', async function explainsFullFailure() {
    authFetchMock.mockResolvedValue({ ok: false, status: 500 } as Response)

    const wrapper = mountPreview('{"nbformat": 4, "cells": [', {
      content: '{"nbformat": 4, "cells": [',
      editorText: '',
      truncated: true,
    })
    await waitFor(() => expect(wrapper.text()).toContain('could not be loaded'))

    expect(wrapper.text()).toContain('Only the first 512 KB of this notebook is shown')
    expect(wrapper.text()).toContain('could not be loaded')
    expect(wrapper.text()).toContain('Could not parse this notebook')
    wrapper.unmount()
  })

  it('is routed from FilePreviewContent for .ipynb text files', async function routesFromWorkspace() {
    const content = notebookV4([{ cell_type: 'markdown', source: '# Routed notebook' }])
    const wrapper = mount(FilePreviewContent, {
      props: {
        previewLoading: false,
        previewErr: null,
        selectedRel: 'demo.ipynb',
        selectedIsDir: false,
        meta: { kind: 'text', content, language: 'plaintext' },
        rawUrl: '',
        showSave: true,
        audioTitle: '',
        audioSub: '',
        audioTimeNow: '0:00',
        audioTimeTotal: '0:00',
        audioSeekValue: 0,
        audioVolValue: 80,
        audioPlaying: false,
        editorDirty: false,
        editorText: content,
        canSaveEditor: false,
        mdShowPreview: false,
        htmlShowPreview: false,
        markdownEditorHtml: '',
        officeLoading: false,
        officeErr: null,
        officeHtml: '',
        paneId: 'pane-1',
        filePath: 'demo.ipynb',
        leafId: 'leaf-1',
      },
    })
    await waitFor(() => expect(wrapper.text()).toContain('Routed notebook'))

    expect(wrapper.find('.ipynb-preview').exists()).toBe(true)
    expect(wrapper.text()).toContain('Routed notebook')
    expect(wrapper.find('.monaco-stub').exists()).toBe(false)
    wrapper.unmount()
  })
})
