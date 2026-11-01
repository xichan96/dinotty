import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  renderMermaidBlocks: vi.fn(async (_root: ParentNode, _options?: unknown) => {}),
}))

vi.mock('../composables/mermaidPreview', () => ({
  renderMermaidBlocks: mocks.renderMermaidBlocks,
}))

import FilePreviewContent from '../components/workspace/FilePreviewContent.vue'

const PLACEHOLDER_HTML =
  '<div class="md-mermaid" data-mermaid><pre class="md-mermaid-src">erDiagram</pre><div class="md-mermaid-canvas"></div></div>'

function mountPreview(markdownEditorHtml: string, mdShowPreview: boolean) {
  return mount(FilePreviewContent, {
    props: {
      previewLoading: false,
      previewErr: '',
      selectedRel: 'docs/schema.md',
      selectedIsDir: false,
      meta: { kind: 'markdown', content: '', language: 'markdown' },
      rawUrl: '/api/workspace/raw?path=docs/schema.md',
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
      canSaveEditor: true,
      mdShowPreview,
      htmlShowPreview: false,
      markdownEditorHtml,
      officeLoading: false,
      officeErr: '',
      officeHtml: '',
      paneId: 'pane-1',
      filePath: 'docs/schema.md',
    },
    global: {
      stubs: { MonacoEditor: true },
    },
  })
}

beforeEach(function clearRenderSpy() {
  mocks.renderMermaidBlocks.mockClear()
})

describe('FilePreviewContent mermaid wiring', function mermaidWiringSuite() {
  it('renders diagrams once the markdown preview is in the DOM', async function rendersOnMount() {
    mountPreview(PLACEHOLDER_HTML, true)
    await flushPromises()

    expect(mocks.renderMermaidBlocks).toHaveBeenCalledTimes(1)
    const container = mocks.renderMermaidBlocks.mock.calls[0][0] as HTMLElement
    expect(container.classList.contains('file-md-body')).toBe(true)
    expect(container.querySelector('[data-mermaid]')).not.toBeNull()
    expect(mocks.renderMermaidBlocks.mock.calls[0][1]).toMatchObject({
      errorLabel: expect.any(String),
    })
  })

  it('does not render while the source view is shown, then renders on switch back', async function rendersWhenShown() {
    const wrapper = mountPreview(PLACEHOLDER_HTML, false)
    await flushPromises()
    expect(mocks.renderMermaidBlocks).not.toHaveBeenCalled()

    await wrapper.setProps({ mdShowPreview: true })
    await flushPromises()

    expect(mocks.renderMermaidBlocks).toHaveBeenCalledTimes(1)
  })
})
