import { mount, type VueWrapper } from '@vue/test-utils'
import { defineComponent, nextTick } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../composables/useUpload', () => ({
  formatMB: () => '0.0',
  useUpload: () => ({ uploadFiles: vi.fn(), uploadErrorStatus: vi.fn() }),
}))

vi.mock('vue-toastification', () => ({
  POSITION: { BOTTOM_CENTER: 'bottom-center' },
  useToast: () => ({ error: vi.fn(), success: vi.fn() }),
}))

vi.mock('../composables/useHistory', async () => {
  const { ref } = await vi.importActual<typeof import('vue')>('vue')
  return {
    useHistory: () => ({
      suggestions: ref([]),
      fetchSuggestions: vi.fn(),
      fetchDebounced: vi.fn(),
    }),
  }
})

vi.mock('../composables/apiBase', () => ({
  apiUrl: (path: string) => path,
  authFetch: vi.fn(async () => ({ ok: true, json: async () => [] })),
  getApiBase: vi.fn(async () => 'http://127.0.0.1:7681'),
  hasAuthToken: vi.fn(() => false),
  wsUrlWithToken: (url: string) => url,
}))

import MobileKeyboard from '../components/keyboard/MobileKeyboard.vue'
import { normalizeQuickSendThreshold } from '../components/settings/KeyboardTab.vue'
import { settings } from '../composables/useSettings'
import { TerminalInstance, setActivePaneId } from '../composables/useTerminal'
import { TauriIpcTransport } from '../composables/useTransport'
import { createFrozenSendFn, type SendDataFn } from '../utils/frozenSend'

const MkbKeyStub = defineComponent({
  name: 'MkbKey',
  emits: ['key-press', 'app-action', 'special'],
  template: '<button class="mkb-key-stub" />',
})

let wrapper: VueWrapper | undefined

function mountKeyboard(getSendFn: () => SendDataFn | null, errorHandler = vi.fn()) {
  wrapper = mount(MobileKeyboard, {
    props: { visible: true, paneId: 'p1', getSendFn },
    global: {
      config: { errorHandler },
      stubs: {
        SuggestionBar: true,
        MkbRow: true,
        MkbKey: MkbKeyStub,
        HistoryPanel: true,
        FilePickerModal: true,
      },
    },
  })
  return wrapper
}

async function enterText(mounted: VueWrapper, text: string) {
  const textarea = mounted.find('textarea')
  await textarea.setValue(text)
  await textarea.trigger('keydown', { key: 'Enter' })
  await Promise.resolve()
}

async function advance(ms: number) {
  await vi.advanceTimersByTimeAsync(ms)
  await nextTick()
}

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

beforeEach(() => {
  vi.useFakeTimers()
  settings.quick_send_threshold = 63
  setActivePaneId(null)
  delete (window as any).__TAURI__
  delete (window as any).__TAURI_INTERNALS__
})

afterEach(() => {
  wrapper?.unmount()
  wrapper = undefined
  setActivePaneId(null)
  delete (window as any).__TAURI__
  delete (window as any).__TAURI_INTERNALS__
  vi.useRealTimers()
})

describe('MobileKeyboard configurable send threshold', () => {
  it('scenario 1: sends short text, waits 50ms, then sends Enter with one captured sender', async () => {
    const send = vi.fn()
    const getSendFn = vi.fn(() => send)
    const mounted = mountKeyboard(getSendFn)

    await enterText(mounted, '0123456789')
    expect(send).toHaveBeenCalledTimes(1)
    expect(send).toHaveBeenNthCalledWith(1, '0123456789')
    expect((mounted.find('textarea').element as HTMLTextAreaElement).value).toBe('')
    await advance(49)
    expect(send).toHaveBeenCalledTimes(1)
    await advance(1)
    expect(send.mock.calls).toEqual([['0123456789'], ['\r']])
    expect(getSendFn).toHaveBeenCalledTimes(1)
  })

  it('scenario 2: takes the direct branch exactly at N', async () => {
    const send = vi.fn()
    const mounted = mountKeyboard(() => send)

    await enterText(mounted, 'x'.repeat(63))
    await advance(50)

    expect(send.mock.calls).toEqual([['x'.repeat(63)], ['\r']])
  })

  it('scenario 3: sends text only above N', async () => {
    const send = vi.fn()
    const mounted = mountKeyboard(() => send)

    await enterText(mounted, 'x'.repeat(64))
    await advance(100)

    expect(send.mock.calls).toEqual([['x'.repeat(64)]])
  })

  it('scenario 4: N=0 sends every non-empty payload as text only', async () => {
    settings.quick_send_threshold = 0
    const send = vi.fn()
    const mounted = mountKeyboard(() => send)

    await enterText(mounted, 'x')
    await advance(100)

    expect(send.mock.calls).toEqual([['x']])
  })

  it('scenario 5: empty text sends one bare Enter', async () => {
    const send = vi.fn()
    const mounted = mountKeyboard(() => send)

    await mounted.find('textarea').trigger('keydown', { key: 'Enter' })
    await advance(100)

    expect(send.mock.calls).toEqual([['\r']])
  })

  it('scenario 6: N=5000 directly sends a 200-character payload', async () => {
    settings.quick_send_threshold = 5000
    const send = vi.fn()
    const mounted = mountKeyboard(() => send)
    const text = '中'.repeat(200)

    await enterText(mounted, text)
    await advance(50)

    expect(send.mock.calls).toEqual([[text], ['\r']])
  })

  it('scenario 7: integer-normalizes the UI value into 0..5000', () => {
    expect(normalizeQuickSendThreshold(-1)).toBe(0)
    expect(normalizeQuickSendThreshold(63.9)).toBe(63)
    expect(normalizeQuickSendThreshold(99999)).toBe(5000)
    expect(normalizeQuickSendThreshold(Number.NaN)).toBe(63)
  })

  it('scenario 8: ignores composition sends without deferral and rejects NUL/ESC payloads', async () => {
    const send = vi.fn()
    const mounted = mountKeyboard(() => send)
    const textarea = mounted.find('textarea')

    await textarea.setValue('composing')
    await textarea.trigger('compositionstart')
    await textarea.trigger('keydown', { key: 'Enter' })
    await textarea.trigger('compositionend')
    await advance(100)
    expect(send).not.toHaveBeenCalled()
    expect((textarea.element as HTMLTextAreaElement).value).toBe('composing')

    await textarea.setValue('bad\0payload')
    await textarea.trigger('keydown', { key: 'Enter' })
    await textarea.setValue('bad\x1bpayload')
    await textarea.trigger('keydown', { key: 'Enter' })
    expect(send).not.toHaveBeenCalled()
    expect((textarea.element as HTMLTextAreaElement).value).toBe('bad\x1bpayload')
  })

  it('scenario 9: a pane switch during the window drops Enter without cross-pane submission', async () => {
    let activePane = 'p1'
    const delivered: Array<[string, string]> = []
    const panePinnedSend: SendDataFn = (data) => {
      if (activePane === 'p1') delivered.push(['p1', data])
    }
    const mounted = mountKeyboard(() => panePinnedSend)

    await enterText(mounted, 'pane-pinned')
    await advance(20)
    activePane = 'p2'
    await advance(30)

    expect(delivered).toEqual([['p1', 'pane-pinned']])
  })

  it('scenario 10: sends multiline text without a trailing Enter at any N', async () => {
    settings.quick_send_threshold = 5000
    const send = vi.fn()
    const mounted = mountKeyboard(() => send)

    await enterText(mounted, 'one\ntwo')
    await advance(100)

    expect(send.mock.calls).toEqual([['one\ntwo']])
  })

  it('scenario 11: unmount invalidates the pending Enter generation', async () => {
    const send = vi.fn()
    const mounted = mountKeyboard(() => send)

    await enterText(mounted, 'unmount')
    await advance(20)
    mounted.unmount()
    wrapper = undefined
    await advance(30)

    expect(send.mock.calls).toEqual([['unmount']])
  })

  it('scenario 12: a broadcast toggle cannot change the frozen recipient set', async () => {
    let broadcastMode = false
    const primary = vi.fn()
    const secondary = vi.fn()
    const frozenSend = createFrozenSendFn(broadcastMode ? [primary, secondary] : [primary])
    const mounted = mountKeyboard(() => frozenSend)

    await enterText(mounted, 'frozen')
    await advance(20)
    broadcastMode = true
    await advance(30)

    expect(primary.mock.calls).toEqual([['frozen'], ['\r']])
    expect(secondary).not.toHaveBeenCalled()
  })

  it('scenario 13: drops toolbar quick-key and app-action taps while the send lock is held', async () => {
    const send = vi.fn()
    const mounted = mountKeyboard(() => send)

    await enterText(mounted, 'locked')
    await advance(20)
    const key = mounted.findAllComponents(MkbKeyStub)[0]
    key.vm.$emit('key-press', 'x')
    key.vm.$emit('app-action', 'term.newline', {})
    await nextTick()
    await advance(30)

    expect(send.mock.calls).toEqual([['locked'], ['\r']])
    expect(mounted.emitted('app-action')).toBeUndefined()
  })

  it('scenario 14: a synchronous text-leg throw retains text and releases the lock', async () => {
    const errorHandler = vi.fn()
    const send = vi.fn().mockImplementationOnce(() => {
      throw new Error('sync send failed')
    })
    const mounted = mountKeyboard(() => send, errorHandler)

    await enterText(mounted, 'retry')
    await nextTick()
    expect((mounted.find('textarea').element as HTMLTextAreaElement).value).toBe('retry')
    await mounted.find('textarea').trigger('keydown', { key: 'Enter' })
    await advance(50)

    expect(send.mock.calls).toEqual([['retry'], ['retry'], ['\r']])
    expect(errorHandler).toHaveBeenCalled()
  })

  it('scenario 15: an asynchronous native text-leg rejection skips bare Enter', async () => {
    const textLeg = deferred<void>()
    const errorHandler = vi.fn()
    const send = vi.fn().mockReturnValueOnce(textLeg.promise)
    const mounted = mountKeyboard(() => send, errorHandler)

    await enterText(mounted, 'reject')
    textLeg.reject(new Error('native reject'))
    await Promise.resolve()
    await nextTick()
    await advance(100)

    expect(send.mock.calls).toEqual([['reject']])
    expect(errorHandler).toHaveBeenCalled()
  })

  it('scenario 16: forwards the real invoke promise through transport, terminal, App closure, and keyboard', async () => {
    const textLeg = deferred<void>()
    const ptyWrites: string[] = []
    const invoke = vi.fn((cmd: string, args: Record<string, unknown>) => {
      if (cmd === 'pty_write') {
        ptyWrites.push(args.data as string)
        return ptyWrites.length === 1 ? textLeg.promise : Promise.resolve()
      }
      return Promise.resolve('zsh')
    })
    ;(window as any).__TAURI__ = {
      core: { invoke },
      event: { listen: vi.fn(async () => () => {}) },
    }
    const transport = new TauriIpcTransport('p1')
    const terminal = new TerminalInstance('p1')
    ;(terminal as any)._transport = transport
    setActivePaneId('p1')
    const appSendClosure = createFrozenSendFn([(data) => terminal.sendData(data)])
    const mounted = mountKeyboard(() => appSendClosure)

    await enterText(mounted, 'native')
    await advance(100)
    expect(ptyWrites).toEqual(['native'])

    textLeg.resolve()
    await Promise.resolve()
    await advance(49)
    expect(ptyWrites).toEqual(['native'])
    await advance(1)
    expect(ptyWrites).toEqual(['native', '\r'])

    transport.disconnect()
  })
})
