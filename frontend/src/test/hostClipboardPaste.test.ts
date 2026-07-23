import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  clipboardLineCount,
  createHostClipboardPasteController,
  stripTrailingNewlines,
} from '../utils/hostClipboardPaste'

function setup(fetchText: () => Promise<string>) {
  const paste = vi.fn()
  const clipboardEmpty = vi.fn()
  const pasteFailed = vi.fn()
  const confirmMultiline = vi.fn()
  const controller = createHostClipboardPasteController({
    fetchText,
    paste,
    clipboardEmpty,
    pasteFailed,
    confirmMultiline,
  })
  return {
    controller,
    paste,
    clipboardEmpty,
    pasteFailed,
    confirmMultiline,
  }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('host clipboard paste flow', () => {
  it.each([
    ['LF', 'echo ok\n\n'],
    ['CRLF', 'echo ok\r\n\r\n'],
    ['bare CR', 'echo ok\r\r'],
  ])('strips trailing %s newline runs before paste', async (_name, input) => {
    const flow = setup(async () => input)
    await flow.controller.trigger(true)
    expect(flow.paste).toHaveBeenCalledOnce()
    expect(flow.paste).toHaveBeenCalledWith('echo ok', true)
  })

  it('passes the tapped key auto_enter value for single-line text', async () => {
    const enabled = setup(async () => 'echo enabled')
    const disabled = setup(async () => 'echo disabled')

    await enabled.controller.trigger(true)
    await disabled.controller.trigger(false)

    expect(enabled.paste).toHaveBeenCalledWith('echo enabled', true)
    expect(disabled.paste).toHaveBeenCalledWith('echo disabled', false)
  })

  it('treats newline-only clipboard as empty with zero writes', async () => {
    const flow = setup(async () => '\r\n\r')
    await flow.controller.trigger(true)
    expect(flow.clipboardEmpty).toHaveBeenCalledOnce()
    expect(flow.paste).not.toHaveBeenCalled()
  })

  it('arms multiline on the first tap and pastes cached text on the second tap', async () => {
    const fetchText = vi.fn(async () => 'one\r\ntwo\n')
    const flow = setup(fetchText)
    await flow.controller.trigger(true)
    expect(flow.paste).not.toHaveBeenCalled()
    expect(flow.confirmMultiline).toHaveBeenCalledWith(2)

    await flow.controller.trigger(true)
    expect(fetchText).toHaveBeenCalledOnce()
    expect(flow.paste).toHaveBeenCalledWith('one\r\ntwo', false)
  })

  it('drops cached multiline text when the three-second arm expires', async () => {
    vi.useFakeTimers()
    const fetchText = vi.fn(async () => 'one\ntwo')
    const flow = setup(fetchText)
    await flow.controller.trigger(true)
    vi.advanceTimersByTime(3000)

    await flow.controller.trigger(true)
    expect(fetchText).toHaveBeenCalledTimes(2)
    expect(flow.paste).not.toHaveBeenCalled()
  })

  it('uses generic failure handling and preserves internal line counting', async () => {
    const flow = setup(async () => {
      throw new Error('sensitive backend detail')
    })
    await flow.controller.trigger(true)
    expect(flow.pasteFailed).toHaveBeenCalledOnce()
    expect(flow.paste).not.toHaveBeenCalled()
    expect(stripTrailingNewlines('a\rb\r')).toBe('a\rb')
    expect(clipboardLineCount('a\rb\r\nc')).toBe(3)
  })
})
