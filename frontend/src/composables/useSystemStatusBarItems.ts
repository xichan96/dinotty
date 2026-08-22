import { h, type ComputedRef } from 'vue'
import { Cpu, MemoryStick, HardDrive, Wifi, Gpu } from 'lucide-vue-next'
import { monitorData } from './useMonitor'
import type { StatusBarItem } from '../stores/statusBarItems'

export type MetricKey = 'cpu' | 'memory' | 'disk' | 'network' | 'gpu'

interface MonitorSettings {
  enabled: boolean
  cpu: boolean
  memory: boolean
  disk: boolean
  network: boolean
  gpu?: boolean
}

function fmtBytes(b: number): string {
  if (b < 1024 * 1024 * 1024) return `${(b / 1024 / 1024).toFixed(1)}M`
  return `${(b / 1024 / 1024 / 1024).toFixed(1)}G`
}

function fmtRate(bps: number): string {
  if (bps < 1024) return `${bps}B`
  if (bps < 1024 * 1024) return `${(bps / 1024).toFixed(1)}K`
  return `${(bps / 1024 / 1024).toFixed(1)}M`
}

export function createSystemStatusBarItems(
  monitorSettings: ComputedRef<MonitorSettings>,
  onMetricClick: (key: MetricKey, event: MouseEvent) => void
): StatusBarItem[] {
  return [
    {
      id: 'system:cpu',
      position: 'right',
      priority: 100,
      tooltip: 'CPU 使用率',
      onClick: (e) => onMetricClick('cpu', e),
      visible: () => monitorSettings.value.cpu,
      render: () => {
        const d = monitorData.value
        const usage = d ? `${d.cpu.usage.toFixed(0)}%` : '-'
        return h('span', { class: 'metric-content' }, [
          h(Cpu, { size: 14 }),
          h('span', { class: 'metric-value' }, usage),
        ])
      },
    },
    {
      id: 'system:memory',
      position: 'right',
      priority: 110,
      tooltip: '内存使用',
      onClick: (e) => onMetricClick('memory', e),
      visible: () => monitorSettings.value.memory,
      render: () => {
        const d = monitorData.value
        const label = d ? `${fmtBytes(d.memory.used)}/${fmtBytes(d.memory.total)}` : '-'
        return h('span', { class: 'metric-content' }, [
          h(MemoryStick, { size: 14 }),
          h('span', { class: 'metric-value' }, label),
        ])
      },
    },
    {
      id: 'system:disk',
      position: 'right',
      priority: 120,
      tooltip: '磁盘使用',
      onClick: (e) => onMetricClick('disk', e),
      visible: () => monitorSettings.value.disk,
      render: () => {
        const d = monitorData.value
        const mainDisk = d?.disk[0]
        const label = mainDisk ? `${fmtBytes(mainDisk.used)}/${fmtBytes(mainDisk.total)}` : '-'
        return h('span', { class: 'metric-content' }, [
          h(HardDrive, { size: 14 }),
          h('span', { class: 'metric-value' }, label),
        ])
      },
    },
    {
      id: 'system:network',
      position: 'right',
      priority: 130,
      tooltip: '网络速率',
      onClick: (e) => onMetricClick('network', e),
      visible: () => monitorSettings.value.network,
      render: () => {
        const d = monitorData.value
        const label = d
          ? `↑${fmtRate(d.network.reduce((s, n) => s + n.tx_rate, 0))} ↓${fmtRate(d.network.reduce((s, n) => s + n.rx_rate, 0))}`
          : '-'
        return h('span', { class: 'metric-content' }, [
          h(Wifi, { size: 14 }),
          h('span', { class: 'metric-value' }, label),
        ])
      },
    },
    {
      id: 'system:gpu',
      position: 'right',
      priority: 140,
      tooltip: 'GPU 显存',
      onClick: (e) => onMetricClick('gpu', e),
      visible: () =>
        (monitorSettings.value.gpu ?? false) && (monitorData.value?.gpu?.length ?? 0) > 0,
      render: () => {
        const d = monitorData.value
        if (!d || !d.gpu?.length) return null
        const totalUsed = d.gpu.reduce((s, g) => s + g.memory_used, 0)
        const totalMem = d.gpu.reduce((s, g) => s + g.memory_total, 0)
        const pct = totalMem > 0 ? (totalUsed / totalMem) * 100 : 0
        const label = `${fmtBytes(totalUsed * 1024 * 1024)}/${fmtBytes(totalMem * 1024 * 1024)} ${pct.toFixed(0)}%`
        return h('span', { class: 'metric-content' }, [
          h(Gpu, { size: 14 }),
          h('span', { class: 'metric-value' }, label),
        ])
      },
    },
  ]
}
