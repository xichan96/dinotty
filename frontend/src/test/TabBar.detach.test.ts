import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { nextTick } from 'vue'

const mocks = vi.hoisted(() => ({
  tauri: true,
}))

vi.mock('../composables/useTransport', () => ({
  isTauri: () => mocks.tauri,
}))

vi.mock('vue-toastification', () => ({
  useToast: () => ({ info: vi.fn(), error: vi.fn(), warning: vi.fn(), success: vi.fn() }),
  POSITION: { TOP_RIGHT: 'top-right' },
}))

import TabBar from '../components/terminal/TabBar.vue'
import type { TabInfo } from '../components/terminal/TabBar.vue'
import { useSessionStore } from '../stores/sessionStore'
import { t } from '../composables/useI18n'
import type { PaneKind, TerminalTab } from '../types/pane'

function terminalTabWithLeaves(kinds: PaneKind[]): TerminalTab {
  const children = kinds.map((kind, i) => ({
    type: 'leaf' as const,
    kind,
    paneId: `leaf-${i}`,
    title: kind,
    ratio: 1 / kinds.length,
    zoomed: false,
  }))
  return {
    type: 'terminal',
    paneId: 'tab-1',
    layout: {
      type: 'split',
      id: 's-1',
      direction: 'horizontal',
      children,
      ratios: kinds.map(() => 1 / kinds.length),
    },
    activePaneId: children[0].paneId,
    paneMru: children.map((leaf) => leaf.paneId),
    broadcastMode: false,
    broadcastActivity: 0,
  }
}

function mountWith(info: TabInfo) {
  return mount(TabBar, {
    attachTo: document.body,
    props: { tabs: [info], activePaneId: info.paneId },
  })
}

function menuLabels(): string[] {
  return Array.from(document.body.querySelectorAll('.ctx-item')).map(
    (item) => item.textContent?.trim() ?? ''
  )
}

describe('TabBar detach entry gating', () => {
  let wrapper: ReturnType<typeof mountWith> | undefined

  beforeEach(() => {
    mocks.tauri = true
    setActivePinia(createPinia())
    // jsdom/happy-dom have no hit-testing; the drag only needs an empty list.
    Object.defineProperty(document, 'elementsFromPoint', {
      value: () => [],
      configurable: true,
    })
  })

  afterEach(() => {
    wrapper?.unmount()
    wrapper = undefined
    document.body.replaceChildren()
  })

  async function openContextMenu(info: TabInfo) {
    wrapper = mountWith(info)
    await wrapper.find('.tab').trigger('contextmenu')
    await nextTick()
  }

  it('offers detach when a terminal-typed tab contains a terminal leaf', async () => {
    const store = useSessionStore()
    store.tabs.push(terminalTabWithLeaves(['files', 'terminal']))
    const info = store.tabList[0]
    expect(info.hasTerminalLeaf).toBe(true)

    await openContextMenu(info)

    expect(menuLabels()).toContain(t('tab.detachToWindow'))
  })

  it('offers detach when a terminal-typed tab has only non-terminal leaves', async () => {
    const store = useSessionStore()
    store.tabs.push(terminalTabWithLeaves(['files', 'web', 'plugin']))
    const info = store.tabList[0]
    expect(info.hasTerminalLeaf).toBe(false)

    await openContextMenu(info)

    expect(menuLabels()).toContain(t('tab.detachToWindow'))
  })

  async function dragTabOutside(): Promise<void> {
    const tab = wrapper!.find('.tab')
    await tab.trigger('mousedown', { button: 0 })
    // First move clears the drag threshold, second leaves the viewport.
    window.dispatchEvent(
      new MouseEvent('mousemove', { bubbles: true, clientX: 50, clientY: 50, buttons: 1 })
    )
    window.dispatchEvent(
      new MouseEvent('mousemove', { bubbles: true, clientX: 5000, clientY: 50, buttons: 1 })
    )
    window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: 5000, clientY: 50 }))
    await nextTick()
  }

  it('tears a terminal tab off when dragged outside the desktop window', async () => {
    const store = useSessionStore()
    store.tabs.push(terminalTabWithLeaves(['terminal']))
    wrapper = mountWith(store.tabList[0])

    await dragTabOutside()

    expect(wrapper.emitted('detach-to-window')).toEqual([['tab-1']])
  })

  it('does not tear tabs off in a web or mobile browser', async () => {
    // Mobile/web have no native window to open, so the gesture must stay inert
    // and must not light up the detach hint.
    mocks.tauri = false
    const store = useSessionStore()
    store.tabs.push(terminalTabWithLeaves(['terminal']))
    wrapper = mountWith(store.tabList[0])

    await dragTabOutside()

    expect(wrapper.emitted('detach-to-window')).toBeUndefined()
  })
})
