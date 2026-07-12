import { ref, shallowReactive, computed, h, watch } from 'vue'
import { useToast, TYPE } from 'vue-toastification'
import { getApiBase, wsUrlWithToken } from './apiBase'
import { isTauri } from './useTransport'
import { settings } from './useSettings'
import { useI18n } from './useI18n'

// ── Sound ──────────────────────────────────────────────

export interface SoundConfig {
  source: 'builtin' | 'custom'
  value: string
  volume: number
}

export type NotificationType = 'info' | 'success' | 'warning' | 'error' | 'urgent'

interface BuiltinDef {
  type: OscillatorType
  freqs: number[]
  duration: number
  gap: number
}

const BUILTIN_SOUNDS: Record<string, BuiltinDef> = {
  ding: { type: 'sine', freqs: [880], duration: 150, gap: 0 },
  'chime-up': { type: 'sine', freqs: [523, 659, 784], duration: 100, gap: 80 },
  'chime-down': { type: 'sine', freqs: [784, 659, 523], duration: 100, gap: 80 },
  'double-beep': { type: 'square', freqs: [660, 660], duration: 80, gap: 100 },
  alarm: { type: 'sawtooth', freqs: [440, 440, 440], duration: 200, gap: 150 },
  'soft-ping': { type: 'triangle', freqs: [1200], duration: 100, gap: 0 },
  'task-done': { type: 'sine', freqs: [523, 659, 784, 1047], duration: 80, gap: 60 },
  'error-buzz': { type: 'sawtooth', freqs: [220], duration: 300, gap: 0 },
}

let audioCtx: AudioContext | null = null

function getAudioContext(): AudioContext {
  if (!audioCtx) {
    audioCtx = new AudioContext()
  }
  if (audioCtx.state === 'suspended') {
    audioCtx.resume()
  }
  return audioCtx
}

function playBuiltin(name: string, volume: number) {
  const def = BUILTIN_SOUNDS[name]
  if (!def) return
  const ctx = getAudioContext()
  const gainNode = ctx.createGain()
  gainNode.gain.value = Math.max(0, Math.min(1, volume))
  gainNode.connect(ctx.destination)

  let offset = ctx.currentTime
  for (const freq of def.freqs) {
    const osc = ctx.createOscillator()
    osc.type = def.type
    osc.frequency.value = freq
    osc.connect(gainNode)
    osc.start(offset)
    osc.stop(offset + def.duration / 1000)
    offset += (def.duration + def.gap) / 1000
  }
}

export function playSound(config: SoundConfig) {
  if (config.source === 'builtin') {
    playBuiltin(config.value, config.volume)
  } else {
    const audio = new Audio(config.value)
    audio.volume = Math.max(0, Math.min(1, config.volume))
    audio.play().catch(() => {})
  }
}

export function getBuiltinSoundNames(): string[] {
  return Object.keys(BUILTIN_SOUNDS)
}

export interface NotificationItem {
  id: string
  type: NotificationType
  paneId: string
  title: string | null
  body: string
  timestamp: number
}

const notifications = ref<NotificationItem[]>([])
const panelVisible = ref(false)
const unreadByPane = shallowReactive<Record<string, NotificationType>>({})
const unreadCount = computed(() => notifications.value.length)

let ws: WebSocket | null = null
let idCounter = 0
let initialized = false
let reconnectDelay = 3000

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

function getNotifConfig() {
  return settings.notification
}

function handleEvent(event: {
  type: string
  pane_id: string
  title?: string | null
  body?: string
  notification_type?: string
}) {
  const cfg = getNotifConfig()
  if (!cfg || !cfg.enabled) return

  let notifType: NotificationType = 'info'
  let title: string | null = null
  let body = ''

  if (event.type === 'bell') {
    if (!cfg.bell?.enabled) return
    body = 'Bell'
  } else if (event.type === 'notify') {
    if (!cfg.osc_notify) return
    title = event.title ?? null
    body = event.body ?? ''
    notifType = (event.notification_type as NotificationType) || 'info'
  } else {
    return
  }

  const item: NotificationItem = {
    id: genId(),
    type: notifType,
    paneId: event.pane_id,
    title,
    body,
    timestamp: Date.now(),
  }
  notifications.value.unshift(item)
  if (notifications.value.length > 100) {
    notifications.value.length = 100
  }

  // Track unread per pane (highest severity)
  const current = unreadByPane[event.pane_id]
  if (!current || severityRank(notifType) > severityRank(current)) {
    unreadByPane[event.pane_id] = notifType
  }

  // Sound
  if (cfg.channels?.sound) {
    const soundCfg: SoundConfig | undefined = cfg.sounds?.[notifType]
    if (soundCfg) playSound(soundCfg)
  }

  // Vibration
  if (cfg.channels?.vibration && navigator.vibrate) {
    navigator.vibrate(notifType === 'urgent' ? [100, 50, 100, 50, 100] : [100])
  }

  // Toast notification (reuses panel channel config)
  if (cfg.channels?.panel) {
    showToast(item)
  }
}

const toastTypeMap: Record<NotificationType, any> = {
  info: TYPE.INFO,
  success: TYPE.SUCCESS,
  warning: TYPE.WARNING,
  error: TYPE.ERROR,
  urgent: TYPE.ERROR,
}

let goToHandler: ((paneId: string) => void) | null = null

export function setGoToPaneHandler(handler: (paneId: string) => void) {
  goToHandler = handler
}

function showToast(item: NotificationItem) {
  const toast = useToast()
  const { t } = useI18n()
  const children = [
    item.title ? h('strong', { class: 'notif-toast-title' }, item.title) : null,
    h('span', { class: 'notif-toast-body' }, item.body),
    h(
      'button',
      {
        class: 'notif-toast-btn',
        onClick: () => {
          if (goToHandler) {
            goToHandler(item.paneId)
          } else {
            panelVisible.value = true
          }
        },
      },
      t('notification.goTo')
    ),
    h(
      'button',
      {
        class: 'notif-toast-btn',
        onClick: () => {
          panelVisible.value = true
        },
      },
      t('notification.viewAll')
    ),
  ].filter(Boolean)
  const content = h('div', { class: 'notif-toast-content' }, children)
  toast(content, {
    type: toastTypeMap[item.type] ?? TYPE.INFO,
    timeout: item.type === 'urgent' ? 8000 : 5000,
  })
}

function connectWs() {
  if (ws) return
  const connect = async () => {
    let url: string
    if (isTauri()) {
      const origin = await getApiBase()
      url = `${origin.replace(/^http/, 'ws')}/ws/notify`
    } else {
      const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
      url = `${proto}//${location.host}/ws/notify`
    }
    ws = new WebSocket(wsUrlWithToken(url))
    ws.onopen = () => {
      reconnectDelay = 3000
    }
    ws.onmessage = (e) => {
      try {
        handleEvent(JSON.parse(e.data))
      } catch {}
    }
    ws.onclose = () => {
      ws = null
      setTimeout(connect, reconnectDelay)
      reconnectDelay = Math.min(reconnectDelay * 2, 30000)
    }
    ws.onerror = () => {}
  }
  connect()
}

export function useNotification() {
  if (!initialized) {
    initialized = true
    connectWs()
  }
  return {
    notifications,
    panelVisible,
    unreadByPane,
    unreadCount,
    setGoToPaneHandler,
    dismissOne(id: string) {
      const item = notifications.value.find((n) => n.id === id)
      notifications.value = notifications.value.filter((n) => n.id !== id)
      if (item && !notifications.value.some((n) => n.paneId === item.paneId)) {
        delete unreadByPane[item.paneId]
      }
    },
    clearAll() {
      notifications.value = []
      for (const k of Object.keys(unreadByPane)) delete unreadByPane[k]
      panelVisible.value = false
    },
    clearPaneUnread(paneId: string) {
      delete unreadByPane[paneId]
    },
    togglePanel() {
      panelVisible.value = !panelVisible.value
    },
  }
}
