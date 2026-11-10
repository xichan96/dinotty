import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { h, nextTick } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { enableAutoUnmount, mount } from '@vue/test-utils'

// Previous tests leave their overlay mounted; an open BaseDialog's window
// capture handler would then eat Escape before the next test's input sees it.
enableAutoUnmount(afterEach)

vi.mock('motion-v', () => {
  const container = (name: string) => ({
    name,
    inheritAttrs: true,
    setup(_props: any, { slots, attrs }: any) {
      return () => h('div', { ...attrs, class: [name, attrs.class] }, slots.default?.())
    },
  })
  return {
    Motion: container('Motion'),
    AnimatePresence: {
      name: 'AnimatePresence',
      props: ['mode'],
      setup(_props: any, { slots }: any) {
        return () => slots.default?.()
      },
    },
  }
})

const hoisted = vi.hoisted(() => ({
  sendMcOp: vi.fn(),
  mc: null as any,
  invoke: vi.fn().mockResolvedValue([]),
  toggleServerPicker: vi.fn(),
  closeServerPicker: vi.fn(),
}))

vi.mock('../composables/useMissionControlState', async () => {
  const { reactive } = await import('vue')
  hoisted.mc = reactive({
    open: true,
    selectedWorkspaceId: 'alpha',
    selectedTabId: null,
    selectedTabTitle: null,
    synced: true,
  })
  return {
    useMissionControlState: () => hoisted.mc,
    sendMcOp: hoisted.sendMcOp,
  }
})

vi.mock('../composables/useTransport', () => ({
  isTauri: () => true,
  tauriInvoke: hoisted.invoke,
}))

vi.mock('../composables/useAppCore', async () => {
  const { ref } = await import('vue')
  return {
    serverPickerOpen: ref(false),
    toggleServerPicker: hoisted.toggleServerPicker,
    closeServerPicker: hoisted.closeServerPicker,
  }
})

vi.mock('../composables/useConfirm', () => ({ uiConfirm: vi.fn() }))

import WorkspaceOverview from '../components/overview/WorkspaceOverview.vue'
import WorkspacePickerSheet from '../components/overview/WorkspacePickerSheet.vue'
import WorkspaceList from '../components/overview/WorkspaceList.vue'
import { useWorkspaces } from '../composables/useWorkspaces'
import { useUiStore } from '../stores/uiStore'

const RECENT_KEY = 'dinotty_mc_recent_workspaces_v1'

function mountOverview() {
  useUiStore().syncConnected = true
  return mount(WorkspaceOverview, {
    props: {
      visible: true,
      activePaneId: null,
      termRefs: {},
      indicators: {},
    } as any,
    attachTo: document.body,
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  setActivePinia(createPinia())
  localStorage.clear()
  hoisted.mc.selectedWorkspaceId = 'alpha'
  useWorkspaces().workspaces.value = [
    { id: 'alpha', name: 'Alpha', path: '/alpha', order: 0 },
    { id: 'beta', name: 'Beta', path: '/beta', order: 1 },
  ]
})

describe('WorkspaceOverview mobile workspace picker', () => {
  it('shows the current workspace and opens the picker on tap', async () => {
    const wrapper = mountOverview()

    expect(wrapper.find('.mc-mobile-ws-current .mc-mobile-ws-name').text()).toBe('Alpha')

    await wrapper.find('.mc-mobile-ws-current').trigger('click')

    const picker = wrapper.findComponent(WorkspacePickerSheet)
    expect(picker.props('visible')).toBe(true)
    expect(picker.props('focusSearch')).toBe(false)
    expect(picker.props('selectedId')).toBe('alpha')
    expect((picker.props('workspaces') as Array<{ id: string }>).map((ws) => ws.id)).toEqual([
      '__default__',
      'alpha',
      'beta',
    ])
  })

  it('opens the picker in search mode from the header magnifier', async () => {
    const wrapper = mountOverview()

    await wrapper.find('.mc-mobile-ws-search').trigger('click')

    const picker = wrapper.findComponent(WorkspacePickerSheet)
    expect(picker.props('visible')).toBe(true)
    expect(picker.props('focusSearch')).toBe(true)
  })

  it('does not let typing in the workspace search drive MC shortcuts', async () => {
    const wrapper = mountOverview()
    const input = wrapper.find('.mc-ws-search-input')

    await input.trigger('keydown', { key: 's' })
    await input.trigger('keydown', { key: 'n' })
    await input.trigger('keydown', { key: 'ArrowDown' })

    expect(hoisted.toggleServerPicker).not.toHaveBeenCalled()
    expect(wrapper.emitted('new-tab')).toBeUndefined()
    expect(hoisted.sendMcOp).not.toHaveBeenCalled()
  })

  it('focuses the workspace search on /', async () => {
    const wrapper = mountOverview()

    await wrapper.find('.mc-close-btn').trigger('keydown', { key: '/' })
    // focusSearch() defers through nextTick.
    await nextTick()
    await nextTick()

    expect(document.activeElement).toBe(wrapper.find('.mc-ws-search-input').element)
  })

  it('clears the search on Escape before closing MC', async () => {
    const wrapper = mountOverview()
    const input = wrapper.find('.mc-ws-search-input')

    await input.setValue('beta')
    expect(wrapper.find('.mc-ws-search-clear').exists()).toBe(true)

    const clearEscape = new KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
      cancelable: true,
    })
    input.element.dispatchEvent(clearEscape)
    await nextTick()

    // The field itself owns the first Escape (covered in detail by
    // WorkspaceList.search.test.ts); MC must not see it as Cancel.
    expect(clearEscape.defaultPrevented).toBe(true)
    expect(hoisted.sendMcOp).not.toHaveBeenCalled()

    // Once the query is gone the field lets Escape through, so MC closes.
    ;(
      wrapper.findComponent(WorkspaceList).vm as unknown as { clearSearch: () => void }
    ).clearSearch()
    await nextTick()
    const clearedInput = wrapper.find('.mc-ws-search-input')
    expect((clearedInput.element as HTMLInputElement).value).toBe('')
    clearedInput.element.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    )

    expect(hoisted.sendMcOp).toHaveBeenCalledWith({ kind: 'cancel' })
  })

  it('jumps to the chosen workspace, closes the sheet, and records it as recent', async () => {
    const wrapper = mountOverview()
    await wrapper.find('.mc-mobile-ws-current').trigger('click')

    wrapper.findComponent(WorkspacePickerSheet).vm.$emit('select', 'beta')
    await nextTick()

    expect(hoisted.sendMcOp).toHaveBeenCalledWith({ kind: 'jump', workspace_id: 'beta' })
    expect(wrapper.findComponent(WorkspacePickerSheet).props('visible')).toBe(false)
    expect(JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]')).toEqual(['beta'])
  })

  it('follows the broadcast selection into the header', async () => {
    const wrapper = mountOverview()
    await wrapper.find('.mc-mobile-ws-current').trigger('click')
    wrapper.findComponent(WorkspacePickerSheet).vm.$emit('select', 'beta')
    await nextTick()

    // The backend broadcast is what actually moves the selection.
    hoisted.mc.selectedWorkspaceId = 'beta'
    await nextTick()

    expect(wrapper.find('.mc-mobile-ws-current .mc-mobile-ws-name').text()).toBe('Beta')
  })
})
