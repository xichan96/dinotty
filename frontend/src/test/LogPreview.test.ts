import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'

const apiMocks = vi.hoisted(() => ({
  authFetch: vi.fn(),
}))

vi.mock('../composables/apiBase', () => ({
  authFetch: apiMocks.authFetch,
}))

vi.mock('../components/workspace/MonacoEditor.vue', () => ({
  __esModule: true,
  default: {
    name: 'MonacoEditor',
    props: ['modelValue', 'language', 'readonly', 'filePath', 'paneId', 'leafId'],
    template: '<div class="monaco-stub">{{ readonly ? "readonly" : "editable" }}</div>',
  },
}))

import LogPreview from '../components/workspace/LogPreview.vue'

const ESC = '\u001b'

function mountPreview(overrides: Record<string, unknown> = {}) {
  return mount(LogPreview, {
    props: {
      meta: { content: 'first line\nsecond line\n', truncated: false, language: 'plaintext' },
      rawUrl: '/api/workspace/raw?path=app.log',
      filePath: 'app.log',
      paneId: 'pane-1',
      leafId: 'leaf-1',
      editorText: 'first line\nsecond line\n',
      editorDirty: false,
      showSave: true,
      canSaveEditor: true,
      ...overrides,
    },
  })
}

async function settle(): Promise<void> {
  await flushPromises()
  await nextTick()
}

function partialResponse(body: string, start: number, total: number): Response {
  const end = start + new TextEncoder().encode(body).length - 1
  return new Response(body, {
    status: 206,
    headers: { 'Content-Range': `bytes ${start}-${end}/${total}` },
  })
}

describe('LogPreview', () => {
  beforeEach(() => {
    apiMocks.authFetch.mockReset()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('renders the supplied content with line numbers and no fetch', async () => {
    const wrapper = mountPreview()
    await settle()

    expect(apiMocks.authFetch).not.toHaveBeenCalled()
    expect(wrapper.findAll('.log-preview-line')).toHaveLength(2)
    expect(wrapper.text()).toContain('first line')
    expect(wrapper.text()).toContain('second line')
    expect(wrapper.find('[data-testid="log-status"]').text()).toContain('2 lines')
    wrapper.unmount()
  })

  it('renders ANSI segments as styled spans instead of raw bytes', async () => {
    const wrapper = mountPreview({
      meta: {
        content: `${ESC}[31merror${ESC}[0m ok ${ESC}[1;44mbold${ESC}[0m`,
        truncated: false,
      },
    })
    await settle()

    expect(wrapper.text()).not.toContain(ESC)
    const spans = wrapper.findAll('.log-preview-line-text span')
    const error = spans.find((span) => span.text() === 'error')
    const bold = spans.find((span) => span.text() === 'bold')
    expect(error).toBeDefined()
    expect((error?.element as HTMLElement).style.color).not.toBe('')
    expect((bold?.element as HTMLElement).style.fontWeight).toBe('700')
    expect((bold?.element as HTMLElement).style.backgroundColor).not.toBe('')
    wrapper.unmount()
  })

  it('fetches the last 256 KiB when the preview is truncated', async () => {
    apiMocks.authFetch.mockResolvedValue(partialResponse('tail line\n', 1000, 2000))
    const wrapper = mountPreview({
      meta: { content: 'head only', truncated: true },
      editorText: 'head only',
    })
    await settle()

    expect(apiMocks.authFetch).toHaveBeenCalledTimes(1)
    const init = apiMocks.authFetch.mock.calls[0][1] as RequestInit
    expect(new Headers(init.headers).get('range')).toBe('bytes=-262144')
    expect(wrapper.text()).toContain('tail line')
    expect(wrapper.find('[data-testid="log-status"]').text()).toContain('showing tail only')
    wrapper.unmount()
  })

  it('starts and stops range polling when follow is toggled', async () => {
    vi.useFakeTimers()
    let calls = 0
    apiMocks.authFetch.mockImplementation(async () => {
      calls += 1
      if (calls === 1) return partialResponse('third\n', 23, 29)
      return new Response(null, { status: 416 })
    })

    const wrapper = mountPreview()
    await nextTick()

    const toggle = wrapper.find('[data-testid="log-follow-toggle"]')
    expect(toggle.attributes('aria-pressed')).toBe('false')
    await toggle.trigger('click')
    await vi.advanceTimersByTimeAsync(0)

    expect(apiMocks.authFetch).toHaveBeenCalledTimes(1)
    const init = apiMocks.authFetch.mock.calls[0][1] as RequestInit
    expect(new Headers(init.headers).get('range')).toBe('bytes=23-')
    expect(wrapper.text()).toContain('third')
    expect(wrapper.findAll('.log-preview-line')).toHaveLength(3)
    expect(wrapper.find('[data-testid="log-follow-toggle"]').attributes('aria-pressed')).toBe(
      'true'
    )

    await vi.advanceTimersByTimeAsync(1200)
    expect(apiMocks.authFetch).toHaveBeenCalledTimes(2)
    expect(wrapper.findAll('.log-preview-line')).toHaveLength(3)

    await wrapper.find('[data-testid="log-follow-toggle"]').trigger('click')
    expect(wrapper.find('[data-testid="log-follow-toggle"]').attributes('aria-pressed')).toBe(
      'false'
    )
    await vi.advanceTimersByTimeAsync(3600)
    expect(apiMocks.authFetch).toHaveBeenCalledTimes(2)

    wrapper.unmount()
  })

  it('aborts an in-flight follow request on unmount', async () => {
    let signal: AbortSignal | undefined
    apiMocks.authFetch.mockImplementation((_url: string, init?: RequestInit) => {
      signal = init?.signal ?? undefined
      return new Promise<Response>(() => {})
    })

    const wrapper = mountPreview()
    await nextTick()
    await wrapper.find('[data-testid="log-follow-toggle"]').trigger('click')
    await nextTick()

    expect(signal?.aborted).toBe(false)
    wrapper.unmount()
    expect(signal?.aborted).toBe(true)
  })

  it('exposes the Source tab through Monaco with truncation kept readonly', async () => {
    apiMocks.authFetch.mockResolvedValue(partialResponse('tail', 99, 103))
    const wrapper = mountPreview({
      meta: { content: 'head', truncated: true },
      editorText: 'head',
    })
    await settle()

    await wrapper.find('[data-testid="log-source-tab"]').trigger('click')
    await vi.waitFor(() => expect(wrapper.find('.monaco-stub').exists()).toBe(true))
    const monaco = wrapper.find('.monaco-stub')
    expect(monaco.text()).toBe('readonly')
    wrapper.unmount()
  })

  it('shows an error state when the fetch fails', async () => {
    apiMocks.authFetch.mockRejectedValue(new Error('network down'))
    const wrapper = mountPreview({
      meta: { content: 'head', truncated: true },
    })
    await settle()

    expect(wrapper.text()).toContain('Could not load the log file')
    wrapper.unmount()
  })
})
