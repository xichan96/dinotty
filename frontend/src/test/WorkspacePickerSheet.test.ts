import { describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { mount } from '@vue/test-utils'
import type { Workspace } from '../types/workspace'

// BaseDialog teleports to <body>, which would put the sheet content outside the
// wrapper in these focused tests. The dialog behaviour itself is covered by
// BaseDialog's own tests; here we only need the slot mounted.
vi.mock('../components/ui/BaseDialog.vue', () => ({
  default: {
    name: 'BaseDialog',
    props: ['visible', 'variant', 'dialogClass', 'closable', 'closeOnBackdrop', 'closeOnEscape'],
    emits: ['close'],
    setup(_props: unknown, { slots }: { slots: { default?: () => unknown } }) {
      return () => slots.default?.()
    },
  },
}))

vi.mock('../components/WorkspaceBadge.vue', () => ({
  default: {
    name: 'WorkspaceBadge',
    props: ['abbr'],
    template: '<span class="ws-badge-stub">{{ abbr }}</span>',
  },
}))

// Predictable labels so assertions do not depend on the active UI locale.
vi.mock('../composables/useI18n', () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, string | number>) =>
      params?.count === undefined ? key : `${key}:${params.count}`,
  }),
}))

import WorkspacePickerSheet from '../components/overview/WorkspacePickerSheet.vue'

const workspaces: Workspace[] = [
  { id: 'default', name: 'Default', path: '~', order: 0 },
  { id: 'alpha', name: 'Alpha', path: '/alpha', order: 1 },
  { id: 'beta', name: 'Beta', path: '/beta', order: 2 },
  { id: 'gamma', name: 'Gamma', path: '/gamma', order: 3 },
]

function mountSheet(recentIds: string[] = ['beta', 'alpha']) {
  return mount(WorkspacePickerSheet, {
    props: {
      visible: true,
      workspaces,
      selectedId: 'alpha',
      tabCounts: { alpha: 3 },
      recentIds,
    },
    attachTo: document.body,
  })
}

describe('WorkspacePickerSheet', () => {
  it('splits into recently used and other workspaces', () => {
    const wrapper = mountSheet()

    expect(wrapper.findAll('.ws-picker-section').map((el) => el.text())).toEqual([
      'workspace.recentUsed',
      'workspace.others',
    ])
    // Recent rows keep MRU order and are not repeated in the other section.
    expect(wrapper.findAll('.ws-picker-row').map((el) => el.attributes('data-ws-id'))).toEqual([
      'beta',
      'alpha',
      'default',
      'gamma',
    ])
    expect(wrapper.find('.ws-picker-row.selected').attributes('data-ws-id')).toBe('alpha')
  })

  it('falls back to a single all-workspaces section without recents', () => {
    const wrapper = mountSheet([])

    expect(wrapper.findAll('.ws-picker-section').map((el) => el.text())).toEqual(['workspace.all'])
    expect(wrapper.findAll('.ws-picker-row')).toHaveLength(workspaces.length)
  })

  it('ignores stale recent ids', () => {
    const wrapper = mountSheet(['deleted', 'beta'])

    expect(wrapper.findAll('.ws-picker-row').map((el) => el.attributes('data-ws-id'))).toEqual([
      'beta',
      'default',
      'alpha',
      'gamma',
    ])
  })

  it('filters by name or path and emits the selected workspace', async () => {
    const wrapper = mountSheet()

    await wrapper.find('input').setValue('bet')
    await nextTick()

    expect(wrapper.findAll('.ws-picker-row').map((el) => el.attributes('data-ws-id'))).toEqual([
      'beta',
    ])
    expect(wrapper.find('.ws-picker-section').text()).toBe('workspace.searchResults:1')
    expect(wrapper.findAll('mark').map((el) => el.text())).toEqual(['Bet', 'bet'])

    await wrapper.find('.ws-picker-row[data-ws-id="beta"]').trigger('click')
    expect(wrapper.emitted('select')).toEqual([['beta']])
  })

  it('clears the query from the search clear button', async () => {
    const wrapper = mountSheet()

    await wrapper.find('input').setValue('bet')
    await nextTick()
    await wrapper.find('.ws-picker-clear').trigger('click')
    await nextTick()

    expect((wrapper.find('input').element as HTMLInputElement).value).toBe('')
    expect(wrapper.findAll('mark')).toHaveLength(0)
    expect(wrapper.findAll('.ws-picker-row')).toHaveLength(workspaces.length)
  })

  it('filters by path too', async () => {
    const wrapper = mountSheet()

    await wrapper.find('input').setValue('/gam')
    await nextTick()

    expect(wrapper.findAll('.ws-picker-row').map((el) => el.attributes('data-ws-id'))).toEqual([
      'gamma',
    ])
  })

  it('selects the first search result on Enter', async () => {
    const wrapper = mountSheet()
    const input = wrapper.find('input')

    await input.setValue('/be')
    await nextTick()
    await input.trigger('keydown', { key: 'Enter' })

    expect(wrapper.emitted('select')).toEqual([['beta']])
  })

  it('shows an empty state when nothing matches', async () => {
    const wrapper = mountSheet()

    await wrapper.find('input').setValue('no-such-workspace')
    await nextTick()

    expect(wrapper.findAll('.ws-picker-row')).toHaveLength(0)
    expect(wrapper.find('.ws-picker-empty').text()).toBe('workspace.noResults')
  })

  it('emits add for the footer button', async () => {
    const wrapper = mountSheet()

    await wrapper.find('.ws-picker-add').trigger('click')
    expect(wrapper.emitted('add')).toEqual([[]])
  })
})
