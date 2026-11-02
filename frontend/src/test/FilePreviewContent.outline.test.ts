import { describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import FilePreviewContent from '../components/workspace/FilePreviewContent.vue'

vi.mock('../components/workspace/MonacoEditor.vue', () => ({
  default: {
    name: 'MonacoEditor',
    props: ['modelValue', 'language', 'readonly', 'filePath', 'paneId', 'leafId'],
    template: '<div class="monaco-stub"></div>',
  },
}))

function mountPreview(overrides: Record<string, unknown> = {}) {
  return mount(FilePreviewContent, {
    props: {
      previewLoading: false,
      previewErr: null,
      selectedRel: 'src/a.ts',
      selectedIsDir: false,
      meta: { kind: 'text', content: 'export const a = 1', language: 'typescript' },
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
      outlineOpen: false,
      outlineAvailable: true,
      outlinePanelId: 'outline-panel-leaf-1',
      ...overrides,
    },
  })
}

describe('FilePreviewContent outline toggle', () => {
  it('renders an aria-pressed toolbar toggle for supported files', async () => {
    const wrapper = mountPreview()
    const button = wrapper.find('.file-editor-outline')
    expect(button.exists()).toBe(true)
    expect(button.attributes('aria-pressed')).toBe('false')
    expect(button.attributes('aria-controls')).toBe('outline-panel-leaf-1')

    await button.trigger('click')
    expect(wrapper.emitted('toggle-outline')).toHaveLength(1)

    await wrapper.setProps({ outlineOpen: true })
    expect(wrapper.find('.file-editor-outline').attributes('aria-pressed')).toBe('true')
    wrapper.unmount()
  })

  it('hides the toggle when the outline has no supported source', () => {
    const wrapper = mountPreview({ outlineAvailable: false })
    expect(wrapper.find('.file-editor-outline').exists()).toBe(false)
    wrapper.unmount()
  })
})
