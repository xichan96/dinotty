import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import PaneHeader from '../components/split/PaneHeader.vue'
import { usePaneDrag } from '../composables/paneDragContext'

function mouse(type: string, target: EventTarget, options: MouseEventInit = {}) {
  const event = new MouseEvent(type, { bubbles: true, ...options })
  Object.defineProperty(event, 'target', { value: target })
  return event
}

function mountHeader(props: { canDetach?: boolean } = {}) {
  return mount(PaneHeader, {
    props: {
      paneId: 'pane-1',
      tabId: 'tab-1',
      title: 'Terminal',
      isActive: true,
      ...props,
    },
    attachTo: document.body,
  })
}

function startDrag(wrapper: ReturnType<typeof mountHeader>): void {
  const header = wrapper.get('.pane-header').element
  void wrapper.get('.pane-header').trigger('mousedown', { button: 0 })
  window.dispatchEvent(mouse('mousemove', header, { clientX: 50, clientY: 50, buttons: 1 }))
}

describe('PaneHeader detach outside the window', () => {
  let mounted: ReturnType<typeof mountHeader> | null = null

  beforeEach(() => {
    // jsdom has no hit-testing; the drag only needs an empty element list.
    Object.defineProperty(document, 'elementsFromPoint', {
      value: () => [],
      configurable: true,
    })
  })

  afterEach(() => {
    mounted?.unmount()
    mounted = null
    usePaneDrag().endDrag()
    document.body.replaceChildren()
    vi.useRealTimers()
  })

  it('opens the pane in a new window when released outside the viewport', () => {
    mounted = mountHeader({ canDetach: true })
    startDrag(mounted)

    window.dispatchEvent(mouse('mouseup', document, { clientX: 5000, clientY: 50 }))

    expect(mounted.emitted('detach')).toHaveLength(1)
  })

  it('does not detach when released inside the window', () => {
    mounted = mountHeader({ canDetach: true })
    startDrag(mounted)

    window.dispatchEvent(mouse('mouseup', document, { clientX: 500, clientY: 300 }))

    expect(mounted.emitted('detach')).toBeUndefined()
  })

  it('keeps reordering when the pane cannot be detached', () => {
    mounted = mountHeader({ canDetach: false })
    startDrag(mounted)

    document.dispatchEvent(mouse('mouseleave', document))
    expect(usePaneDrag().state.outsideWindow).toBe(false)
    window.dispatchEvent(mouse('mouseup', document, { clientX: 5000, clientY: 50 }))

    expect(mounted.emitted('detach')).toBeUndefined()
  })

  it('arms the outside-window hint and falls back to a timer when mouseup is lost', () => {
    vi.useFakeTimers()
    mounted = mountHeader({ canDetach: true })
    startDrag(mounted)

    document.dispatchEvent(mouse('mouseleave', document))
    expect(usePaneDrag().state.outsideWindow).toBe(true)

    vi.advanceTimersByTime(600)
    expect(mounted.emitted('detach')).toHaveLength(1)
  })
})
