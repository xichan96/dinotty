<template>
  <div v-if="monitorSettings.enabled" class="status-bar">
    <div class="status-bar-metrics">
      <button
        v-for="m in visibleMetrics"
        :key="m.key"
        class="metric-btn"
        @click.stop="togglePopover(m.key, $event)"
      >
        <component :is="m.icon" :size="14" />
        <span class="metric-value">{{ m.label }}</span>
      </button>
    </div>

    <MonitorPopover
      :visible="!!activePopover"
      :metric="activePopover || 'cpu'"
      :data="data"
      :anchor-rect="anchorRect"
      :cpu-history="cpuHistory"
      :mem-history="memHistory"
      :net-rx-history="netRxHistory"
      :net-tx-history="netTxHistory"
      :gpu-util-history="gpuUtilHistory"
      :gpu-mem-history="gpuMemHistory"
      @close="activePopover = null"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { Cpu, MemoryStick, HardDrive, Wifi, Gpu } from 'lucide-vue-next'
import { monitorData } from '../../composables/useMonitor'
import { cpuHistory, memHistory, netRxHistory, netTxHistory, gpuUtilHistory, gpuMemHistory } from '../../composables/useMonitor'
import { useSettings } from '../../composables/useSettings'
import MonitorPopover from './MonitorPopover.vue'

const data = monitorData
const { settings } = useSettings()

const monitorSettings = computed(() => settings.monitor ?? { enabled: true, cpu: true, memory: true, disk: true, network: true })

type MetricKey = 'cpu' | 'memory' | 'disk' | 'network' | 'gpu'

const activePopover = ref<MetricKey | null>(null)
const anchorRect = ref<DOMRect | null>(null)

function fmtBytes(b: number): string {
  if (b < 1024 * 1024 * 1024) return `${(b / 1024 / 1024).toFixed(1)}M`
  return `${(b / 1024 / 1024 / 1024).toFixed(1)}G`
}

function fmtRate(bytesPerSec: number): string {
  if (bytesPerSec < 1024) return `${bytesPerSec}B`
  if (bytesPerSec < 1024 * 1024) return `${(bytesPerSec / 1024).toFixed(1)}K`
  return `${(bytesPerSec / 1024 / 1024).toFixed(1)}M`
}

const allMetrics = computed(() => {
  const d = data.value
  if (!d) {
    return [
      { key: 'cpu' as MetricKey, icon: Cpu, label: '—' },
      { key: 'memory' as MetricKey, icon: MemoryStick, label: '—' },
      { key: 'disk' as MetricKey, icon: HardDrive, label: '—' },
      { key: 'network' as MetricKey, icon: Wifi, label: '—' },
    ]
  }

  const mainDisk = d.disk[0]
  const totalRx = d.network.reduce((s, n) => s + n.rx_rate, 0)
  const totalTx = d.network.reduce((s, n) => s + n.tx_rate, 0)

  const metrics = [
    { key: 'cpu' as MetricKey, icon: Cpu, label: `${d.cpu.usage.toFixed(0)}%` },
    {
      key: 'memory' as MetricKey,
      icon: MemoryStick,
      label: `${fmtBytes(d.memory.used)}/${fmtBytes(d.memory.total)}`,
    },
    {
      key: 'disk' as MetricKey,
      icon: HardDrive,
      label: mainDisk
        ? `${fmtBytes(mainDisk.used)}/${fmtBytes(mainDisk.total)}`
        : '—',
    },
    {
      key: 'network' as MetricKey,
      icon: Wifi,
      label: `↑${fmtRate(totalTx)} ↓${fmtRate(totalRx)}`,
    },
  ]

  if (d.gpu?.length > 0) {
    const totalUsed = d.gpu.reduce((s, g) => s + g.memory_used, 0)
    const totalMem = d.gpu.reduce((s, g) => s + g.memory_total, 0)
    const pct = totalMem > 0 ? (totalUsed / totalMem * 100) : 0
    metrics.push({
      key: 'gpu' as MetricKey,
      icon: Gpu,
      label: `${fmtBytes(totalUsed * 1024 * 1024)}/${fmtBytes(totalMem * 1024 * 1024)} ${pct.toFixed(0)}%`,
    })
  }

  return metrics
})

const visibleMetrics = computed(() =>
  allMetrics.value.filter((m) => monitorSettings.value[m.key])
)

function togglePopover(key: MetricKey, event: MouseEvent) {
  if (activePopover.value === key) {
    activePopover.value = null
    return
  }
  const el = (event.currentTarget as HTMLElement)
  anchorRect.value = el.getBoundingClientRect()
  activePopover.value = key
}
</script>

<style scoped>
.status-bar {
  height: calc(24px + env(safe-area-inset-bottom, 0px));
  background: var(--bg, #1a1a2e);
  border-top: 1px solid var(--border, #3C3C3C);
  display: flex;
  align-items: center;
  justify-content: flex-start;
  flex-shrink: 0;
  padding: 0 12px;
  position: relative;
  z-index: 2;
}
.status-bar-metrics {
  display: flex;
  gap: 16px;
  align-items: center;
}
.metric-btn {
  display: flex;
  align-items: center;
  gap: 4px;
  background: none;
  border: none;
  color: var(--fg-muted, rgba(255, 255, 255, 0.7));
  cursor: pointer;
  padding: 2px 4px;
  border-radius: 3px;
  font-size: 12px;
  font-family: inherit;
  line-height: 1;
  transition: color 0.15s;
}
.metric-btn:hover {
  color: var(--fg-bright, rgba(255, 255, 255, 0.9));
}
.metric-value {
  font-variant-numeric: tabular-nums;
}
</style>
