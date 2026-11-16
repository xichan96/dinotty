import { describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import type { Workspace } from '../types/workspace'

const confirmMock = vi.hoisted(() => vi.fn())
vi.mock('../composables/useConfirm', () => ({ uiConfirm: confirmMock }))

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
import { DEFAULT_WORKSPACE_ID } from '../composables/useWorkspaces'

const workspaces: Workspace[] = [
  { id: 'default', name: 'Default', path: '~', order: 0 },
  { id: 'alpha', name: 'Alpha', path: '/alpha', order: 1 },
  { id: 'beta', name: 'Beta', path: '/beta', order: 2 },
  { id: 'gamma', name: 'Gamma', path: '/gamma', order: 3 },
]

function mountSheet(recentIds: string[] = ['beta', 'alpha'], list: Workspace[] = workspaces) {
  return mount(WorkspacePickerSheet, {
    props: {
      visible: true,
      workspaces: list,
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

describe('WorkspacePickerSheet manage mode', () => {
  const manageWorkspaces: Workspace[] = [
    { id: DEFAULT_WORKSPACE_ID, name: 'Default', path: '~', order: 0 },
    { id: 'alpha', name: 'Alpha', path: '/alpha', order: 1 },
    { id: 'beta', name: 'Beta', path: '/beta', order: 2 },
  ]

  function row(wrapper: ReturnType<typeof mountSheet>, id: string) {
    return wrapper.find(`[data-ws-manage-id="${id}"]`)
  }

  async function enterManage(wrapper: ReturnType<typeof mountSheet>) {
    await wrapper.find('.ws-picker-manage-entry').trigger('click')
  }

  it('replaces search/sections with a flat, ordered manage list', async () => {
    const wrapper = mountSheet([], manageWorkspaces)
    await enterManage(wrapper)

    expect(wrapper.find('.ws-picker-search').exists()).toBe(false)
    expect(
      wrapper.findAll('.ws-picker-manage-row').map((el) => el.attributes('data-ws-manage-id'))
    ).toEqual([DEFAULT_WORKSPACE_ID, 'alpha', 'beta'])
    expect(row(wrapper, DEFAULT_WORKSPACE_ID).find('.ws-picker-fixed-tag').exists()).toBe(true)
    expect(row(wrapper, DEFAULT_WORKSPACE_ID).find('.ws-picker-drag').exists()).toBe(false)
    expect(row(wrapper, DEFAULT_WORKSPACE_ID).find('.ws-picker-action.danger').exists()).toBe(false)
    expect(row(wrapper, 'alpha').find('.ws-picker-drag').exists()).toBe(true)
  })

  it('returns to the normal picker on Done', async () => {
    const wrapper = mountSheet([], manageWorkspaces)
    await enterManage(wrapper)
    await wrapper.find('.ws-picker-done').trigger('click')

    expect(wrapper.find('.ws-picker-search').exists()).toBe(true)
    expect(wrapper.findAll('.ws-picker-row').length).toBe(3)
  })

  it('emits rename for a row action', async () => {
    const wrapper = mountSheet([], manageWorkspaces)
    await enterManage(wrapper)

    await row(wrapper, 'alpha').find('.ws-picker-action').trigger('click')
    expect(wrapper.emitted('rename')).toEqual([['alpha']])
  })

  it('asks for confirmation before emitting delete', async () => {
    confirmMock.mockResolvedValue(true)
    const wrapper = mountSheet([], manageWorkspaces)
    await enterManage(wrapper)

    await row(wrapper, 'alpha').find('.ws-picker-action.danger').trigger('click')
    await flushPromises()

    expect(confirmMock).toHaveBeenCalledTimes(1)
    expect(wrapper.emitted('delete')).toEqual([['alpha']])
  })

  it('does not delete when the confirmation is declined', async () => {
    confirmMock.mockResolvedValue(false)
    const wrapper = mountSheet([], manageWorkspaces)
    await enterManage(wrapper)

    await row(wrapper, 'alpha').find('.ws-picker-action.danger').trigger('click')
    await flushPromises()

    expect(wrapper.emitted('delete')).toBeUndefined()
  })

  it('emits the reordered id list after dragging a handle', async () => {
    const wrapper = mountSheet([], manageWorkspaces)
    await enterManage(wrapper)

    const target = row(wrapper, 'beta').element
    const original = document.elementFromPoint
    document.elementFromPoint = () => target
    try {
      const handle = row(wrapper, 'alpha').find('.ws-picker-drag').element
      handle.dispatchEvent(
        new PointerEvent('pointerdown', { bubbles: true, button: 0, clientX: 10, clientY: 10 })
      )
      window.dispatchEvent(new PointerEvent('pointermove', { clientX: 10, clientY: 40 }))
      window.dispatchEvent(new PointerEvent('pointerup'))
      await nextTick()
    } finally {
      document.elementFromPoint = original
    }

    expect(wrapper.emitted('reorder')).toEqual([[['beta', 'alpha']]])
  })

  it('reorders one slot per keyboard press on a focused handle', async () => {
    const wrapper = mountSheet([], manageWorkspaces)
    await enterManage(wrapper)

    await row(wrapper, 'alpha').find('.ws-picker-drag').trigger('keydown', { key: 'ArrowDown' })
    expect(wrapper.emitted('reorder')).toEqual([[['beta', 'alpha']]])
  })
})
