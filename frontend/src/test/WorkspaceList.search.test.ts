import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { mount } from '@vue/test-utils'
import WorkspaceList from '../components/overview/WorkspaceList.vue'
import type { Workspace } from '../types/workspace'

const workspaces: Workspace[] = [
  { id: 'alpha', name: 'Alpha', path: '/alpha', order: 0 },
  { id: 'beta', name: 'Beta', path: '/beta', order: 1 },
  { id: 'gamma', name: 'Gamma', path: '/gamma', order: 2 },
]

beforeEach(() => {
  // The drag path is disabled during search; a matchMedia stub keeps other
  // incidental calls safe in happy-dom.
  vi.spyOn(window, 'matchMedia').mockImplementation(
    (query: string) =>
      ({
        matches: false,
        media: query,
        onchange: null,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
      }) as unknown as MediaQueryList
  )
})

afterEach(() => {
  vi.restoreAllMocks()
  document.body.style.userSelect = ''
})

function mountList() {
  return mount(WorkspaceList, {
    props: {
      workspaces,
      selectedId: 'beta',
      activeId: null,
      tabCounts: { beta: 3 },
      defaultCount: 1,
    },
    attachTo: document.body,
  })
}

describe('WorkspaceList search', () => {
  it('filters by name and keeps the default workspace out when it does not match', async () => {
    const wrapper = mountList()

    await wrapper.find('.mc-ws-search-input').setValue('bet')

    expect(wrapper.findAll('.mc-ws-list-item')).toHaveLength(1)
    expect(wrapper.find('[data-workspace-id="beta"]').exists()).toBe(true)
    expect(wrapper.find('[data-workspace-id="__default__"]').exists()).toBe(false)
  })

  it('filters by path too', async () => {
    const wrapper = mountList()

    await wrapper.find('.mc-ws-search-input').setValue('/gam')

    expect(wrapper.findAll('[data-workspace-id]')).toHaveLength(1)
    expect(wrapper.find('[data-workspace-id="gamma"]').exists()).toBe(true)
  })

  it('shows the path and highlights matching text in results', async () => {
    const wrapper = mountList()

    await wrapper.find('.mc-ws-search-input').setValue('bet')

    expect(wrapper.find('[data-workspace-id="beta"] .mc-ws-path').text()).toBe('/beta')
    expect(wrapper.findAll('mark').map((el) => el.text())).toEqual(['Bet', 'bet'])
  })

  it('clears the query from the inline clear button', async () => {
    const wrapper = mountList()

    await wrapper.find('.mc-ws-search-input').setValue('bet')
    await wrapper.find('.mc-ws-search-clear').trigger('click')
    await nextTick()

    expect((wrapper.find('.mc-ws-search-input').element as HTMLInputElement).value).toBe('')
    expect(wrapper.findAll('.mc-ws-list-item')).toHaveLength(4)
    expect(wrapper.find('.mc-ws-empty--search').exists()).toBe(false)
  })

  it('shows an empty state when nothing matches', async () => {
    const wrapper = mountList()

    await wrapper.find('.mc-ws-search-input').setValue('zzz')

    expect(wrapper.findAll('.mc-ws-list-item')).toHaveLength(0)
    expect(wrapper.find('.mc-ws-empty--search').exists()).toBe(true)
    expect(wrapper.find('.mc-ws-empty-title').text()).not.toBe('')
  })

  it('exposes focus and clear helpers for the overlay shortcuts', async () => {
    const wrapper = mountList()
    const vm = wrapper.vm as unknown as {
      focusSearch: () => void
      clearSearch: () => boolean
    }

    vm.focusSearch()
    await nextTick()
    expect(document.activeElement).toBe(wrapper.find('.mc-ws-search-input').element)

    await wrapper.find('.mc-ws-search-input').setValue('bet')
    expect(wrapper.find('.mc-ws-search-clear').exists()).toBe(true)

    expect(vm.clearSearch()).toBe(true)
    expect(vm.clearSearch()).toBe(false)
    await nextTick()
    expect(wrapper.findAll('.mc-ws-list-item')).toHaveLength(4)
  })

  it('does not start a drag from a filtered result', async () => {
    const wrapper = mountList()

    await wrapper.find('.mc-ws-search-input').setValue('bet')
    const item = wrapper.find('[data-workspace-id="beta"]')
    await item.trigger('touchstart', { touches: [{ clientX: 100, clientY: 50 }] })

    // canDrag() bails because the list is filtered; reordering a subset would
    // write an incorrect order back to the server.
    expect(document.body.style.userSelect).toBe('')
    expect(wrapper.find('.mc-ws-list-item.dragging').exists()).toBe(false)
  })

  it('clears the query on Escape without bubbling to the MC handler', async () => {
    const wrapper = mountList()
    const input = wrapper.find('.mc-ws-search-input')

    await input.setValue('bet')
    const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    input.element.dispatchEvent(event)
    await nextTick()

    expect(event.defaultPrevented).toBe(true)
    expect((input.element as HTMLInputElement).value).toBe('')
    expect(wrapper.findAll('.mc-ws-list-item')).toHaveLength(4)
  })
})
