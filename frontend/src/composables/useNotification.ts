import { ref, shallowReactive, computed, h, watch } from 'vue'
import { TYPE } from 'vue-toastification'
import type { ToastInterface } from 'vue-toastification'
import { settings } from './useSettings'
import { useI18n } from './useI18n'
import {
  createAttentionStore,
  type AttentionStateEnvelope,
  type MarkReadResultWire,
  type OverlayTarget,
} from './attentionReconcile'
import {
  __resetNotificationPresentationForTest,
  createPresentationScheduler,
  getNotificationPresentationSettings,
  presentationGate,
  type PresentationEvent,
  type PresentationOutput,
} from './useNotificationPresentation'
import { getClientId, onNotification, sendMarkRead } from './useSyncWebSocket'

// ── Sound (moved to useNotificationAudio) ──────────────
export type { SoundConfig } from './useNotificationAudio'
export {
  playSound,
  getBuiltinSoundNames,
  __setPresentationEffectsForTest,
} from './useNotificationAudio'
import {
  notificationPresentationEffects,
  resetPresentationEffects,
} from './useNotificationAudio'

export type NotificationType = 'info' | 'success' | 'warning' | 'error' | 'urgent'

export interface NotificationItem {
  id: string
  type: NotificationType
  paneId?: string
  title: string | null
  body: string
  timestamp: number
  source?: 'terminal' | 'plugin'
  eventSeq?: string
  notifId?: string
  epoch?: string
  presentationIdentity?: { kind: 'pane' | 'notif'; id: string }
}

export type MarkReadReason =
  | 'focus'
  | 'terminal_input'
  | 'tab_activate'
  | 'tab_close'
  | 'pane_close'
  | 'goto'
  | 'active_observed'
  | 'dismiss'
  | 'clear_all'

interface LegacyEvent {
  type: 'bell' | 'notify'
  v: number
  pane_id: string
  title: string | null
  body: string
  notification_type: string
  eventSeq: string
  occurredAt: number
  severity: NotificationType
  notifId?: string
}

interface MarkReadPayload {
  type: 'mark_read'
  v: 1
  epoch: string
  clientId: string
  requestId: string
  reason: MarkReadReason
  panes: Array<{ paneId: string; throughEventSeq: string }>
  notifs: Array<{ notifId: string }>
}

interface PendingRequest {
  requestId: string
  payload: MarkReadPayload
  attempts: number
  timer: ReturnType<typeof setTimeout> | null
}

const ACK_TIMEOUT_MS = 5000
const MAX_SEND_ATTEMPTS = 4
const PENDING_CAP = 64
const HISTORY_DEDUP_CAP = 512
const PANEL_EMPTY_AUTOHIDE_MS = 250
export const NOTIFICATION_SESSION_HISTORY_KEY = 'dinotty_notification_history_v1'

const notificationTypes = new Set<NotificationType>([
  'info',
  'success',
  'warning',
  'error',
  'urgent',
])

function parseNotificationSessionHistory(raw: string | null): NotificationItem[] {
  if (raw === null) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.slice(0, 100).flatMap((value): NotificationItem[] => {
      if (typeof value !== 'object' || value === null) return []
      const item = value as Record<string, unknown>
      if (
        typeof item.id !== 'string' ||
        !notificationTypes.has(item.type as NotificationType) ||
        (item.title !== null && typeof item.title !== 'string') ||
        typeof item.body !== 'string' ||
        typeof item.timestamp !== 'number' ||
        !Number.isFinite(item.timestamp) ||
        (item.source !== undefined && item.source !== 'terminal' && item.source !== 'plugin') ||
        (item.paneId !== undefined && typeof item.paneId !== 'string') ||
        (item.eventSeq !== undefined && typeof item.eventSeq !== 'string') ||
        (item.notifId !== undefined && typeof item.notifId !== 'string') ||
        (item.epoch !== undefined && typeof item.epoch !== 'string')
      ) return []
      return [{
        id: item.id,
        type: item.type as NotificationType,
        paneId: item.paneId as string | undefined,
        title: item.title,
        body: item.body,
        timestamp: item.timestamp,
        source: item.source as NotificationItem['source'],
        eventSeq: item.eventSeq as string | undefined,
        notifId: item.notifId as string | undefined,
        epoch: item.epoch as string | undefined,
      }]
    })
  } catch {
    return []
  }
}

function loadNotificationSessionHistory(): NotificationItem[] {
  if (typeof sessionStorage === 'undefined') return []
  try {
    const raw = sessionStorage.getItem(NOTIFICATION_SESSION_HISTORY_KEY)
    const items = parseNotificationSessionHistory(raw)
    if (raw !== null && items.length === 0) {
      sessionStorage.removeItem(NOTIFICATION_SESSION_HISTORY_KEY)
    }
    return items
  } catch {
    return []
  }
}

function persistNotificationSessionHistory(items: NotificationItem[]) {
  if (typeof sessionStorage === 'undefined') return
  try {
    if (items.length === 0) {
      sessionStorage.removeItem(NOTIFICATION_SESSION_HISTORY_KEY)
      return
    }
    sessionStorage.setItem(
      NOTIFICATION_SESSION_HISTORY_KEY,
      JSON.stringify(items.map(({
        id,
        type,
        paneId,
        title,
        body,
        timestamp,
        source,
        eventSeq,
        notifId,
        epoch,
      }) => ({ id, type, paneId, title, body, timestamp, source, eventSeq, notifId, epoch }))),
    )
  } catch {
    // Session storage is an optional reload bridge. The authoritative ledger and
    // the panel's clear-all recovery path remain available when it is blocked.
  }
}

const notifications = ref<NotificationItem[]>(loadNotificationSessionHistory())
watch(
  notifications,
  (items) => persistNotificationSessionHistory(items),
  { deep: true, flush: 'sync' },
)
const panelVisible = ref(false)
let panelEmptyAutohideTimer: ReturnType<typeof setTimeout> | null = null

function clearPanelEmptyAutohide() {
  if (panelEmptyAutohideTimer === null) return
  clearTimeout(panelEmptyAutohideTimer)
  panelEmptyAutohideTimer = null
}

watch(
  () => notifications.value.length,
  (length, previousLength) => {
    if (length > 0) {
      clearPanelEmptyAutohide()
      return
    }
    if (!panelVisible.value || previousLength === 0) return

    clearPanelEmptyAutohide()
    panelEmptyAutohideTimer = setTimeout(() => {
      panelEmptyAutohideTimer = null
      if (panelVisible.value && notifications.value.length === 0) {
        panelVisible.value = false
      }
    }, PANEL_EMPTY_AUTOHIDE_MS)
  },
  { flush: 'sync' },
)

watch(
  panelVisible,
  (visible) => {
    if (!visible) clearPanelEmptyAutohide()
  },
  { flush: 'sync' },
)

const unreadByPane = shallowReactive<Record<string, NotificationType>>({})
const firstUnreadAtByPane = shallowReactive<Record<string, number | null>>({})
const projectionVersion = ref(0)
const historyCount = computed(() => notifications.value.length)
const unreadAttentionCount = computed(() => {
  void projectionVersion.value
  return attentionStore.unreadAttentionCount()
})

let attentionStore = createAttentionStore()
let idCounter = 0
let initialized = false
let requestCounter = 0
const pendingRequests = new Map<string, PendingRequest>()
const historyDedup = new Set<string>()
const deferredHistoryActions = new Map<string, () => void>()
let hasReceivedInitialSnapshot = false

function hasRestoredHistoryAwaitingSnapshot(predicate: (item: NotificationItem) => boolean) {
  return !hasReceivedInitialSnapshot
    && notifications.value.some((item) => item.epoch !== undefined && predicate(item))
}

function deferHistoryAction(key: string, action: () => void) {
  if (deferredHistoryActions.size >= PENDING_CAP && !deferredHistoryActions.has(key)) {
    const oldest = deferredHistoryActions.keys().next().value
    if (oldest !== undefined) deferredHistoryActions.delete(oldest)
  }
  deferredHistoryActions.set(key, action)
}

function flushDeferredHistoryActions() {
  const actions = [...deferredHistoryActions.values()]
  deferredHistoryActions.clear()
  for (const action of actions) action()
}

interface ActiveReadContext {
  getActiveFocusedPaneId: () => string | null
  isAppForeground: () => boolean
  getActiveTabPaneIds: () => string[]
}

let activeReadContext: ActiveReadContext | null = null

function gateNotification(item: NotificationItem): PresentationOutput {
  return presentationGate(
    { paneId: item.paneId, eventSeq: item.eventSeq, severity: item.type },
    {
      settings: getNotificationPresentationSettings(),
      focusedPaneId: activeReadContext?.getActiveFocusedPaneId() ?? null,
      activeTabPaneIds: activeReadContext?.getActiveTabPaneIds() ?? [],
      isAppForeground: activeReadContext?.isAppForeground() ?? false,
      now: () => new Date(),
    },
  )
}

function emitPresentation(
  item: NotificationItem,
  output: PresentationOutput,
  retire: () => void,
) {
  const presentation = getNotificationPresentationSettings()
  if (output.playSound) {
    const soundCfg = presentation.sounds[item.type]
    if (soundCfg) notificationPresentationEffects.playSound(soundCfg)
  }
  if (output.vibrate && typeof navigator !== 'undefined' && navigator.vibrate) {
    navigator.vibrate(item.type === 'urgent' ? [100, 50, 100, 50, 100] : [100])
  }
  if (output.showPopup) return showToast(item, retire)
}

type ScheduledNotification = NotificationItem & PresentationEvent

const presentationScheduler = createPresentationScheduler<ScheduledNotification>({
  getWindowMs: () => getNotificationPresentationSettings().coalesce_window_ms,
  evaluate: gateNotification,
  fire: emitPresentation,
})

function presentNotification(item: NotificationItem, initialOutput: PresentationOutput) {
  const identity = item.presentationIdentity ?? stampPresentationIdentity(item)
  presentationScheduler.enqueue({
    ...item,
    paneId: identity.kind === 'pane' ? identity.id : undefined,
    notifId: identity.kind === 'notif' ? identity.id : undefined,
    severity: item.type,
  }, initialOutput)
}

function stampPresentationIdentity(item: NotificationItem) {
  const identity = item.paneId
    ? { kind: 'pane' as const, id: item.paneId }
    : { kind: 'notif' as const, id: item.notifId ?? item.id }
  item.presentationIdentity = identity
  return identity
}

function cancelPresentationForItem(item: NotificationItem) {
  const identity = item.presentationIdentity ?? stampPresentationIdentity(item)
  if (identity.kind === 'pane') presentationScheduler.cancelPane(identity.id)
  else presentationScheduler.cancelNotif(identity.id)
}

function cancelPresentationForState(envelope: AttentionStateEnvelope) {
  for (const pane of envelope.panes) {
    if (pane.removed) {
      presentationScheduler.removePane(pane.paneId)
    } else if (pane.readThroughSeq !== null) {
      presentationScheduler.cancelPane(pane.paneId, pane.readThroughSeq)
    }
  }
  for (const notif of envelope.notifs) {
    if (notif.read === true || notif.removed) presentationScheduler.cancelNotif(notif.notifId)
  }
}

function randomToken(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID()
    }
    if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
      const bytes = new Uint32Array(4)
      crypto.getRandomValues(bytes)
      return [...bytes].map((value) => value.toString(36)).join('-')
    }
  } catch {}
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}

const tabNonce = randomToken()

export function getNotificationClientId(): string {
  return getClientId() ?? ''
}

export function mintNotificationRequestId(): string {
  return `${tabNonce}-${++requestCounter}`
}

function genId(): string {
  return `notif-${++idCounter}-${Date.now()}`
}

function severityRank(t: NotificationType): number {
  const ranks: Record<NotificationType, number> = {
    info: 0,
    success: 1,
    warning: 2,
    error: 3,
    urgent: 4,
  }
  return ranks[t] ?? 0
}

/** Returns the highest severity among the given paneIds, or null if none unread. */
export function aggregateSeverity(paneIds: string[]): NotificationType | null {
  let highest: NotificationType | null = null
  let highestRank = -1
  for (const pid of paneIds) {
    const sev = unreadByPane[pid]
    if (sev) {
      const rank = severityRank(sev)
      if (rank > highestRank) {
        highest = sev
        highestRank = rank
      }
    }
  }
  return highest
}

function safeBigInt(s: string): bigint | null {
  try { return BigInt(s) } catch { return null }
}

function historyItemMatchesReadTarget(card: NotificationItem, target: OverlayTarget): boolean {
  if ('paneId' in target) {
    const seq = card.eventSeq !== undefined ? safeBigInt(card.eventSeq) : null
    return card.paneId === target.paneId
      && seq !== null
      && seq <= target.throughEventSeq
  }
  return card.notifId === target.notifId
}

function pruneHistoryByReadTargets(targets: OverlayTarget[]) {
  const epoch = attentionStore.epoch
  if (epoch === null || targets.length === 0) return
  notifications.value = notifications.value.filter(
    (card) => card.epoch !== epoch || !targets.some((target) =>
      historyItemMatchesReadTarget(card, target)
    )
  )
}

function pruneHistoryByAuthoritativeRead() {
  const epoch = attentionStore.epoch
  if (epoch === null) return
  notifications.value = notifications.value.filter((card) => {
    if (card.epoch !== epoch) return true

    let paneRead = false
    if (card.paneId !== undefined) {
      const pane = attentionStore.panes.get(card.paneId)
      const seq = card.eventSeq !== undefined ? safeBigInt(card.eventSeq) : null
      paneRead = pane !== undefined
        && seq !== null
        && pane.readThroughSeq >= seq
    }

    let notifRead = false
    if (card.notifId !== undefined) {
      const notif = attentionStore.notifs.get(card.notifId)
      notifRead = notif !== undefined && notif.read === true
    }

    return !paneRead && !notifRead
  })
}

function refreshProjection() {
  pruneHistoryByAuthoritativeRead()
  const next = attentionStore.unreadPaneSeverities()
  delete next['']
  for (const paneId of Object.keys(unreadByPane)) {
    if (!(paneId in next)) delete unreadByPane[paneId]
  }
  for (const [paneId, severity] of Object.entries(next)) {
    unreadByPane[paneId] = severity as NotificationType
  }
  const nextFirstUnreadAt = attentionStore.firstUnreadAtByPane()
  for (const paneId of Object.keys(firstUnreadAtByPane)) {
    if (!(paneId in nextFirstUnreadAt)) delete firstUnreadAtByPane[paneId]
  }
  for (const [paneId, firstUnreadAt] of Object.entries(nextFirstUnreadAt)) {
    firstUnreadAtByPane[paneId] = firstUnreadAt
  }
  projectionVersion.value++
}

function getNotifConfig() {
  return settings.notification
}

function rememberHistoryKey(key: string): boolean {
  if (historyDedup.has(key)) return false
  historyDedup.add(key)
  if (historyDedup.size > HISTORY_DEDUP_CAP) {
    const oldest = historyDedup.values().next().value
    if (oldest !== undefined) historyDedup.delete(oldest)
  }
  return true
}

function insertHistory(item: NotificationItem) {
  const epoch = attentionStore.epoch
  if (epoch !== null && item.epoch === epoch) {
    const pane = item.paneId === undefined ? undefined : attentionStore.panes.get(item.paneId)
    const paneRead = pane !== undefined
      && item.eventSeq !== undefined
      && pane.readThroughSeq >= BigInt(item.eventSeq)
    const notifRead = item.notifId !== undefined
      && attentionStore.notifs.get(item.notifId)?.read === true
    const overlayRead = [...attentionStore.overlays.values()].some((overlay) =>
      overlay.targets.some((target) => historyItemMatchesReadTarget(item, target))
    )
    if (paneRead || notifRead || overlayRead) return
  }
  notifications.value.unshift(item)
  if (notifications.value.length > 100) notifications.value.length = 100
}

function handleEvent(event: LegacyEvent) {
  const cfg = getNotifConfig()
  if (!cfg || !cfg.enabled) return

  let notifType: NotificationType = event.severity || 'info'
  let title: string | null = null
  let body = ''

  if (event.type === 'bell') {
    if (!cfg.bell?.enabled) return
    body = 'Bell'
  } else if (event.type === 'notify') {
    if (!event.notifId && !cfg.osc_notify) return
    title = event.title ?? null
    body = event.body ?? ''
    notifType = event.severity || (event.notification_type as NotificationType) || 'info'
  } else {
    return
  }

  const dedupKey = event.pane_id
    ? `${attentionStore.epoch ?? ''}|${event.pane_id}|${event.eventSeq}`
    : `${attentionStore.epoch ?? ''}|notif|${event.notifId ?? ''}`
  if (!rememberHistoryKey(dedupKey)) return

  const item: NotificationItem = {
    id: genId(),
    type: notifType,
    paneId: event.pane_id || undefined,
    title,
    body,
    timestamp: Date.now(),
    source: event.notifId && !event.pane_id ? 'plugin' : 'terminal',
    eventSeq: event.eventSeq,
    notifId: event.notifId,
    epoch: attentionStore.epoch ?? undefined,
  }
  stampPresentationIdentity(item)
  const output = gateNotification(item)
  if (output.storeHistory) insertHistory(item)
  presentNotification(item, output)
}

// Direct push for local fallback sources. It bypasses bell/osc_notify ingest
// sub-switches, but presentation follows the same per-surface gate as raised events.
export function pushNotification(opts: {
  type: NotificationType
  title?: string | null
  body: string
  source?: 'terminal' | 'plugin'
  paneId?: string
}) {
  const cfg = getNotifConfig()
  if (!cfg || !cfg.enabled) return

  const item: NotificationItem = {
    id: genId(),
    type: opts.type,
    paneId: opts.paneId,
    title: opts.title ?? null,
    body: opts.body,
    timestamp: Date.now(),
    source: opts.source ?? 'terminal',
    epoch: attentionStore.epoch ?? undefined,
  }
  stampPresentationIdentity(item)
  const output = gateNotification(item)
  if (output.storeHistory) insertHistory(item)
  presentNotification(item, output)
}

const toastTypeMap: Record<NotificationType, any> = {
  info: TYPE.INFO,
  success: TYPE.SUCCESS,
  warning: TYPE.WARNING,
  error: TYPE.ERROR,
  urgent: TYPE.ERROR,
}

// Toast instance must be captured from a component setup context (App.vue) and
// injected here - vue-toastification v2's useToast() called outside component
// context returns an interface that doesn't reach the mounted container reliably.
type ToastID = ReturnType<ToastInterface>
type ToastInstance = ((content: any, options?: any) => ToastID) & {
  dismiss(id: ToastID): void
}
type LegacyToastInstance = (content: any, options?: any) => void
type StoredToastInstance = ((content: any, options?: any) => ToastID | void) & {
  dismiss?: (id: ToastID) => void
}

let toastInstance: StoredToastInstance | null = null

export function setToastInstance(toast: ToastInstance | LegacyToastInstance | null) {
  toastInstance = toast
  return () => {
    if (toastInstance === toast) toastInstance = null
  }
}

let goToHandler: ((paneId: string) => void) | null = null

export function setGoToPaneHandler(handler: (paneId: string) => void) {
  goToHandler = handler
}

export function setActiveReadContext(context: ActiveReadContext | null) {
  activeReadContext = context
  return () => {
    if (activeReadContext === context) activeReadContext = null
  }
}

export function disposeNotificationPresentationScheduler() {
  presentationScheduler.dispose()
}

export function evaluateActiveRead() {
  if (!activeReadContext?.isAppForeground()) return
  const paneId = activeReadContext.getActiveFocusedPaneId()
  if (!paneId) return
  markPaneReadIfUnread(paneId, 'active_observed')
}

function showToast(item: NotificationItem, retire: () => void) {
  if (!toastInstance) {
    console.warn(
      '[notification] toast instance not set; call setToastInstance() from App.vue setup'
    )
    return
  }
  const toast = toastInstance
  const { t } = useI18n()
  const paneId = item.paneId
  let dismissToast: (() => void) | undefined
  let closed = false
  let dismissRequested = false
  const children = [
    item.title ? h('strong', { class: 'notif-toast-title' }, item.title) : null,
    h('span', { class: 'notif-toast-body' }, item.body),
    paneId
      ? h(
          'button',
          {
            class: 'notif-toast-btn',
            onClick: () => {
              dismissToast?.()
              if (goToHandler) {
                goToHandler(paneId)
              } else {
                panelVisible.value = true
              }
            },
          },
          t('notification.goTo')
        )
      : null,
    h(
      'button',
      {
        class: 'notif-toast-btn',
        onClick: () => {
          dismissToast?.()
          panelVisible.value = true
        },
      },
      t('notification.viewAll')
    ),
  ].filter(Boolean)
  const content = h('div', { class: 'notif-toast-content' }, children)
  const id = toast(content, {
    type: toastTypeMap[item.type] ?? TYPE.INFO,
    timeout: item.type === 'urgent' ? 8000 : 5000,
    onClose: () => {
      if (closed) return
      closed = true
      retire()
    },
  })
  if (id !== undefined && 'dismiss' in toast && typeof toast.dismiss === 'function') {
    dismissToast = () => {
      if (closed || dismissRequested) return
      dismissRequested = true
      toast.dismiss?.(id)
    }
  }
  return dismissToast
}

function cancelPending(requestId: string) {
  const pending = pendingRequests.get(requestId)
  if (!pending) return
  if (pending.timer !== null) clearTimeout(pending.timer)
  pendingRequests.delete(requestId)
}

function dropPending(requestId: string) {
  cancelPending(requestId)
  attentionStore.dropOverlay(requestId)
}

function cancelAllPending() {
  for (const pending of pendingRequests.values()) {
    if (pending.timer !== null) clearTimeout(pending.timer)
  }
  pendingRequests.clear()
}

function prunePendingWithoutOverlay() {
  for (const requestId of pendingRequests.keys()) {
    if (!attentionStore.overlays.has(requestId)) cancelPending(requestId)
  }
}

function scheduleAckTimeout(pending: PendingRequest) {
  if (pending.timer !== null) clearTimeout(pending.timer)
  pending.timer = setTimeout(() => {
    pending.timer = null
    if (!pendingRequests.has(pending.requestId)) return
    if (pending.attempts >= MAX_SEND_ATTEMPTS) {
      pendingRequests.delete(pending.requestId)
      attentionStore.dropOverlay(pending.requestId)
      refreshProjection()
      return
    }
    sendPending(pending)
  }, ACK_TIMEOUT_MS)
}

function sendPending(pending: PendingRequest) {
  if (pending.attempts >= MAX_SEND_ATTEMPTS) {
    pendingRequests.delete(pending.requestId)
    attentionStore.dropOverlay(pending.requestId)
    refreshProjection()
    return
  }
  pending.attempts++
  if (pending.payload.epoch) {
    sendMarkRead(pending.payload)
  }
  scheduleAckTimeout(pending)
}

function createPending(
  targets: OverlayTarget[],
  reason: MarkReadReason,
  panes: MarkReadPayload['panes'],
  notifs: MarkReadPayload['notifs']
) {
  if (targets.length === 0) return
  const requestId = mintNotificationRequestId()
  const payload: MarkReadPayload = {
    type: 'mark_read',
    v: 1,
    epoch: attentionStore.epoch ?? '',
    clientId: getNotificationClientId(),
    requestId,
    reason,
    panes,
    notifs,
  }
  const pending: PendingRequest = { requestId, payload, attempts: 0, timer: null }
  if (pendingRequests.size >= PENDING_CAP) {
    const oldestRequestId = pendingRequests.keys().next().value
    if (oldestRequestId !== undefined) dropPending(oldestRequestId)
  }
  attentionStore.addOverlay(requestId, targets)
  pendingRequests.set(requestId, pending)
  refreshProjection()
  sendPending(pending)
}

export function markPanesRead(
  panes: Array<{ paneId: string; throughEventSeq?: string }>,
  reason: MarkReadReason
) {
  const wirePanes: MarkReadPayload['panes'] = []
  const targets: OverlayTarget[] = []
  for (const requested of panes) {
    const pane = attentionStore.panes.get(requested.paneId)
    const throughEventSeq = requested.throughEventSeq ?? pane?.latestEventSeq.toString()
    presentationScheduler.cancelPane(requested.paneId, throughEventSeq)
    if (!pane || throughEventSeq === undefined) continue
    wirePanes.push({ paneId: requested.paneId, throughEventSeq })
    targets.push({ paneId: requested.paneId, throughEventSeq: BigInt(throughEventSeq) })
  }
  pruneHistoryByReadTargets(targets)
  createPending(targets, reason, wirePanes, [])
}

export function markPaneReadIfUnread(paneId: string, reason: MarkReadReason) {
  if (!paneId) return
  presentationScheduler.cancelPane(paneId)
  if (!unreadByPane[paneId]) return
  const pane = attentionStore.panes.get(paneId)
  if (!pane) return
  markPanesRead([{ paneId, throughEventSeq: pane.latestEventSeq.toString() }], reason)
}

export function markNotifsRead(notifIds: string[], reason: MarkReadReason) {
  const requestedIds = [...new Set(notifIds)]
  for (const notifId of requestedIds) presentationScheduler.cancelNotif(notifId)
  const ids = requestedIds.filter((notifId) => attentionStore.notifs.has(notifId))
  const targets: OverlayTarget[] = ids.map((notifId) => ({ notifId }))
  pruneHistoryByReadTargets(targets)
  createPending(
    targets,
    reason,
    [],
    ids.map((notifId) => ({ notifId }))
  )
}

function resendPendingAfterSnapshot() {
  for (const pending of [...pendingRequests.values()]) {
    if (!attentionStore.overlays.has(pending.requestId)) {
      cancelPending(pending.requestId)
      continue
    }
    if (pending.timer !== null) clearTimeout(pending.timer)
    pending.timer = null
    pending.payload.epoch = attentionStore.epoch ?? ''
    sendPending(pending)
  }
}

export function __dispatchServerMessageForTest(msg: unknown) {
  if (!msg || typeof msg !== 'object' || !('type' in msg)) return
  const envelope = msg as { type: string }
  switch (envelope.type) {
    case 'state_delta':
      {
        const delta = msg as unknown as AttentionStateEnvelope
        const applied = attentionStore.applyDelta(delta)
        if (applied) cancelPresentationForState(delta)
        prunePendingWithoutOverlay()
        refreshProjection()
        if (applied) evaluateActiveRead()
      }
      break
    case 'snapshot': {
      const snapshot = msg as unknown as AttentionStateEnvelope
      const previousEpoch = attentionStore.epoch
      const epochChanged = previousEpoch !== snapshot.epoch
      if (previousEpoch !== null && epochChanged) {
        presentationScheduler.clear()
      }
      const applied = attentionStore.applySnapshot(snapshot)
      if (applied) cancelPresentationForState(snapshot)
      prunePendingWithoutOverlay()
      refreshProjection()
      const receivedInitialSnapshot = applied && !hasReceivedInitialSnapshot
      if (applied) hasReceivedInitialSnapshot = true
      if (receivedInitialSnapshot) flushDeferredHistoryActions()
      if (applied) evaluateActiveRead()
      if (previousEpoch !== null && epochChanged) {
        resendPendingAfterSnapshot()
      }
      break
    }
    case 'mark_read_result': {
      const result = msg as MarkReadResultWire & { type: string }
      const pending = pendingRequests.get(result.requestId)
      for (const { target } of result.results) {
        if ('paneId' in target) {
          const pane = pending?.payload.panes.find(({ paneId }) => paneId === target.paneId)
          presentationScheduler.cancelPane(target.paneId, pane?.throughEventSeq)
        } else if ('notifId' in target) {
          presentationScheduler.cancelNotif(target.notifId)
        }
      }
      const staleEpoch = result.results.some(({ status }) => status === 'stale_epoch')
      if (staleEpoch) cancelAllPending()
      else cancelPending(result.requestId)
      attentionStore.applyMarkReadResult(result)
      refreshProjection()
      break
    }
    case 'resync_required':
      attentionStore.noteResyncRequired()
      refreshProjection()
      break
    case 'bell':
    case 'notify':
      handleEvent(msg as LegacyEvent)
      break
  }
}

onNotification(__dispatchServerMessageForTest)

export function __pendingRequestCountForTest(): number {
  return pendingRequests.size
}

export function __pendingPresentationCountForTest(): number {
  return presentationScheduler.pendingCount()
}

export function __restoreNotificationSessionHistoryForTest() {
  hasReceivedInitialSnapshot = false
  notifications.value = loadNotificationSessionHistory()
}

export function __resetForTest() {
  resetPresentationEffects()
  clearPanelEmptyAutohide()
  cancelAllPending()
  notifications.value = []
  panelVisible.value = false
  for (const paneId of Object.keys(unreadByPane)) delete unreadByPane[paneId]
  for (const paneId of Object.keys(firstUnreadAtByPane)) delete firstUnreadAtByPane[paneId]
  attentionStore = createAttentionStore()
  projectionVersion.value++
  historyDedup.clear()
  deferredHistoryActions.clear()
  hasReceivedInitialSnapshot = false
  idCounter = 0
  requestCounter = 0
  initialized = false
  toastInstance = null
  goToHandler = null
  activeReadContext = null
  presentationScheduler.clear()
  __resetNotificationPresentationForTest()
}

export function useNotification() {
  initialized = true
  return {
    notifications,
    panelVisible,
    unreadByPane,
    firstUnreadAtByPane,
    unreadAttentionCount,
    historyCount,
    setGoToPaneHandler,
    markPanesRead,
    markPaneReadIfUnread,
    markNotifsRead,
    dismissOne(id: string) {
      const item = notifications.value.find((notification) => notification.id === id)
      if (item && hasRestoredHistoryAwaitingSnapshot((candidate) => candidate.id === id)) {
        deferHistoryAction(`dismiss:${id}`, () => useNotification().dismissOne(id))
        return
      }
      if (item) cancelPresentationForItem(item)
      notifications.value = notifications.value.filter((notification) => notification.id !== id)
      if (!item || item.epoch !== attentionStore.epoch) return
      if (item?.paneId && item.eventSeq) {
        markPanesRead([{ paneId: item.paneId, throughEventSeq: item.eventSeq }], 'dismiss')
      } else if (item?.notifId) {
        markNotifsRead([item.notifId], 'dismiss')
      }
    },
    clearAll() {
      if (hasRestoredHistoryAwaitingSnapshot(() => true)) {
        deferHistoryAction('clear_all', () => useNotification().clearAll())
        return
      }
      presentationScheduler.cancelAllPanes()
      presentationScheduler.cancelAllNotifs()
      notifications.value = []
      const panes = [...attentionStore.panes.entries()]
        .filter(([, pane]) => pane.latestEventSeq > pane.readThroughSeq)
        .map(([paneId, pane]) => ({ paneId, throughEventSeq: pane.latestEventSeq.toString() }))
      const notifIds = [...attentionStore.notifs.entries()]
        .filter(([, notif]) => !notif.read)
        .map(([notifId]) => notifId)
      const targets: OverlayTarget[] = [
        ...panes.map(({ paneId, throughEventSeq }) => ({
          paneId,
          throughEventSeq: BigInt(throughEventSeq),
        })),
        ...notifIds.map((notifId) => ({ notifId })),
      ]
      createPending(
        targets,
        'clear_all',
        panes,
        notifIds.map((notifId) => ({ notifId }))
      )
    },
    clearPaneUnread(paneId: string) {
      markPanesRead([{ paneId }], 'pane_close')
    },
    clearForPaneIds(paneIds: string[], reason: MarkReadReason = 'tab_activate') {
      const idSet = new Set(paneIds)
      if (hasRestoredHistoryAwaitingSnapshot(
        (notification) => Boolean(notification.paneId && idSet.has(notification.paneId))
      )) {
        const deferredPaneIds = [...paneIds]
        const key = `clear_panes:${reason}:${[...idSet].sort().join(',')}`
        deferHistoryAction(key, () => useNotification().clearForPaneIds(deferredPaneIds, reason))
        return
      }
      notifications.value = notifications.value.filter(
        (notification) => !notification.paneId || !idSet.has(notification.paneId)
      )
      markPanesRead(
        paneIds.map((paneId) => ({ paneId })),
        reason
      )
    },
    togglePanel() {
      panelVisible.value = !panelVisible.value
    },
  }
}
