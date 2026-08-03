import { beforeEach, describe, expect, it, vi } from 'vitest'

const transportMocks = vi.hoisted(() => ({
  tauri: false,
}))

vi.mock('../composables/useTransport', () => ({
  isTauri: () => transportMocks.tauri,
  createTransport: vi.fn(),
  tauriInvoke: vi.fn(),
}))

import { TerminalInstance } from '../composables/useTerminal'
import { setupTerminalDrop } from '../composables/useTerminalDrop'

function eventWithData<T extends Event>(event: T, prop: string, value: unknown): T {
  Object.defineProperty(event, prop, { value })
  return event
}

async function flushAsync() {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

describe('terminal upload detection', () => {
  beforeEach(() => {
    transportMocks.tauri = false
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true })
  })

  it('uploads dropped browser files on non-Tauri and prevents the native drop', () => {
    const term = new TerminalInstance('p1')
    const wrapper = document.createElement('div')
    const xterm = document.createElement('div')
    xterm.className = 'xterm'
    wrapper.appendChild(xterm)
    const upload = vi.fn()
    term.onFileUpload = upload
    setupTerminalDrop(wrapper, {
      sendData: (d) => term.sendData(d),
      onFileUpload: (files) => term.onFileUpload?.(files),
    })

    const file = new File(['x'], 'x.txt')
    const drop = eventWithData(new Event('drop', { bubbles: true, cancelable: true }), 'dataTransfer', {
      files: [file],
      types: [],
      getData: vi.fn(),
    })
    xterm.dispatchEvent(drop)

    expect(upload).toHaveBeenCalledWith([file])
    expect(drop.defaultPrevented).toBe(true)
  })

  it('keeps the existing Tauri path typing branch unchanged', async () => {
    transportMocks.tauri = true
    const term = new TerminalInstance('p1')
    const sendData = vi.spyOn(term, 'sendData').mockImplementation(() => {})
    const wrapper = document.createElement('div')
    const xterm = document.createElement('div')
    xterm.className = 'xterm'
    wrapper.appendChild(xterm)
    const upload = vi.fn()
    term.onFileUpload = upload
    setupTerminalDrop(wrapper, {
      sendData: (d) => term.sendData(d),
      onFileUpload: (files) => term.onFileUpload?.(files),
    })

    const drop = eventWithData(new Event('drop', { bubbles: true, cancelable: true }), 'dataTransfer', {
      files: [{ path: '/tmp/a b.txt', name: 'a b.txt' }],
      types: [],
      getData: vi.fn(),
    })
    xterm.dispatchEvent(drop)
    await flushAsync()

    expect(upload).not.toHaveBeenCalled()
    expect(sendData).toHaveBeenCalledWith("'/tmp/a b.txt'")
  })

  it('uploads pasted files, leaves text-only paste alone, and treats mixed paste as upload-only', () => {
    const term = new TerminalInstance('p1')
    const wrapper = document.createElement('div')
    const upload = vi.fn()
    term.onFileUpload = upload
    setupTerminalDrop(wrapper, {
      sendData: (d) => term.sendData(d),
      onFileUpload: (files) => term.onFileUpload?.(files),
    })

    const textPaste = eventWithData(
      new Event('paste', { bubbles: true, cancelable: true }),
      'clipboardData',
      { items: [{ kind: 'string', getAsFile: () => null }] }
    )
    wrapper.dispatchEvent(textPaste)
    expect(textPaste.defaultPrevented).toBe(false)
    expect(upload).not.toHaveBeenCalled()

    const file = new File(['x'], 'x.txt')
    const mixedPaste = eventWithData(
      new Event('paste', { bubbles: true, cancelable: true }),
      'clipboardData',
      {
        items: [
          { kind: 'string', getAsFile: () => null },
          { kind: 'file', getAsFile: () => file },
        ],
      }
    )
    wrapper.dispatchEvent(mixedPaste)

    expect(mixedPaste.defaultPrevented).toBe(true)
    expect(upload).toHaveBeenCalledWith([file])
  })

  it('uploads pasted images from the async clipboard read path without blocking paste', async () => {
    const blob = new Blob(['image'], { type: 'image/png' })
    const item = {
      types: ['text/plain', 'image/png'],
      getType: vi.fn().mockResolvedValue(blob),
    }
    const read = vi.fn().mockResolvedValue([item])
    Object.defineProperty(navigator, 'clipboard', { value: { read }, configurable: true })

    const term = new TerminalInstance('p1')
    const wrapper = document.createElement('div')
    const upload = vi.fn()
    term.onFileUpload = upload
    setupTerminalDrop(wrapper, {
      sendData: (d) => term.sendData(d),
      onFileUpload: (files) => term.onFileUpload?.(files),
    })

    const pasteShortcut = new KeyboardEvent('keydown', {
      key: 'v',
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    })
    wrapper.dispatchEvent(pasteShortcut)
    await flushAsync()

    expect(pasteShortcut.defaultPrevented).toBe(false)
    expect(read).toHaveBeenCalled()
    expect(item.getType).toHaveBeenCalledWith('image/png')
    expect(upload).toHaveBeenCalledTimes(1)
    const files = upload.mock.calls[0][0]
    expect(files).toHaveLength(1)
    expect(files[0]).toBeInstanceOf(File)
    expect(files[0].name).toMatch(/^pasted-image-\d+\.png$/)
    expect(files[0].type).toBe('image/png')
  })
})
