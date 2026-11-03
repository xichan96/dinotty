import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { nextTick } from 'vue'

vi.mock('../composables/useTransport', () => ({
  isTauri: () => true,
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
    setActivePinia(createPinia())
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

  it('hides detach when a terminal-typed tab has only non-terminal leaves', async () => {
    const store = useSessionStore()
    store.tabs.push(terminalTabWithLeaves(['files', 'web', 'plugin']))
    const info = store.tabList[0]
    expect(info.hasTerminalLeaf).toBe(false)

    await openContextMenu(info)

    expect(menuLabels()).not.toContain(t('tab.detachToWindow'))
  })
})
