import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'

const apiMocks = vi.hoisted(() => ({
  authFetch: vi.fn(),
  getAuthToken: vi.fn(() => ''),
}))

vi.mock('../composables/apiBase', () => ({
  getApiBase: vi.fn().mockResolvedValue(''),
  apiUrl: (path: string) => path,
  authFetch: apiMocks.authFetch,
  getAuthToken: apiMocks.getAuthToken,
}))

vi.mock('../composables/useTransport', () => ({
  isTauri: () => false,
}))

vi.mock('../components/workspace/FilePreviewContent.vue', () => ({
  __esModule: true,
  default: {
    name: 'FilePreviewContent',
    props: [
      'paneId',
      'filePath',
      'previewLoading',
      'previewErr',
      'selectedRel',
      'selectedIsDir',
      'meta',
      'rawUrl',
      'showSave',
      'audioTitle',
      'audioSub',
      'audioTimeNow',
      'audioTimeTotal',
      'audioSeekValue',
      'audioVolValue',
      'audioPlaying',
      'editorDirty',
      'editorText',
      'canSaveEditor',
      'mdShowPreview',
      'htmlShowPreview',
      'markdownEditorHtml',
      'officeLoading',
      'officeErr',
      'officeHtml',
      'readOnly',
    ],
    template: '<div class="file-preview-content-stub"></div>',
  },
}))

import FileViewer from '../components/preview/FileViewer.vue'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

function mountViewer(props: Record<string, unknown> = {}) {
  return mount(FileViewer, {
    props: {
      sourcePaneId: 'pane-abc123',
      path: 'docs/readme.md',
      ...props,
    },
  })
}

function previewStub(wrapper: ReturnType<typeof mountViewer>) {
  return wrapper.findComponent({ name: 'FilePreviewContent' })
}

async function settle(): Promise<void> {
  await flushPromises()
  await nextTick()
}

async function waitFor(predicate: () => boolean, timeoutMs = 5000): Promise<void> {
  const start = Date.now()
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error('timed out waiting for viewer')
    await new Promise((resolve) => setTimeout(resolve, 10))
    await nextTick()
  }
}

function metaUrl(call: unknown[]): URLSearchParams {
  const url = String(call[0])
  return new URLSearchParams(url.slice(url.indexOf('?') + 1))
}

describe('FileViewer', () => {
  beforeEach(() => {
    apiMocks.authFetch.mockReset()
    apiMocks.getAuthToken.mockReset()
    apiMocks.getAuthToken.mockReturnValue('')
  })

  it('loads meta with the real pane id and relative path, read-only', async () => {
    apiMocks.authFetch.mockResolvedValue(
      jsonResponse({ kind: 'text', content: 'hello', language: 'plaintext' })
    )
    const wrapper = mountViewer()
    await waitFor(() => previewStub(wrapper).props('previewLoading') === false)
    await settle()

    expect(apiMocks.authFetch).toHaveBeenCalledTimes(1)
    const params = metaUrl(apiMocks.authFetch.mock.calls[0])
    expect(params.get('pane_id')).toBe('pane-abc123')
    expect(params.get('path')).toBe('docs/readme.md')

    const stub = previewStub(wrapper)
    expect(stub.props('readOnly')).toBe(true)
    expect(stub.props('showSave')).toBe(false)
    expect(stub.props('canSaveEditor')).toBe(false)
    expect(stub.props('editorDirty')).toBe(false)
    expect(stub.props('paneId')).toBe('pane-abc123')
    expect(stub.props('filePath')).toBe('docs/readme.md')
    expect(stub.props('editorText')).toBe('hello')
    wrapper.unmount()
  })

  it('renders markdown through the shared sanitizer and opens the preview', async () => {
    apiMocks.authFetch.mockResolvedValue(
      jsonResponse({
        kind: 'markdown',
        content: '# Title\n\n<img src="x" onerror="alert(1)">',
        language: 'markdown',
      })
    )
    const wrapper = mountViewer()
    await waitFor(() => {
      const html = String(previewStub(wrapper).props('markdownEditorHtml') ?? '')
      return html.includes('<h1')
    })

    const stub = previewStub(wrapper)
    const html = String(stub.props('markdownEditorHtml'))
    expect(stub.props('mdShowPreview')).toBe(true)
    expect(html).not.toContain('onerror')
    wrapper.unmount()
  })

  it('shows a localized error with the server code when loading fails', async () => {
    apiMocks.authFetch.mockResolvedValue(jsonResponse({ error: 'OUTSIDE_WORKSPACE' }, 403))
    const wrapper = mountViewer()
    await waitFor(() => previewStub(wrapper).props('previewErr') !== null)

    const message = String(previewStub(wrapper).props('previewErr'))
    expect(message).toContain('OUTSIDE_WORKSPACE')
    expect(previewStub(wrapper).props('previewLoading')).toBe(false)
    wrapper.unmount()
  })

  it('reload() refetches and busts the raw URL cache', async () => {
    apiMocks.authFetch.mockResolvedValue(jsonResponse({ kind: 'image', content: '', language: '' }))
    const wrapper = mountViewer()
    await waitFor(() => previewStub(wrapper).props('previewLoading') === false)
    const before = String(previewStub(wrapper).props('rawUrl'))
    expect(before).not.toContain('_t=')
    ;(wrapper.vm as unknown as { reload: () => void }).reload()
    await waitFor(() => apiMocks.authFetch.mock.calls.length === 2)
    await settle()

    expect(metaUrl(apiMocks.authFetch.mock.calls[1]).get('path')).toBe('docs/readme.md')
    const after = String(previewStub(wrapper).props('rawUrl'))
    expect(after).toContain('_t=1')
    expect(new URLSearchParams(after.slice(after.indexOf('?') + 1)).get('pane_id')).toBe(
      'pane-abc123'
    )
    wrapper.unmount()
  })

  it('drops a late response for the previous path', async () => {
    const first = deferred<Response>()
    const second = deferred<Response>()
    apiMocks.authFetch
      .mockReturnValueOnce(first.promise as never)
      .mockReturnValueOnce(second.promise as never)

    const wrapper = mountViewer({ path: 'a.txt' })
    await waitFor(() => apiMocks.authFetch.mock.calls.length === 1)

    await wrapper.setProps({ path: 'b.txt' })
    await waitFor(() => apiMocks.authFetch.mock.calls.length === 2)
    expect(metaUrl(apiMocks.authFetch.mock.calls[1]).get('path')).toBe('b.txt')

    second.resolve(jsonResponse({ kind: 'text', content: 'B', language: 'plaintext' }))
    await waitFor(() => previewStub(wrapper).props('editorText') === 'B')

    first.resolve(jsonResponse({ kind: 'text', content: 'A', language: 'plaintext' }))
    await settle()

    expect(previewStub(wrapper).props('editorText')).toBe('B')
    expect(previewStub(wrapper).props('filePath')).toBe('b.txt')
    wrapper.unmount()
  })

  it('shows the file name in the toolbar and falls back from a missing title', async () => {
    apiMocks.authFetch.mockResolvedValue(
      jsonResponse({ kind: 'text', content: '', language: 'plaintext' })
    )
    const wrapper = mountViewer({ path: 'docs/design.md' })
    await settle()

    expect(wrapper.find('.file-viewer-title').text()).toBe('design.md')
    expect(wrapper.find('.file-viewer-path').text()).toBe('docs/design.md')

    await wrapper.setProps({ title: 'Design doc' })
    expect(wrapper.find('.file-viewer-title').text()).toBe('Design doc')
    wrapper.unmount()
  })
})
