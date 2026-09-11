import { ref } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { usePaneDrag } from '../paneDragContext'
import { useTabDrag } from '../useTabDrag'

function mouse(type: string, target: EventTarget, options: MouseEventInit = {}) {
  const event = new MouseEvent(type, { bubbles: true, ...options })
  Object.defineProperty(event, 'target', { value: target })
  return event
}

function createTab(paneId: string) {
  const tab = document.createElement('div')
  tab.className = 'tab'
  tab.dataset.paneId = paneId
  document.body.appendChild(tab)
  return tab
}

describe('useTabDrag click fallback', () => {
  afterEach(() => {
    document.body.replaceChildren()
  })

  it('activates a source tab on mouseup when a title update suppresses click', () => {
    const activate = vi.fn()
    const tab = createTab('pane-1')
    const title = document.createElement('span')
    title.className = 'tab-title'
    tab.appendChild(title)
    const state = useTabDrag({
      drag: usePaneDrag(),
      activePaneId: ref('pane-2'),
      findTabElement: () => undefined,
      onActivate: activate,
      onReorder: vi.fn(),
      onMergeTabIntoPane: vi.fn(),
    })

    state.onTabMouseDown(mouse('mousedown', title, { button: 0 }), 'pane-1')

    // Simulate Vue replacing the OSC-updated title node before mouseup. WebKit
    // can then omit click entirely, so only the window mouseup reaches us.
    title.replaceWith(document.createElement('span'))
    window.dispatchEvent(mouse('mouseup', tab, { button: 0 }))

    expect(activate).toHaveBeenCalledTimes(1)
    expect(activate).toHaveBeenCalledWith('pane-1')
  })

  it('consumes the native click after the mouseup fallback activates the tab', () => {
    const activate = vi.fn()
    const tab = createTab('pane-1')
    const state = useTabDrag({
      drag: usePaneDrag(),
      activePaneId: ref('pane-2'),
      findTabElement: () => undefined,
      onActivate: activate,
      onReorder: vi.fn(),
      onMergeTabIntoPane: vi.fn(),
    })

    state.onTabMouseDown(mouse('mousedown', tab, { button: 0 }), 'pane-1')
    window.dispatchEvent(mouse('mouseup', tab, { button: 0 }))
    state.onTabClick(mouse('click', tab), 'pane-1')

    expect(activate).toHaveBeenCalledTimes(1)
  })

  it('does not activate a tab when mouseup is on its close button', () => {
    const activate = vi.fn()
    const tab = createTab('pane-1')
    const close = document.createElement('button')
    tab.appendChild(close)
    const state = useTabDrag({
      drag: usePaneDrag(),
      activePaneId: ref('pane-2'),
      findTabElement: () => undefined,
      onActivate: activate,
      onReorder: vi.fn(),
      onMergeTabIntoPane: vi.fn(),
    })

    state.onTabMouseDown(mouse('mousedown', close, { button: 0 }), 'pane-1')
    window.dispatchEvent(mouse('mouseup', close, { button: 0 }))

    expect(activate).not.toHaveBeenCalled()
  })
})
