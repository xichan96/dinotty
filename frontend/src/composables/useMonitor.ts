import { ref } from 'vue'
import { coalesceLatest } from '../utils/coalesceLatest'
import {
  onMonitorData as onSyncMonitorData,
  onMonitorHistory as onSyncMonitorHistory,
} from './useSyncWebSocket'

export interface CpuData {
  usage: number
  cores: number[]
  core_count: { physical: number; logical: number }
  load_avg: [number, number, number]
}

export interface MemoryData {
  used: number
  available: number
  total: number
  usage: number
  swap_used: number
  swap_total: number
}

export interface DiskData {
  mount: string
  fs_type: string
  used: number
  available: number
  total: number
  usage: number
}

export interface NetworkData {
  name: string
  ip: string
  rx_rate: number
  tx_rate: number
  rx_total: number
  tx_total: number
}

export interface GpuData {
  name: string
  uuid: string
  utilization_gpu: number
  utilization_mem: number
  temperature: number
  power_draw: number
  power_limit: number
  fan_speed: number
  memory_used: number
  memory_total: number
  memory_usage: number
}

export interface MonitorData {
  cpu: CpuData
  memory: MemoryData
  disk: DiskData[]
  network: NetworkData[]
  gpu: GpuData[]
}

export const monitorData = ref<MonitorData | null>(null)

type MonitorListener = (data: MonitorData) => void
type HistoryListener = (data: MonitorData[]) => void

const listeners: MonitorListener[] = []
const historyListeners: HistoryListener[] = []

export function onMonitorData(fn: MonitorListener) {
  listeners.push(fn)
  return () => {
    const i = listeners.indexOf(fn)
    if (i >= 0) listeners.splice(i, 1)
  }
}

export function onMonitorHistory(fn: HistoryListener) {
  historyListeners.push(fn)
  return () => {
    const i = historyListeners.indexOf(fn)
    if (i >= 0) historyListeners.splice(i, 1)
  }
}

// Monitor is "latest value wins", so collapsing a burst to a bounded cadence
// is safe and is the single choke point for every consumer (status bar items,
// history arrays, charts, plugin sampling). Without it, a desktop app whose
// WebContent process was suspended while its screen was off returns to a
// backlog of buffered samples that the server flushes at once - each sample
// triggering a full synchronous chart redraw and starving the main thread.
// Values spaced > MONITOR_FLUSH_MS apart (the server's 2s cadence) pass
// through unchanged.
const MONITOR_FLUSH_MS = 200

const emitMonitor = coalesceLatest(
  (d: MonitorData) => {
    monitorData.value = d
    for (const fn of listeners) fn(d)
  },
  { intervalMs: MONITOR_FLUSH_MS }
)

// Subscribe to sync channel for live monitor data
onSyncMonitorData((data) => {
  emitMonitor(data as unknown as MonitorData)
})

// Subscribe to sync channel for monitor history
onSyncMonitorHistory((data) => {
  const history = data as unknown as MonitorData[]
  for (const fn of historyListeners) fn(history)
  if (history.length > 0) {
    monitorData.value = history[history.length - 1]
  }
})

// ── Monitor History ──────────────────────────────────────────────

const MAX_HISTORY = 60

export const cpuHistory = ref<number[]>([])
export const memHistory = ref<number[]>([])
export const netRxHistory = ref<number[]>([])
export const netTxHistory = ref<number[]>([])
export const gpuUtilHistory = ref<number[][]>([])
export const gpuMemHistory = ref<number[][]>([])

let historyInitialized = false

function pushHistory<T>(arr: T[], val: T) {
  arr.push(val)
  if (arr.length > MAX_HISTORY) arr.shift()
}

function processEntry(d: MonitorData) {
  pushHistory(cpuHistory.value, d.cpu.usage)
  pushHistory(memHistory.value, d.memory.usage)
  const rx = d.network.reduce((s, n) => s + n.rx_rate, 0)
  const tx = d.network.reduce((s, n) => s + n.tx_rate, 0)
  pushHistory(netRxHistory.value, rx)
  pushHistory(netTxHistory.value, tx)

  // Per-GPU utilization history
  const gpu = d.gpu ?? []
  const utilHist = gpuUtilHistory.value
  const memHist = gpuMemHistory.value
  while (utilHist.length < gpu.length) {
    utilHist.push([])
  }
  while (memHist.length < gpu.length) {
    memHist.push([])
  }
  for (let i = 0; i < gpu.length; i++) {
    pushHistory(utilHist[i], gpu[i].utilization_gpu)
    pushHistory(memHist[i], gpu[i].memory_usage)
  }
}

export function initMonitorHistory() {
  if (historyInitialized) return
  historyInitialized = true

  onMonitorHistory((history) => {
    cpuHistory.value = []
    memHistory.value = []
    netRxHistory.value = []
    netTxHistory.value = []
    gpuUtilHistory.value = []
    gpuMemHistory.value = []
    for (const d of history) {
      processEntry(d)
    }
  })

  onMonitorData((d) => {
    processEntry(d)
    // Plugin-contributed series sample on the same cadence as system metrics.
    // Lazy import avoids a circular dep: pluginMonitor store imports from useSettings
    // which transitively reads monitorData.
    void import('../stores/pluginMonitor').then((m) => m.usePluginMonitorStore().sample())
  })
}
