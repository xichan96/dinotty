import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  hostTarget: vi.fn<() => string | null>(),
  instances: [] as any[],
  isTauri: vi.fn<() => boolean>(),
}))

vi.mock('@xterm/xterm', () => ({
  Terminal: class {
    options: Record<string, any>
    unicode = { activeVersion: '' }
    parser = { registerOscHandler() {} }
    buffer = { active: { getLine: () => null, cursorY: 0, cursorX: 0 } }
    keyHandler: ((event: KeyboardEvent) => boolean) | null = null
    dataHandler: ((data: string) => void) | null = null
    modes = { applicationCursorKeysMode: false }
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
    onData(handler: (data: string) => void) { this.dataHandler = handler }
    hasSelection() { return false }
    dispose() {}
    focus() {}
    blur() {}
  },
}))

vi.mock('@xterm/addon-fit', () => ({ FitAddon: class { fit = vi.fn() } }))
vi.mock('@xterm/addon-unicode11', () => ({ Unicode11Addon: class {} }))
vi.mock('@xterm/addon-webgl', () => ({ WebglAddon: class { onContextLoss() {}; dispose() {} } }))
vi.mock('@xterm/addon-search', () => ({ SearchAddon: class {} }))
vi.mock('../composables/useTransport', () => ({
  isTauri: mocks.isTauri,
  createTransport: () => ({
    onConnect() {}, onMessage() {}, onDisconnect() {}, connect() {}, disconnect() {}, send() {},
  }),
}))
vi.mock('../utils/clientPlatform', () => ({
  hostTarget: mocks.hostTarget,
  isWindowsClient: false,
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
import { settings, notifyTextChange } from '../composables/useSettings'
import {
  getEffectiveText,
  resetAllOverrides,
  resetOverride,
  setOverride,
} from '../composables/useDeviceTextSettings'

class MemoryStorage implements Storage {
  private data = new Map<string, string>()
  get length() { return this.data.size }
  clear() { this.data.clear() }
  getItem(key: string) { return this.data.get(key) ?? null }
  key(index: number) { return [...this.data.keys()][index] ?? null }
  removeItem(key: string) { this.data.delete(key) }
  setItem(key: string, value: string) { this.data.set(key, String(value)) }
}

function attach(id: string) {
  const term = new TerminalInstance(id)
  vi.spyOn(term as any, '_scheduleSettleResize').mockImplementation(() => {})
  vi.spyOn(term as any, '_refit').mockImplementation(() => {})
  term.attach(document.createElement('div'))
  return term
}

function lastXterm() {
  return mocks.instances[mocks.instances.length - 1]
}

function dispatchTextareaInsert(
  textarea: HTMLTextAreaElement,
  before: string,
  selectionStart: number,
  data: string,
  after: string,
  emitRaw = true
) {
  textarea.value = before
  textarea.setSelectionRange(selectionStart, before.length)
  textarea.dispatchEvent(
    new InputEvent('beforeinput', {
      bubbles: true,
      composed: true,
      data,
      inputType: 'insertText',
      isComposing: false,
    })
  )
  textarea.value = after
  textarea.setSelectionRange(after.length, after.length)
  if (emitRaw) lastXterm().dataHandler!(data)
  textarea.dispatchEvent(
    new InputEvent('input', {
      bubbles: true,
      composed: true,
      data,
      inputType: 'insertText',
      isComposing: false,
    })
  )
}

describe('useTerminal device text integration', () => {
  beforeEach(() => {
    mocks.instances.length = 0
    mocks.hostTarget.mockReturnValue('linux-x86_64')
    mocks.isTauri.mockReturnValue(true)
    const storage = new MemoryStorage()
    Object.defineProperty(window, 'localStorage', { value: storage, configurable: true })
    vi.stubGlobal('localStorage', storage)
    localStorage.clear()
    resetAllOverrides()
    settings.text.font_size = 16
    settings.text.font_family = 'server-font'
    settings.text.line_height = 1.2
    settings.text.letter_spacing = 1
    settings.text.cursor_blink = true
    settings.text.scrollback = 10000
    document.documentElement.style.setProperty('--font-mono', 'test-mono-stack')
    vi.stubGlobal('ResizeObserver', class { observe() {}; disconnect() {} })
    vi.stubGlobal('WebSocket', class {
      static OPEN = 1
      readyState = 0
      close() {}
      send() {}
    })
  })

  it('initializes xterm from effective text', () => {
    setOverride('font_size', 24)
    setOverride('font_family', 'local-font')
    const term = attach('p1')
    expect(term.xterm?.options).toMatchObject({ fontSize: 24, fontFamily: 'local-font' })
    term.destroy()
  })

  it('uses monospace for an empty font on Linux Tauri', () => {
    settings.text.font_family = ''
    const term = attach('p1')
    expect(term.xterm?.options.fontFamily).toBe('monospace')
    term.destroy()
  })

  it('keeps an explicit server font on Linux Tauri', () => {
    settings.text.font_family = 'server-font'
    const term = attach('p1')
    expect(term.xterm?.options.fontFamily).toBe('server-font')
    term.destroy()
  })

  it('resets the runtime font to monospace on Linux Tauri and refits once', () => {
    settings.text.font_family = ''
    setOverride('font_family', 'local-font')
    const term = attach('p1')
    const refit = term['_refit'] as ReturnType<typeof vi.fn>
    resetOverride('font_family')
    expect(term.xterm?.options.fontFamily).toBe('monospace')
    expect(refit).toHaveBeenCalledTimes(1)
    term.destroy()
  })

  it('keeps the CSS font stack for an empty font in a Linux browser', () => {
    mocks.isTauri.mockReturnValue(false)
    settings.text.font_family = ''
    const term = attach('p1')
    expect(term.xterm?.options.fontFamily).toBe('test-mono-stack')
    term.destroy()
  })

  it.each(['windows-x86_64', 'macos-aarch64'])(
    'keeps the CSS font stack for an empty font on %s Tauri',
    (target) => {
      mocks.hostTarget.mockReturnValue(target)
      settings.text.font_family = ''
      const term = attach('p1')
      expect(term.xterm?.options.fontFamily).toBe('test-mono-stack')
      term.destroy()
    },
  )

  it('broadcasts local changes to two panes and refits each once', () => {
    const one = attach('p1')
    const two = attach('p2')
    const refitOne = one['_refit'] as ReturnType<typeof vi.fn>
    const refitTwo = two['_refit'] as ReturnType<typeof vi.fn>
    setOverride('font_size', 26)
    expect(one.xterm?.options.fontSize).toBe(26)
    expect(two.xterm?.options.fontSize).toBe(26)
    expect(refitOne).toHaveBeenCalledTimes(1)
    expect(refitTwo).toHaveBeenCalledTimes(1)
    one.destroy(); two.destroy()
  })

  it('zooms from the effective value, clamps, and reset returns the server default', () => {
    setOverride('font_size', 20)
    const term = attach('p1')
    const refit = term['_refit'] as ReturnType<typeof vi.fn>
    term.adjustFontSize(100)
    expect(getEffectiveText().font_size).toBe(72)
    expect(settings.text.font_size).toBe(16)
    expect(refit).toHaveBeenCalledTimes(1)
    term.resetFontSize()
    expect(getEffectiveText().font_size).toBe(16)
    expect(term.xterm?.options.fontSize).toBe(16)
    expect(refit).toHaveBeenCalledTimes(2)
    term.destroy()
  })

  it('propagates server cursor/scrollback changes but refits only layout changes', () => {
    const term = attach('p1')
    const refit = term['_refit'] as ReturnType<typeof vi.fn>
    settings.text.cursor_blink = false
    notifyTextChange()
    expect(term.xterm?.options.cursorBlink).toBe(false)
    expect(refit).not.toHaveBeenCalled()
    settings.text.scrollback = 20000
    notifyTextChange()
    expect(term.xterm?.options.scrollback).toBe(20000)
    expect(refit).toHaveBeenCalledTimes(1)
    term.destroy()
  })

  it.each([
    ['touch system input', false, 1, 'system', 'ios'],
    ['Windows Tauri touch input', true, 1, 'builtin', 'windows-x86_64'],
    ['Linux Tauri desktop input', true, 0, 'builtin', 'linux-x86_64'],
  ] as const)(
    'reconciles an auto-pair and later closer on %s',
    (_surface, tauri, touchPoints, inputMode, target) => {
      mocks.isTauri.mockReturnValue(tauri)
      mocks.hostTarget.mockReturnValue(target)
      Object.defineProperty(navigator, 'maxTouchPoints', {
        configurable: true,
        value: touchPoints,
      })
      settings.mobile_input_mode = inputMode
      const term = attach('p1')
      const input = vi.fn()
      term.onInput = input
      const textarea = (term as any)._wrapper.querySelector(
        '.xterm-helper-textarea',
      ) as HTMLTextAreaElement
      const keyHandler = lastXterm().keyHandler!
      const edit = (value: string, caret: number, data: string) => {
        keyHandler(new KeyboardEvent('keydown', { keyCode: 229, key: 'Process' }))
        textarea.value = value
        textarea.setSelectionRange(caret, caret)
        textarea.dispatchEvent(
          new InputEvent('input', { inputType: 'insertText', data, isComposing: false }),
        )
        keyHandler(new KeyboardEvent('keyup', { keyCode: 229, key: 'Process' }))
      }

      edit('()', 1, '(')
      edit('())', 2, ')')

      expect(input.mock.calls.map(([data]) => data)).toEqual(['()\x1b[D', '\x1b[C)'])
      expect([textarea.selectionStart, textarea.selectionEnd]).toEqual([3, 3])
      term.destroy()
    },
  )

  it('does not duplicate a Tauri 229 symbol through the input rescue path', () => {
    mocks.isTauri.mockReturnValue(true)
    Object.defineProperty(navigator, 'maxTouchPoints', { configurable: true, value: 0 })
    const term = attach('p1')
    const input = vi.fn()
    term.onInput = input
    const textarea = (term as any)._wrapper.querySelector(
      '.xterm-helper-textarea',
    ) as HTMLTextAreaElement
    const keyHandler = lastXterm().keyHandler!

    keyHandler(new KeyboardEvent('keydown', { keyCode: 229, key: 'Process' }))
    textarea.value = '!'
    textarea.setSelectionRange(1, 1)
    textarea.dispatchEvent(
      new InputEvent('input', { inputType: 'insertText', data: '!', isComposing: false }),
    )
    lastXterm().dataHandler!('!')
    keyHandler(new KeyboardEvent('keyup', { keyCode: 229, key: 'Process' }))

    expect(input.mock.calls.map(([data]) => data)).toEqual(['!'])
    term.destroy()
  })

  it('rescues a touch-web punctuation input when the IME emits no 229 event', () => {
    mocks.isTauri.mockReturnValue(false)
    Object.defineProperty(navigator, 'maxTouchPoints', { configurable: true, value: 1 })
    settings.mobile_input_mode = 'system'
    const term = attach('p1')
    const input = vi.fn()
    term.onInput = input
    const textarea = (term as any)._wrapper.querySelector(
      '.xterm-helper-textarea',
    ) as HTMLTextAreaElement

    textarea.dispatchEvent(
      new InputEvent('input', { inputType: 'insertText', data: '！', isComposing: false }),
    )
    lastXterm().dataHandler!('！')

    expect(input.mock.calls.map(([data]) => data)).toEqual(['！'])
    term.destroy()
  })

  it('reconciles iOS dictation tail replacements instead of appending interim transcripts', async () => {
    vi.useFakeTimers()
    mocks.isTauri.mockReturnValue(false)
    Object.defineProperty(navigator, 'maxTouchPoints', { configurable: true, value: 1 })
    settings.mobile_input_mode = 'system'
    const term = attach('p1')
    const input = vi.fn()
    term.onInput = input
    const textarea = (term as any)._wrapper.querySelector(
      '.xterm-helper-textarea'
    ) as HTMLTextAreaElement

    dispatchTextareaInsert(textarea, '', 0, '我', '我')
    dispatchTextareaInsert(textarea, '我', 0, '我说一句', '我说一句')
    dispatchTextareaInsert(textarea, '我说一句', 0, '我说一句话', '我说一句话')
    dispatchTextareaInsert(
      textarea,
      '我说一句话',
      0,
      '我说一句话，你来理解我',
      '我说一句话，你来理解我'
    )
    dispatchTextareaInsert(
      textarea,
      '我说一句话，你来理解我',
      0,
      '我说一句话，你来理解我的意思',
      '我说一句话，你来理解我的意思'
    )
    await vi.advanceTimersByTimeAsync(80)

    expect(input.mock.calls.map(([data]) => data)).toEqual(['我', '说一句话，你来理解我的意思'])

    dispatchTextareaInsert(
      textarea,
      '我说一句话，你来理解我的意思',
      12,
      '意图',
      '我说一句话，你来理解我的意图'
    )
    await vi.advanceTimersByTimeAsync(80)
    expect(input.mock.calls.map(([data]) => data)).toEqual([
      '我',
      '说一句话，你来理解我的意思',
      '\x7f图',
    ])
    term.destroy()
    vi.useRealTimers()
  })

  it('reconciles the full observed dictation chain when a later DOM edit does not match', () => {
    mocks.isTauri.mockReturnValue(false)
    Object.defineProperty(navigator, 'maxTouchPoints', { configurable: true, value: 1 })
    settings.mobile_input_mode = 'system'
    const term = attach('p1')
    const input = vi.fn()
    term.onInput = input
    const textarea = (term as any)._wrapper.querySelector(
      '.xterm-helper-textarea'
    ) as HTMLTextAreaElement

    dispatchTextareaInsert(textarea, '', 0, '我', '我')
    dispatchTextareaInsert(textarea, '我', 0, '我说一句', '我说一句')
    dispatchTextareaInsert(textarea, '我说一句', 0, '我说一句话', '我说一句呢')

    expect(input.mock.calls.map(([data]) => data)).toEqual(['我', '说一句呢'])
    expect((term as any)._ime229Baseline).toBeNull()
    term.destroy()
  })

  it('does not let an unrelated keyup flush a dictation-owned snapshot', async () => {
    vi.useFakeTimers()
    mocks.isTauri.mockReturnValue(false)
    Object.defineProperty(navigator, 'maxTouchPoints', { configurable: true, value: 1 })
    settings.mobile_input_mode = 'system'
    const term = attach('p1')
    const input = vi.fn()
    term.onInput = input
    const textarea = (term as any)._wrapper.querySelector(
      '.xterm-helper-textarea'
    ) as HTMLTextAreaElement

    dispatchTextareaInsert(textarea, '', 0, '我', '我')
    dispatchTextareaInsert(textarea, '我', 0, '我说一句', '我说一句')
    expect(lastXterm().keyHandler!(new KeyboardEvent('keyup', { key: 'Shift' }))).toBe(true)
    expect(input.mock.calls.map(([data]) => data)).toEqual(['我'])

    await vi.advanceTimersByTimeAsync(80)
    expect(input.mock.calls.map(([data]) => data)).toEqual(['我', '说一句'])
    term.destroy()
    vi.useRealTimers()
  })

  it('does not synthesize a dictation edit unless xterm emitted the matching raw input', async () => {
    vi.useFakeTimers()
    mocks.isTauri.mockReturnValue(false)
    Object.defineProperty(navigator, 'maxTouchPoints', { configurable: true, value: 1 })
    settings.mobile_input_mode = 'system'
    const term = attach('p1')
    const input = vi.fn()
    term.onInput = input
    const textarea = (term as any)._wrapper.querySelector(
      '.xterm-helper-textarea'
    ) as HTMLTextAreaElement

    dispatchTextareaInsert(textarea, '旧候选', 0, '新候选', '新候选', false)
    await vi.advanceTimersByTimeAsync(80)

    expect(input).not.toHaveBeenCalled()
    expect((term as any)._ime229Baseline).toBeNull()
    term.destroy()
    vi.useRealTimers()
  })

  it.each([
    ['builtin input', 'builtin', false, false],
    ['screen reader mode', 'system', true, false],
    ['Tauri touch input', 'system', false, true],
  ] as const)(
    'leaves dictation-like tail input on xterm in %s',
    (_case, mode, screenReaderMode, tauri) => {
      mocks.isTauri.mockReturnValue(tauri)
      Object.defineProperty(navigator, 'maxTouchPoints', { configurable: true, value: 1 })
      settings.mobile_input_mode = mode
      const term = attach('p1')
      const input = vi.fn()
      term.onInput = input
      term.xterm!.options.screenReaderMode = screenReaderMode
      const textarea = (term as any)._wrapper.querySelector(
        '.xterm-helper-textarea'
      ) as HTMLTextAreaElement

      dispatchTextareaInsert(textarea, '旧候选', 0, '新候选', '新候选')

      expect(input.mock.calls.map(([data]) => data)).toEqual(['新候选'])
      expect((term as any)._ime229Baseline).toBeNull()
      term.destroy()
    }
  )

  it('preserves the desktop replacement-text workaround on Tauri touch input', () => {
    mocks.isTauri.mockReturnValue(true)
    Object.defineProperty(navigator, 'maxTouchPoints', { configurable: true, value: 1 })
    settings.mobile_input_mode = 'system'
    const term = attach('p1')
    const sendData = vi.spyOn(term, 'sendData')
    const textarea = (term as any)._wrapper.querySelector(
      '.xterm-helper-textarea'
    ) as HTMLTextAreaElement
    textarea.value = 'ni'
    textarea.dispatchEvent(
      new InputEvent('input', { inputType: 'insertText', data: 'ni', isComposing: false })
    )

    textarea.dispatchEvent(
      new InputEvent('beforeinput', {
        inputType: 'insertReplacementText',
        data: '你',
        isComposing: false,
      })
    )

    expect(sendData).toHaveBeenCalledOnce()
    expect(sendData).toHaveBeenCalledWith('\x7f\x7f')
    term.destroy()
  })
})
