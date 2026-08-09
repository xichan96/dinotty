import { describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { mountWithTabs, mocks, TabBarStub, clearMountedWrapper } from './_setup'

describe('App.vue - notification badge visibility', () => {
  it('keeps the bell visible for authoritative unread attention with empty history', async () => {
    mocks.notificationItems.value = []
    mocks.unreadAttentionCount.value = 1

    const wrapper = await mountWithTabs()

    expect(wrapper.find('button.notif-btn').exists()).toBe(true)
    expect(wrapper.find('.notif-badge').text()).toBe('1')
  })
})

describe('App.vue - notification goto flow', () => {
  it('passes the goto reason from the real NotificationPanel reveal path', async () => {
    const wrapper = await mountWithTabs()
    mocks.clearForPaneIds.mockClear()

    await wrapper.findComponent({ name: 'NotificationPanel' }).vm.$emit('goto-pane', 'pane-1')
    await Promise.resolve()
    await nextTick()

    expect(mocks.clearForPaneIds).toHaveBeenCalledWith(
      expect.arrayContaining(['tab-1', 'pane-1', 'pane-2']),
      'goto'
    )
  })
})

describe('App.vue - plugin notification bridge', () => {
  function response(status: number, body: Record<string, unknown>) {
    return { ok: status >= 200 && status < 300, status, json: async () => body }
  }

  async function flushBridge() {
    for (let i = 0; i < 6; i++) await Promise.resolve()
  }

  it('POSTs pane-less plugin notifications and waits for the raised broadcast to insert history', async () => {
    await mountWithTabs()
    mocks.authFetch.mockClear()
    mocks.pushNotification.mockClear()
    ;(window as any).__dinotty_ui_notify('hello', 'warn', 'Plugin title')
    await Promise.resolve()
    await Promise.resolve()

    expect(mocks.authFetch).toHaveBeenCalledWith('/api/notify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientId: 'client-stable',
        requestId: 'tab-nonce-1',
        source: 'plugin',
        type: 'warning',
        title: 'Plugin title',
        body: 'hello',
      }),
      signal: expect.any(AbortSignal),
    })
    expect(mocks.pushNotification).not.toHaveBeenCalled()
  })

  it('retries an accepted-but-response-lost request with the same requestId and does not insert locally', async () => {
    await mountWithTabs()
    mocks.authFetch.mockClear()
    vi.useFakeTimers()
    mocks.authFetch.mockRejectedValueOnce(new Error('network'))
    mocks.authFetch.mockResolvedValueOnce(
      response(200, { status: 'accepted', notifId: 'notif-2', eventSeq: '2' })
    )
    ;(window as any).__dinotty_ui_notify('offline', 'error')
    await flushBridge()
    await vi.advanceTimersByTimeAsync(1000)
    await flushBridge()

    expect(mocks.authFetch).toHaveBeenCalledTimes(2)
    const requestBodies = mocks.authFetch.mock.calls.map(([, init]) =>
      JSON.parse(init!.body as string)
    )
    expect(requestBodies[0].requestId).toBe(requestBodies[1].requestId)
    expect(requestBodies[0]).toEqual(requestBodies[1])
    expect(mocks.pushNotification).not.toHaveBeenCalled()
  })

  it('does not insert for a suppressed response', async () => {
    await mountWithTabs()
    mocks.authFetch.mockClear()
    mocks.authFetch.mockResolvedValueOnce(
      response(200, { status: 'suppressed', reason: 'disabled' })
    )
    ;(window as any).__dinotty_ui_notify('suppressed', 'info')
    await flushBridge()

    expect(mocks.authFetch).toHaveBeenCalledTimes(1)
    expect(mocks.pushNotification).not.toHaveBeenCalled()
  })

  it('retries HTTP 503 responses regardless of body shape with the same requestId', async () => {
    await mountWithTabs()
    mocks.authFetch.mockClear()
    vi.useFakeTimers()
    mocks.authFetch
      .mockResolvedValueOnce({
        ok: false,
        status: 503,
        json: async () => {
          throw new SyntaxError('truncated proxy response')
        },
      })
      .mockResolvedValueOnce(response(503, { status: 'unexpected-proxy-shape' }))
      .mockResolvedValueOnce(
        response(200, { status: 'accepted', notifId: 'notif-3', eventSeq: '3' })
      )
    ;(window as any).__dinotty_ui_notify('busy', 'info')
    await flushBridge()
    await vi.advanceTimersByTimeAsync(3000)
    await flushBridge()

    expect(mocks.authFetch).toHaveBeenCalledTimes(3)
    const requestBodies = mocks.authFetch.mock.calls.map(([, init]) =>
      JSON.parse(init!.body as string)
    )
    expect(new Set(requestBodies.map(({ requestId }) => requestId))).toEqual(
      new Set([requestBodies[0].requestId])
    )
    expect(requestBodies[1]).toEqual(requestBodies[0])
    expect(requestBodies[2]).toEqual(requestBodies[0])
    expect(mocks.pushNotification).not.toHaveBeenCalled()
  })

  it('gives separate jobs distinct requestIds while preserving each id across retries', async () => {
    await mountWithTabs()
    mocks.authFetch.mockClear()
    vi.useFakeTimers()
    const attemptsByRequestId = new Map<string, number>()
    mocks.authFetch.mockImplementation(async (_input, init) => {
      const request = JSON.parse(init!.body as string)
      const attempt = (attemptsByRequestId.get(request.requestId) ?? 0) + 1
      attemptsByRequestId.set(request.requestId, attempt)
      if (attempt === 1) throw new Error('network')
      return response(200, { status: 'accepted', notifId: request.requestId, eventSeq: '1' })
    })
    ;(window as any).__dinotty_ui_notify('first', 'info')
    ;(window as any).__dinotty_ui_notify('second', 'warn')
    await flushBridge()
    await vi.advanceTimersByTimeAsync(1000)
    await flushBridge()

    const requests = mocks.authFetch.mock.calls.map(([, init]) => JSON.parse(init!.body as string))
    const requestIdsByBody = new Map<string, Set<string>>()
    for (const request of requests) {
      const ids = requestIdsByBody.get(request.body) ?? new Set<string>()
      ids.add(request.requestId)
      requestIdsByBody.set(request.body, ids)
    }
    expect([...requestIdsByBody.keys()].sort()).toEqual(['first', 'second'])
    expect(requestIdsByBody.get('first')?.size).toBe(1)
    expect(requestIdsByBody.get('second')?.size).toBe(1)
    expect([...requestIdsByBody.get('first')!][0]).not.toBe([...requestIdsByBody.get('second')!][0])
    expect([...attemptsByRequestId.values()]).toEqual([2, 2])
  })

  it.each([400, 404, 409])(
    'treats HTTP %s as terminal without retrying or inserting locally',
    async (status) => {
      await mountWithTabs()
      mocks.authFetch.mockClear()
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
      mocks.authFetch.mockResolvedValueOnce(response(status, { status: 'terminal' }))
      ;(window as any).__dinotty_ui_notify('rejected', 'info')
      await flushBridge()

      expect(mocks.authFetch).toHaveBeenCalledTimes(1)
      expect(mocks.pushNotification).not.toHaveBeenCalled()
      expect(consoleError).toHaveBeenCalledWith(
        `[notification] plugin notify failed with HTTP ${status}`
      )
      consoleError.mockRestore()
    }
  )

  it('falls back exactly once after all four retryable attempts fail', async () => {
    await mountWithTabs()
    mocks.authFetch.mockClear()
    vi.useFakeTimers()
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    mocks.authFetch.mockRejectedValue(new Error('offline'))
    ;(window as any).__dinotty_ui_notify('offline', 'error')
    await flushBridge()
    await vi.advanceTimersByTimeAsync(7000)
    await flushBridge()

    expect(mocks.authFetch).toHaveBeenCalledTimes(4)
    expect(mocks.pushNotification).toHaveBeenCalledTimes(1)
    expect(mocks.pushNotification).toHaveBeenCalledWith({
      type: 'error',
      title: 'Plugin',
      body: 'offline',
      source: 'plugin',
    })
    consoleError.mockRestore()
  })

  it('limits a failing notification burst to three concurrent fetches', async () => {
    await mountWithTabs()
    mocks.authFetch.mockClear()
    mocks.pushNotification.mockClear()
    vi.useFakeTimers()
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    let inFlight = 0
    let maxInFlight = 0
    const attemptsByBody = new Map<string, number>()
    const requestIdsByBody = new Map<string, Set<string>>()
    const attemptsByRequestId = new Map<string, number>()
    mocks.authFetch.mockImplementation(
      (_input, init) =>
        new Promise((_, reject) => {
          const request = JSON.parse(init!.body as string)
          attemptsByBody.set(request.body, (attemptsByBody.get(request.body) ?? 0) + 1)
          const ids = requestIdsByBody.get(request.body) ?? new Set<string>()
          ids.add(request.requestId)
          requestIdsByBody.set(request.body, ids)
          attemptsByRequestId.set(
            request.requestId,
            (attemptsByRequestId.get(request.requestId) ?? 0) + 1
          )
          inFlight++
          maxInFlight = Math.max(maxInFlight, inFlight)
          setTimeout(() => {
            inFlight--
            reject(new Error('offline'))
          }, 10)
        })
    )

    for (let i = 0; i < 12; i++) {
      ;(window as any).__dinotty_ui_notify(`burst-${i}`, 'info')
    }
    await flushBridge()
    await vi.runAllTimersAsync()
    await flushBridge()

    expect(maxInFlight).toBe(3)
    expect(mocks.authFetch).toHaveBeenCalledTimes(48)
    expect([...attemptsByBody.keys()].sort()).toEqual(
      Array.from({ length: 12 }, (_, i) => `burst-${i}`).sort()
    )
    expect([...attemptsByBody.values()]).toEqual(Array(12).fill(4))
    expect([...requestIdsByBody.values()].every((ids) => ids.size === 1)).toBe(true)
    expect(attemptsByRequestId.size).toBe(12)
    expect([...attemptsByRequestId.values()]).toEqual(Array(12).fill(4))
    consoleError.mockRestore()
  })

  it('aggregates overflow warnings while evicting the oldest queued jobs', async () => {
    await mountWithTabs()
    mocks.authFetch.mockClear()
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const pending: Array<{
      body: string
      resolve: (value: ReturnType<typeof response>) => void
    }> = []
    mocks.authFetch.mockImplementation(
      (_input, init) =>
        new Promise((resolve) => {
          pending.push({ body: init!.body as string, resolve })
        })
    )

    for (let i = 0; i < 72; i++) {
      ;(window as any).__dinotty_ui_notify(`queued-${i}`, 'info')
    }
    await flushBridge()

    expect(mocks.authFetch).toHaveBeenCalledTimes(3)
    expect(consoleWarn).toHaveBeenCalledTimes(1)
    expect(consoleWarn).toHaveBeenCalledWith(
      '[notification] plugin notify bridge queue full; evicted 5 oldest pending jobs'
    )
    pending
      .splice(0, 3)
      .forEach(({ resolve }) =>
        resolve(response(200, { status: 'accepted', notifId: 'notif', eventSeq: '1' }))
      )
    await flushBridge()

    const startedAfterSlotRelease = mocks.authFetch.mock.calls
      .slice(3, 6)
      .map(([, init]) => JSON.parse(init!.body as string).body)
    expect(startedAfterSlotRelease).toEqual(['queued-8', 'queued-9', 'queued-10'])
    pending
      .splice(0)
      .forEach(({ resolve }) =>
        resolve(response(200, { status: 'accepted', notifId: 'notif', eventSeq: '1' }))
      )
    await flushBridge()
    consoleWarn.mockRestore()
  })

  it('aborts pending fetches on unmount without retrying, starting queued work, or falling back', async () => {
    const wrapper = await mountWithTabs()
    mocks.authFetch.mockClear()
    mocks.pushNotification.mockClear()
    const signals: AbortSignal[] = []
    let abortEvents = 0
    mocks.authFetch.mockImplementation(
      (_input, init) =>
        new Promise((_, reject) => {
          const signal = init!.signal as AbortSignal
          signals.push(signal)
          signal.addEventListener('abort', () => {
            abortEvents++
            const error = new Error('aborted')
            error.name = 'AbortError'
            reject(error)
          })
        })
    )

    for (let i = 0; i < 4; i++) {
      ;(window as any).__dinotty_ui_notify(`dispose-${i}`, 'error')
    }
    await flushBridge()
    expect(mocks.authFetch).toHaveBeenCalledTimes(3)
    expect(signals.every((signal) => !signal.aborted)).toBe(true)

    wrapper.unmount()
    clearMountedWrapper()
    await flushBridge()

    expect(abortEvents).toBe(3)
    expect(signals.every((signal) => signal.aborted)).toBe(true)
    expect(mocks.authFetch).toHaveBeenCalledTimes(3)
    const startedBodies = mocks.authFetch.mock.calls.map(
      ([, init]) => JSON.parse(init!.body as string).body
    )
    expect(startedBodies).toEqual(['dispose-0', 'dispose-1', 'dispose-2'])
    expect(mocks.pushNotification).not.toHaveBeenCalled()
  })
})

describe('App.vue - notification tab indicator display filter', () => {
  it('hides and shows the rendered indicator without mutating authoritative unread state', async () => {
    mocks.authoritativeSeverity = 'warning'
    mocks.unreadByPane['pane-1'] = 'warning'
    mocks.presentationSettings.channels.tab_indicator = true
    const wrapper = await mountWithTabs()
    const tabBar = wrapper.findComponent(TabBarStub)

    expect(tabBar.attributes('data-indicators')).toContain('warning')
    expect(mocks.unreadByPane['pane-1']).toBe('warning')

    mocks.presentationSettings.channels.tab_indicator = false
    await nextTick()
    expect(tabBar.attributes('data-indicators')).toBe('{}')
    expect(mocks.unreadByPane['pane-1']).toBe('warning')

    mocks.presentationSettings.channels.tab_indicator = true
    await nextTick()
    expect(tabBar.attributes('data-indicators')).toContain('warning')
    expect(mocks.unreadByPane['pane-1']).toBe('warning')
  })
})
