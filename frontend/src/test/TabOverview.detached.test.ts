import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { h, nextTick } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { flushPromises, mount } from '@vue/test-utils'

// Render attrs (and therefore `@contextmenu` / classes) onto a real element;
// the notif-dot test's bare fragment stub cannot receive the card listeners.
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
  invoke: vi.fn(),
  uiConfirm: vi.fn(),
}))

vi.mock('../composables/useTransport', () => ({
  isTauri: () => true,
  tauriInvoke: hoisted.invoke,
}))

vi.mock('../composables/useConfirm', () => ({
  uiConfirm: hoisted.uiConfirm,
}))

import TabOverview from '../components/overview/TabOverview.vue'
import { useDetachedWindowsStore } from '../stores/detachedWindowsStore'
import { t } from '../composables/useI18n'
import type { TabCard } from '../composables/useTabPreview'

function makeCard(overrides: Partial<TabCard> = {}): TabCard {
  return {
    paneId: 'tab-1',
    index: 1,
    title: 'Terminal',
    type: 'terminal',
    previewImage: null,
    textContent: '',
    htmlContent: '$ ls -la',
    splitCount: 1,
    ...overrides,
  }
}

function mountOverview(props: Record<string, unknown> = {}) {
  return mount(TabOverview, {
    props: {
      visible: true,
      cards: [makeCard()],
      activePaneId: 'tab-1',
      embedded: true,
      indicators: {},
      ...props,
    } as any,
    attachTo: document.body,
  })
}

function menuButtons(): HTMLButtonElement[] {
  return Array.from(document.body.querySelectorAll<HTMLButtonElement>('.ctx-item'))
}

async function openCardMenu(wrapper: ReturnType<typeof mountOverview>) {
  await wrapper.find('.mc-card').trigger('contextmenu')
  await nextTick()
  return menuButtons()
}

beforeEach(() => {
  setActivePinia(createPinia())
  hoisted.invoke.mockReset()
  hoisted.uiConfirm.mockReset()
})

afterEach(() => {
  document.body.innerHTML = ''
})

describe('TabOverview - detached cards', () => {
  it('renders a labelled badge with the native window title', () => {
    const wrapper = mountOverview({
      cards: [makeCard({ detached: true, windowLabel: 'Agent build' })],
    })

    const badge = wrapper.find('.mc-detached-badge')
    expect(badge.exists()).toBe(true)
    // The label is real text, so the state never relies on colour alone.
    expect(badge.text()).toContain(t('tab.detachedBadge'))
    expect(badge.attributes('aria-label')).toBe(`${t('tab.detachedBadge')}: Agent build`)
    expect(badge.attributes('title')).toBe('Agent build')
  })

  it('does not render the badge for an ordinary card', () => {
    const wrapper = mountOverview()
    expect(wrapper.find('.mc-detached-badge').exists()).toBe(false)
  })

  it('shows the placeholder instead of attempting a buffer capture', () => {
    const wrapper = mountOverview({
      cards: [makeCard({ detached: true, htmlContent: '$ should-not-render' })],
    })

    const placeholder = wrapper.find('.mc-detached-preview')
    expect(placeholder.exists()).toBe(true)
    expect(placeholder.text()).toContain(t('detached.previewPlaceholder'))
    expect(wrapper.html()).not.toContain('should-not-render')
  })

  it('keeps the ordinary tab menu for non-detached cards', async () => {
    const wrapper = mountOverview()
    const buttons = await openCardMenu(wrapper)

    expect(buttons.map((b) => b.textContent?.trim())).toContain(t('palette.rename'))
    expect(buttons.map((b) => b.textContent?.trim())).not.toContain(t('detached.reattachToMain'))
  })

  it('offers focus, reattach and close-terminal for detached cards', async () => {
    const wrapper = mountOverview({ cards: [makeCard({ detached: true })] })
    const buttons = await openCardMenu(wrapper)

    expect(buttons.map((b) => b.textContent?.trim())).toEqual([
      t('detached.focusWindow'),
      t('detached.reattachToMain'),
      t('detached.closeTerminal'),
    ])
  })

  it('focuses by emitting activate, so the shared fallback still applies', async () => {
    const wrapper = mountOverview({ cards: [makeCard({ detached: true })] })
    const buttons = await openCardMenu(wrapper)

    buttons[0].click()
    await nextTick()

    expect(wrapper.emitted('activate')).toEqual([['tab-1']])
  })

  it('reattaches by closing the native window', async () => {
    hoisted.invoke.mockResolvedValue(undefined)
    const wrapper = mountOverview({ cards: [makeCard({ detached: true })] })
    const buttons = await openCardMenu(wrapper)

    buttons[1].click()
    await nextTick()

    expect(hoisted.invoke).toHaveBeenCalledWith('close_tab_window', { tabId: 'tab-1' })
  })

  it('confirms before closing the terminal for real', async () => {
    hoisted.uiConfirm.mockResolvedValue(true)
    const wrapper = mountOverview({ cards: [makeCard({ detached: true })] })
    const buttons = await openCardMenu(wrapper)

    buttons[2].click()
    await flushPromises()

    expect(hoisted.uiConfirm).toHaveBeenCalledWith(
      t('detached.closeTerminalConfirm'),
      expect.any(Object)
    )
    expect(wrapper.emitted('close-terminal')).toEqual([['tab-1']])
    expect(wrapper.emitted('close-tab')).toBeUndefined()
  })

  it('does not close the terminal when the confirmation is cancelled', async () => {
    hoisted.uiConfirm.mockResolvedValue(false)
    const wrapper = mountOverview({ cards: [makeCard({ detached: true })] })
    const buttons = await openCardMenu(wrapper)

    buttons[2].click()
    await flushPromises()

    expect(wrapper.emitted('close-terminal')).toBeUndefined()
  })

  it('still routes the card close button through the confirming close-tab path', async () => {
    const wrapper = mountOverview({ cards: [makeCard({ detached: true })] })

    await wrapper.find('.mc-card-close').trigger('click')

    expect(wrapper.emitted('close-tab')).toEqual([['tab-1']])
    expect(wrapper.emitted('close-terminal')).toBeUndefined()
  })
})

describe('detachedWindowsStore window info', () => {
  it('drops the title when a window is reported closed', async () => {
    const store = useDetachedWindowsStore()
    hoisted.invoke.mockResolvedValue([{ tab_id: 'tab-1', label: 'tab-tab-1', title: 'Agent' }])
    await store.refreshFromRust()

    expect(store.windowTitleOf('tab-1')).toBe('Agent')

    store.handleClosed('tab-1')
    expect(store.windowTitleOf('tab-1')).toBeNull()
  })
})
