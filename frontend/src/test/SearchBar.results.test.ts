import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import SearchBar from '../components/terminal/SearchBar.vue'
import { settings } from '../composables/useSettings'

type ResultsListener = (event: { resultIndex: number; resultCount: number }) => void

function mountSearch() {
  let listener: ResultsListener | undefined
  const addon = {
    clearDecorations: vi.fn(),
    findNext: vi.fn(),
    findPrevious: vi.fn(),
    onDidChangeResults: vi.fn((cb: ResultsListener) => {
      listener = cb
      return { dispose: vi.fn() }
    }),
  }
  const wrapper = mount(SearchBar, {
    props: { terminal: { searchAddon: addon } as any },
  })
  return { wrapper, addon, emitResults: (event: Parameters<ResultsListener>[0]) => listener?.(event) }
}

describe('SearchBar result counter', () => {
  beforeEach(() => {
    settings.locale = 'en'
  })

  it('shows the match count reported by the search addon', async () => {
    const { wrapper, addon, emitResults } = mountSearch()

    await wrapper.get('input').setValue('foo')
    await nextTick()

    expect(addon.findNext).toHaveBeenCalledWith(
      'foo',
      expect.objectContaining({ decorations: expect.any(Object) })
    )

    emitResults({ resultIndex: 2, resultCount: 5 })
    await nextTick()

    expect(wrapper.get('.search-bar-count').text()).toBe('3/5')
    wrapper.unmount()
  })

  it('clears highlights and resets the counter when the query is emptied', async () => {
    const { wrapper, addon, emitResults } = mountSearch()

    await wrapper.get('input').setValue('foo')
    emitResults({ resultIndex: 0, resultCount: 2 })
    await nextTick()
    expect(wrapper.get('.search-bar-count').text()).toBe('1/2')

    await wrapper.get('input').setValue('')
    await nextTick()

    expect(addon.clearDecorations).toHaveBeenCalled()
    expect(wrapper.find('.search-bar-count').exists()).toBe(false)
    wrapper.unmount()
  })
})
