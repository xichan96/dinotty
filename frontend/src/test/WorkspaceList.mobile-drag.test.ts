import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { mount } from '@vue/test-utils'
import WorkspaceList from '../components/overview/WorkspaceList.vue'
import type { Workspace } from '../types/workspace'

// The drag gate consults window.matchMedia('(max-width: 600px)').matches at
// gesture start; control it per-test instead of relying on happy-dom's
// viewport (useIsMobile also reads matchMedia but only .matches — safe to
// funnel through the same stub).
const mediaMatches: Record<string, boolean> = {}

beforeEach(() => {
  // happy-dom has no elementsFromPoint; returning [] leaves dragOver null,
  // which is fine — the assertions only care that dragging armed/started.
  document.elementsFromPoint = () => []
  vi.spyOn(window, 'matchMedia').mockImplementation((query: string) => {
    const mql = {
      matches: mediaMatches[query] ?? false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }
    return mql as unknown as MediaQueryList
  })
})

afterEach(() => {
  vi.restoreAllMocks()
  for (const k of Object.keys(mediaMatches)) delete mediaMatches[k]
})

function makeWorkspaces(): Workspace[] {
  return [
    { id: 'ws-1', name: 'Alpha', path: '/alpha', order: 0 },
    { id: 'ws-2', name: 'Beta', path: '/beta', order: 1 },
  ]
}

function mountList() {
  return mount(WorkspaceList, {
    props: {
      workspaces: makeWorkspaces(),
      selectedId: 'ws-1',
      activeId: null,
      tabCounts: {},
      defaultCount: 0,
    },
  })
}

function fireTouchmove(clientX: number, clientY: number) {
  const evt = new Event('touchmove', { cancelable: true }) as TouchEvent
  Object.assign(evt, { touches: [{ clientX, clientY }] })
  const preventDefault = vi.spyOn(evt, 'preventDefault')
  window.dispatchEvent(evt)
  return preventDefault
}

describe('WorkspaceList - mobile drag gate (≤600px chip row)', () => {
  it('does not arm drag on touch when viewport is narrow', async () => {
    mediaMatches['(max-width: 600px)'] = true
    const wrapper = mountList()

    const item = wrapper.find('[data-workspace-id="ws-2"]')
    await item.trigger('touchstart', { touches: [{ clientX: 100, clientY: 50 }] })

    // startDrag bailed before any side effect: no userSelect mutation...
    expect(document.body.style.userSelect).toBe('')
    // ...and the window touchmove listener was never registered, so a swipe
    // past the 5px threshold neither drags nor preventDefaults.
    const preventDefault = fireTouchmove(140, 52)
    expect(wrapper.find('.mc-ws-list-item.dragging').exists()).toBe(false)
    expect(preventDefault).not.toHaveBeenCalled()
  })

  it('still emits select on tap in narrow viewport', async () => {
    mediaMatches['(max-width: 600px)'] = true
    const wrapper = mountList()

    await wrapper.find('[data-workspace-id="ws-2"]').trigger('click')
    expect(wrapper.emitted('select')).toEqual([['ws-2']])
  })

  it('keeps drag armed on wide viewports (desktop regression guard)', async () => {
    const wrapper = mountList()

    const item = wrapper.find('[data-workspace-id="ws-2"]')
    await item.trigger('touchstart', { touches: [{ clientX: 100, clientY: 50 }] })
    expect(document.body.style.userSelect).toBe('none')

    const preventDefault = fireTouchmove(140, 52)
    await nextTick()
    expect(wrapper.find('.mc-ws-list-item.dragging').exists()).toBe(true)
    expect(preventDefault).toHaveBeenCalled()

    window.dispatchEvent(new Event('touchend'))
    expect(document.body.style.userSelect).toBe('')
  })
})
