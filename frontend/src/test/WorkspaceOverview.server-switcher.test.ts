import { beforeEach, describe, expect, it, vi } from 'vitest'
import { h } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { mount } from '@vue/test-utils'

// The picker itself lives in the status bar, and that is where it is covered
// (StatusBar.serverChip.test.ts). Mission Control only *drives* it - the `s`
// binding, the keyboard gate while it is up, and the disconnected panel - so
// the shared open bit is mocked here and the assertions are about that wiring.
vi.mock('motion-v', () => {
  // `inheritAttrs: false` would drop `.mc-backdrop` / `.mc-ws-dual` onto the
  // stub as attrs instead of rendered attributes, and the class is how these
  // tests address the overlay. Render a plain element carrying both attrs and
  // listeners so `trigger('keydown')` reaches the component's own handler.
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
      // Declared so the child's own `<AnimatePresence mode="wait">` does not
      // warn about a non-prop attribute on a fragment root.
      props: ['mode'],
      setup(_props: any, { slots }: any) {
        return () => slots.default?.()
      },
    },
  }
})

const hoisted = vi.hoisted(() => ({
  sendMcOp: vi.fn(),
  toggleServerPicker: vi.fn(),
  closeServerPicker: vi.fn(),
}))

vi.mock('../composables/useMissionControlState', () => ({
  useMissionControlState: () => ({
    open: true,
    selectedWorkspaceId: null,
    selectedTabId: null,
    selectedTabTitle: null,
  }),
  sendMcOp: hoisted.sendMcOp,
}))

// Faithful enough to be worth asserting on: the two functions really do move
// the open bit, so the gate can be tested by observing it rather than only by
// counting calls.
vi.mock('../composables/useAppCore', async () => {
  const { ref } = await import('vue')
  const serverPickerOpen = ref(false)
  hoisted.toggleServerPicker.mockImplementation(() => {
    serverPickerOpen.value = !serverPickerOpen.value
  })
  hoisted.closeServerPicker.mockImplementation(() => {
    serverPickerOpen.value = false
  })
  return {
    serverPickerOpen,
    toggleServerPicker: hoisted.toggleServerPicker,
    closeServerPicker: hoisted.closeServerPicker,
  }
})

import WorkspaceOverview from '../components/overview/WorkspaceOverview.vue'
import { serverPickerOpen } from '../composables/useAppCore'
import { useUiStore } from '../stores/uiStore'

function mountOverview(connected = true) {
  // The store defaults to disconnected, which swaps the grid for the offline
  // panel. Most cases here are about the connected overlay.
  useUiStore().syncConnected = connected
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

async function pressKey(wrapper: any, key: string, init: Record<string, unknown> = {}) {
  // The close button is inside the overlay - so the document listener's
  // containment check passes - and nothing in this component stops the event
  // before the container sees it.
  await wrapper.find('.mc-close-btn').trigger('keydown', { key, ...init })
}

beforeEach(() => {
  vi.clearAllMocks()
  setActivePinia(createPinia())
  serverPickerOpen.value = false
})

describe('WorkspaceOverview server picker wiring', () => {
  it('opens the status-bar picker on `s`', async () => {
    const wrapper = mountOverview()
    await pressKey(wrapper, 's')

    expect(hoisted.toggleServerPicker).toHaveBeenCalledTimes(1)
    expect(serverPickerOpen.value).toBe(true)
    // Device-level local view state, deliberately not an McOp: the roster and
    // the active server belong to this device, not to the server's own
    // MissionControlState.
    expect(hoisted.sendMcOp).not.toHaveBeenCalled()
  })

  it('ignores `s` with a modifier so the browser keeps its own shortcut', async () => {
    const wrapper = mountOverview()
    await pressKey(wrapper, 's', { metaKey: true })

    expect(hoisted.toggleServerPicker).not.toHaveBeenCalled()
    expect(serverPickerOpen.value).toBe(false)
  })

  it('closes the picker on `s` rather than re-opening it', async () => {
    const wrapper = mountOverview()
    await pressKey(wrapper, 's')
    expect(serverPickerOpen.value).toBe(true)

    // The container handler runs on the way up past the picker, and with the
    // picker up it owns `s` instead of toggling it again.
    await pressKey(wrapper, 's')

    expect(hoisted.closeServerPicker).toHaveBeenCalledTimes(1)
    expect(hoisted.toggleServerPicker).toHaveBeenCalledTimes(1)
    expect(serverPickerOpen.value).toBe(false)
  })

  it('does not turn Escape into the MC Cancel op while the picker is open', async () => {
    const wrapper = mountOverview()
    await pressKey(wrapper, 's')

    await pressKey(wrapper, 'Escape')

    // Cancel is a server-side op; sending it would close MC for every client.
    expect(hoisted.sendMcOp).not.toHaveBeenCalled()
    expect(serverPickerOpen.value).toBe(false)
  })

  it('still sends Cancel on Escape when the picker is closed', async () => {
    const wrapper = mountOverview()
    await pressKey(wrapper, 'Escape')

    expect(hoisted.sendMcOp).toHaveBeenCalledWith({ kind: 'cancel' })
  })

  // Up/Down/Enter would otherwise also drive workspace and tab navigation -
  // the picker's own handler is on `window`, so it only runs after this one.
  it.each(['ArrowUp', 'ArrowDown', 'Enter'])(
    'swallows %s while the picker is open',
    async (key) => {
      const wrapper = mountOverview()
      await pressKey(wrapper, 's')

      await pressKey(wrapper, key)

      expect(hoisted.sendMcOp).not.toHaveBeenCalled()
      expect(serverPickerOpen.value).toBe(true)
    }
  )

  it('leaves the workspace grid alone when the picker is closed', async () => {
    const wrapper = mountOverview()
    await pressKey(wrapper, 'ArrowDown')

    expect(hoisted.sendMcOp).toHaveBeenCalledWith({ kind: 'navigate', dir: 'down' })
  })

  it('replaces the tab grid with the disconnected panel and a switch entry', async () => {
    const wrapper = mountOverview(false)
    await wrapper.vm.$nextTick()

    expect(wrapper.find('.mc-offline').exists()).toBe(true)
    expect(wrapper.find('.mc-offline-btn').exists()).toBe(true)
    // The workspace grid is meaningless without the socket that drives its
    // selection, so it goes too - the picker is the way out.
    expect(wrapper.find('.mc-ws-list').exists()).toBe(false)
    expect(wrapper.find('.mc-grid').exists()).toBe(false)
  })

  it('opens the picker from the disconnected panel', async () => {
    const wrapper = mountOverview(false)
    await wrapper.vm.$nextTick()

    await wrapper.find('.mc-offline-btn').trigger('click')

    expect(hoisted.toggleServerPicker).toHaveBeenCalledTimes(1)
    expect(serverPickerOpen.value).toBe(true)
  })

  it('restores the grid once the sync socket is back', async () => {
    const wrapper = mountOverview(false)
    const ui = useUiStore()
    expect(wrapper.find('.mc-offline').exists()).toBe(true)

    ui.syncConnected = true
    await wrapper.vm.$nextTick()

    expect(wrapper.find('.mc-offline').exists()).toBe(false)
    expect(wrapper.find('.mc-ws-list').exists()).toBe(true)
  })

  // The server manager is a BaseDialog, which teleports to <body> and so lands
  // outside `.mc-backdrop`. That is what lets it sit over Mission Control
  // without MC acting on every keystroke aimed at it - Escape above all, which
  // would otherwise become a Cancel op and close the whole overlay.
  it('ignores keys aimed outside the overlay, where a teleported dialog lives', async () => {
    mountOverview()
    const outside = document.createElement('input')
    document.body.appendChild(outside)
    try {
      for (const key of ['Escape', 'n', 's', 'ArrowDown']) {
        outside.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }))
      }
      await new Promise((resolve) => setTimeout(resolve, 0))

      expect(hoisted.sendMcOp).not.toHaveBeenCalled()
      expect(hoisted.toggleServerPicker).not.toHaveBeenCalled()
    } finally {
      outside.remove()
    }
  })
})
