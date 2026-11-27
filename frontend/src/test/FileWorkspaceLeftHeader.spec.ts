import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import FileWorkspaceLeftHeader from '../components/workspace/FileWorkspaceLeftHeader.vue'

function makeRect(width: number): DOMRect {
  return {
    width,
    height: 30,
    top: 0,
    left: 0,
    right: width,
    bottom: 30,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  } as DOMRect
}

let currentWidth = 220

function mountHeader(width = 220) {
  currentWidth = width
  return mount(FileWorkspaceLeftHeader, {
    props: { mode: 'tree', changeCount: 6, refreshBusy: false, narrow: true },
  })
}

beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(() =>
    makeRect(currentWidth)
  )
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  )
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('FileWorkspaceLeftHeader', () => {
  it('moves the tail actions into the overflow menu at compact widths', async () => {
    const wrapper = mountHeader(220)
    await nextTick()

    expect(wrapper.find('[data-testid="tree-head-search"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="tree-head-refresh"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="tree-head-new-file"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="tree-head-new-folder"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="tree-head-collapse-all"]').exists()).toBe(false)

    await wrapper.find('[data-testid="tree-head-more"]').trigger('click')
    expect(wrapper.find('[data-testid="tree-head-menu-new-file"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="tree-head-menu-search"]').exists()).toBe(false)

    await wrapper.find('[data-testid="tree-head-menu-new-file"]').trigger('click')
    expect(wrapper.emitted('new-file')).toHaveLength(1)
    expect(wrapper.find('.fw-more-menu').exists()).toBe(false)
  })

  it('keeps every action inline at full width', async () => {
    const wrapper = mountHeader(320)
    await nextTick()

    for (const id of ['search', 'new-file', 'new-folder', 'refresh', 'collapse-all']) {
      expect(wrapper.find(`[data-testid="tree-head-${id}"]`).exists()).toBe(true)
    }
    expect(wrapper.find('[data-testid="tree-head-more"]').exists()).toBe(false)
  })

  it('shows the change count only when the switch has room', async () => {
    const wide = mountHeader(220)
    await nextTick()
    expect(wide.find('.fw-mode-count').text()).toBe('6')

    const narrow = mountHeader(120)
    await nextTick()
    expect(narrow.find('.fw-mode-count').exists()).toBe(false)
  })
})
