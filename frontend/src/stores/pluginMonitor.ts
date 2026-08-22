import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

const MAX_HISTORY = 60
const MAX_FAILURES = 5

export type MonitorSeriesScale = 'percent' | 'auto'

export interface MonitorSeriesDetailRow {
  label: string
  value: string
}

export interface MonitorSeries {
  /** Globally unique, recommend `plugin-id:series-name` */
  id: string
  /** Chart title in Monitor tab + status bar tooltip */
  label: string
  /** Y-axis scale: 'percent' = 0-100 fixed, 'auto' = begin-at-zero dynamic. Defaults to 'auto'. */
  scale?: MonitorSeriesScale
  /** Optional explicit line color (CSS color or hex). Defaults to a palette color. */
  color?: string
  /** Sample the current value at ~1s cadence. Return null for a gap in the chart. */
  current?: () => number | null
  /** Multi-series variant (e.g. rx + tx). When present, `current` is ignored. */
  multiSeries?: () => Array<{ label?: string; value: number | null; color?: string }>
  /** Compact status bar text. Return null to hide the status bar entry (chart still renders). */
  statusText?: () => string | null
  /** Lucide icon name for the status bar entry. Defaults to 'Activity'. */
  statusIcon?: string
  /** Detail rows shown in the click-through popover. */
  detail?: () => MonitorSeriesDetailRow[]
  /** Default visibility (applies to both chart and status bar entry). Defaults to true. */
  defaultVisible?: boolean
  /** Dynamic visibility check (e.g. hide when sensor is absent). */
  visible?: () => boolean
}

export interface RegisteredSeries extends MonitorSeries {
  pluginId: string
  /** Per-subseries history; length 1 for single-series, N for multiSeries. */
  history: (number | null)[][]
  failureCount: number
  lastError?: string
  autoHidden: boolean
}

function pushHistory(arr: (number | null)[], v: number | null) {
  arr.push(v)
  if (arr.length > MAX_HISTORY) arr.shift()
}

function toNum(raw: number | null | undefined): number | null {
  if (raw == null) return null
  const n = Number(raw)
  return Number.isNaN(n) ? null : n
}

export const usePluginMonitorStore = defineStore('pluginMonitor', () => {
  const series = ref<RegisteredSeries[]>([])

  function register(pluginId: string, items: MonitorSeries[]) {
    for (const s of items) {
      if (series.value.some((x) => x.id === s.id)) continue
      series.value.push({
        ...s,
        pluginId,
        history: [[]],
        failureCount: 0,
        autoHidden: false,
      })
    }
  }

  function unregister(pluginId: string) {
    series.value = series.value.filter((s) => s.pluginId !== pluginId)
  }

  function clearErrors(s: RegisteredSeries) {
    if (s.failureCount > 0 || s.autoHidden) {
      s.failureCount = 0
      s.autoHidden = false
      s.lastError = undefined
    }
  }

  /** Called by useMonitor on each WS sample (~1s cadence). */
  function sample() {
    for (const s of series.value) {
      try {
        if (s.multiSeries) {
          const values = s.multiSeries()
          while (s.history.length < values.length) s.history.push([])
          while (s.history.length > values.length) s.history.pop()
          values.forEach((v, i) => {
            pushHistory(s.history[i], toNum(v?.value))
          })
        } else if (s.current) {
          pushHistory(s.history[0], toNum(s.current()))
        }
        clearErrors(s)
      } catch (err) {
        s.failureCount += 1
        s.lastError = err instanceof Error ? err.message : String(err)
        if (s.failureCount >= MAX_FAILURES) s.autoHidden = true
        // Push gaps so chart length stays consistent across series
        for (const h of s.history) pushHistory(h, null)
      }
    }
  }

  function isVisible(
    s: RegisteredSeries,
    userConfig: Record<string, boolean> | undefined
  ): boolean {
    if (s.autoHidden) return false
    if (s.visible && !s.visible()) return false
    const override = userConfig?.[s.id]
    if (override !== undefined) return override
    return s.defaultVisible ?? true
  }

  // Whether the series should show its config toggle in MonitorTab. Decouples
  // "sensor present" from "user enabled" so a disabled series can still be
  // re-enabled through the UI (otherwise the toggle disappears once the user
  // sets plugin_series[id] = false).
  function isConfigurable(s: RegisteredSeries): boolean {
    if (s.autoHidden) return false
    if (s.visible && !s.visible()) return false
    return true
  }

  const pluginIds = computed(() => Array.from(new Set(series.value.map((s) => s.pluginId))))

  return {
    series,
    pluginIds,
    register,
    unregister,
    sample,
    isVisible,
    isConfigurable,
  }
})

export { MAX_HISTORY, MAX_FAILURES }
