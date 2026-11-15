import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent } from 'vue'
import { mount } from '@vue/test-utils'
import { useDevTools } from '../useDevTools'

const PREVIEW_ORIGIN = 'http://preview.test'

function mountDevTools() {
  let api!: ReturnType<typeof useDevTools>
  const wrapper = mount(
    defineComponent({
      setup() {
        api = useDevTools()
        return () => null
      },
    })
  )
  api.allowOrigin(PREVIEW_ORIGIN)
  return { wrapper, api }
}

function send(data: unknown, origin = PREVIEW_ORIGIN) {
  window.dispatchEvent(new MessageEvent('message', { data, origin }))
}

function networkMessage(index: number) {
  return {
    type: 'preview-network',
    method: 'GET',
    url: `/api/item/${index}`,
    status: 200,
    duration: 4,
    ts: index,
  }
}

describe('useDevTools', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('coalesces a burst into a single bounded update', async () => {
    const { wrapper, api } = mountDevTools()

    for (let i = 0; i < 1000; i += 1) send(networkMessage(i))
    expect(api.networkEntries.value).toHaveLength(0)

    vi.advanceTimersByTime(100)

    expect(api.networkEntries.value).toHaveLength(500)
    expect(api.networkEntries.value[0].url).toBe('/api/item/500')
    expect(api.networkEntries.value[499].url).toBe('/api/item/999')

    wrapper.unmount()
  })

  it('keeps one timer for a burst and applies the batch once', async () => {
    const { wrapper, api } = mountDevTools()
    const pushes: number[] = []
    const stop = setInterval(() => pushes.push(api.networkEntries.value.length), 10)

    for (let i = 0; i < 50; i += 1) send(networkMessage(i))
    vi.advanceTimersByTime(99)
    expect(pushes.every((length) => length === 0)).toBe(true)

    vi.advanceTimersByTime(1)
    expect(api.networkEntries.value).toHaveLength(50)

    clearInterval(stop)
    wrapper.unmount()
  })

  it('drops queued entries when the list is cleared before the flush', async () => {
    const { wrapper, api } = mountDevTools()

    send(networkMessage(1))
    send(networkMessage(2))
    api.clearNetwork()
    vi.advanceTimersByTime(100)

    expect(api.networkEntries.value).toHaveLength(0)

    wrapper.unmount()
  })

  it('applies console.clear immediately and never resurrects queued lines', async () => {
    const { wrapper, api } = mountDevTools()

    send({ type: 'preview-console', level: 'log', args: ['before'], ts: 1 })
    send({ type: 'preview-console', level: 'clear', ts: 2 })
    send({ type: 'preview-console', level: 'log', args: ['after'], ts: 3 })
    vi.advanceTimersByTime(100)

    expect(api.consoleEntries.value).toHaveLength(1)
    expect(api.consoleEntries.value[0].args).toEqual(['after'])

    wrapper.unmount()
  })

  it('batches unhandled preview errors with console entries', async () => {
    const { wrapper, api } = mountDevTools()

    send({ type: 'preview-error', message: 'boom', source: 'app.js', line: 3 })
    vi.advanceTimersByTime(100)

    expect(api.consoleEntries.value).toHaveLength(1)
    expect(api.consoleEntries.value[0].level).toBe('error')
    expect(api.consoleEntries.value[0].args).toEqual(['[app.js:3]', 'boom'])
    expect(api.errorCount.value).toBe(1)

    wrapper.unmount()
  })

  it('ignores disallowed origins and cancels the pending flush on unmount', () => {
    const { wrapper, api } = mountDevTools()

    send(networkMessage(1), 'http://evil.test')
    expect(api.networkEntries.value).toHaveLength(0)

    send(networkMessage(2))
    wrapper.unmount()
    vi.advanceTimersByTime(100)

    expect(api.networkEntries.value).toHaveLength(0)
    expect(vi.getTimerCount()).toBe(0)
  })
})
