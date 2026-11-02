import { afterEach, describe, expect, it } from 'vitest'
import { nextTick } from 'vue'
import { mount } from '@vue/test-utils'
import OutlinePanel from '../components/workspace/OutlinePanel.vue'
import { OUTLINE_ROW_HEIGHT } from '../utils/outlineVirtual'
import type { OutlineItem, OutlineSource } from '../types/outline'

const items: OutlineItem[] = [
  {
    id: 'a',
    label: 'Alpha',
    kind: 'heading',
    level: 1,
    line: 1,
    anchor: 'a',
    children: [
      {
        id: 'b',
        label: 'Beta',
        kind: 'heading',
        level: 2,
        line: 2,
        anchor: 'b',
        children: [
          {
            id: 'c',
            label: 'Gamma',
            kind: 'heading',
            level: 3,
            line: 3,
            anchor: 'c',
          },
        ],
      },
      { id: 'd', label: 'Delta', kind: 'heading', level: 2, line: 4, anchor: 'd' },
    ],
  },
  { id: 'e', label: 'Epsilon', kind: 'heading', level: 1, line: 5, anchor: 'e' },
]

const source: OutlineSource = {
  mode: 'markdown',
  items,
  status: 'ok',
  loading: false,
  provider: 'lexer',
}

type PanelProps = InstanceType<typeof OutlinePanel>['$props']

const wrappers: ReturnType<typeof mount>[] = []

function mountPanel(overrides: Partial<PanelProps> = {}) {
  const wrapper = mount(OutlinePanel, {
    props: {
      open: true,
      mobile: false,
      source,
      mode: 'markdown',
      activeId: 'a',
      filePath: 'docs/design.md',
      languageLabel: 'Markdown',
      ...overrides,
    } as PanelProps,
  })
  wrappers.push(wrapper)
  return wrapper
}

function rowIds(wrapper: ReturnType<typeof mount>): string[] {
  return wrapper.findAll('[data-outline-id]').map((row) => row.attributes('data-outline-id') ?? '')
}

function manyItems(count: number): OutlineItem[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `n${index}`,
    label: `Node ${index}`,
    kind: 'heading',
    level: 1,
    line: index + 1,
    anchor: `n${index}`,
  }))
}

function firePointer(element: Element, type: string, init: PointerEventInit): void {
  element.dispatchEvent(
    new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 1, ...init })
  )
}

afterEach(() => {
  for (const wrapper of wrappers.splice(0)) wrapper.unmount()
})

describe('OutlinePanel', () => {
  it('renders the open overlay with two levels expanded by default', () => {
    const wrapper = mountPanel()
    expect(wrapper.find('.outline-panel').classes()).toContain('open')
    expect(rowIds(wrapper)).toEqual(['a', 'b', 'c', 'd', 'e'])
    expect(wrapper.find('.count-pill').text()).toBe('5')
  })

  it('collapses a branch from its chevron and expands all again', async () => {
    const wrapper = mountPanel()
    await wrapper.find('[data-outline-id="a"] .chev').trigger('click')
    expect(rowIds(wrapper)).toEqual(['a', 'e'])
    expect(wrapper.find('[data-outline-id="a"]').attributes('aria-expanded')).toBe('false')

    await wrapper.find('.panel-head button:nth-of-type(1)').trigger('click')
    expect(rowIds(wrapper)).toEqual(['a', 'b', 'c', 'd', 'e'])

    await wrapper.find('.panel-head button:nth-of-type(2)').trigger('click')
    expect(rowIds(wrapper)).toEqual(['a', 'e'])
  })

  it('filters with ancestor retention, highlights matches and reports counts', async () => {
    const wrapper = mountPanel()
    await wrapper.find('input').setValue('gamma')

    expect(rowIds(wrapper)).toEqual(['a', 'b', 'c'])
    expect(wrapper.find('.count-pill').text()).toBe('1/5')
    expect(wrapper.find('mark').text()).toBe('Gamma')

    await wrapper.find('.search-clear').trigger('click')
    expect(rowIds(wrapper)).toEqual(['a', 'b', 'c', 'd', 'e'])
    expect(wrapper.find('.count-pill').text()).toBe('5')
  })

  it('shows a no-matches state with a clear action', async () => {
    const wrapper = mountPanel()
    await wrapper.find('input').setValue('zzz')

    expect(wrapper.find('.empty-title').text()).toBe('No matches')
    await wrapper.find('.empty-action').trigger('click')
    expect(rowIds(wrapper)).toEqual(['a', 'b', 'c', 'd', 'e'])
  })

  it('emits the active id and reveal target when a row is clicked', async () => {
    const wrapper = mountPanel()
    await wrapper.find('[data-outline-id="b"]').trigger('click')

    expect(wrapper.emitted('update:activeId')?.[0]).toEqual(['b'])
    expect(wrapper.emitted('reveal')?.[0]?.[0]).toMatchObject({ id: 'b', line: 2 })
  })

  it('expands ancestors when the active id comes from scroll spy', async () => {
    const wrapper = mountPanel({ activeId: '' })
    await wrapper.find('[data-outline-id="a"] .chev').trigger('click')
    expect(rowIds(wrapper)).toEqual(['a', 'e'])

    await wrapper.setProps({ activeId: 'c' })
    expect(rowIds(wrapper)).toEqual(['a', 'b', 'c', 'd', 'e'])
  })

  it('closes from the header button and Escape', async () => {
    const wrapper = mountPanel()
    await wrapper.find('.panel-close').trigger('click')
    expect(wrapper.emitted('close')).toHaveLength(1)

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(wrapper.emitted('close')).toHaveLength(2)
  })

  it('shows a distinct empty state with a rescan action', async () => {
    const wrapper = mountPanel({
      source: { mode: 'markdown', items: [], status: 'empty', loading: false },
    })
    expect(wrapper.find('.empty-title').text()).toBe('No headings found')
    expect(wrapper.find('.count-pill').text()).toBe('0')

    await wrapper.find('.empty-action').trigger('click')
    expect(wrapper.emitted('retry')).toHaveLength(1)
  })

  it('shows the parse error line and retries', async () => {
    const wrapper = mountPanel({
      mode: 'json',
      source: {
        mode: 'json',
        items: [],
        status: 'error',
        loading: false,
        errorLine: 4,
        message: 'Expected something',
      },
    })
    expect(wrapper.find('.empty-title').text()).toBe('Couldn’t parse this file')
    expect(wrapper.find('.empty-detail').text()).toBe('Line 4: Expected something')

    await wrapper.find('.empty-action').trigger('click')
    expect(wrapper.emitted('retry')).toHaveLength(1)
  })

  it('switches to the mobile bottom sheet and floating button', async () => {
    const wrapper = mountPanel({ mobile: true, open: false })
    expect(wrapper.find('.outline-panel').classes()).toContain('mobile')
    expect(wrapper.find('.outline-panel').classes()).not.toContain('open')

    const fab = wrapper.find('.outline-fab')
    expect(fab.exists()).toBe(true)
    await fab.trigger('click')
    expect(wrapper.emitted('open')).toHaveLength(1)

    await wrapper.setProps({ open: true })
    expect(wrapper.find('.outline-panel').classes()).toContain('open')
    expect(wrapper.find('.outline-scrim').classes()).toContain('show')
    expect(wrapper.find('.outline-fab').exists()).toBe(false)
  })

  it('virtualizes large trees above the threshold with exact spacer heights', () => {
    const items = manyItems(2500)
    const wrapper = mountPanel({
      source: { mode: 'markdown', items, status: 'ok', loading: false, provider: 'lexer' },
    })

    const rendered = rowIds(wrapper)
    expect(rendered).toHaveLength(8)
    expect(rendered[0]).toBe('n0')

    const spacer = wrapper.find('.outline-vpad')
    expect(spacer.exists()).toBe(true)
    expect(spacer.attributes('style')).toContain(
      `height: ${(2500 - rendered.length) * OUTLINE_ROW_HEIGHT}px`
    )

    // Rendered rows keep their tree semantics.
    const first = wrapper.find('[data-outline-id="n0"]')
    expect(first.attributes('role')).toBe('treeitem')
    expect(first.attributes('aria-level')).toBe('1')
  })

  it('renders every row below the virtualization threshold', () => {
    const items = manyItems(200)
    const wrapper = mountPanel({
      source: { mode: 'markdown', items, status: 'ok', loading: false, provider: 'lexer' },
    })
    expect(rowIds(wrapper)).toHaveLength(200)
    expect(wrapper.find('.outline-vpad').exists()).toBe(false)
  })

  it('scrolls an active row from the scroll spy into the virtual window', async () => {
    const items = manyItems(2500)
    const wrapper = mountPanel({
      activeId: '',
      source: { mode: 'markdown', items, status: 'ok', loading: false, provider: 'lexer' },
    })
    expect(wrapper.find('[data-outline-id="n2000"]').exists()).toBe(false)

    await wrapper.setProps({ activeId: 'n2000' })
    for (let i = 0; i < 4; i++) await nextTick()

    const scroller = wrapper.find('.outline-scroll').element as HTMLElement
    expect(scroller.scrollTop).toBe(2000 * OUTLINE_ROW_HEIGHT)
    expect(wrapper.find('[data-outline-id="n2000"]').exists()).toBe(true)
  })

  it('closes the mobile sheet after a downward swipe on the header', async () => {
    const wrapper = mountPanel({ mobile: true, open: true })
    const head = wrapper.find('.panel-head').element

    firePointer(head, 'pointerdown', { clientY: 100 })
    firePointer(head, 'pointermove', { clientY: 240 })
    firePointer(head, 'pointerup', { clientY: 240 })
    await nextTick()

    expect(wrapper.emitted('close')).toHaveLength(1)
  })

  it('ignores upward swipes and keeps the sheet open', async () => {
    const wrapper = mountPanel({ mobile: true, open: true })
    const head = wrapper.find('.panel-head').element

    firePointer(head, 'pointerdown', { clientY: 240 })
    firePointer(head, 'pointermove', { clientY: 120 })
    firePointer(head, 'pointerup', { clientY: 120 })
    await nextTick()

    expect(wrapper.emitted('close')).toBeUndefined()
  })

  it('does not attach swipe-to-close on desktop', async () => {
    const wrapper = mountPanel({ mobile: false, open: true })
    const head = wrapper.find('.panel-head').element

    firePointer(head, 'pointerdown', { clientY: 100 })
    firePointer(head, 'pointermove', { clientY: 300 })
    firePointer(head, 'pointerup', { clientY: 300 })
    await nextTick()

    expect(wrapper.emitted('close')).toBeUndefined()
  })

  it('labels regex-derived code symbols', () => {
    const wrapper = mountPanel({
      mode: 'code',
      source: {
        mode: 'code',
        items: [{ id: 'ts:run:1', label: 'run()', kind: 'function', line: 1 }],
        status: 'ok',
        loading: false,
        provider: 'regex',
        language: 'typescript',
      },
      languageLabel: 'TypeScript',
    })
    expect(wrapper.find('.source-pill').text()).toBe('regex')
    expect(wrapper.find('.type-pill').text()).toBe('TypeScript')
  })
})
