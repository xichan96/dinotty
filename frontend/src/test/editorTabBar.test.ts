import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import EditorTabBar from '../components/workspace/EditorTabBar.vue'
import { beginTabDrag, endTabDrag, TAB_DRAG_MIME } from '../composables/useEditorTabDrag'
import {
  createTabBufferStore,
  TAB_BUFFER_STORE_KEY,
  type TabBufferStore,
} from '../composables/useTabBufferStore'
import type { EditorTab } from '../types/editorTabs'

class ResizeObserverStub {
  static instances: ResizeObserverStub[] = []
  callback: ResizeObserverCallback

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback
    ResizeObserverStub.instances.push(this)
  }

  observe() {}
  unobserve() {}
  disconnect() {}
}

interface DataTransferStub {
  types: string[]
  dropEffect: string
  effectAllowed: string
  data: Map<string, string>
  setData(format: string, value: string): void
  getData(format: string): string
}

function makeDataTransfer(types: string[] = [TAB_DRAG_MIME]): DataTransferStub {
  const data = new Map<string, string>()
  return {
    types,
    dropEffect: '',
    effectAllowed: '',
    data,
    setData(format, value) {
      data.set(format, value)
    },
    getData(format) {
      return data.get(format) ?? ''
    },
  }
}

function tabsFixture(): EditorTab[] {
  return [
    {
      id: 'a',
      filePath: 'src/a.ts',
      isDir: false,
      preview: false,
    },
    {
      id: 'b',
      filePath: 'lib/a.ts',
      isDir: false,
      preview: true,
    },
    {
      id: 'c',
      filePath: 'b.ts',
      isDir: false,
      preview: false,
    },
  ]
}

function mountBar(
  store: TabBufferStore = createTabBufferStore(),
  overrides: Record<string, unknown> = {}
) {
  return mount(EditorTabBar, {
    attachTo: document.body,
    props: {
      leafId: 'leaf-1',
      tabs: tabsFixture(),
      activeTabId: 'a',
      canCloseGroup: false,
      ...overrides,
    },
    global: {
      plugins: [
        {
          install(app) {
            app.provide(TAB_BUFFER_STORE_KEY, store)
          },
        },
      ],
    },
  })
}

describe('EditorTabBar rendering', () => {
  let wrapper: ReturnType<typeof mountBar> | null = null

  beforeEach(() => {
    ResizeObserverStub.instances = []
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
    document.body.replaceChildren()
    vi.unstubAllGlobals()
  })

  it('renders active, preview and duplicate-name tabs', () => {
    wrapper = mountBar()
    const tabs = wrapper.findAll('.editor-tab')
    expect(tabs).toHaveLength(3)

    expect(tabs[0].classes()).toContain('active')
    expect(tabs[0].attributes('aria-selected')).toBe('true')
    expect(tabs[1].classes()).not.toContain('active')
    expect(tabs[1].classes()).toContain('preview')

    // Two tabs share the base name `a.ts`, so both reveal their parent dir.
    const dirs = wrapper.findAll('.tab-dir').map((node) => node.text())
    expect(dirs).toEqual(['src/', 'lib/'])
    expect(tabs[2].find('.tab-dir').exists()).toBe(false)

    expect(wrapper.findAll('.tab-name').map((node) => node.text())).toEqual([
      'a.ts',
      'a.ts',
      'b.ts',
    ])
    expect(wrapper.findAll('.editor-tab-close')).toHaveLength(3)
  })

  it('marks a tab dirty when its cached buffer has unsaved text', () => {
    const store = createTabBufferStore()
    const buffer = store.ensure('b', 'lib/a.ts')
    buffer.text = 'unsaved edit'
    buffer.baseline = 'original'

    wrapper = mountBar(store)
    const tabs = wrapper.findAll('.editor-tab')
    expect(tabs[0].classes()).not.toContain('dirty')
    expect(tabs[1].classes()).toContain('dirty')
    expect(tabs[1].find('.tab-dirty-dot').exists()).toBe(true)
  })

  it('emits activate on click, pin on double click and close on middle click', async () => {
    wrapper = mountBar()
    const tabs = wrapper.findAll('.editor-tab')

    await tabs[1].trigger('click')
    expect(wrapper.emitted('activate')).toEqual([['b']])

    await tabs[1].trigger('dblclick')
    expect(wrapper.emitted('pin')).toEqual([['b']])

    await tabs[2].trigger('auxclick', { button: 1 })
    expect(wrapper.emitted('request-close')).toEqual([['c']])

    // Left-click auxclick must not close anything.
    await tabs[0].trigger('auxclick', { button: 0 })
    expect(wrapper.emitted('request-close')).toHaveLength(1)
  })

  it('emits request-close from the tab close button without activating it', async () => {
    wrapper = mountBar()
    const closeButtons = wrapper.findAll('.editor-tab-close')

    await closeButtons[2].trigger('click')
    expect(wrapper.emitted('request-close')).toEqual([['c']])
    expect(wrapper.emitted('activate')).toBeUndefined()
  })

  it('keeps the close button visible on every tab, not only on hover', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'src/components/workspace/EditorTabBar.vue'),
      'utf8'
    )
    expect(source).toMatch(/\.editor-tab-close\s*{[^}]*display:\s*inline-flex;/s)
    expect(source).not.toMatch(/\.editor-tab:hover \.editor-tab-close/)
  })

  it('does not reuse the terminal tab bar class, whose global rule hides it', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'src/components/workspace/EditorTabBar.vue'),
      'utf8'
    )
    const layoutCss = readFileSync(resolve(process.cwd(), 'src/styles/layout.css'), 'utf8')
    // layout.css owns `.tab-close { opacity: 0 }`, so sharing that class makes
    // the editor close button permanently invisible.
    expect(layoutCss).toMatch(/\.tab-close\s*{[^}]*opacity:\s*0;/s)
    expect(source).not.toMatch(/class="tab-close"/)
  })
})

describe('EditorTabBar context menu', () => {
  let wrapper: ReturnType<typeof mountBar> | null = null

  beforeEach(() => {
    ResizeObserverStub.instances = []
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
    document.body.replaceChildren()
    vi.unstubAllGlobals()
  })

  function menuItems(): HTMLButtonElement[] {
    return [...document.body.querySelectorAll<HTMLButtonElement>('.tab-ctx-item')]
  }

  it('opens the menu and emits the selected command for that tab', async () => {
    wrapper = mountBar()
    await wrapper.findAll('.editor-tab')[0].trigger('contextmenu', {
      clientX: 30,
      clientY: 40,
    })
    await nextTick()

    const items = menuItems()
    expect(items).toHaveLength(6)
    // First tab has tabs to the right, so "close right" is enabled.
    expect(items[3].disabled).toBe(false)

    items[0].click()
    await nextTick()

    expect(wrapper.emitted('command')).toEqual([['a', 'close']])
    expect(menuItems()).toHaveLength(0)
  })

  it('offers pin for a preview tab and disables close-right on the last tab', async () => {
    wrapper = mountBar()
    const tabs = wrapper.findAll('.editor-tab')

    await tabs[1].trigger('contextmenu')
    await nextTick()
    let items = menuItems()
    expect(items[1].textContent).toContain('Pin Tab')
    items[1].click()
    await nextTick()
    expect(wrapper.emitted('command')).toEqual([['b', 'toggle-preview']])

    await tabs[2].trigger('contextmenu')
    await nextTick()
    items = menuItems()
    expect(items[3].disabled).toBe(true)
  })
})

describe('EditorTabBar drag and drop', () => {
  let wrapper: ReturnType<typeof mountBar> | null = null

  beforeEach(() => {
    ResizeObserverStub.instances = []
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
    document.body.replaceChildren()
    vi.unstubAllGlobals()
  })

  it('emits reorder when a tab is dropped after another tab in the same strip', async () => {
    wrapper = mountBar()
    const tabs = wrapper.findAll('.editor-tab')
    const dataTransfer = makeDataTransfer()

    await tabs[0].trigger('dragstart', { dataTransfer })
    await tabs[2].trigger('dragover', { dataTransfer, clientX: 100 })
    await tabs[2].trigger('drop', { dataTransfer, clientX: 100 })

    expect(wrapper.emitted('reorder')).toEqual([['a', 'c', true]])
  })

  it('emits reorder with after=false when dropped on the left half', async () => {
    wrapper = mountBar()
    const tabs = wrapper.findAll('.editor-tab')
    const dataTransfer = makeDataTransfer()

    await tabs[2].trigger('dragstart', { dataTransfer })
    await tabs[0].trigger('dragover', { dataTransfer, clientX: 0 })
    await tabs[0].trigger('drop', { dataTransfer, clientX: 0 })

    expect(wrapper.emitted('reorder')).toEqual([['c', 'a', false]])
  })

  it('emits drop-on-strip when a tab from another group lands on a tab', async () => {
    wrapper = mountBar()
    beginTabDrag({ leafId: 'leaf-other', tabId: 'x', filePath: 'x.ts' })
    const dataTransfer = makeDataTransfer()
    const target = wrapper.findAll('.editor-tab')[1]

    await target.trigger('dragover', { dataTransfer })
    await target.trigger('drop', { dataTransfer })

    expect(wrapper.emitted('drop-on-strip')).toEqual([['leaf-other', 'x']])
  })

  it('highlights the strip and emits drop-on-strip for a cross-group strip drop', async () => {
    wrapper = mountBar()
    beginTabDrag({ leafId: 'leaf-other', tabId: 'y', filePath: 'y.ts' })
    const dataTransfer = makeDataTransfer()
    const bar = wrapper.find('.editor-tab-bar')

    await bar.trigger('dragover', { dataTransfer })
    expect(bar.classes()).toContain('strip-drop')

    await bar.trigger('drop', { dataTransfer })
    expect(wrapper.emitted('drop-on-strip')).toEqual([['leaf-other', 'y']])
  })

  it('ignores a strip drop from the same group', async () => {
    wrapper = mountBar()
    beginTabDrag({ leafId: 'leaf-1', tabId: 'a', filePath: 'src/a.ts' })
    const dataTransfer = makeDataTransfer()
    const bar = wrapper.find('.editor-tab-bar')

    await bar.trigger('dragover', { dataTransfer })
    await bar.trigger('drop', { dataTransfer })

    expect(wrapper.emitted('drop-on-strip')).toBeUndefined()
  })
})

describe('EditorTabBar overflow menu', () => {
  let wrapper: ReturnType<typeof mountBar> | null = null

  beforeEach(() => {
    ResizeObserverStub.instances = []
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
    document.body.replaceChildren()
    vi.unstubAllGlobals()
  })

  async function overflowTabs(wrapper: ReturnType<typeof mountBar>) {
    const tabsEl = wrapper.find('.editor-tabs').element as HTMLElement
    Object.defineProperty(tabsEl, 'scrollWidth', { configurable: true, value: 900 })
    Object.defineProperty(tabsEl, 'clientWidth', { configurable: true, value: 200 })
    Object.defineProperty(tabsEl, 'scrollLeft', { configurable: true, value: 0 })
    await wrapper.find('.editor-tabs').trigger('scroll')
  }

  it('shows the overflow button only when the strip overflows', async () => {
    wrapper = mountBar()
    const button = wrapper.find('.tab-action.overflow')
    expect(button.classes()).not.toContain('show')

    await overflowTabs(wrapper)
    expect(button.classes()).toContain('show')
  })

  it('lists every tab and activates the chosen one', async () => {
    wrapper = mountBar()
    await overflowTabs(wrapper)

    await wrapper.find('.tab-action.overflow').trigger('click')
    const items = wrapper.findAll('.overflow-item')
    expect(items).toHaveLength(3)
    expect(items[0].classes()).toContain('active')

    await items[2].trigger('click')
    expect(wrapper.emitted('activate')).toEqual([['c']])
    expect(wrapper.find('.tab-overflow').exists()).toBe(false)
  })
})
