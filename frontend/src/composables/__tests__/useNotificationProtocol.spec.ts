import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

function memoryStorage(): Storage {
  const values = new Map<string, string>()
  return {
    get length() {
      return values.size
    },
    clear: () => values.clear(),
    getItem: (key: string) => values.get(key) ?? null,
    key: (index: number) => [...values.keys()][index] ?? null,
    removeItem: (key: string) => values.delete(key),
    setItem: (key: string, value: string) => values.set(key, String(value)),
  }
}

vi.stubGlobal('localStorage', memoryStorage())
vi.stubGlobal('sessionStorage', memoryStorage())

const transportMock = vi.hoisted(() => ({ tauri: false }))
vi.stubGlobal('location', {
  protocol: 'http:',
  host: 'localhost',
})

vi.mock('vue-toastification', () => ({
  TYPE: { INFO: 'info', SUCCESS: 'success', WARNING: 'warning', ERROR: 'error' },
}))

vi.mock('../useI18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}))

vi.mock('../useTransport', () => ({ isTauri: () => transportMock.tauri }))

const syncMock = vi.hoisted(() => ({
  sentPayloads: [] as any[],
  clientId: 'client-test',
}))
vi.mock('../useSyncWebSocket', () => ({
  onNotification: () => () => {},
  getClientId: () => syncMock.clientId,
  sendMarkRead: (payload: any) => { syncMock.sentPayloads.push(payload) },
}))

import { settings } from '../useSettings'
import {
  __dispatchServerMessageForTest,
  __pendingRequestCountForTest,
  __restoreNotificationSessionHistoryForTest,
  __resetForTest,
  NOTIFICATION_SESSION_HISTORY_KEY,
  useNotification,
  type NotificationItem,
} from '../useNotification'

function snapshot(
  revision: string,
  panes: Array<{
    paneId: string
    latestEventSeq: string
    readThroughSeq: string
    severity: string | null
  }> = [],
  notifs: Array<{ notifId: string; read: boolean }> = [],
  epoch = 'epoch-a'
) {
  return {
    type: 'snapshot',
    epoch,
    revision,
    panes: panes.map((pane) => ({ ...pane, firstUnreadAt: 100 })),
    notifs,
  }
}

function delta(
  revision: string,
  panes: Array<{
    paneId: string
    latestEventSeq: string
    readThroughSeq: string
    severity: string | null
  }> = [],
  notifs: Array<{ notifId: string; read: boolean }> = []
) {
  return {
    type: 'state_delta',
    epoch: 'epoch-a',
    revision,
    panes: panes.map((pane) => ({ ...pane, firstUnreadAt: 100 })),
    notifs,
  }
}

function legacyEvent(overrides: Record<string, unknown> = {}) {
  return {
    type: 'notify',
    v: 1,
    pane_id: 'pane-a',
    title: null,
    body: 'done',
    notification_type: 'info',
    eventSeq: '1',
    occurredAt: 100,
    severity: 'info',
    ...overrides,
  }
}

function current() {
  return useNotification()
}

beforeEach(() => {
  vi.useFakeTimers()
  __resetForTest()
  syncMock.sentPayloads = []
  syncMock.clientId = 'client-test'
  localStorage.clear()
  sessionStorage.clear()
  transportMock.tauri = false
  ;(settings as any).notification = {
    enabled: true,
    osc_notify: true,
    bell: { enabled: true },
    channels: { sound: false, vibration: false, panel: true, tab_indicator: false },
    sounds: {},
  }
})

afterEach(() => {
  __resetForTest()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('useNotification protocol dispatcher', () => {
  it('dispatches state, resync, snapshot, ack, and legacy envelopes', () => {
    const notif = current()

    __dispatchServerMessageForTest(
      snapshot('1', [
        { paneId: 'pane-a', latestEventSeq: '2', readThroughSeq: '0', severity: 'error' },
      ])
    )
    expect(notif.unreadByPane['pane-a']).toBe('error')

    notif.markPanesRead([{ paneId: 'pane-a' }], 'focus')
    expect(notif.unreadAttentionCount.value).toBe(0)

    expect(syncMock.sentPayloads).toHaveLength(1)
    const payload = syncMock.sentPayloads[0]
    expect(payload).toMatchObject({
      type: 'mark_read',
      v: 1,
      epoch: 'epoch-a',
      reason: 'focus',
      panes: [{ paneId: 'pane-a', throughEventSeq: '2' }],
      notifs: [],
    })
    expect(payload.clientId).toEqual(expect.any(String))
    expect(payload.requestId).toEqual(expect.any(String))
    __dispatchServerMessageForTest({
      type: 'mark_read_result',
      requestId: payload.requestId,
      epoch: 'epoch-a',
      appliedAtRevision: null,
      results: [{ target: { paneId: 'pane-a' }, status: 'conflict' }],
    })
    expect(notif.unreadAttentionCount.value).toBe(1)

    __dispatchServerMessageForTest({ type: 'resync_required', v: 1 })
    __dispatchServerMessageForTest(
      delta('2', [{ paneId: 'pane-a', latestEventSeq: '2', readThroughSeq: '2', severity: null }])
    )
    expect(notif.unreadAttentionCount.value).toBe(1)

    __dispatchServerMessageForTest(
      snapshot('2', [
        { paneId: 'pane-a', latestEventSeq: '2', readThroughSeq: '2', severity: null },
      ])
    )
    expect(notif.unreadAttentionCount.value).toBe(0)

    __dispatchServerMessageForTest(legacyEvent({ eventSeq: '3' }))
    expect(notif.historyCount.value).toBe(1)
  })

  it('bounds ack-timeout resends and rolls back the overlay after exhaustion', async () => {
    const notif = current()
    __dispatchServerMessageForTest(
      snapshot('1', [
        { paneId: 'pane-a', latestEventSeq: '7', readThroughSeq: '0', severity: 'warning' },
      ])
    )

    notif.markPanesRead([{ paneId: 'pane-a' }], 'terminal_input')
    expect(syncMock.sentPayloads).toHaveLength(1)
    expect(notif.unreadAttentionCount.value).toBe(0)

    await vi.advanceTimersByTimeAsync(15_000)
    expect(syncMock.sentPayloads).toHaveLength(4)
    expect(new Set(syncMock.sentPayloads).size).toBe(1)
    expect(notif.unreadAttentionCount.value).toBe(0)

    await vi.advanceTimersByTimeAsync(5_000)
    expect(syncMock.sentPayloads).toHaveLength(4)
    expect(notif.unreadAttentionCount.value).toBe(1)
  })

  it('deduplicates history by epoch plus pane sequence or pane-less notif identity', () => {
    const notif = current()
    __dispatchServerMessageForTest(snapshot('1'))

    __dispatchServerMessageForTest(legacyEvent())
    __dispatchServerMessageForTest(legacyEvent())
    __dispatchServerMessageForTest(
      legacyEvent({ pane_id: '', notifId: 'notif-1', eventSeq: '9', body: 'plugin' })
    )
    __dispatchServerMessageForTest(
      legacyEvent({ pane_id: '', notifId: 'notif-1', eventSeq: '10', body: 'plugin duplicate' })
    )
    expect(notif.historyCount.value).toBe(2)

    __dispatchServerMessageForTest(snapshot('0', [], [], 'epoch-b'))
    __dispatchServerMessageForTest(legacyEvent())
    __dispatchServerMessageForTest(
      legacyEvent({ pane_id: '', notifId: 'notif-1', eventSeq: '11', body: 'new epoch' })
    )
    expect(notif.historyCount.value).toBe(4)
  })

  it('restores notification cards across a page reload before the same-epoch snapshot arrives', () => {
    const notif = current()
    __dispatchServerMessageForTest(snapshot('1'))
    __dispatchServerMessageForTest(legacyEvent({ body: 'survives reload' }))
    __dispatchServerMessageForTest(
      legacyEvent({ pane_id: '', notifId: 'notif-1', eventSeq: '2', body: 'plugin survives' })
    )

    const persisted = sessionStorage.getItem(NOTIFICATION_SESSION_HISTORY_KEY)
    expect(persisted).not.toBeNull()

    notif.notifications.value = []
    sessionStorage.setItem(NOTIFICATION_SESSION_HISTORY_KEY, persisted!)
    __restoreNotificationSessionHistoryForTest()

    expect(notif.notifications.value.map(({ body }) => body)).toEqual([
      'plugin survives',
      'survives reload',
    ])

    __dispatchServerMessageForTest(snapshot(
      '2',
      [{ paneId: 'pane-a', latestEventSeq: '1', readThroughSeq: '0', severity: 'info' }],
      [{ notifId: 'notif-1', read: false }],
    ))
    expect(notif.unreadAttentionCount.value).toBe(2)
    expect(notif.notifications.value).toHaveLength(2)
  })

  it('ignores corrupt persisted notification history', () => {
    const notif = current()
    sessionStorage.setItem(NOTIFICATION_SESSION_HISTORY_KEY, '{not-json')

    __restoreNotificationSessionHistoryForTest()

    expect(notif.notifications.value).toEqual([])
    expect(sessionStorage.getItem(NOTIFICATION_SESSION_HISTORY_KEY)).toBeNull()
  })

  it('defers restored-card dismissal until the first snapshot resolves its epoch', () => {
    const notif = current()
    sessionStorage.setItem(NOTIFICATION_SESSION_HISTORY_KEY, JSON.stringify([{
      id: 'restored-pane',
      type: 'warning',
      paneId: 'pane-a',
      title: null,
      body: 'restored',
      timestamp: 100,
      source: 'terminal',
      eventSeq: '1',
      epoch: 'epoch-a',
    }]))
    __restoreNotificationSessionHistoryForTest()

    notif.dismissOne('restored-pane')

    expect(notif.notifications.value).toHaveLength(1)
    expect(syncMock.sentPayloads).toEqual([])

    __dispatchServerMessageForTest(snapshot(
      '1',
      [{ paneId: 'pane-a', latestEventSeq: '1', readThroughSeq: '0', severity: 'warning' }],
    ))

    expect(notif.notifications.value).toEqual([])
    expect(syncMock.sentPayloads).toHaveLength(1)
    expect(syncMock.sentPayloads[0]).toMatchObject({
      reason: 'dismiss',
      panes: [{ paneId: 'pane-a', throughEventSeq: '1' }],
    })
  })

  it('defers restored-card clear actions until the first snapshot can mark their targets read', () => {
    const notif = current()
    sessionStorage.setItem(NOTIFICATION_SESSION_HISTORY_KEY, JSON.stringify([
      {
        id: 'restored-pane', type: 'info', paneId: 'pane-a', title: null,
        body: 'pane', timestamp: 100, source: 'terminal', eventSeq: '1', epoch: 'epoch-a',
      },
      {
        id: 'restored-notif', type: 'success', title: null,
        body: 'plugin', timestamp: 101, source: 'plugin', eventSeq: '2',
        notifId: 'notif-a', epoch: 'epoch-a',
      },
    ]))
    __restoreNotificationSessionHistoryForTest()

    notif.clearForPaneIds(['pane-a'], 'tab_activate')
    notif.clearAll()

    expect(notif.notifications.value).toHaveLength(2)
    expect(syncMock.sentPayloads).toEqual([])

    __dispatchServerMessageForTest(snapshot(
      '1',
      [{ paneId: 'pane-a', latestEventSeq: '1', readThroughSeq: '0', severity: 'info' }],
      [{ notifId: 'notif-a', read: false }],
    ))

    expect(notif.notifications.value).toEqual([])
    expect(syncMock.sentPayloads.map(({ reason }) => reason)).toEqual(['tab_activate', 'clear_all'])
    expect(notif.unreadAttentionCount.value).toBe(0)
  })

  it('keeps restored-card actions deferred when a delta arrives before the first snapshot', () => {
    const notif = current()
    sessionStorage.setItem(NOTIFICATION_SESSION_HISTORY_KEY, JSON.stringify([{
      id: 'restored-pane',
      type: 'warning',
      paneId: 'pane-a',
      title: null,
      body: 'restored',
      timestamp: 100,
      source: 'terminal',
      eventSeq: '1',
      epoch: 'epoch-a',
    }]))
    __restoreNotificationSessionHistoryForTest()

    notif.clearAll()
    __dispatchServerMessageForTest(delta(
      '1',
      [{ paneId: 'pane-a', latestEventSeq: '1', readThroughSeq: '0', severity: 'warning' }],
    ))

    expect(notif.notifications.value).toHaveLength(1)
    expect(syncMock.sentPayloads).toEqual([])

    __dispatchServerMessageForTest(snapshot(
      '2',
      [{ paneId: 'pane-a', latestEventSeq: '1', readThroughSeq: '0', severity: 'warning' }],
    ))

    expect(notif.notifications.value).toEqual([])
    expect(syncMock.sentPayloads).toHaveLength(1)
    expect(syncMock.sentPayloads[0]).toMatchObject({
      reason: 'clear_all',
      panes: [{ paneId: 'pane-a', throughEventSeq: '1' }],
    })
  })

  it('keeps authoritative attention count independent from history count', () => {
    const notif = current()
    __dispatchServerMessageForTest(
      snapshot(
        '1',
        [{ paneId: 'pane-a', latestEventSeq: '1', readThroughSeq: '0', severity: 'urgent' }],
        [{ notifId: 'notif-a', read: false }]
      )
    )
    expect(notif.unreadAttentionCount.value).toBe(2)
    expect(notif.historyCount.value).toBe(0)

    __dispatchServerMessageForTest(legacyEvent())
    expect(notif.unreadAttentionCount.value).toBe(2)
    expect(notif.historyCount.value).toBe(1)
  })

  it('projects firstUnreadAt values alongside unread severity', () => {
    const notif = current()
    __dispatchServerMessageForTest(
      snapshot('1', [
        { paneId: 'pane-a', latestEventSeq: '1', readThroughSeq: '0', severity: 'urgent' },
      ])
    )
    expect(notif.firstUnreadAtByPane['pane-a']).toBe(100)

    __dispatchServerMessageForTest(
      delta('2', [
        { paneId: 'pane-a', latestEventSeq: '1', readThroughSeq: '1', severity: null },
      ])
    )
    expect(notif.firstUnreadAtByPane['pane-a']).toBe(100)

    __dispatchServerMessageForTest({
      type: 'state_delta',
      epoch: 'epoch-a',
      revision: '3',
      panes: [
        {
          paneId: 'pane-a',
          latestEventSeq: '1',
          readThroughSeq: '1',
          firstUnreadAt: null,
          severity: null,
        },
      ],
      notifs: [],
    })
    expect(notif.firstUnreadAtByPane['pane-a']).toBeNull()
  })

  it('clearAll sends one combined request with authoritative pane and notif targets', () => {
    const notif = current()
    __dispatchServerMessageForTest(
      snapshot(
        '1',
        [{ paneId: 'pane-a', latestEventSeq: '8', readThroughSeq: '2', severity: 'warning' }],
        [{ notifId: 'notif-a', read: false }]
      )
    )

    notif.clearAll()

    expect(syncMock.sentPayloads).toHaveLength(1)
    expect(syncMock.sentPayloads[0]).toMatchObject({
      reason: 'clear_all',
      panes: [{ paneId: 'pane-a', throughEventSeq: '8' }],
      notifs: [{ notifId: 'notif-a' }],
    })
    expect(notif.unreadAttentionCount.value).toBe(0)
  })

  it('stale_epoch cancels every pending overlay', () => {
    const notif = current()
    __dispatchServerMessageForTest(
      snapshot('1', [
        { paneId: 'a', latestEventSeq: '1', readThroughSeq: '0', severity: 'info' },
        { paneId: 'b', latestEventSeq: '2', readThroughSeq: '0', severity: 'error' },
      ])
    )
    notif.markPanesRead([{ paneId: 'a' }], 'focus')
    notif.markPanesRead([{ paneId: 'b' }], 'focus')
    expect(notif.unreadAttentionCount.value).toBe(0)

    const firstPayload = syncMock.sentPayloads[0]
    __dispatchServerMessageForTest({
      type: 'mark_read_result',
      requestId: firstPayload.requestId,
      epoch: 'epoch-b',
      appliedAtRevision: null,
      results: [{ target: { paneId: 'a' }, status: 'stale_epoch' }],
    })
    expect(notif.unreadAttentionCount.value).toBe(2)
  })

  it('bounds pending requests, evicts the oldest at 64, and expires all overlays', async () => {
    const notif = current()
    const panes = Array.from({ length: 65 }, (_, index) => ({
      paneId: `pane-${index}`,
      latestEventSeq: String(index + 1),
      readThroughSeq: '0',
      severity: 'warning',
    }))
    __dispatchServerMessageForTest(snapshot('1', panes))
    const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout')

    for (const pane of panes) notif.markPanesRead([{ paneId: pane.paneId }], 'focus')

    expect(__pendingRequestCountForTest()).toBe(64)
    expect(notif.unreadAttentionCount.value).toBe(1)
    expect(clearTimeoutSpy).toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(20_000)
    expect(__pendingRequestCountForTest()).toBe(0)
    expect(notif.unreadAttentionCount.value).toBe(65)
  })

  it('dismisses a stale-epoch history card locally without sending mark_read', () => {
    const notif = current()
    __dispatchServerMessageForTest(
      snapshot('1', [
        { paneId: 'pane-a', latestEventSeq: '1', readThroughSeq: '0', severity: 'info' },
      ])
    )
    __dispatchServerMessageForTest(legacyEvent())
    const item = notif.notifications.value[0]

    __dispatchServerMessageForTest(
      snapshot(
        '1',
        [{ paneId: 'pane-a', latestEventSeq: '9', readThroughSeq: '0', severity: 'urgent' }],
        [],
        'epoch-b'
      )
    )
    notif.dismissOne(item.id)

    expect(notif.notifications.value).toHaveLength(0)
    expect(syncMock.sentPayloads).toHaveLength(0)
    expect(notif.unreadAttentionCount.value).toBe(1)
  })

  it('drops pending entries on epoch change instead of resending them', () => {
    const notif = current()
    __dispatchServerMessageForTest(
      snapshot('1', [
        { paneId: 'pane-a', latestEventSeq: '3', readThroughSeq: '0', severity: 'info' },
      ])
    )
    notif.markPanesRead([{ paneId: 'pane-a' }], 'focus')
    expect(syncMock.sentPayloads).toHaveLength(1)

    __dispatchServerMessageForTest(
      snapshot(
        '1',
        [{ paneId: 'pane-a', latestEventSeq: '8', readThroughSeq: '0', severity: 'error' }],
        [],
        'epoch-b'
      )
    )

    expect(syncMock.sentPayloads).toHaveLength(1)
    expect(__pendingRequestCountForTest()).toBe(0)
    expect(notif.unreadAttentionCount.value).toBe(1)
  })

  it('cancels the resend timer when mark_read_result arrives', async () => {
    const notif = current()
    __dispatchServerMessageForTest(
      snapshot('1', [
        { paneId: 'pane-a', latestEventSeq: '3', readThroughSeq: '0', severity: 'info' },
      ])
    )
    notif.markPanesRead([{ paneId: 'pane-a' }], 'focus')
    const payload = syncMock.sentPayloads[0]

    __dispatchServerMessageForTest({
      type: 'mark_read_result',
      requestId: payload.requestId,
      epoch: 'epoch-a',
      appliedAtRevision: '2',
      results: [{ target: { paneId: 'pane-a' }, status: 'applied' }],
    })
    await vi.advanceTimersByTimeAsync(20_000)

    expect(syncMock.sentPayloads).toHaveLength(1)
    expect(__pendingRequestCountForTest()).toBe(0)
  })

  it('retires a proved overlay through snapshot message dispatch', async () => {
    const notif = current()
    __dispatchServerMessageForTest(
      snapshot('1', [
        { paneId: 'pane-a', latestEventSeq: '3', readThroughSeq: '0', severity: 'info' },
      ])
    )
    notif.markPanesRead([{ paneId: 'pane-a' }], 'focus')

    __dispatchServerMessageForTest(
      snapshot('2', [
        { paneId: 'pane-a', latestEventSeq: '3', readThroughSeq: '3', severity: null },
      ])
    )
    await vi.advanceTimersByTimeAsync(20_000)

    expect(__pendingRequestCountForTest()).toBe(0)
    expect(syncMock.sentPayloads).toHaveLength(1)
    expect(notif.unreadAttentionCount.value).toBe(0)
  })

  it('retires and cancels a proved overlay through delta message dispatch', async () => {
    const notif = current()
    __dispatchServerMessageForTest(
      snapshot('1', [
        { paneId: 'pane-a', latestEventSeq: '3', readThroughSeq: '0', severity: 'info' },
      ])
    )
    notif.markPanesRead([{ paneId: 'pane-a' }], 'focus')

    __dispatchServerMessageForTest(
      delta('2', [
        { paneId: 'pane-a', latestEventSeq: '3', readThroughSeq: '3', severity: null },
      ])
    )
    await vi.advanceTimersByTimeAsync(20_000)

    expect(__pendingRequestCountForTest()).toBe(0)
    expect(syncMock.sentPayloads).toHaveLength(1)
    expect(notif.unreadAttentionCount.value).toBe(0)
  })

  it('keeps the history item identity fields from legacy envelopes', () => {
    const notif = current()
    __dispatchServerMessageForTest(snapshot('1'))
    __dispatchServerMessageForTest(legacyEvent({ eventSeq: '55', notifId: undefined }))
    const item = notif.notifications.value[0] as NotificationItem
    expect(item.eventSeq).toBe('55')
    expect(item.notifId).toBeUndefined()
  })
})
