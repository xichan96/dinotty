import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { mount } from '@vue/test-utils'

// Stub motion-v - its animation machinery is irrelevant for rendering assertions
// and can misbehave in happy-dom.
vi.mock('motion-v', () => ({
  Motion: {
    name: 'Motion',
    inheritAttrs: false,
    setup(_props: any, { slots }: any) {
      return () => slots.default?.()
    },
  },
  AnimatePresence: {
    name: 'AnimatePresence',
    setup(_props: any, { slots }: any) {
      return () => slots.default?.()
    },
  },
}))

import TabOverview from '../components/overview/TabOverview.vue'
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

function mountOverview(props: Partial<InstanceType<typeof TabOverview>['$props']> = {}) {
  return mount(TabOverview, {
    props: {
      visible: true,
      cards: [makeCard()],
      activePaneId: 'tab-1',
      embedded: true,
      indicators: {},
      ...props,
    } as any,
  })
}

beforeEach(() => {
  setActivePinia(createPinia())
})

describe('TabOverview - notification dot rendering', () => {
  it('does not render a dot when indicators is empty', () => {
    const wrapper = mountOverview({ indicators: {} })
    expect(wrapper.findAll('.mc-notif-dot')).toHaveLength(0)
  })

  it('does not render a dot when card.paneId has no entry', () => {
    const wrapper = mountOverview({ indicators: { 'other-tab': 'warning' } })
    expect(wrapper.findAll('.mc-notif-dot')).toHaveLength(0)
  })

  it('renders a dot with warning class when indicators[paneId] = warning', () => {
    const wrapper = mountOverview({ indicators: { 'tab-1': 'warning' } })
    const dots = wrapper.findAll('.mc-notif-dot')
    expect(dots).toHaveLength(1)
    expect(dots[0].classes()).toContain('dot-warning')
  })

  it('renders urgent dot with urgent class', () => {
    const wrapper = mountOverview({ indicators: { 'tab-1': 'urgent' } })
    const dots = wrapper.findAll('.mc-notif-dot')
    expect(dots).toHaveLength(1)
    expect(dots[0].classes()).toContain('dot-urgent')
  })

  it('renders dots only for cards that have indicators (mixed scenario)', () => {
    const cards = [
      makeCard({ paneId: 'tab-1', index: 1 }),
      makeCard({ paneId: 'tab-2', index: 2 }),
      makeCard({ paneId: 'tab-3', index: 3 }),
    ]
    const wrapper = mountOverview({
      cards,
      indicators: { 'tab-2': 'error' },
    })
    const dots = wrapper.findAll('.mc-notif-dot')
    expect(dots).toHaveLength(1)
    expect(dots[0].classes()).toContain('dot-error')
  })

  it('places the dot inside the card header (after title, before close button)', () => {
    const wrapper = mountOverview({ indicators: { 'tab-1': 'info' } })
    const header = wrapper.find('.mc-card-header')
    expect(header.exists()).toBe(true)
    const dot = header.find('.mc-notif-dot')
    expect(dot.exists()).toBe(true)
    // Dot should come after the title element and before the close button
    const children = header.element.children
    const classes = Array.from(children).map((c) => (c as HTMLElement).className)
    const titleIdx = classes.findIndex((c) => c.includes('mc-card-title'))
    const dotIdx = classes.findIndex((c) => c.includes('mc-notif-dot'))
    const closeIdx = classes.findIndex((c) => c.includes('mc-card-close'))
    expect(titleIdx).toBeGreaterThanOrEqual(0)
    expect(dotIdx).toBeGreaterThan(titleIdx)
    expect(closeIdx).toBeGreaterThan(dotIdx)
  })
})
