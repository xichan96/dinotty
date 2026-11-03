import { ref } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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

describe('useTabDrag detach outside the window', () => {
  const disposers: Array<() => void> = []

  beforeEach(() => {
    // jsdom has no hit-testing; the drag only needs an empty element list.
    Object.defineProperty(document, 'elementsFromPoint', {
      value: () => [],
      configurable: true,
    })
  })

  afterEach(() => {
    // A test that stops mid-gesture leaves global listeners behind; tear them
    // down so they cannot mutate the shared drag state in the next test.
    for (const dispose of disposers.splice(0)) dispose()
    document.body.replaceChildren()
    vi.useRealTimers()
  })

  function setup(overrides: { canDetachTab?: (tabId: string) => boolean } = {}) {
    const onDetach = vi.fn()
    const onReorder = vi.fn()
    const onMergeTabIntoPane = vi.fn()
    const state = useTabDrag({
      drag: usePaneDrag(),
      activePaneId: ref('pane-2'),
      findTabElement: () => undefined,
      onActivate: vi.fn(),
      onReorder,
      onMergeTabIntoPane,
      onDetach,
      ...overrides,
    })
    disposers.push(state.cleanup)
    return { state, onDetach, onReorder, onMergeTabIntoPane }
  }

  function startDrag(state: ReturnType<typeof useTabDrag>, tab: HTMLElement): void {
    state.onTabMouseDown(mouse('mousedown', tab, { button: 0 }), 'pane-1')
    window.dispatchEvent(
      mouse('mousemove', document, { clientX: 50, clientY: 50, buttons: 1 })
    )
  }

  it('opens the tab in a new window when released outside the viewport', () => {
    const tab = createTab('pane-1')
    const { state, onDetach, onReorder, onMergeTabIntoPane } = setup()
    startDrag(state, tab)

    window.dispatchEvent(mouse('mouseup', document, { clientX: 5000, clientY: 50 }))

    expect(onDetach).toHaveBeenCalledWith('pane-1')
    expect(onReorder).not.toHaveBeenCalled()
    expect(onMergeTabIntoPane).not.toHaveBeenCalled()
  })

  it('does not detach when released inside the window', () => {
    const tab = createTab('pane-1')
    const { state, onDetach } = setup()
    startDrag(state, tab)

    window.dispatchEvent(mouse('mouseup', document, { clientX: 500, clientY: 300 }))

    expect(onDetach).not.toHaveBeenCalled()
  })

  it('falls back to a timer when the webview drops the outside mouseup', () => {
    vi.useFakeTimers()
    const tab = createTab('pane-1')
    const { state, onDetach } = setup()
    startDrag(state, tab)

    document.dispatchEvent(mouse('mouseleave', document))
    vi.advanceTimersByTime(600)

    expect(onDetach).toHaveBeenCalledWith('pane-1')
  })

  it('exposes the outside-window state for the detach hint', () => {
    vi.useFakeTimers()
    const tab = createTab('pane-1')
    const { state, onDetach } = setup()
    const drag = usePaneDrag()
    startDrag(state, tab)

    document.dispatchEvent(mouse('mouseleave', document))
    expect(drag.state.outsideWindow).toBe(true)

    window.dispatchEvent(
      mouse('mousemove', document, { clientX: 100, clientY: 100, buttons: 1 })
    )
    expect(drag.state.outsideWindow).toBe(false)
    expect(onDetach).not.toHaveBeenCalled()

    state.cleanup()
    expect(drag.state.outsideWindow).toBe(false)
  })

  it('cancels the outside timer when the pointer comes back', () => {
    vi.useFakeTimers()
    const tab = createTab('pane-1')
    const { state, onDetach } = setup()
    startDrag(state, tab)

    document.dispatchEvent(mouse('mouseleave', document))
    window.dispatchEvent(
      mouse('mousemove', document, { clientX: 100, clientY: 100, buttons: 1 })
    )
    vi.advanceTimersByTime(600)

    expect(onDetach).not.toHaveBeenCalled()
  })

  it('never arms the detach gesture when the tab cannot be detached', () => {
    // Mobile layouts and non-terminal tabs must not show the detach hint or
    // fire a window-open on release: they have no native window to open.
    vi.useFakeTimers()
    const tab = createTab('pane-1')
    const { state, onDetach } = setup({ canDetachTab: () => false })
    const drag = usePaneDrag()
    startDrag(state, tab)

    document.dispatchEvent(mouse('mouseleave', document))
    expect(drag.state.outsideWindow).toBe(false)

    window.dispatchEvent(
      mouse('mousemove', document, { clientX: 5000, clientY: 50, buttons: 1 })
    )
    expect(drag.state.outsideWindow).toBe(false)

    vi.advanceTimersByTime(600)
    expect(onDetach).not.toHaveBeenCalled()

    window.dispatchEvent(mouse('mouseup', document, { clientX: 5000, clientY: 50 }))
    expect(onDetach).not.toHaveBeenCalled()
  })
})
