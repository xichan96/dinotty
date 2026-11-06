import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { defineComponent, h, nextTick, reactive } from 'vue'
import EditorPane from '../components/workspace/EditorPane.vue'
import { useEditorSplit } from '../composables/useEditorSplit'
import { beginTabDrag, endTabDrag, TAB_DRAG_MIME } from '../composables/useEditorTabDrag'
import {
  createTabBufferStore,
  TAB_BUFFER_STORE_KEY,
  type TabBuffer,
  type TabBufferStore,
} from '../composables/useTabBufferStore'
import type { EditorLeafPane } from '../types/editorPane'
import { createEditorTab, getActiveTab, type EditorTab } from '../types/editorTabs'

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

const TabBarStub = defineComponent({
  name: 'EditorTabBar',
  emits: [
    'activate',
    'request-close',
    'pin',
    'split',
    'close-group',
    'reorder',
    'drop-on-strip',
    'command',
  ],
  setup() {
    return () => h('div', { class: 'tabbar-stub' })
  },
})

const BreadcrumbsStub = defineComponent({
  name: 'EditorBreadcrumbs',
  props: { filePath: { type: String, default: '' } },
  emits: ['reload-disk'],
  setup() {
    return () => h('div', { class: 'breadcrumbs-stub' })
  },
})

const PreviewStub = defineComponent({
  name: 'FilePreviewContent',
  props: {
    editorText: { type: String, default: '' },
    previewLoading: { type: Boolean, default: false },
    htmlShowPreview: { type: Boolean, default: false },
  },
  emits: ['update:editorText', 'saveEditor', 'selection-change'],
  setup(props) {
    return () =>
      h('div', {
        class: 'preview-stub',
        'data-text': props.editorText,
        'data-loading': String(props.previewLoading),
        'data-html-preview': String(props.htmlShowPreview),
      })
  },
})

interface DataTransferStub {
  types: string[]
  dropEffect: string
  effectAllowed: string
  setData(): void
  getData(): string
}

function makeDataTransfer(): DataTransferStub {
  return {
    types: [TAB_DRAG_MIME],
    dropEffect: '',
    effectAllowed: '',
    setData() {},
    getData() {
      return ''
    },
  }
}

function mountedText(wrapper: ReturnType<typeof mountPane>): string {
  return wrapper.find('.preview-stub').attributes('data-text') ?? ''
}

function seedBuffer(
  store: TabBufferStore,
  tab: EditorTab,
  text: string,
  meta: unknown = { kind: 'text', content: text, language: 'typescript' }
): TabBuffer {
  const buffer = store.ensure(tab.id, tab.filePath)
  buffer.loaded = true
  buffer.text = text
  buffer.baseline = text
  buffer.meta = meta
  return buffer
}

function leafWithTabs(tabs: EditorTab[], active: EditorTab): EditorLeafPane {
  return reactive<EditorLeafPane>({
    type: 'editor-leaf',
    id: 'leaf-1',
    tabs,
    activeTabId: active.id,
    filePath: active.filePath,
    isDir: false,
    ratio: 1,
    zoomed: false,
  })
}

function mountPane(leaf: EditorLeafPane, store: TabBufferStore) {
  return mount(EditorPane, {
    attachTo: document.body,
    props: {
      leaf,
      paneId: 'pane-1',
      isActive: true,
      showHeader: true,
      reveal: null,
    },
    global: {
      plugins: [
        {
          install(app) {
            app.provide(TAB_BUFFER_STORE_KEY, store)
          },
        },
      ],
      stubs: {
        EditorTabBar: TabBarStub,
        EditorBreadcrumbs: BreadcrumbsStub,
        FilePreviewContent: PreviewStub,
      },
    },
  })
}

describe('EditorPane tab buffers', () => {
  let wrapper: ReturnType<typeof mountPane> | null = null

  beforeEach(() => {
    vi.stubGlobal('ResizeObserver', ResizeObserverStub)
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: vi.fn(),
    })
  })

  afterEach(() => {
    wrapper?.unmount()
    wrapper = null
    endTabDrag()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    document.body.replaceChildren()
  })

  it('keeps unsaved text when switching tabs and restores it on return', async () => {
    const a = createEditorTab('src/a.ts')
    const b = createEditorTab('src/b.ts')
    const leaf = leafWithTabs([a, b], a)
    const store = createTabBufferStore()
    seedBuffer(store, a, 'alpha')
    seedBuffer(store, b, 'beta')

    wrapper = mountPane(leaf, store)
    await nextTick()
    expect(mountedText(wrapper)).toBe('alpha')

    wrapper.findComponent(PreviewStub).vm.$emit('update:editorText', 'alpha edited')
    await nextTick()

    expect(store.get(a.id, a.filePath)?.text).toBe('alpha edited')
    expect(store.isDirty(a)).toBe(true)

    // Switching away persists the live text in a's buffer.
    leaf.activeTabId = b.id
    await nextTick()
    expect(mountedText(wrapper)).toBe('beta')
    expect(store.get(a.id, a.filePath)?.text).toBe('alpha edited')
    expect(store.isDirty(b)).toBe(false)

    // Switching back restores the unsaved text instead of the disk baseline.
    leaf.activeTabId = a.id
    await nextTick()
    expect(mountedText(wrapper)).toBe('alpha edited')
    expect(store.get(a.id, a.filePath)?.baseline).toBe('alpha')
    expect(store.isDirty(a)).toBe(true)
  })

  it('loads a retargeted preview path from disk instead of restoring stale text', async () => {
    const tab = createEditorTab('a.ts', false, true)
    const leaf = leafWithTabs([tab], tab)
    const store = createTabBufferStore()
    seedBuffer(store, tab, 'stale text')

    wrapper = mountPane(leaf, store)
    await nextTick()
    expect(mountedText(wrapper)).toBe('stale text')

    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ kind: 'text', content: 'fresh b', language: 'typescript' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
    )
    vi.stubGlobal('fetch', fetchMock)

    // Same tab id, new path: this is what preview-tab reuse looks like once the
    // model has retargeted the tab. Mutate the reactive copy from the leaf —
    // the raw fixture object would not trigger the pane's watcher.
    leaf.tabs[0].filePath = 'b.ts'
    await nextTick()
    await flushPromises()
    await nextTick()

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(mountedText(wrapper)).toBe('fresh b')
    expect(store.get(tab.id, 'a.ts')).toBeUndefined()
    expect(store.get(tab.id, 'b.ts')?.loaded).toBe(true)
    expect(store.isDirty(tab)).toBe(false)
  })

  it('loads HTML content into the editor buffer and opens the rendered view', async () => {
    const tab = createEditorTab('site/index.html')
    const leaf = leafWithTabs([tab], tab)
    const store = createTabBufferStore()
    const html = '<!doctype html><h1>Hello</h1>'
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ kind: 'html', content: html, language: 'html' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
    )
    vi.stubGlobal('fetch', fetchMock)

    wrapper = mountPane(leaf, store)
    await flushPromises()
    await nextTick()

    // The preview iframe renders editorText; before this was fixed, html kind
    // fell into the "no text" branch and the preview document was empty.
    expect(mountedText(wrapper)).toBe(html)
    expect(wrapper.find('.preview-stub').attributes('data-html-preview')).toBe('true')
  })

  it('emits split-tab when a tab from another group is dropped on an editor edge', async () => {
    const a = createEditorTab('src/a.ts')
    const leaf = leafWithTabs([a], a)
    const store = createTabBufferStore()
    seedBuffer(store, a, 'alpha')

    wrapper = mountPane(leaf, store)
    await nextTick()

    const rect = {
      left: 0,
      top: 0,
      width: 200,
      height: 200,
      right: 200,
      bottom: 200,
      x: 0,
      y: 0,
      toJSON() {
        return {}
      },
    } as DOMRect
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(rect)

    beginTabDrag({ leafId: 'leaf-other', tabId: 'x', filePath: 'x.ts' })
    const dataTransfer = makeDataTransfer()
    const pane = wrapper.find('.editor-pane')

    await pane.trigger('dragover', { dataTransfer, clientX: 180, clientY: 100 })
    await pane.trigger('drop', { dataTransfer, clientX: 180, clientY: 100 })

    expect(wrapper.emitted('split-tab')).toEqual([['leaf-other', 'x', 'leaf-1', 'right']])
  })

  it('emits move-tab when a tab from another group is dropped in the centre', async () => {
    const a = createEditorTab('src/a.ts')
    const leaf = leafWithTabs([a], a)
    const store = createTabBufferStore()
    seedBuffer(store, a, 'alpha')

    wrapper = mountPane(leaf, store)
    await nextTick()

    const rect = {
      left: 0,
      top: 0,
      width: 200,
      height: 200,
      right: 200,
      bottom: 200,
      x: 0,
      y: 0,
      toJSON() {
        return {}
      },
    } as DOMRect
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(rect)

    beginTabDrag({ leafId: 'leaf-other', tabId: 'y', filePath: 'y.ts' })
    const dataTransfer = makeDataTransfer()
    const pane = wrapper.find('.editor-pane')

    await pane.trigger('dragover', { dataTransfer, clientX: 100, clientY: 100 })
    await pane.trigger('drop', { dataTransfer, clientX: 100, clientY: 100 })

    expect(wrapper.emitted('move-tab')).toEqual([['leaf-other', 'y', 'leaf-1']])
    expect(wrapper.emitted('split-tab')).toBeUndefined()
  })
})

describe('useEditorSplit tab activation and preview reuse', () => {
  function setup(store: TabBufferStore = createTabBufferStore()) {
    return useEditorSplit({
      paneId: () => 'pane-1',
      isTabDirty: (tab) => store.isDirty(tab),
      onTabRemoved: (tab) => store.drop(tab.id),
      onTabReset: (tab) => store.reset(tab.id),
    })
  }

  it('activates the right neighbour when closing the active tab, then the left', () => {
    const split = setup()
    split.openFileInActivePane('a.ts', false, { pin: true })
    const b = split.openFileInActivePane('b.ts', false, { pin: true })!
    const c = split.openFileInActivePane('c.ts', false, { pin: true })!
    const leaf = split.activeLeaf.value!

    split.activateTab(leaf.id, b.id)
    expect(split.closeTab(leaf.id, b.id)).toBe(true)
    expect(getActiveTab(leaf)?.filePath).toBe('c.ts')

    expect(split.closeTab(leaf.id, c.id)).toBe(true)
    expect(getActiveTab(leaf)?.filePath).toBe('a.ts')
  })

  it('drops the old buffer when a clean preview tab is reused for a new path', () => {
    const store = createTabBufferStore()
    const split = setup(store)

    const first = split.openFileInActivePane('a.ts', false)!
    // A clean (text === baseline) buffer is still reusable…
    const stale = seedBuffer(store, first, 'same')
    stale.text = 'same'

    const second = split.openFileInActivePane('b.ts', false)!
    expect(second.id).toBe(first.id)
    expect(second.filePath).toBe('b.ts')
    expect(store.buffers.has(first.id)).toBe(false)
    expect(store.get(first.id, 'a.ts')).toBeUndefined()
  })

  it('keeps a preview tab with unsaved text instead of reusing it', () => {
    const store = createTabBufferStore()
    const split = setup(store)

    const first = split.openFileInActivePane('a.ts', false)!
    const buffer = seedBuffer(store, first, 'baseline')
    buffer.text = 'unsaved edit'

    const second = split.openFileInActivePane('b.ts', false)!
    expect(second.id).not.toBe(first.id)
    expect(store.get(first.id, 'a.ts')?.text).toBe('unsaved edit')
    expect(getActiveTab(split.activeLeaf.value!)?.filePath).toBe('b.ts')
  })
})

describe('useTabBufferStore', () => {
  it('keys buffers by tab id and path, and recreates when the path changes', () => {
    const store = createTabBufferStore()
    store.ensure('t1', 'a.ts')
    // The store is a reactive Map, so reads return reactive proxies: compare
    // by identity between reads rather than against the raw ensure() result.
    const cached = store.get('t1', 'a.ts')
    expect(cached?.path).toBe('a.ts')
    expect(store.get('t1', 'a.ts')).toBe(cached)
    expect(store.ensure('t1', 'a.ts')).toBe(cached)

    store.ensure('t1', 'b.ts')
    expect(store.get('t1', 'a.ts')).toBeUndefined()
    expect(store.get('t1', 'b.ts')?.path).toBe('b.ts')
    expect(store.get('t1', 'b.ts')).not.toBe(cached)
    expect(store.get('missing', 'b.ts')).toBeUndefined()
  })

  it('reports dirty only when text differs from the baseline', () => {
    const store = createTabBufferStore()
    const tab = createEditorTab('a.ts')
    expect(store.isDirty(tab)).toBe(false)

    const buffer = store.ensure(tab.id, tab.filePath)
    buffer.text = 'edit'
    buffer.baseline = 'edit'
    expect(store.isDirty(tab)).toBe(false)

    buffer.text = 'edited'
    expect(store.isDirty(tab)).toBe(true)
  })

  it('marks disk changes and clears them when the buffer is dropped', () => {
    const store = createTabBufferStore()
    const buffer = store.ensure('t1', 'a.ts')
    expect(buffer.diskChanged).toBe(false)

    store.markDiskChanged('t1')
    expect(store.get('t1', 'a.ts')?.diskChanged).toBe(true)
    store.markDiskChanged('missing')

    store.invalidate('t1')
    expect(store.get('t1', 'a.ts')).toBeUndefined()
  })

  it('drops and resets buffers by tab id', () => {
    const store = createTabBufferStore()
    store.ensure('t1', 'a.ts')
    store.ensure('t2', 'b.ts')

    store.drop('t1')
    expect(store.get('t1', 'a.ts')).toBeUndefined()
    expect(store.get('t2', 'b.ts')).toBeDefined()

    store.reset('t2')
    expect(store.buffers.size).toBe(0)
  })
})
