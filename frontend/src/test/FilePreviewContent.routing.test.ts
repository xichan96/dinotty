import { flushPromises, mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'

vi.mock('../components/workspace/MonacoEditor.vue', () => ({
  __esModule: true,
  default: {
    name: 'MonacoEditor',
    props: ['modelValue', 'language', 'readonly', 'filePath', 'paneId', 'leafId'],
    template: '<div class="monaco-stub"></div>',
  },
}))

vi.mock('../components/workspace/LogPreview.vue', () => ({
  __esModule: true,
  default: {
    name: 'LogPreview',
    props: [
      'meta',
      'rawUrl',
      'filePath',
      'paneId',
      'leafId',
      'editorText',
      'editorDirty',
      'showSave',
      'canSaveEditor',
    ],
    template: '<div class="log-preview-stub"></div>',
  },
}))

vi.mock('../components/workspace/IpynbPreview.vue', () => ({
  __esModule: true,
  default: {
    name: 'IpynbPreview',
    props: [
      'content',
      'filePath',
      'rawUrl',
      'truncated',
      'paneId',
      'leafId',
      'showSave',
      'editorText',
      'editorDirty',
      'canSaveEditor',
    ],
    template: '<div class="ipynb-preview-stub"></div>',
  },
}))

vi.mock('../components/workspace/StructuredPreview.vue', () => ({
  __esModule: true,
  default: {
    name: 'StructuredPreview',
    props: [
      'content',
      'filePath',
      'format',
      'rawUrl',
      'truncated',
      'editorText',
      'editorDirty',
      'showSave',
      'canSaveEditor',
      'paneId',
      'leafId',
      'outlineOpen',
      'outlineAvailable',
      'outlinePanelId',
    ],
    template: '<div class="structured-stub" :data-format="format"></div>',
  },
}))

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
    ],
    template: '<div class="csv-preview-stub"></div>',
  },
}))

vi.mock('../components/workspace/ImagePreview.vue', () => ({
  __esModule: true,
  default: {
    name: 'ImagePreview',
    props: ['src', 'alt', 'fileKey'],
    template: '<div class="image-preview-stub" :data-src="src"></div>',
  },
}))

vi.mock('../components/workspace/SvgPreview.vue', () => ({
  __esModule: true,
  default: {
    name: 'SvgPreview',
    props: [
      'content',
      'editorText',
      'filePath',
      'rawUrl',
      'truncated',
      'editorDirty',
      'showSave',
      'canSaveEditor',
      'paneId',
      'leafId',
    ],
    template: '<div class="svg-preview-stub"></div>',
  },
}))

vi.mock('../components/workspace/SpreadsheetPreview.vue', () => ({
  __esModule: true,
  default: {
    name: 'SpreadsheetPreview',
    props: ['rawUrl', 'filePath', 'paneId'],
    template: '<div class="spreadsheet-preview-stub"></div>',
  },
}))

import FilePreviewContent from '../components/workspace/FilePreviewContent.vue'

function mountPreview(filePath: string, metaKind = 'text') {
  return mount(FilePreviewContent, {
    props: {
      previewLoading: false,
      previewErr: null,
      selectedRel: filePath,
      selectedIsDir: false,
      meta: { kind: metaKind, content: '{"a":1}', language: 'json' },
      rawUrl: `/api/workspace/raw?path=${filePath}`,
      showSave: true,
      audioTitle: '',
      audioSub: '',
      audioTimeNow: '0:00',
      audioTimeTotal: '0:00',
      audioSeekValue: 0,
      audioVolValue: 80,
      audioPlaying: false,
      editorDirty: false,
      editorText: '{"a":1}',
      canSaveEditor: true,
      mdShowPreview: false,
      htmlShowPreview: false,
      markdownEditorHtml: '',
      officeLoading: false,
      officeErr: null,
      officeHtml: '',
      paneId: 'pane-1',
      filePath,
      leafId: 'leaf-1',
      outlineOpen: false,
      outlineAvailable: true,
      outlinePanelId: 'outline-panel-leaf-1',
    },
  })
}

async function settle(): Promise<void> {
  await flushPromises()
  await nextTick()
}

describe('FilePreviewContent structured routing', () => {
  it.each([
    ['config.json', 'json'],
    ['config.JSON', 'json'],
    ['app.yaml', 'yaml'],
    ['app.yml', 'yaml'],
    ['Cargo.toml', 'toml'],
  ])('routes %s to the structured preview', async (filePath, format) => {
    const wrapper = mountPreview(filePath)
    await settle()
    expect(wrapper.find('.structured-stub').attributes('data-format')).toBe(format)
    wrapper.unmount()
  })

  it('keeps the notebook viewer for .ipynb', async () => {
    const wrapper = mountPreview('analysis.ipynb')
    await settle()
    expect(wrapper.find('.ipynb-preview-stub').exists()).toBe(true)
    expect(wrapper.find('.structured-stub').exists()).toBe(false)
    wrapper.unmount()
  })

  it('keeps the log viewer for .log', async () => {
    const wrapper = mountPreview('server.log')
    await settle()
    expect(wrapper.find('.log-preview-stub').exists()).toBe(true)
    expect(wrapper.find('.structured-stub').exists()).toBe(false)
    wrapper.unmount()
  })

  it('keeps the CSV table for .csv', async () => {
    const wrapper = mountPreview('data.csv')
    await settle()
    expect(wrapper.find('.csv-preview-stub').exists()).toBe(true)
    expect(wrapper.find('.structured-stub').exists()).toBe(false)
    wrapper.unmount()
  })

  it('routes images to the image preview', async () => {
    const wrapper = mountPreview('photo.png', 'image')
    await settle()
    expect(wrapper.find('.image-preview-stub').exists()).toBe(true)
    wrapper.unmount()
  })

  it.each(['icon.svg', 'ICON.SVG'])('routes %s text to the SVG preview', async (filePath) => {
    const wrapper = mountPreview(filePath)
    await settle()
    expect(wrapper.find('.svg-preview-stub').exists()).toBe(true)
    expect(wrapper.find('.monaco-stub').exists()).toBe(false)
    wrapper.unmount()
  })

  it('routes spreadsheets to the spreadsheet preview', async () => {
    const wrapper = mountPreview('book.xlsx', 'spreadsheet')
    await settle()
    expect(wrapper.find('.spreadsheet-preview-stub').exists()).toBe(true)
    expect(wrapper.find('.file-office').exists()).toBe(false)
    wrapper.unmount()
  })

  it('keeps the generic editor for other text files', async () => {
    const wrapper = mountPreview('script.ts')
    await settle()
    expect(wrapper.find('.monaco-stub').exists()).toBe(true)
    expect(wrapper.find('.structured-stub').exists()).toBe(false)
    wrapper.unmount()
  })

  it('does not use the structured preview for non-text kinds', async () => {
    const wrapper = mountPreview('config.json', 'unsupported')
    await settle()
    expect(wrapper.find('.structured-stub').exists()).toBe(false)
    wrapper.unmount()
  })
})
