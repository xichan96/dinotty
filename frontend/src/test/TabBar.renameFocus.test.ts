import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { nextTick } from 'vue'

vi.mock('../composables/useTransport', () => ({
  isTauri: () => false,
}))

vi.mock('vue-toastification', () => ({
  useToast: () => ({ info: vi.fn(), error: vi.fn(), warning: vi.fn(), success: vi.fn() }),
  POSITION: { TOP_RIGHT: 'top-right' },
}))

import TabBar from '../components/terminal/TabBar.vue'
import { useSessionStore } from '../stores/sessionStore'
import { FOCUS_ACTIVE_KEY } from '../composables/useFocusActive'
import { TAB_TITLE_INPUT_CLASS } from '../utils/renameFocusGuard'
import type { TerminalTab } from '../types/pane'

function terminalTab(): TerminalTab {
  return {
    type: 'terminal',
    paneId: 'tab-1',
    layout: { type: 'leaf', paneId: 'pane-1', title: 'Terminal', ratio: 1, zoomed: false },
    activePaneId: 'pane-1',
    paneMru: ['pane-1'],
    broadcastMode: false,
    broadcastActivity: 0,
  }
}

function mountWith(focusActive: () => void) {
  const store = useSessionStore()
  store.tabs.push(terminalTab())
  return mount(TabBar, {
    attachTo: document.body,
    props: { tabs: store.tabList, activePaneId: 'tab-1' },
    global: { provide: { [FOCUS_ACTIVE_KEY]: focusActive } },
  })
}

async function openRenameEditor(wrapper: ReturnType<typeof mountWith>) {
  await wrapper.find('.tab-title').trigger('dblclick')
  await nextTick()
  await nextTick()
  const input = wrapper.find(`input.${TAB_TITLE_INPUT_CLASS}`)
  expect(input.exists()).toBe(true)
  expect(document.activeElement).toBe(input.element)
  return input
}

describe('TabBar rename editor focus', () => {
  let wrapper: ReturnType<typeof mountWith> | undefined

  beforeEach(() => {
    setActivePinia(createPinia())
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

  it('hands focus back to the active pane after Enter', async () => {
    const focusActive = vi.fn()
    wrapper = mountWith(focusActive)
    const input = await openRenameEditor(wrapper)

    await input.trigger('keydown', { key: 'Enter' })
    await nextTick()
    await nextTick()

    expect(wrapper.find(`input.${TAB_TITLE_INPUT_CLASS}`).exists()).toBe(false)
    expect(focusActive).toHaveBeenCalledTimes(1)
  })

  it('hands focus back to the active pane after Escape', async () => {
    const focusActive = vi.fn()
    wrapper = mountWith(focusActive)
    const input = await openRenameEditor(wrapper)

    await input.trigger('keydown', { key: 'Escape' })
    await nextTick()
    await nextTick()

    expect(wrapper.find(`input.${TAB_TITLE_INPUT_CLASS}`).exists()).toBe(false)
    expect(focusActive).toHaveBeenCalledTimes(1)
  })

  it('does not steal focus when the editor is closed by a blur', async () => {
    const focusActive = vi.fn()
    wrapper = mountWith(focusActive)
    const input = await openRenameEditor(wrapper)

    await input.trigger('blur')
    await nextTick()

    // The click that caused the blur decides where focus goes; the tab bar
    // must not drag it back to the terminal.
    expect(focusActive).not.toHaveBeenCalled()
  })
})
