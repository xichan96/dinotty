import { reactive, readonly, ref, watch } from 'vue'
import { isTauri } from './useTransport'
import { settings as serverSettings, settingsLoaded } from './useSettings'
import type { NotificationType, SoundConfig } from './useNotification'

export type DndLevel = 'normal' | 'dot_sound' | 'silent'

export interface NotificationPresentationSettings {
  presentation_enabled: boolean
  channels: {
    sound: boolean
    vibration: boolean
    popup: boolean
    panel: boolean
    tab_indicator: boolean
  }
  sounds: Record<NotificationType, SoundConfig>
  dnd_level: DndLevel
  ignore_current_tab: boolean
  quiet_hours: { start: string; end: string }
  coalesce_window_ms: number
}

export interface PresentationEvent {
  paneId?: string
  notifId?: string
  eventSeq?: string
  severity: NotificationType
}

export interface PresentationOutput {
  storeHistory: boolean
  showTabIndicator: boolean
  showPopup: boolean
  playSound: boolean
  vibrate: boolean
}

export interface PresentationGateContext {
  settings: NotificationPresentationSettings
  focusedPaneId: string | null
  activeTabPaneIds: readonly string[]
  isAppForeground: boolean
  now: () => Date
}

const VERSION = 1
const SURFACE = isTauri() ? 'tauri' : 'web'
export const NOTIFICATION_PRESENTATION_STORAGE_KEY = `dinotty_notification_presentation_${SURFACE}_v${VERSION}`
export const NOTIFICATION_PRESENTATION_MIGRATION_KEY = `${NOTIFICATION_PRESENTATION_STORAGE_KEY}_migrated`

const DEFAULT_SOUNDS: Record<NotificationType, SoundConfig> = {
  info: { source: 'builtin', value: 'ding', volume: 0.7 },
  success: { source: 'builtin', value: 'chime-up', volume: 0.7 },
  warning: { source: 'builtin', value: 'double-beep', volume: 0.8 },
  error: { source: 'builtin', value: 'error-buzz', volume: 0.8 },
  urgent: { source: 'builtin', value: 'alarm', volume: 1 },
}

export const DEFAULT_NOTIFICATION_PRESENTATION_SETTINGS: NotificationPresentationSettings = {
  presentation_enabled: true,
  channels: { sound: true, vibration: true, popup: true, panel: true, tab_indicator: true },
  sounds: DEFAULT_SOUNDS,
  dnd_level: 'normal',
  ignore_current_tab: true,
  quiet_hours: { start: '22:00', end: '22:00' },
  coalesce_window_ms: 300,
}

function cloneDefaults(): NotificationPresentationSettings {
  return JSON.parse(JSON.stringify(DEFAULT_NOTIFICATION_PRESENTATION_SETTINGS))
}

const presentationSettings = reactive<NotificationPresentationSettings>(cloneDefaults())
const isEphemeral = ref(false)
let loaded = false
let loading = false
let persistenceEnabled = false
let stopServerStripWatch: (() => void) | null = null
let stopSettingsLoadedWatch: (() => void) | null = null
const sessionMigrationAttempted = new Set<string>()

function storageGet(key: string): string | null | undefined {
  if (typeof localStorage === 'undefined') return undefined
  try {
    return localStorage.getItem(key)
  } catch {
    isEphemeral.value = true
    return undefined
  }
}

function storageSet(key: string, value: string): boolean {
  if (typeof localStorage === 'undefined') {
    isEphemeral.value = true
    return false
  }
  try {
    localStorage.setItem(key, value)
    return true
  } catch {
    isEphemeral.value = true
    return false
  }
}

function storageRemove(key: string): boolean {
  if (typeof localStorage === 'undefined') {
    isEphemeral.value = true
    return false
  }
  try {
    localStorage.removeItem(key)
    return true
  } catch {
    isEphemeral.value = true
    return false
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isSoundConfig(value: unknown): value is SoundConfig {
  return (
    isRecord(value) &&
    (value.source === 'builtin' || value.source === 'custom') &&
    typeof value.value === 'string' &&
    typeof value.volume === 'number' &&
    Number.isFinite(value.volume) &&
    value.volume >= 0 &&
    value.volume <= 1
  )
}

function isTime(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{2}:\d{2}$/.test(value)) return false
  const [hours, minutes] = value.split(':').map(Number)
  return hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59
}

function normalizeSettings(value: unknown): NotificationPresentationSettings | null {
  if (
    !isRecord(value) ||
    !isRecord(value.channels) ||
    !isRecord(value.sounds) ||
    !isRecord(value.quiet_hours)
  )
    return null
  let popup = true
  if (Object.prototype.hasOwnProperty.call(value.channels, 'popup')) {
    if (typeof value.channels.popup !== 'boolean') return null
    popup = value.channels.popup
  }
  if (
    typeof value.presentation_enabled !== 'boolean' ||
    typeof value.channels.sound !== 'boolean' ||
    typeof value.channels.vibration !== 'boolean' ||
    typeof value.channels.panel !== 'boolean' ||
    typeof value.channels.tab_indicator !== 'boolean' ||
    !['normal', 'dot_sound', 'silent'].includes(String(value.dnd_level)) ||
    typeof value.ignore_current_tab !== 'boolean' ||
    !isTime(value.quiet_hours.start) ||
    !isTime(value.quiet_hours.end) ||
    typeof value.coalesce_window_ms !== 'number' ||
    !Number.isFinite(value.coalesce_window_ms) ||
    value.coalesce_window_ms < 0
  )
    return null
  const sounds = value.sounds as Record<string, unknown>
  if (
    !(['info', 'success', 'warning', 'error', 'urgent'] as const).every((severity) =>
      isSoundConfig(sounds[severity])
    )
  )
    return null
  return {
    ...value,
    channels: { ...value.channels, popup },
  } as unknown as NotificationPresentationSettings
}

function assignSettings(value: NotificationPresentationSettings) {
  Object.assign(presentationSettings, cloneDefaults(), value)
  presentationSettings.channels = { ...value.channels }
  presentationSettings.sounds = JSON.parse(JSON.stringify(value.sounds))
  presentationSettings.quiet_hours = { ...value.quiet_hours }
}

function persist() {
  if (loading || !persistenceEnabled) return
  if (
    !storageSet(
      NOTIFICATION_PRESENTATION_STORAGE_KEY,
      JSON.stringify({ version: VERSION, settings: presentationSettings })
    )
  )
    persistenceEnabled = false
}

function migrateFromLoadedServerSettings(): boolean {
  if (!settingsLoaded.value) return false
  if (sessionMigrationAttempted.has(NOTIFICATION_PRESENTATION_MIGRATION_KEY)) return false
  sessionMigrationAttempted.add(NOTIFICATION_PRESENTATION_MIGRATION_KEY)
  loading = true
  assignSettings(legacyMigrationSeed())
  loading = false

  const markerWritten = storageSet(NOTIFICATION_PRESENTATION_MIGRATION_KEY, String(VERSION))
  if (!markerWritten) {
    persistenceEnabled = false
    isEphemeral.value = true
    try {
      storageRemove(NOTIFICATION_PRESENTATION_STORAGE_KEY)
    } catch {}
    return true
  }
  const localWritten = storageSet(
    NOTIFICATION_PRESENTATION_STORAGE_KEY,
    JSON.stringify({ version: VERSION, settings: presentationSettings })
  )
  persistenceEnabled = localWritten
  if (!localWritten) {
    isEphemeral.value = true
    try {
      storageRemove(NOTIFICATION_PRESENTATION_STORAGE_KEY)
    } catch {}
    try {
      storageRemove(NOTIFICATION_PRESENTATION_MIGRATION_KEY)
    } catch {}
  }
  return true
}

function legacyMigrationSeed(): NotificationPresentationSettings {
  const seed = cloneDefaults()
  const legacy = serverSettings.notification as unknown as Record<string, unknown>
  if (typeof legacy.presentation_enabled === 'boolean') {
    seed.presentation_enabled = legacy.presentation_enabled
  }
  if (isRecord(legacy.channels)) {
    for (const key of ['sound', 'vibration', 'panel', 'tab_indicator'] as const) {
      if (typeof legacy.channels[key] === 'boolean') seed.channels[key] = legacy.channels[key]
    }
    seed.channels.popup =
      typeof legacy.channels.popup === 'boolean'
        ? legacy.channels.popup
        : typeof legacy.channels.panel === 'boolean'
          ? legacy.channels.panel
          : true
  }
  if (isRecord(legacy.sounds)) {
    for (const severity of ['info', 'success', 'warning', 'error', 'urgent'] as const) {
      if (isSoundConfig(legacy.sounds[severity]))
        seed.sounds[severity] = { ...legacy.sounds[severity] }
    }
  }
  if (
    legacy.dnd_level === 'normal' ||
    legacy.dnd_level === 'dot_sound' ||
    legacy.dnd_level === 'silent'
  ) {
    seed.dnd_level = legacy.dnd_level
  }
  if (typeof legacy.ignore_current_tab === 'boolean')
    seed.ignore_current_tab = legacy.ignore_current_tab
  if (
    isRecord(legacy.quiet_hours) &&
    isTime(legacy.quiet_hours.start) &&
    isTime(legacy.quiet_hours.end)
  ) {
    seed.quiet_hours = { start: legacy.quiet_hours.start, end: legacy.quiet_hours.end }
  }
  if (typeof legacy.coalesce_window_ms === 'number' && Number.isFinite(legacy.coalesce_window_ms)) {
    seed.coalesce_window_ms = Math.max(0, legacy.coalesce_window_ms)
  }
  return seed
}

function hideLegacyServerPresentationFields() {
  const notification = serverSettings.notification as unknown as Record<string, unknown>
  for (const key of [
    'presentation_enabled',
    'channels',
    'sounds',
    'dnd_level',
    'ignore_current_tab',
    'quiet_hours',
    'coalesce_window_ms',
  ]) {
    if (!Object.prototype.hasOwnProperty.call(notification, key)) continue
    const descriptor = Object.getOwnPropertyDescriptor(notification, key)
    if (descriptor?.enumerable === false) continue
    try {
      Object.defineProperty(notification, key, { ...descriptor, enumerable: false })
    } catch {}
  }
}

function load() {
  if (loaded) return
  loaded = true
  loading = true
  persistenceEnabled = false
  assignSettings(cloneDefaults())

  let marker = storageGet(NOTIFICATION_PRESENTATION_MIGRATION_KEY)
  const storedBlob = storageGet(NOTIFICATION_PRESENTATION_STORAGE_KEY)
  if (marker !== String(VERSION) && storedBlob !== null && storedBlob !== undefined) {
    storageRemove(NOTIFICATION_PRESENTATION_STORAGE_KEY)
  }
  const raw = marker === String(VERSION) ? storedBlob : null
  let validLocal = false
  if (raw !== null && raw !== undefined) {
    try {
      const parsed: unknown = JSON.parse(raw)
      const normalized =
        isRecord(parsed) && parsed.version === VERSION ? normalizeSettings(parsed.settings) : null
      if (normalized) {
        assignSettings(normalized)
        validLocal = true
        persistenceEnabled = true
      } else {
        storageRemove(NOTIFICATION_PRESENTATION_STORAGE_KEY)
      }
    } catch {
      storageRemove(NOTIFICATION_PRESENTATION_STORAGE_KEY)
    }
  }

  if (!validLocal) {
    if (marker === String(VERSION)) {
      storageRemove(NOTIFICATION_PRESENTATION_MIGRATION_KEY)
      marker = null
    }
    if (marker === null) {
      migrateFromLoadedServerSettings()
    }
  }

  loading = false
  stopSettingsLoadedWatch = watch(
    settingsLoaded,
    (isLoaded) => {
      if (!isLoaded || persistenceEnabled) return
      const marker = storageGet(NOTIFICATION_PRESENTATION_MIGRATION_KEY)
      if (marker === null) migrateFromLoadedServerSettings()
    },
    { flush: 'sync' }
  )
  hideLegacyServerPresentationFields()
  stopServerStripWatch = watch(
    () => serverSettings.notification,
    hideLegacyServerPresentationFields,
    { flush: 'sync' }
  )
}

watch(presentationSettings, persist, { deep: true, flush: 'sync' })

export function useNotificationPresentation() {
  load()
  return {
    settings: presentationSettings,
    readonlySettings: readonly(presentationSettings),
    isEphemeral: readonly(isEphemeral),
    persist,
  }
}

export function getNotificationPresentationSettings() {
  load()
  return presentationSettings
}

export function __resetNotificationPresentationForTest() {
  stopServerStripWatch?.()
  stopServerStripWatch = null
  stopSettingsLoadedWatch?.()
  stopSettingsLoadedWatch = null
  loaded = false
  loading = true
  persistenceEnabled = false
  isEphemeral.value = false
  assignSettings(cloneDefaults())
  loading = false
  sessionMigrationAttempted.clear()
}

function minutesOfDay(value: string): number {
  const [hours, minutes] = value.split(':').map(Number)
  return hours * 60 + minutes
}

export function isInQuietHours(quietHours: { start: string; end: string }, now: Date): boolean {
  const start = minutesOfDay(quietHours.start)
  const end = minutesOfDay(quietHours.end)
  const current = now.getHours() * 60 + now.getMinutes()
  if (start === end) return false
  return start < end ? current >= start && current < end : current >= start || current < end
}

export function presentationGate(
  event: PresentationEvent,
  ctx: PresentationGateContext
): PresentationOutput {
  const { settings } = ctx
  const output: PresentationOutput = settings.presentation_enabled
    ? {
        storeHistory: settings.presentation_enabled,
        showTabIndicator: settings.channels.tab_indicator,
        showPopup: settings.channels.popup,
        playSound: settings.channels.sound,
        vibrate: settings.channels.vibration,
      }
    : {
        storeHistory: false,
        showTabIndicator: false,
        showPopup: false,
        playSound: false,
        vibrate: false,
      }

  if (settings.dnd_level === 'dot_sound') {
    output.showPopup = false
    output.vibrate = false
  } else if (settings.dnd_level === 'silent') {
    output.showPopup = false
    output.playSound = false
    output.vibrate = false
  }

  if (event.paneId && event.paneId === ctx.focusedPaneId && ctx.isAppForeground) {
    output.showPopup = false
    output.playSound = false
    output.vibrate = false
  }

  if (event.paneId && settings.ignore_current_tab && ctx.activeTabPaneIds.includes(event.paneId)) {
    output.showPopup = false
  }

  if (isInQuietHours(settings.quiet_hours, ctx.now())) {
    output.showPopup = false
    output.playSound = false
    output.vibrate = false
  }
  return output
}

interface PendingPresentation<T extends PresentationEvent> {
  events: Array<{ event: T; order: number }>
  timer: ReturnType<typeof setTimeout>
}

type PresentationKey = { kind: 'pane'; id: string } | { kind: 'notif'; id: string }

export interface PresentationSchedulerOptions<T extends PresentationEvent> {
  getWindowMs: () => number
  evaluate: (event: T) => PresentationOutput
  fire: (event: T, output: PresentationOutput, retire: () => void) => (() => void) | void
  setTimer?: (callback: () => void, delay: number) => ReturnType<typeof setTimeout>
  clearTimer?: (timer: ReturnType<typeof setTimeout>) => void
}

interface LivePresentation {
  token: object
  dismiss: () => void
  representativeSeq?: string
}

const severityRanks: Record<NotificationType, number> = {
  info: 0,
  success: 1,
  warning: 2,
  error: 3,
  urgent: 4,
}

export function createPresentationScheduler<T extends PresentationEvent>(
  options: PresentationSchedulerOptions<T>
) {
  const pendingPanes = new Map<string, PendingPresentation<T>>()
  const pendingNotifs = new Map<string, PendingPresentation<T>>()
  const livePresentations = new Map<string, LivePresentation[]>()
  const readWatermarks = new Map<string, bigint>()
  const setTimer =
    options.setTimer ?? ((callback: () => void, delay: number) => setTimeout(callback, delay))
  const clearTimer =
    options.clearTimer ?? ((timer: ReturnType<typeof setTimeout>) => clearTimeout(timer))
  let order = 0

  function keyFor(event: T): PresentationKey | null {
    if (event.paneId) return { kind: 'pane', id: event.paneId }
    if (event.notifId) return { kind: 'notif', id: event.notifId }
    return null
  }

  function mapFor(key: PresentationKey) {
    return key.kind === 'pane' ? pendingPanes : pendingNotifs
  }

  function namespacedKey(key: PresentationKey) {
    return `${key.kind}:${key.id}`
  }

  function retireLive(key: PresentationKey, token: object) {
    const liveKey = namespacedKey(key)
    const entries = livePresentations.get(liveKey)
    if (!entries) return
    const survivors = entries.filter((entry) => entry.token !== token)
    if (survivors.length > 0) livePresentations.set(liveKey, survivors)
    else livePresentations.delete(liveKey)
  }

  function dismissLive(
    key: PresentationKey,
    matches: (entry: LivePresentation) => boolean = () => true
  ) {
    const liveKey = namespacedKey(key)
    const entries = livePresentations.get(liveKey)
    if (!entries) return
    const dismissed = entries.filter(matches)
    const survivors = entries.filter((entry) => !matches(entry))
    if (survivors.length > 0) livePresentations.set(liveKey, survivors)
    else livePresentations.delete(liveKey)
    for (const entry of dismissed) entry.dismiss()
  }

  function representative(events: PendingPresentation<T>['events']): T {
    return events.reduce((best, candidate) => {
      const rank = severityRanks[candidate.event.severity]
      const bestRank = severityRanks[best.event.severity]
      return rank > bestRank || (rank === bestRank && candidate.order > best.order)
        ? candidate
        : best
    }).event
  }

  function flush(key: PresentationKey) {
    const pending = mapFor(key)
    const entry = pending.get(key.id)
    if (!entry) return
    pending.delete(key.id)
    const event = representative(entry.events)
    const output = options.evaluate(event)
    if (output.showPopup || output.playSound || output.vibrate) {
      const token = {}
      let retired = false
      const retire = () => {
        if (retired) return
        retired = true
        retireLive(key, token)
      }
      if (key.kind === 'notif' && output.showPopup) dismissLive(key)
      const dismiss = options.fire(event, output, retire)
      if (dismiss && !retired) {
        let dismissed = false
        const live: LivePresentation = {
          token,
          representativeSeq: event.eventSeq,
          dismiss: () => {
            if (dismissed) return
            dismissed = true
            dismiss()
          },
        }
        const liveKey = namespacedKey(key)
        const entries = livePresentations.get(liveKey) ?? []
        entries.push(live)
        livePresentations.set(liveKey, entries)
      }
    }
  }

  function enqueue(event: T, initialOutput = options.evaluate(event)): boolean {
    if (!initialOutput.showPopup && !initialOutput.playSound && !initialOutput.vibrate) return false
    if (event.paneId && event.eventSeq) {
      const watermark = readWatermarks.get(event.paneId)
      if (watermark !== undefined && BigInt(event.eventSeq) <= watermark) return false
    }
    const key = keyFor(event)
    if (!key) return false
    const pending = mapFor(key)
    const existing = pending.get(key.id)
    if (existing) clearTimer(existing.timer)
    const events = existing?.events ?? []
    events.push({ event, order: ++order })
    const windowMs = Math.max(0, options.getWindowMs())
    const timer = setTimer(() => flush(key), windowMs)
    pending.set(key.id, { events, timer })
    return true
  }

  function cancelPane(paneId: string, throughEventSeq?: string | bigint) {
    const key: PresentationKey = { kind: 'pane', id: paneId }
    const cancelAllForPane = throughEventSeq === undefined
    if (throughEventSeq !== undefined) {
      const watermark = BigInt(throughEventSeq)
      const current = readWatermarks.get(paneId)
      if (current === undefined || watermark > current) readWatermarks.set(paneId, watermark)
    }
    const entry = pendingPanes.get(paneId)
    if (entry) {
      clearTimer(entry.timer)
      const watermark = readWatermarks.get(paneId)
      const survivors =
        cancelAllForPane || watermark === undefined
          ? []
          : entry.events.filter(
              ({ event }) => !event.eventSeq || BigInt(event.eventSeq) > watermark
            )
      pendingPanes.delete(paneId)
      if (survivors.length > 0) {
        const timer = setTimer(() => flush(key), Math.max(0, options.getWindowMs()))
        pendingPanes.set(paneId, { events: survivors, timer })
      }
    }
    dismissLive(
      key,
      (live) =>
        cancelAllForPane ||
        !live.representativeSeq ||
        BigInt(live.representativeSeq) <= BigInt(throughEventSeq!)
    )
  }

  function removePane(paneId: string) {
    const entry = pendingPanes.get(paneId)
    if (entry) clearTimer(entry.timer)
    pendingPanes.delete(paneId)
    dismissLive({ kind: 'pane', id: paneId })
    readWatermarks.delete(paneId)
  }

  function cancelNotif(notifId: string) {
    const entry = pendingNotifs.get(notifId)
    if (entry) clearTimer(entry.timer)
    pendingNotifs.delete(notifId)
    dismissLive({ kind: 'notif', id: notifId })
  }

  function cancelAllNotifs() {
    for (const entry of pendingNotifs.values()) clearTimer(entry.timer)
    pendingNotifs.clear()
    for (const [key, entries] of livePresentations) {
      if (!key.startsWith('notif:')) continue
      livePresentations.delete(key)
      for (const live of entries) live.dismiss()
    }
  }

  function cancelAllPanes() {
    for (const entry of pendingPanes.values()) clearTimer(entry.timer)
    pendingPanes.clear()
    for (const [key, entries] of livePresentations) {
      if (!key.startsWith('pane:')) continue
      livePresentations.delete(key)
      for (const live of entries) live.dismiss()
    }
  }

  function dispose() {
    for (const entry of pendingPanes.values()) clearTimer(entry.timer)
    for (const entry of pendingNotifs.values()) clearTimer(entry.timer)
    pendingPanes.clear()
    pendingNotifs.clear()
    for (const entries of livePresentations.values()) {
      for (const live of entries) live.dismiss()
    }
    livePresentations.clear()
    readWatermarks.clear()
  }

  return {
    enqueue,
    cancelPane,
    removePane,
    cancelNotif,
    cancelAllPanes,
    cancelAllNotifs,
    clear: dispose,
    dispose,
    pendingCount: () => pendingPanes.size + pendingNotifs.size,
  }
}
