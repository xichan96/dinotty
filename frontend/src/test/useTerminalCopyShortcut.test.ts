import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Ctrl+C in the terminal must copy through the same helper as the context menu
// (async Clipboard API + execCommand fallback). A raw `navigator.clipboard.writeText`
// call silently copies nothing when the API is missing (plain-http origin) or
// rejects (webview "Document is not focused"), which left the previous clipboard
// content in place while the keydown had already called preventDefault.

const mocks = vi.hoisted(() => ({
  instances: [] as any[],
  selection: 'selected terminal text',
}))

vi.mock('@xterm/xterm', () => ({
  Terminal: class {
    options: Record<string, any>
    unicode = { activeVersion: '' }
    parser = {
      handlers: {} as Record<number, (data: string) => boolean>,
      registerOscHandler(this: any, id: number, cb: (data: string) => boolean) {
        this.handlers[id] = cb
      },
    }
    buffer = { active: { getLine: () => null, cursorY: 0, cursorX: 0 } }
    keyHandler: ((event: KeyboardEvent) => boolean) | null = null
    paste = vi.fn()
    constructor(options: Record<string, any>) {
      this.options = { ...options }
      mocks.instances.push(this)
    }
    loadAddon() {}
    open(wrapper: HTMLElement) {
      const el = document.createElement('div')
      el.className = 'xterm'
      wrapper.appendChild(el)
      const textarea = document.createElement('textarea')
      textarea.className = 'xterm-helper-textarea'
      wrapper.appendChild(textarea)
    }
    attachCustomKeyEventHandler(handler: (event: KeyboardEvent) => boolean) {
      this.keyHandler = handler
    }
    registerLinkProvider() {}
    onTitleChange() {}
    onData() {}
    hasSelection() {
      return true
    }
    getSelection() {
      return mocks.selection
    }
    dispose() {}
    focus() {}
    blur() {}
  },
}))
vi.mock('@xterm/addon-fit', () => ({
  FitAddon: class {
    fit = vi.fn()
  },
}))
vi.mock('@xterm/addon-unicode11', () => ({ Unicode11Addon: class {} }))
vi.mock('@xterm/addon-webgl', () => ({
  WebglAddon: class {
    onContextLoss() {}
    dispose() {}
  },
}))
vi.mock('@xterm/addon-search', () => ({ SearchAddon: class {} }))
vi.mock('../composables/useTransport', () => ({
  isTauri: () => false,
  createTransport: () => ({
    onConnect() {},
    onMessage() {},
    onDisconnect() {},
    connect() {},
    disconnect() {},
    send() {},
  }),
}))
vi.mock('../utils/clientPlatform', () => ({
  hostTarget: () => 'windows-x86_64',
  isWindowsClient: true,
  isMacClient: false,
}))
vi.mock('../composables/useTerminalWheel', () => ({
  createTerminalWheel: () => ({
    setup: vi.fn(),
    cleanup: vi.fn(),
    sendWheelEvent: vi.fn(),
    isBypassActive: () => false,
  }),
}))

import { TerminalInstance } from '../composables/useTerminal'

class MemoryStorage implements Storage {
  private data = new Map<string, string>()
  get length() {
    return this.data.size
  }
  clear() {
    this.data.clear()
  }
  getItem(key: string) {
    return this.data.get(key) ?? null
  }
  key(index: number) {
    return [...this.data.keys()][index] ?? null
  }
  removeItem(key: string) {
    this.data.delete(key)
  }
  setItem(key: string, value: string) {
    this.data.set(key, String(value))
  }
}

function attach() {
  const term = new TerminalInstance('p1')
  vi.spyOn(term as any, '_scheduleSettleResize').mockImplementation(() => {})
  vi.spyOn(term as any, '_refit').mockImplementation(() => {})
  term.attach(document.createElement('div'))
  return term
}

function keydown(init: Partial<KeyboardEvent> = {}) {
  return {
    type: 'keydown',
    key: 'c',
    code: 'KeyC',
    ctrlKey: true,
    shiftKey: false,
    altKey: false,
    metaKey: false,
    isComposing: false,
    keyCode: 67,
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
    ...init,
  } as unknown as KeyboardEvent
}

function pressCtrlC(init: Partial<KeyboardEvent> = {}) {
  const handler = mocks.instances[mocks.instances.length - 1].keyHandler!
  const event = keydown(init)
  const handled = handler(event)
  return { handled, event }
}

async function flush() {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

function setClipboard(value: unknown) {
  Object.defineProperty(globalThis.navigator, 'clipboard', {
    value,
    configurable: true,
    writable: true,
  })
}

const originalClipboard = Object.getOwnPropertyDescriptor(globalThis.navigator, 'clipboard')

describe('terminal Ctrl+C copy', () => {
  let execCommand: ReturnType<typeof vi.fn>

  beforeEach(() => {
    mocks.instances.length = 0
    mocks.selection = 'selected terminal text'
    const storage = new MemoryStorage()
    Object.defineProperty(window, 'localStorage', { value: storage, configurable: true })
    vi.stubGlobal('localStorage', storage)
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        disconnect() {}
      }
    )
    vi.stubGlobal(
      'WebSocket',
      class {
        static OPEN = 1
        readyState = 0
        close() {}
        send() {}
      }
    )
    execCommand = vi.fn(() => true)
    ;(document as any).execCommand = execCommand
  })

  afterEach(() => {
    if (originalClipboard) {
      Object.defineProperty(globalThis.navigator, 'clipboard', originalClipboard)
    } else {
      setClipboard(undefined)
    }
  })

  it('copies through the async Clipboard API when it works', async () => {
    const writeText = vi.fn(async () => {})
    setClipboard({ writeText })
    const term = attach()

    const { handled, event } = pressCtrlC()
    await flush()

    expect(writeText).toHaveBeenCalledWith('selected terminal text')
    expect(execCommand).not.toHaveBeenCalled()
    expect(event.preventDefault).toHaveBeenCalled()
    expect(handled).toBe(false)
    term.destroy()
  })

  it('falls back to execCommand when the Clipboard API rejects', async () => {
    const writeText = vi.fn(async () => {
      throw new Error('Document is not focused')
    })
    setClipboard({ writeText })
    const term = attach()

    const { handled, event } = pressCtrlC()
    await flush()

    expect(writeText).toHaveBeenCalled()
    expect(execCommand).toHaveBeenCalledWith('copy')
    expect(event.preventDefault).toHaveBeenCalled()
    expect(handled).toBe(false)
    term.destroy()
  })

  it('falls back to execCommand when navigator.clipboard does not exist', async () => {
    setClipboard(undefined)
    const term = attach()

    expect(() => pressCtrlC()).not.toThrow()
    await flush()

    expect(execCommand).toHaveBeenCalledWith('copy')
    term.destroy()
  })

  it('does the same for Ctrl+Shift+C', async () => {
    setClipboard({
      writeText: vi.fn(async () => {
        throw new Error('Document is not focused')
      }),
    })
    const term = attach()

    pressCtrlC({ key: 'C', shiftKey: true })
    await flush()

    expect(execCommand).toHaveBeenCalledWith('copy')
    term.destroy()
  })

  it('leaves Ctrl+C as SIGINT when nothing is selected', async () => {
    const writeText = vi.fn(async () => {})
    setClipboard({ writeText })
    const term = attach()
    ;(mocks.instances[mocks.instances.length - 1] as any).hasSelection = () => false

    const { handled } = pressCtrlC()
    await flush()

    expect(writeText).not.toHaveBeenCalled()
    expect(execCommand).not.toHaveBeenCalled()
    expect(handled).toBe(true)
    term.destroy()
  })

  it('writes OSC 52 clipboard data through the same fallback', async () => {
    setClipboard({
      writeText: vi.fn(async () => {
        throw new Error('Document is not focused')
      }),
    })
    const term = attach()
    const handler = mocks.instances[mocks.instances.length - 1].parser.handlers[52]

    handler(`c;${Buffer.from('copied by tmux', 'utf8').toString('base64')}`)
    await flush()

    expect(execCommand).toHaveBeenCalledWith('copy')
    term.destroy()
  })

  it('pastes from the host clipboard when the Clipboard API rejects', async () => {
    setClipboard({
      readText: vi.fn(async () => {
        throw new Error('denied')
      }),
    })
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ text: 'host text' }) }))
    vi.stubGlobal('fetch', fetchMock)
    const term = attach()

    pressCtrlC({ key: 'V', code: 'KeyV', shiftKey: true })
    await flush()
    await flush()

    expect(fetchMock).toHaveBeenCalled()
    expect(mocks.instances[mocks.instances.length - 1].paste).toHaveBeenCalledWith('host text')
    term.destroy()
  })

  it('pastes from the host clipboard when navigator.clipboard does not exist', async () => {
    setClipboard(undefined)
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, json: async () => ({ text: 'lan paste' }) }))
    )
    const term = attach()

    expect(() => pressCtrlC({ key: 'V', code: 'KeyV', shiftKey: true })).not.toThrow()
    await flush()
    await flush()

    expect(mocks.instances[mocks.instances.length - 1].paste).toHaveBeenCalledWith('lan paste')
    term.destroy()
  })
})
