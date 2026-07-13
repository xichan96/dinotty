import { beforeEach, describe, expect, it, vi } from 'vitest'

const xtermMocks = vi.hoisted(() => ({ instances: [] as any[] }))

vi.mock('@xterm/xterm', () => ({
  Terminal: class {
    options: Record<string, any>
    unicode = { activeVersion: '' }
    parser = { registerOscHandler() {} }
    buffer = { active: { getLine: () => null, cursorY: 0, cursorX: 0 } }
    constructor(options: Record<string, any>) {
      this.options = { ...options }
      xtermMocks.instances.push(this)
    }
    loadAddon() {}
    open(wrapper: HTMLElement) {
      const el = document.createElement('div')
      el.className = 'xterm'
      wrapper.appendChild(el)
    }
    attachCustomKeyEventHandler() {}
    registerLinkProvider() {}
    onTitleChange() {}
    onData() {}
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
  isTauri: () => true,
  createTransport: () => ({
    onConnect() {}, onMessage() {}, onDisconnect() {}, connect() {}, disconnect() {}, send() {},
  }),
}))

import { TerminalInstance } from '../composables/useTerminal'
import { settings, notifyTextChange } from '../composables/useSettings'
import {
  getEffectiveText,
  resetAllOverrides,
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
  vi.spyOn(term as any, '_setupAdaptiveWheel').mockImplementation(() => {})
  vi.spyOn(term as any, '_scheduleSettleResize').mockImplementation(() => {})
  vi.spyOn(term as any, '_refit').mockImplementation(() => {})
  term.attach(document.createElement('div'))
  return term
}

describe('useTerminal device text integration', () => {
  beforeEach(() => {
    xtermMocks.instances.length = 0
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
    vi.stubGlobal('ResizeObserver', class { observe() {}; disconnect() {} })
  })

  it('initializes xterm from effective text', () => {
    setOverride('font_size', 24)
    setOverride('font_family', 'local-font')
    const term = attach('p1')
    expect(term.xterm?.options).toMatchObject({ fontSize: 24, fontFamily: 'local-font' })
    term.destroy()
  })

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
})
