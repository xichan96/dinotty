import { beforeEach, describe, expect, it, vi } from 'vitest'

const transportMocks = vi.hoisted(() => ({
  tauri: false,
}))

vi.mock('../composables/useTransport', () => ({
  isTauri: () => transportMocks.tauri,
  createTransport: vi.fn(),
  tauriInvoke: vi.fn(),
}))

import { TerminalInstance, setActivePaneId } from '../composables/useTerminal'
import { setupTerminalDrop } from '../composables/useTerminalDrop'

function eventWithData<T extends Event>(event: T, prop: string, value: unknown): T {
  Object.defineProperty(event, prop, { value })
  return event
}

describe('tree-row drop into terminal (active-pane guard regression)', () => {
  beforeEach(() => {
    transportMocks.tauri = false
    setActivePaneId(null)
  })

  it('drops the path when active pane is the file-workspace pane (regression)', () => {
    const term = new TerminalInstance('term-pane')
    const sendMock = vi.fn()
    ;(term as unknown as { _transport: unknown })._transport = { send: sendMock }

    // Simulate user mousedown on the file-workspace pane before dragging:
    // focusPane() sets _activePaneId to the file-workspace pane id.
    setActivePaneId('files-pane')

    const wrapper = document.createElement('div')
    const xterm = document.createElement('div')
    xterm.className = 'xterm'
    wrapper.appendChild(xterm)
    setupTerminalDrop(wrapper, {
      sendData: (d, force) => term.sendData(d, force),
      onFileUpload: (files) => term.onFileUpload?.(files),
    })

    const dt: any = {
      files: [],
      types: ['application/x-tree-move', 'text/plain'],
      getData: (type: string) =>
        type === 'application/x-tree-move'
          ? 'frontend/src/App.vue'
          : type === 'text/plain'
            ? '/Users/me/dinotty/frontend/src/App.vue'
            : '',
    }
    const drop = eventWithData(
      new Event('drop', { bubbles: true, cancelable: true }),
      'dataTransfer',
      dt
    )
    xterm.dispatchEvent(drop)

    expect(sendMock).toHaveBeenCalledWith({
      type: 'input',
      data: '/Users/me/dinotty/frontend/src/App.vue',
    })
  })
})
