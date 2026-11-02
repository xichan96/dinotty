import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'

vi.mock('../components/workspace/MonacoEditor.vue', () => ({
  __esModule: true,
  default: {
    name: 'MonacoEditor',
    props: ['modelValue', 'language', 'readonly', 'filePath', 'paneId', 'leafId'],
    emits: ['update:modelValue', 'save', 'selection-change'],
    template:
      '<div class="monaco-stub" :data-language="language" :data-readonly="String(readonly)"></div>',
  },
}))

vi.mock('../components/workspace/ImagePreview.vue', () => ({
  __esModule: true,
  default: {
    name: 'ImagePreview',
    props: ['src', 'alt', 'fileKey'],
    template:
      '<div class="image-preview-stub" :data-src="src" :data-alt="alt" :data-file-key="fileKey"></div>',
  },
}))

import SvgPreview from '../components/workspace/SvgPreview.vue'

const SVG_TEXT =
  '<svg xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10" fill="#f00"/></svg>'
const EDITED_TEXT =
  '<svg xmlns="http://www.w3.org/2000/svg"><rect width="20" height="20" fill="#0f0"/></svg>'
const RAW_URL = '/api/workspace/raw?path=icons/logo.svg'

type MutableUrlStatics = {
  createObjectURL?: (obj: Blob | MediaSource) => string
  revokeObjectURL?: (url: string) => void
}

const urlStatics = URL as unknown as MutableUrlStatics
const originalCreate = urlStatics.createObjectURL
const originalRevoke = urlStatics.revokeObjectURL

let urlSequence = 0
const createObjectURL = vi.fn((_blob: Blob | MediaSource) => `blob:svg-${++urlSequence}`)
const revokeObjectURL = vi.fn((_url: string) => {})

/** Decode synchronously so a preload completes within the same call. */
class AutoLoadImage {
  onload: (() => void) | null = null
  onerror: (() => void) | null = null

  set src(_value: string) {
    this.onload?.()
  }
}

function mountPreview(overrides: Record<string, unknown> = {}) {
  return mount(SvgPreview, {
    props: {
      content: SVG_TEXT,
      editorText: SVG_TEXT,
      filePath: 'icons/logo.svg',
      rawUrl: RAW_URL,
      truncated: false,
      editorDirty: false,
      showSave: true,
      canSaveEditor: true,
      paneId: 'pane-1',
      leafId: 'leaf-1',
      ...overrides,
    },
  })
}

function previewSrc(wrapper: ReturnType<typeof mountPreview>): string | undefined {
  return wrapper.find('.image-preview-stub').attributes('data-src')
}

beforeEach(() => {
  urlSequence = 0
  createObjectURL.mockClear()
  revokeObjectURL.mockClear()
  urlStatics.createObjectURL = createObjectURL
  urlStatics.revokeObjectURL = revokeObjectURL
  vi.stubGlobal('Image', AutoLoadImage)
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  urlStatics.createObjectURL = originalCreate
  urlStatics.revokeObjectURL = originalRevoke
})

describe('SvgPreview', () => {
  it('renders a blob-backed preview by default', () => {
    const wrapper = mountPreview()

    expect(createObjectURL).toHaveBeenCalledTimes(1)
    expect((createObjectURL.mock.calls[0][0] as Blob).type).toBe('image/svg+xml')
    expect(previewSrc(wrapper)).toBe('blob:svg-1')
    expect(wrapper.find('.image-preview-stub').attributes('data-alt')).toBe('logo.svg')
    expect(wrapper.find('.image-preview-stub').attributes('data-file-key')).toBe(RAW_URL)
    expect(wrapper.find('[data-testid="svg-preview-tab"]').classes()).toContain('active')
    expect(wrapper.find('.monaco-stub').exists()).toBe(false)
    wrapper.unmount()
  })

  it('debounces editor updates and revokes the replaced blob URL', async () => {
    const wrapper = mountPreview()
    expect(createObjectURL).toHaveBeenCalledTimes(1)

    vi.useFakeTimers()
    await wrapper.setProps({ editorText: EDITED_TEXT })
    await nextTick()
    expect(createObjectURL).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(249)
    await nextTick()
    expect(createObjectURL).toHaveBeenCalledTimes(1)
    expect(previewSrc(wrapper)).toBe('blob:svg-1')

    vi.advanceTimersByTime(1)
    await nextTick()
    expect(createObjectURL).toHaveBeenCalledTimes(2)
    expect(previewSrc(wrapper)).toBe('blob:svg-2')
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:svg-1')
    wrapper.unmount()
  })

  it('coalesces rapid edits into a single trailing update', async () => {
    const wrapper = mountPreview()
    vi.useFakeTimers()

    await wrapper.setProps({ editorText: EDITED_TEXT })
    await nextTick()
    vi.advanceTimersByTime(100)
    await wrapper.setProps({ editorText: SVG_TEXT })
    await nextTick()
    vi.advanceTimersByTime(249)
    await nextTick()
    expect(createObjectURL).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(1)
    await nextTick()
    expect(createObjectURL).toHaveBeenCalledTimes(2)
    expect(previewSrc(wrapper)).toBe('blob:svg-2')
    wrapper.unmount()
  })

  it('keeps ImagePreview mounted while the source tab is open', async () => {
    const wrapper = mountPreview()
    const mountedPreview = wrapper.find('.image-preview-stub').element

    await wrapper.find('[data-testid="svg-source-tab"]').trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-testid="svg-source-tab"]').classes()).toContain('active')
    expect(wrapper.find('.monaco-stub').attributes('data-language')).toBe('xml')
    expect(wrapper.find('.monaco-stub').attributes('data-readonly')).toBe('false')
    expect(wrapper.find('.image-preview-stub').element).toBe(mountedPreview)
    expect((mountedPreview as HTMLElement).style.display).toBe('none')

    await wrapper.find('[data-testid="svg-preview-tab"]').trigger('click')
    expect(wrapper.find('.monaco-stub').exists()).toBe(false)
    expect(wrapper.find('.image-preview-stub').element).toBe(mountedPreview)
    expect((mountedPreview as HTMLElement).style.display).toBe('')
    wrapper.unmount()
  })

  it('falls back to rawUrl and a read-only source when truncated', async () => {
    const wrapper = mountPreview({ truncated: true })

    expect(createObjectURL).not.toHaveBeenCalled()
    expect(previewSrc(wrapper)).toBe(RAW_URL)
    expect(wrapper.find('[data-testid="svg-truncated"]').text()).toContain('512 KB')
    expect(wrapper.find('[data-testid="svg-save"]').attributes('disabled')).toBeDefined()

    await wrapper.find('[data-testid="svg-source-tab"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('.monaco-stub').attributes('data-readonly')).toBe('true')
    wrapper.unmount()
  })

  it('resets to the preview when the file changes', async () => {
    const wrapper = mountPreview()
    await wrapper.find('[data-testid="svg-source-tab"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('.monaco-stub').exists()).toBe(true)

    const nextUrl = '/api/workspace/raw?path=other.svg'
    await wrapper.setProps({
      filePath: 'other.svg',
      rawUrl: nextUrl,
      content: '<svg xmlns="http://www.w3.org/2000/svg"/>',
      editorText: '<svg xmlns="http://www.w3.org/2000/svg"/>',
    })
    await nextTick()

    expect(wrapper.find('.monaco-stub').exists()).toBe(false)
    expect(wrapper.find('[data-testid="svg-preview-tab"]').classes()).toContain('active')
    expect(wrapper.find('.image-preview-stub').attributes('data-file-key')).toBe(nextUrl)
    wrapper.unmount()
  })

  it('forwards save, edit, and selection events', async () => {
    const wrapper = mountPreview({ editorDirty: true })
    expect(wrapper.text()).toContain('Modified')

    await wrapper.find('[data-testid="svg-save"]').trigger('click')
    expect(wrapper.emitted('saveEditor')).toHaveLength(1)

    await wrapper.find('[data-testid="svg-source-tab"]').trigger('click')
    await flushPromises()
    const monaco = wrapper.findComponent({ name: 'MonacoEditor' })
    expect(monaco.exists()).toBe(true)

    monaco.vm.$emit('update:modelValue', EDITED_TEXT)
    monaco.vm.$emit('selection-change', { text: 'rect', rect: null })

    expect(wrapper.emitted('update:editorText')?.[0]).toEqual([EDITED_TEXT])
    expect(wrapper.emitted('selection-change')?.[0]).toEqual([{ text: 'rect', rect: null }])
    wrapper.unmount()
  })

  it('uses rawUrl when createObjectURL is unavailable', () => {
    urlStatics.createObjectURL = undefined
    const wrapper = mountPreview()

    expect(createObjectURL).not.toHaveBeenCalled()
    expect(previewSrc(wrapper)).toBe(RAW_URL)
    wrapper.unmount()
  })

  it('uses rawUrl when the source text is empty', () => {
    const wrapper = mountPreview({ content: '', editorText: '' })

    expect(createObjectURL).not.toHaveBeenCalled()
    expect(previewSrc(wrapper)).toBe(RAW_URL)
    wrapper.unmount()
  })

  it('revokes the live blob URL on unmount', () => {
    const wrapper = mountPreview()
    expect(previewSrc(wrapper)).toBe('blob:svg-1')

    wrapper.unmount()
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:svg-1')
  })
})
