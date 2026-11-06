import { flushPromises, mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'

vi.mock('../components/workspace/MonacoEditor.vue', () => ({
  __esModule: true,
  default: {
    name: 'MonacoEditor',
    props: ['modelValue', 'language', 'readonly', 'filePath', 'paneId', 'leafId'],
    template: '<div class="monaco-stub" :data-readonly="String(readonly)"></div>',
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
      'readOnly',
    ],
    template: '<div class="log-preview-stub" :data-readonly="String(readOnly)"></div>',
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
      'readOnly',
    ],
    template: '<div class="ipynb-preview-stub" :data-readonly="String(readOnly)"></div>',
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
      'readOnly',
    ],
    template: '<div class="structured-stub" :data-readonly="String(readOnly)"></div>',
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
      'readOnly',
    ],
    template: '<div class="svg-preview-stub" :data-readonly="String(readOnly)"></div>',
  },
}))

import FilePreviewContent from '../components/workspace/FilePreviewContent.vue'

function mountPreview(overrides: Record<string, unknown> = {}) {
  return mount(FilePreviewContent, {
    props: {
      previewLoading: false,
      previewErr: null,
      selectedRel: 'src/a.ts',
      selectedIsDir: false,
      meta: { kind: 'text', content: 'export const a = 1', language: 'typescript' },
      rawUrl: '',
      showSave: false,
      audioTitle: '',
      audioSub: '',
      audioTimeNow: '0:00',
      audioTimeTotal: '0:00',
      audioSeekValue: 0,
      audioVolValue: 80,
      audioPlaying: false,
      editorDirty: false,
      editorText: 'export const a = 1',
      canSaveEditor: false,
      mdShowPreview: false,
      htmlShowPreview: false,
      markdownEditorHtml: '',
      officeLoading: false,
      officeErr: null,
      officeHtml: '',
      paneId: 'pane-1',
      filePath: 'src/a.ts',
      leafId: 'leaf-1',
      ...overrides,
    },
  })
}

async function settle(): Promise<void> {
  await flushPromises()
  await nextTick()
}

describe('FilePreviewContent read-only propagation', () => {
  it('forces the generic Monaco branch read-only', async () => {
    const wrapper = mountPreview({ readOnly: true })
    await settle()
    expect(wrapper.find('.monaco-stub').attributes('data-readonly')).toBe('true')
    wrapper.unmount()
  })

  it('keeps the Monaco branch editable without readOnly and without truncation', async () => {
    const wrapper = mountPreview()
    await settle()
    expect(wrapper.find('.monaco-stub').attributes('data-readonly')).toBe('false')
    wrapper.unmount()
  })

  it('still forces Monaco read-only for a truncated buffer', async () => {
    const wrapper = mountPreview({
      meta: { kind: 'text', content: 'cut', language: 'plaintext', truncated: true },
      editorText: 'cut',
    })
    await settle()
    expect(wrapper.find('.monaco-stub').attributes('data-readonly')).toBe('true')
    wrapper.unmount()
  })

  it('forces the HTML source Monaco read-only', async () => {
    const wrapper = mountPreview({
      meta: { kind: 'html', content: '<h1>hi</h1>', language: 'html' },
      filePath: 'page.html',
      selectedRel: 'page.html',
      editorText: '<h1>hi</h1>',
      htmlShowPreview: false,
      readOnly: true,
    })
    await settle()
    expect(wrapper.find('.monaco-stub').attributes('data-readonly')).toBe('true')
    wrapper.unmount()
  })

  it('tightens the HTML iframe sandbox to allow-scripts only when read-only', async () => {
    const wrapper = mountPreview({
      meta: { kind: 'html', content: '<h1>hi</h1>', language: 'html' },
      filePath: 'page.html',
      selectedRel: 'page.html',
      editorText: '<h1>hi</h1>',
      htmlShowPreview: true,
      readOnly: true,
    })
    await settle()
    expect(wrapper.find('iframe.file-pdf').attributes('sandbox')).toBe('allow-scripts')
    wrapper.unmount()
  })

  it('keeps the full sandbox for the editable file browser', async () => {
    const wrapper = mountPreview({
      meta: { kind: 'html', content: '<h1>hi</h1>', language: 'html' },
      filePath: 'page.html',
      selectedRel: 'page.html',
      editorText: '<h1>hi</h1>',
      htmlShowPreview: true,
    })
    await settle()
    expect(wrapper.find('iframe.file-pdf').attributes('sandbox')).toBe(
      'allow-scripts allow-same-origin allow-forms allow-popups allow-modals'
    )
    wrapper.unmount()
  })

  it.each([
    ['server.log', '.log-preview-stub'],
    ['analysis.ipynb', '.ipynb-preview-stub'],
    ['config.json', '.structured-stub'],
    ['icon.svg', '.svg-preview-stub'],
  ])('passes readOnly through to %s', async (filePath, selector) => {
    const wrapper = mountPreview({
      selectedRel: filePath,
      filePath,
      readOnly: true,
      meta: { kind: 'text', content: '{}', language: 'json' },
      editorText: '{}',
    })
    await settle()
    expect(wrapper.find(selector).attributes('data-readonly')).toBe('true')
    wrapper.unmount()
  })
})
