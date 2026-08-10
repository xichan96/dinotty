import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'

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
vi.stubGlobal('location', { protocol: 'http:', host: 'localhost' })

vi.mock('vue-toastification', () => ({
  TYPE: { INFO: 'info', SUCCESS: 'success', WARNING: 'warning', ERROR: 'error' },
}))
vi.mock('../useI18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))
vi.mock('../useTransport', () => ({ isTauri: () => false }))

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
  __pendingPresentationCountForTest,
  __pendingRequestCountForTest,
  __resetForTest,
  __setPresentationEffectsForTest,
  evaluateActiveRead,
  markPaneReadIfUnread,
  markNotifsRead,
  markPanesRead,
  pushNotification,
  setActiveReadContext,
  setGoToPaneHandler,
  setToastInstance,
  useNotification,
} from '../useNotification'
import { useNotificationPresentation } from '../useNotificationPresentation'
import NotificationPanel from '../../components/notification/NotificationPanel.vue'

function pane(paneId: string, latestEventSeq: string, readThroughSeq = '0') {
  return {
    paneId,
    latestEventSeq,
    readThroughSeq,
    firstUnreadAt: 100,
    severity: latestEventSeq === readThroughSeq ? null : 'warning',
  }
}

function snapshot(
  revision: string,
  panes = [] as ReturnType<typeof pane>[],
  notifs = [] as Array<{ notifId: string; read: boolean | null; removed?: true }>,
) {
  return { type: 'snapshot', epoch: 'epoch-a', revision, panes, notifs }
}

function delta(
  revision: string,
  panes = [] as Array<ReturnType<typeof pane> | {
    paneId: string
    latestEventSeq: null
    readThroughSeq: null
    firstUnreadAt: null
    severity: null
    removed: true
  }>,
  notifs = [] as Array<{ notifId: string; read: boolean | null; removed?: true }>,
) {
  return { type: 'state_delta', epoch: 'epoch-a', revision, panes, notifs }
}

function raised(overrides: Record<string, unknown> = {}) {
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

function createToastSpy() {
  let nextId = 0
  const toast = vi.fn(() => `toast-${++nextId}`) as ReturnType<typeof vi.fn> & {
    dismiss: ReturnType<typeof vi.fn>
  }
  toast.dismiss = vi.fn()
  return toast
}

beforeEach(() => {
  vi.useFakeTimers()
  __resetForTest()
  syncMock.sentPayloads = []
  syncMock.clientId = 'client-test'
  localStorage.clear()
  ;(settings as any).notification = {
    enabled: true,
    osc_notify: true,
    bell: { enabled: true },
    channels: { sound: false, vibration: false, panel: true, tab_indicator: false },
    sounds: {},
  }
  const presentation = useNotificationPresentation().settings
  presentation.channels.sound = false
  presentation.channels.vibration = false
  presentation.channels.panel = true
  vi.stubGlobal('navigator', { vibrate: vi.fn() })
})

afterEach(() => {
  vi.restoreAllMocks()
  __resetForTest()
  vi.useRealTimers()
})

describe('active-read state triggers', () => {
  it.each([
    ['snapshot', () => snapshot('1', [pane('pane-a', '7')])],
    [
      'delta',
      () => {
        __dispatchServerMessageForTest(snapshot('1'))
        return delta('2', [pane('pane-a', '7')])
      },
    ],
  ])('marks an active foreground pane read from a %s without a raised envelope', (_, message) => {
    const notif = useNotification()
    setActiveReadContext({
      getActiveFocusedPaneId: () => 'pane-a',
      isAppForeground: () => true,
      getActiveTabPaneIds: () => ['pane-a'],
    })

    __dispatchServerMessageForTest(message())

    expect(notif.unreadByPane['pane-a']).toBeUndefined()
    expect(notif.unreadAttentionCount.value).toBe(0)
    expect(__pendingRequestCountForTest()).toBe(1)
    const sent = syncMock.sentPayloads
    expect(sent[sent.length - 1]).toMatchObject({
      reason: 'active_observed',
      panes: [{ paneId: 'pane-a', throughEventSeq: '7' }],
    })
  })

  it.each([
    ['backgrounded', 'pane-a', false, true],
    ['different focused pane', 'pane-b', true, true],
    ['unregistered context', 'pane-a', true, false],
  ])('does not active-read when %s', (_, focusedPaneId, foreground, registered) => {
    const notif = useNotification()
    if (registered) {
      setActiveReadContext({
        getActiveFocusedPaneId: () => focusedPaneId,
        isAppForeground: () => foreground,
        getActiveTabPaneIds: () => ['pane-a'],
      })
    }

    __dispatchServerMessageForTest(snapshot('1', [pane('pane-a', '4')]))

    expect(notif.unreadByPane['pane-a']).toBe('warning')
    expect(__pendingRequestCountForTest()).toBe(0)
  })

  it('does not emit a duplicate while the optimistic overlay masks the pane', () => {
    useNotification()
    setActiveReadContext({
      getActiveFocusedPaneId: () => 'pane-a',
      isAppForeground: () => true,
      getActiveTabPaneIds: () => ['pane-a'],
    })
    __dispatchServerMessageForTest(snapshot('1', [pane('pane-a', '5')]))
    __dispatchServerMessageForTest(delta('2', [pane('pane-a', '5')]))

    expect(__pendingRequestCountForTest()).toBe(1)
    expect(syncMock.sentPayloads).toHaveLength(1)
  })

  it('does not active-read an interim delta discarded while awaiting a snapshot', () => {
    useNotification()
    setActiveReadContext({
      getActiveFocusedPaneId: () => 'pane-a',
      isAppForeground: () => true,
      getActiveTabPaneIds: () => ['pane-a'],
    })
    __dispatchServerMessageForTest(snapshot('1'))
    __dispatchServerMessageForTest({ type: 'resync_required' })

    __dispatchServerMessageForTest(delta('2', [pane('pane-a', '5')]))

    expect(__pendingRequestCountForTest()).toBe(0)
    expect(syncMock.sentPayloads).toHaveLength(0)
  })

  it('active-reads a genuinely newer event above an existing overlay watermark', () => {
    useNotification()
    setActiveReadContext({
      getActiveFocusedPaneId: () => 'pane-a',
      isAppForeground: () => true,
      getActiveTabPaneIds: () => ['pane-a'],
    })
    __dispatchServerMessageForTest(snapshot('1', [pane('pane-a', '5')]))

    __dispatchServerMessageForTest(delta('2', [pane('pane-a', '6')]))

    expect(__pendingRequestCountForTest()).toBe(2)
    const sent = syncMock.sentPayloads
    expect(sent).toHaveLength(2)
    expect(sent[0]).toMatchObject({
      reason: 'active_observed',
      panes: [{ paneId: 'pane-a', throughEventSeq: '5' }],
    })
    expect(sent[1]).toMatchObject({
      reason: 'active_observed',
      panes: [{ paneId: 'pane-a', throughEventSeq: '6' }],
    })
  })

  it('does not re-emit active_observed when a proving read delta retires its overlay', () => {
    useNotification()
    setActiveReadContext({
      getActiveFocusedPaneId: () => 'pane-a',
      isAppForeground: () => true,
      getActiveTabPaneIds: () => ['pane-a'],
    })
    __dispatchServerMessageForTest(snapshot('1', [pane('pane-a', '5')]))

    __dispatchServerMessageForTest(delta('2', [pane('pane-a', '5', '5')]))

    expect(__pendingRequestCountForTest()).toBe(0)
    expect(syncMock.sentPayloads).toHaveLength(1)
  })

  it('can re-evaluate authoritative unread state independently on foreground gain', () => {
    useNotification()
    let foreground = false
    setActiveReadContext({
      getActiveFocusedPaneId: () => 'pane-a',
      isAppForeground: () => foreground,
      getActiveTabPaneIds: () => ['pane-a'],
    })
    __dispatchServerMessageForTest(snapshot('1', [pane('pane-a', '8')]))
    expect(__pendingRequestCountForTest()).toBe(0)

    foreground = true
    evaluateActiveRead()

    expect(__pendingRequestCountForTest()).toBe(1)
    expect(syncMock.sentPayloads[0]).toMatchObject({
      reason: 'active_observed',
      panes: [{ paneId: 'pane-a', throughEventSeq: '8' }],
    })
  })

  it('makes explicit trigger calls a no-op unless the masked projection is visibly unread', () => {
    useNotification()
    __dispatchServerMessageForTest(snapshot('1', [pane('pane-a', '3', '3')]))
    markPaneReadIfUnread('pane-a', 'focus')
    expect(__pendingRequestCountForTest()).toBe(0)

    __dispatchServerMessageForTest(delta('2', [pane('pane-a', '4', '3')]))
    markPaneReadIfUnread('pane-a', 'terminal_input')
    markPaneReadIfUnread('pane-a', 'terminal_input')
    expect(__pendingRequestCountForTest()).toBe(1)
    expect(syncMock.sentPayloads[0]).toMatchObject({
      reason: 'terminal_input',
      panes: [{ paneId: 'pane-a', throughEventSeq: '4' }],
    })
  })
})

describe('raised envelope compatibility', () => {
  it('accepts pane-less plugin notify regardless of osc_notify and never creates an empty pane key', () => {
    const notif = useNotification()
    ;(settings as any).notification.osc_notify = false
    __dispatchServerMessageForTest(snapshot('1'))

    __dispatchServerMessageForTest(
      raised({ pane_id: '', notifId: 'notif-1', eventSeq: '9', body: 'plugin message' })
    )

    expect(notif.historyCount.value).toBe(1)
    expect(notif.notifications.value[0]).toMatchObject({
      paneId: undefined,
      notifId: 'notif-1',
      source: 'plugin',
      body: 'plugin message',
    })
    expect(Object.prototype.hasOwnProperty.call(notif.unreadByPane, '')).toBe(false)
  })

  it('keeps osc_notify gating for legacy notify envelopes without notifId', () => {
    const notif = useNotification()
    ;(settings as any).notification.osc_notify = false
    __dispatchServerMessageForTest(snapshot('1'))
    __dispatchServerMessageForTest(raised())
    expect(notif.historyCount.value).toBe(0)
  })
})

describe('notification panel visibility', () => {
  it('keeps the clear action visible when both history and unread attention are empty', async () => {
    const notif = useNotification()
    const wrapper = mount(NotificationPanel, {
      props: { paneLabels: {} },
    })

    expect(notif.notifications.value).toEqual([])
    expect(notif.unreadAttentionCount.value).toBe(0)
    expect(wrapper.find('.panel-empty').exists()).toBe(true)
    expect(wrapper.find('.panel-clear').exists()).toBe(true)

    await wrapper.find('.panel-clear').trigger('click')

    expect(syncMock.sentPayloads).toEqual([])
    wrapper.unmount()
  })

  it('can clear authoritative unread attention when reconnect history is empty', async () => {
    const notif = useNotification()
    __dispatchServerMessageForTest(
      snapshot('1', [
        pane('pane-a', '1'),
        pane('pane-b', '2'),
        pane('pane-c', '3'),
        pane('pane-d', '4'),
      ])
    )
    notif.panelVisible.value = true
    const wrapper = mount(NotificationPanel, {
      props: { paneLabels: {} },
    })

    expect(notif.notifications.value).toEqual([])
    expect(notif.unreadAttentionCount.value).toBe(4)
    expect(wrapper.find('.panel-empty').exists()).toBe(true)

    await wrapper.find('.panel-clear').trigger('click')

    expect(notif.unreadAttentionCount.value).toBe(0)
    expect(syncMock.sentPayloads).toHaveLength(1)
    expect(syncMock.sentPayloads[0]).toMatchObject({ reason: 'clear_all' })
    wrapper.unmount()
  })

  it('hides the panel when a notification goto emits the pane target', async () => {
    const notif = useNotification()
    pushNotification({ type: 'info', body: 'done', paneId: 'pane-a' })
    notif.panelVisible.value = true
    const wrapper = mount(NotificationPanel, {
      props: { paneLabels: { 'pane-a': 'Pane A' } },
    })

    await wrapper.find('.notification-card').trigger('click')

    expect(wrapper.emitted('goto-pane')).toEqual([['pane-a']])
    expect(notif.panelVisible.value).toBe(false)
    wrapper.unmount()
  })

  it('hides 250ms after the last notification is removed', () => {
    const notif = useNotification()
    pushNotification({ type: 'info', body: 'done' })
    notif.panelVisible.value = true

    notif.dismissOne(notif.notifications.value[0].id)

    vi.advanceTimersByTime(249)
    expect(notif.panelVisible.value).toBe(true)
    vi.advanceTimersByTime(1)
    expect(notif.panelVisible.value).toBe(false)
  })

  it('stays visible when a notification arrives during the empty grace delay', () => {
    const notif = useNotification()
    pushNotification({ type: 'info', body: 'first' })
    notif.panelVisible.value = true
    notif.dismissOne(notif.notifications.value[0].id)

    vi.advanceTimersByTime(100)
    pushNotification({ type: 'info', body: 'second' })
    vi.advanceTimersByTime(150)

    expect(notif.panelVisible.value).toBe(true)
  })

  it('stays visible when opened while the notification list is already empty', () => {
    const notif = useNotification()

    notif.panelVisible.value = true
    vi.advanceTimersByTime(251)

    expect(notif.panelVisible.value).toBe(true)
  })

  it('hides after a cross-client projection prune empties the notification list', () => {
    const notif = useNotification()
    __dispatchServerMessageForTest(snapshot('1', [pane('pane-a', '5')]))
    __dispatchServerMessageForTest(raised({ eventSeq: '5' }))
    notif.panelVisible.value = true

    __dispatchServerMessageForTest(delta('2', [pane('pane-a', '5', '5')]))

    expect(notif.notifications.value).toEqual([])
    expect(notif.panelVisible.value).toBe(true)
    vi.advanceTimersByTime(250)
    expect(notif.panelVisible.value).toBe(false)
  })
})

describe('unhandled history pruning', () => {
  it('prunes a pane card immediately when a local pane read is created', () => {
    const notif = useNotification()
    __dispatchServerMessageForTest(snapshot('1', [pane('pane-a', '5')]))
    __dispatchServerMessageForTest(raised({ eventSeq: '5' }))
    expect(notif.historyCount.value).toBe(1)

    markPanesRead([{ paneId: 'pane-a', throughEventSeq: '5' }], 'focus')

    expect(notif.notifications.value).toEqual([])
    expect(notif.historyCount.value).toBe(0)
  })

  it('prunes a notif card immediately when a local notif read is created', () => {
    const notif = useNotification()
    __dispatchServerMessageForTest(snapshot('1', [], [{ notifId: 'notif-a', read: false }]))
    __dispatchServerMessageForTest(raised({ pane_id: '', notifId: 'notif-a' }))
    expect(notif.historyCount.value).toBe(1)

    markNotifsRead(['notif-a'], 'dismiss')

    expect(notif.notifications.value).toEqual([])
    expect(notif.historyCount.value).toBe(0)
  })

  it('does not insert a late raised card masked by an active-read overlay', () => {
    const notif = useNotification()
    __dispatchServerMessageForTest(snapshot('1', [pane('pane-a', '5')]))
    __dispatchServerMessageForTest(delta('2', [pane('pane-a', '6', '5')]))
    setActiveReadContext({
      getActiveFocusedPaneId: () => 'pane-a',
      isAppForeground: () => true,
      getActiveTabPaneIds: () => ['pane-a'],
    })

    evaluateActiveRead()
    expect(notif.unreadAttentionCount.value).toBe(0)

    __dispatchServerMessageForTest(raised({ eventSeq: '6' }))

    expect(notif.notifications.value).toEqual([])
    expect(notif.unreadAttentionCount.value).toBe(0)
  })

  it('prunes a pane card when a cross-client delta reads through its event sequence', () => {
    const notif = useNotification()
    __dispatchServerMessageForTest(snapshot('1', [pane('pane-a', '5')]))
    __dispatchServerMessageForTest(raised({ eventSeq: '5' }))
    expect(notif.historyCount.value).toBe(1)

    __dispatchServerMessageForTest(delta('2', [pane('pane-a', '5', '5')]))

    expect(notif.historyCount.value).toBe(0)
  })

  it('prunes a pane-less notification card when a delta marks its notif read', () => {
    const notif = useNotification()
    __dispatchServerMessageForTest(snapshot('1', [], [{ notifId: 'notif-a', read: false }]))
    __dispatchServerMessageForTest(raised({ pane_id: '', notifId: 'notif-a' }))
    expect(notif.historyCount.value).toBe(1)

    __dispatchServerMessageForTest(delta('2', [], [{ notifId: 'notif-a', read: true }]))

    expect(notif.historyCount.value).toBe(0)
  })

  it('retains current-epoch pane and notif cards when authoritative entries disappear', () => {
    const notif = useNotification()
    __dispatchServerMessageForTest(snapshot(
      '1',
      [pane('pane-a', '2')],
      [{ notifId: 'notif-a', read: false }],
    ))
    __dispatchServerMessageForTest(raised({ eventSeq: '2' }))
    __dispatchServerMessageForTest(raised({ pane_id: '', notifId: 'notif-a' }))

    __dispatchServerMessageForTest(delta(
      '2',
      [{
        paneId: 'pane-a', latestEventSeq: null, readThroughSeq: null,
        firstUnreadAt: null, severity: null, removed: true,
      }],
      [{ notifId: 'notif-a', read: null, removed: true }],
    ))

    expect(notif.historyCount.value).toBe(2)
  })

  it('prunes cards proven read by a reconnect snapshot', () => {
    const notif = useNotification()
    __dispatchServerMessageForTest(snapshot(
      '1',
      [pane('pane-a', '7')],
      [{ notifId: 'notif-a', read: false }],
    ))
    __dispatchServerMessageForTest(raised({ eventSeq: '7' }))
    __dispatchServerMessageForTest(raised({ pane_id: '', notifId: 'notif-a' }))
    expect(notif.historyCount.value).toBe(2)

    __dispatchServerMessageForTest(snapshot(
      '2',
      [pane('pane-a', '7', '7')],
      [{ notifId: 'notif-a', read: true }],
    ))

    expect(notif.historyCount.value).toBe(0)
  })

  it('retains current-epoch cards absent from a same-epoch snapshot', () => {
    const notif = useNotification()
    __dispatchServerMessageForTest(snapshot(
      '1',
      [pane('pane-a', '7')],
      [{ notifId: 'notif-a', read: false }],
    ))
    __dispatchServerMessageForTest(raised({ eventSeq: '7' }))
    __dispatchServerMessageForTest(raised({ pane_id: '', notifId: 'notif-a' }))
    expect(notif.historyCount.value).toBe(2)

    __dispatchServerMessageForTest(snapshot('2'))

    expect(notif.historyCount.value).toBe(2)
  })

  it('keeps a same-epoch local fallback card across projection refreshes', () => {
    const notif = useNotification()
    const channels = useNotificationPresentation().settings.channels
    channels.popup = true
    channels.panel = true
    __dispatchServerMessageForTest(snapshot('1'))
    pushNotification({ type: 'error', body: 'network fallback', source: 'plugin' })
    const fallbackCard = notif.notifications.value[0]
    expect(fallbackCard.paneId).toBeUndefined()
    expect(fallbackCard.notifId).toBeUndefined()

    __dispatchServerMessageForTest(snapshot('2'))

    expect(notif.notifications.value).toEqual([fallbackCard])
  })

  it('keeps a card unread when its toast X closes and sends no mark-read request', () => {
    const toast = createToastSpy()
    setToastInstance(toast)
    useNotificationPresentation().settings.coalesce_window_ms = 0
    const notif = useNotification()
    __dispatchServerMessageForTest(snapshot('1', [pane('pane-a', '3')]))
    __dispatchServerMessageForTest(raised({ eventSeq: '3' }))
    vi.advanceTimersByTime(0)

    const options = toast.mock.calls[0][1] as any
    options.onClose()

    expect(notif.historyCount.value).toBe(1)
    expect(syncMock.sentPayloads).toEqual([])
  })

  it('preserves a stale-epoch card during authoritative pruning and allows manual dismissal', () => {
    const notif = useNotification()
    __dispatchServerMessageForTest(snapshot('1', [pane('pane-a', '4')]))
    __dispatchServerMessageForTest(raised({ eventSeq: '4' }))
    const staleCard = notif.notifications.value[0]

    __dispatchServerMessageForTest({ ...snapshot('1'), epoch: 'epoch-b' })

    expect(notif.notifications.value).toEqual([staleCard])
    notif.dismissOne(staleCard.id)
    expect(notif.historyCount.value).toBe(0)
    expect(syncMock.sentPayloads).toEqual([])
  })
})

describe('raised presentation pipeline', () => {
  it('stores every event but coalesces a 10-event same-pane burst to one presentation vector', () => {
    const toast = vi.fn()
    const sound = vi.fn()
    __setPresentationEffectsForTest({ playSound: sound })
    const vibrate = vi.mocked(navigator.vibrate)
    setToastInstance(toast)
    const local = useNotificationPresentation().settings
    local.coalesce_window_ms = 100
    local.channels.sound = true
    local.channels.vibration = true
    expect(local.channels.panel).toBe(true)
    const notif = useNotification()

    for (let seq = 1; seq <= 10; seq++) {
      __dispatchServerMessageForTest(raised({ eventSeq: String(seq), body: `event-${seq}` }))
      vi.advanceTimersByTime(10)
    }
    expect(notif.historyCount.value).toBe(10)
    expect(__pendingPresentationCountForTest()).toBe(1)
    expect(toast).not.toHaveBeenCalled()

    vi.advanceTimersByTime(100)
    expect(__pendingPresentationCountForTest()).toBe(0)
    expect(toast).toHaveBeenCalledOnce()
    expect(sound).toHaveBeenCalledOnce()
    expect(vibrate).toHaveBeenCalledOnce()
  })

  it('markPaneReadIfUnread dismisses the visible toast for that pane', () => {
    const toast = createToastSpy()
    setToastInstance(toast)
    useNotificationPresentation().settings.coalesce_window_ms = 0
    useNotification()
    __dispatchServerMessageForTest(snapshot('1', [pane('pane-a', '3')]))
    __dispatchServerMessageForTest(raised({ eventSeq: '3' }))
    vi.advanceTimersByTime(0)
    expect(toast).toHaveBeenCalledOnce()

    markPaneReadIfUnread('pane-a', 'focus')

    expect(toast.dismiss).toHaveBeenCalledWith('toast-1')
  })

  it('dismisses a visible local toast when a server state delta marks its pane read', () => {
    const toast = createToastSpy()
    setToastInstance(toast)
    useNotificationPresentation().settings.coalesce_window_ms = 0
    useNotification()
    __dispatchServerMessageForTest(snapshot('1', [pane('pane-a', '4')]))
    __dispatchServerMessageForTest(raised({ eventSeq: '4' }))
    vi.advanceTimersByTime(0)
    expect(toast).toHaveBeenCalledOnce()

    __dispatchServerMessageForTest(delta('2', [pane('pane-a', '4', '4')]))

    expect(toast.dismiss).toHaveBeenCalledWith('toast-1')
  })

  it('dismisses through the toast interface that created the live toast', () => {
    const creatingToast = createToastSpy()
    const replacementToast = createToastSpy()
    setToastInstance(creatingToast)
    useNotificationPresentation().settings.coalesce_window_ms = 0
    useNotification()
    __dispatchServerMessageForTest(snapshot('1', [pane('pane-a', '3')]))
    __dispatchServerMessageForTest(raised({ eventSeq: '3' }))
    vi.advanceTimersByTime(0)

    setToastInstance(replacementToast)
    markPaneReadIfUnread('pane-a', 'focus')

    expect(creatingToast.dismiss).toHaveBeenCalledWith('toast-1')
    expect(replacementToast.dismiss).not.toHaveBeenCalled()
  })

  it('retires a naturally closed toast without later dismissing it', () => {
    const toast = createToastSpy()
    setToastInstance(toast)
    useNotificationPresentation().settings.coalesce_window_ms = 0
    useNotification()
    __dispatchServerMessageForTest(snapshot('1', [pane('pane-a', '3')]))
    __dispatchServerMessageForTest(raised({ eventSeq: '3' }))
    vi.advanceTimersByTime(0)
    const options = toast.mock.calls[0][1] as any

    options.onClose()
    options.onClose()
    markPaneReadIfUnread('pane-a', 'focus')

    expect(toast.dismiss).not.toHaveBeenCalled()
  })

  it("does not let an old toast's onClose retire a newer toast for the same pane", () => {
    const toast = createToastSpy()
    setToastInstance(toast)
    useNotificationPresentation().settings.coalesce_window_ms = 0
    useNotification()
    __dispatchServerMessageForTest(snapshot('1', [pane('pane-a', '2')]))
    __dispatchServerMessageForTest(raised({ eventSeq: '1' }))
    vi.advanceTimersByTime(0)
    __dispatchServerMessageForTest(raised({ eventSeq: '2' }))
    vi.advanceTimersByTime(0)
    const firstOptions = toast.mock.calls[0][1] as any

    firstOptions.onClose()
    markPanesRead([{ paneId: 'pane-a', throughEventSeq: '2' }], 'focus')

    expect(toast.dismiss).toHaveBeenCalledTimes(1)
    expect(toast.dismiss).toHaveBeenCalledWith('toast-2')
  })

  it('dismisses its own toast before running the goTo button behavior', () => {
    const actions: string[] = []
    const toast = createToastSpy()
    toast.dismiss.mockImplementation(() => actions.push('dismiss'))
    setToastInstance(toast)
    setGoToPaneHandler(() => actions.push('goTo'))
    useNotificationPresentation().settings.coalesce_window_ms = 0
    useNotification()
    __dispatchServerMessageForTest(raised())
    vi.advanceTimersByTime(0)
    const content = toast.mock.calls[0][0] as any
    const goToButton = content.children.find(
      (child: any) => child?.children === 'notification.goTo',
    )

    goToButton.props.onClick()

    expect(toast.dismiss).toHaveBeenCalledWith('toast-1')
    expect(actions).toEqual(['dismiss', 'goTo'])
  })

  it('dismisses a pane card during its open coalesce window with no later presentation', () => {
    const toast = vi.fn()
    const sound = vi.fn()
    __setPresentationEffectsForTest({ playSound: sound })
    const vibrate = vi.mocked(navigator.vibrate)
    setToastInstance(toast)
    const local = useNotificationPresentation().settings
    local.coalesce_window_ms = 50
    local.channels.sound = true
    local.channels.vibration = true
    const notif = useNotification()

    __dispatchServerMessageForTest(raised({ eventSeq: '3' }))
    notif.dismissOne(notif.notifications.value[0].id)
    vi.advanceTimersByTime(50)

    expect(toast).not.toHaveBeenCalled()
    expect(sound).not.toHaveBeenCalled()
    expect(vibrate).not.toHaveBeenCalled()
    expect(__pendingPresentationCountForTest()).toBe(0)
  })

  it('markNotifsRead cancels a scheduled server-originated pane-less notification', () => {
    const toast = vi.fn()
    setToastInstance(toast)
    useNotificationPresentation().settings.coalesce_window_ms = 50
    useNotification()
    __dispatchServerMessageForTest(snapshot('1', [], [{ notifId: 'server-notif', read: false }]))
    __dispatchServerMessageForTest(raised({ pane_id: '', notifId: 'server-notif' }))

    markNotifsRead(['server-notif'], 'dismiss')
    vi.advanceTimersByTime(50)

    expect(toast).not.toHaveBeenCalled()
    expect(__pendingPresentationCountForTest()).toBe(0)
  })

  it('dismiss cancels a purely local fallback card under its local notif identity', () => {
    const toast = vi.fn()
    setToastInstance(toast)
    useNotificationPresentation().settings.coalesce_window_ms = 50
    const notif = useNotification()
    pushNotification({ type: 'error', body: 'network fallback', source: 'plugin' })
    const item = notif.notifications.value[0]
    expect(item.presentationIdentity).toEqual({ kind: 'notif', id: item.id })

    notif.dismissOne(item.id)
    vi.advanceTimersByTime(50)

    expect(toast).not.toHaveBeenCalled()
    expect(__pendingPresentationCountForTest()).toBe(0)
  })

  it('uses the active-leaf mask independently of authoritative active-read cancellation', () => {
    const toast = vi.fn()
    setToastInstance(toast)
    const local = useNotificationPresentation().settings
    local.coalesce_window_ms = 50
    expect(local.channels.panel).toBe(true)
    const notif = useNotification()
    setActiveReadContext({
      getActiveFocusedPaneId: () => 'pane-a',
      isAppForeground: () => true,
      getActiveTabPaneIds: () => ['pane-a'],
    })

    __dispatchServerMessageForTest(raised())
    expect(notif.historyCount.value).toBe(1)
    vi.advanceTimersByTime(50)
    expect(toast).not.toHaveBeenCalled()
    expect(__pendingRequestCountForTest()).toBe(0)
  })

  it('cancels pending presentation on local read and permits a later sequence above the watermark', () => {
    const toast = vi.fn()
    setToastInstance(toast)
    useNotificationPresentation().settings.coalesce_window_ms = 50
    useNotification()
    __dispatchServerMessageForTest(snapshot('1', [pane('pane-a', '5')]))
    __dispatchServerMessageForTest(raised({ eventSeq: '5' }))

    markPanesRead([{ paneId: 'pane-a', throughEventSeq: '5' }], 'focus')
    vi.advanceTimersByTime(50)
    expect(toast).not.toHaveBeenCalled()

    __dispatchServerMessageForTest(raised({ eventSeq: '6', body: 'new unread' }))
    vi.advanceTimersByTime(50)
    expect(toast).toHaveBeenCalledOnce()
  })

  it('cancels from mark_read_result arrival for a pane-less notification', () => {
    const toast = vi.fn()
    setToastInstance(toast)
    useNotificationPresentation().settings.coalesce_window_ms = 50
    useNotification()
    __dispatchServerMessageForTest(snapshot('1', [], [{ notifId: 'notif-a', read: false }]))
    markNotifsRead(['notif-a'], 'dismiss')
    const request = syncMock.sentPayloads[0]
    __dispatchServerMessageForTest(raised({ pane_id: '', notifId: 'notif-a' }))
    expect(__pendingPresentationCountForTest()).toBe(1)

    __dispatchServerMessageForTest({
      type: 'mark_read_result',
      requestId: request.requestId,
      epoch: 'epoch-a',
      appliedAtRevision: '1',
      results: [{ target: { notifId: 'notif-a' }, status: 'applied' }],
    })
    vi.advanceTimersByTime(50)
    expect(toast).not.toHaveBeenCalled()
  })

  it('cancels from a proving pane delta', () => {
    const toast = vi.fn()
    setToastInstance(toast)
    useNotificationPresentation().settings.coalesce_window_ms = 50
    useNotification()
    __dispatchServerMessageForTest(snapshot('1'))
    __dispatchServerMessageForTest(raised({ eventSeq: '4' }))
    __dispatchServerMessageForTest(delta('2', [pane('pane-a', '4', '4')]))
    vi.advanceTimersByTime(50)
    expect(toast).not.toHaveBeenCalled()
  })

  it('cancels from a proving pane snapshot', () => {
    const toast = vi.fn()
    setToastInstance(toast)
    useNotificationPresentation().settings.coalesce_window_ms = 50
    useNotification()
    __dispatchServerMessageForTest(snapshot('1'))
    __dispatchServerMessageForTest(raised({ eventSeq: '4' }))
    __dispatchServerMessageForTest(snapshot('2', [pane('pane-a', '4', '4')]))
    vi.advanceTimersByTime(50)
    expect(toast).not.toHaveBeenCalled()
  })

  it('cancels and fully removes pane scheduler state on a removal delta', () => {
    const toast = vi.fn()
    setToastInstance(toast)
    useNotificationPresentation().settings.coalesce_window_ms = 50
    useNotification()
    __dispatchServerMessageForTest(snapshot('1'))
    __dispatchServerMessageForTest(raised({ eventSeq: '9' }))
    __dispatchServerMessageForTest(delta('2', [{
      paneId: 'pane-a', latestEventSeq: null, readThroughSeq: null,
      firstUnreadAt: null, severity: null, removed: true,
    }]))
    vi.advanceTimersByTime(50)
    expect(toast).not.toHaveBeenCalled()

    __dispatchServerMessageForTest(raised({ eventSeq: '1', body: 'reused pane id' }))
    vi.advanceTimersByTime(50)
    expect(toast).toHaveBeenCalledOnce()
  })

  it('local focus intent cancels before authoritative pane state exists without sending mark-read', () => {
    const toast = vi.fn()
    setToastInstance(toast)
    useNotificationPresentation().settings.coalesce_window_ms = 50
    useNotification()
    __dispatchServerMessageForTest(raised({ eventSeq: '3' }))
    markPaneReadIfUnread('pane-a', 'focus')
    expect(__pendingRequestCountForTest()).toBe(0)
    vi.advanceTimersByTime(50)
    expect(toast).not.toHaveBeenCalled()
  })

  it.each(['terminal_input', 'active_observed'] as const)(
    '%s cancels before authoritative pane state exists without sending mark-read',
    (reason) => {
      const toast = vi.fn()
      setToastInstance(toast)
      useNotificationPresentation().settings.coalesce_window_ms = 50
      useNotification()
      __dispatchServerMessageForTest(raised({ eventSeq: '3' }))

      if (reason === 'active_observed') {
        setActiveReadContext({
          getActiveFocusedPaneId: () => 'pane-a',
          isAppForeground: () => true,
          getActiveTabPaneIds: () => [],
        })
        evaluateActiveRead()
      } else {
        markPaneReadIfUnread('pane-a', reason)
      }

      expect(__pendingRequestCountForTest()).toBe(0)
      vi.advanceTimersByTime(50)
      expect(toast).not.toHaveBeenCalled()
      expect(__pendingPresentationCountForTest()).toBe(0)
    },
  )

  it('a pane mark_read_result arrival cancels that pane scheduler slot', () => {
    const toast = vi.fn()
    setToastInstance(toast)
    useNotificationPresentation().settings.coalesce_window_ms = 50
    useNotification()
    __dispatchServerMessageForTest(raised({ eventSeq: '4' }))

    __dispatchServerMessageForTest({
      type: 'mark_read_result',
      requestId: 'already-retired-request',
      epoch: 'epoch-a',
      appliedAtRevision: '1',
      results: [{ target: { paneId: 'pane-a' }, status: 'applied' }],
    })
    vi.advanceTimersByTime(50)

    expect(toast).not.toHaveBeenCalled()
    expect(__pendingPresentationCountForTest()).toBe(0)
  })

  it('cancels pane-less scheduling from notif read and removed state updates', () => {
    const toast = vi.fn()
    setToastInstance(toast)
    useNotificationPresentation().settings.coalesce_window_ms = 50
    useNotification()
    __dispatchServerMessageForTest(snapshot('1'))
    __dispatchServerMessageForTest(raised({ pane_id: '', notifId: 'notif-read' }))
    __dispatchServerMessageForTest(delta('2', [], [{ notifId: 'notif-read', read: true }]))
    __dispatchServerMessageForTest(raised({ pane_id: '', notifId: 'notif-removed' }))
    __dispatchServerMessageForTest(delta('3', [], [{ notifId: 'notif-removed', read: null, removed: true }]))
    vi.advanceTimersByTime(50)
    expect(toast).not.toHaveBeenCalled()
  })

  it('cancels pane and pane-less scheduling from card dismiss and clearAll', () => {
    const toast = vi.fn()
    setToastInstance(toast)
    useNotificationPresentation().settings.coalesce_window_ms = 50
    const notif = useNotification()
    __dispatchServerMessageForTest(snapshot('1'))

    __dispatchServerMessageForTest(raised({ pane_id: '', notifId: 'notif-dismiss' }))
    notif.dismissOne(notif.notifications.value[0].id)
    __dispatchServerMessageForTest(raised({ pane_id: '', notifId: 'notif-clear' }))
    __dispatchServerMessageForTest(raised({ pane_id: 'pane-clear', eventSeq: '1' }))
    notif.clearAll()

    vi.advanceTimersByTime(50)
    expect(toast).not.toHaveBeenCalled()
    expect(__pendingPresentationCountForTest()).toBe(0)
  })
})
