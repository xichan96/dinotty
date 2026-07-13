<template>
  <div>
    <div class="local-hint">
      <Monitor :size="14" />
      <span>{{ t('settings.monitor.localHint') }}</span>
    </div>
    <div class="settings-group">
      <div class="chart-header">
        <h3>{{ t('settings.monitor.cpuChart') }}</h3>
        <label class="toggle">
          <input type="checkbox" v-model="settings.monitor.cpu" @change="saveSettings()" />
          <span class="toggle-track"><span class="toggle-thumb"></span></span>
        </label>
      </div>
      <div class="chart-wrap">
        <Line :data="cpuChartData" :options="pctChartOptions" />
      </div>
    </div>

    <div class="settings-group">
      <div class="chart-header">
        <h3>{{ t('settings.monitor.memChart') }}</h3>
        <label class="toggle">
          <input type="checkbox" v-model="settings.monitor.memory" @change="saveSettings()" />
          <span class="toggle-track"><span class="toggle-thumb"></span></span>
        </label>
      </div>
      <div class="chart-wrap">
        <Line :data="memChartData" :options="pctChartOptions" />
      </div>
    </div>

    <div class="settings-group">
      <div class="chart-header">
        <h3>{{ t('settings.monitor.diskLabel') }}</h3>
        <label class="toggle">
          <input type="checkbox" v-model="settings.monitor.disk" @change="saveSettings()" />
          <span class="toggle-track"><span class="toggle-thumb"></span></span>
        </label>
      </div>
      <div v-if="data" class="disk-info">
        <div v-for="(d, i) in data.disk" :key="i" class="settings-row">
          <label>{{ d.mount }}</label>
          <span class="disk-val"
            >{{ fmtBytes(d.used) }} / {{ fmtBytes(d.total) }} ({{ d.usage.toFixed(0) }}%)</span
          >
        </div>
      </div>
      <div v-else class="disk-info"><span class="disk-val">—</span></div>
    </div>

    <div class="settings-group">
      <div class="chart-header">
        <h3>{{ t('settings.monitor.netChart') }}</h3>
        <label class="toggle">
          <input type="checkbox" v-model="settings.monitor.network" @change="saveSettings()" />
          <span class="toggle-track"><span class="toggle-thumb"></span></span>
        </label>
      </div>
      <div class="chart-wrap">
        <Line :data="netChartData" :options="netChartOptions" />
      </div>
    </div>

    <div class="settings-group">
      <div class="chart-header">
        <h3>{{ t('settings.monitor.gpuChart') }}</h3>
        <label class="toggle">
          <input type="checkbox" v-model="settings.monitor.gpu" @change="saveSettings()" />
          <span class="toggle-track"><span class="toggle-thumb"></span></span>
        </label>
      </div>
      <div v-if="settings.monitor.gpu && hasGpu" class="chart-wrap">
        <Line :data="gpuChartData" :options="pctChartOptions" />
      </div>
      <div v-if="settings.monitor.gpu && hasGpu" class="chart-header">
        <h3>{{ t('settings.monitor.gpuMemChart') }}</h3>
      </div>
      <div v-if="settings.monitor.gpu && hasGpu" class="chart-wrap">
        <Line :data="gpuMemChartData" :options="autoChartOptions" />
      </div>
      <div v-if="settings.monitor.gpu && hasGpu" class="disk-info">
        <div v-for="(g, i) in data!.gpu" :key="i" class="settings-row">
          <label>GPU {{ i }} · {{ g.name }}</label>
          <span class="disk-val"
            >VRAM {{ fmtBytes(g.memory_used * 1024 * 1024) }} /
            {{ fmtBytes(g.memory_total * 1024 * 1024) }} ({{ g.memory_usage.toFixed(0) }}%) ·
            {{ g.utilization_gpu.toFixed(0) }}%</span
          >
        </div>
      </div>
      <div v-if="!settings.monitor.gpu || !hasGpu" class="disk-info">
        <span class="disk-val">—</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, watch } from 'vue'
import { Monitor } from 'lucide-vue-next'
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Filler,
  Tooltip,
} from 'chart.js'
import { Line } from 'vue-chartjs'
import { useSettings } from '../../composables/useSettings'
import { effectiveTheme } from '../../composables/useDeviceThemeSelection'
import { useI18n } from '../../composables/useI18n'
import { monitorData } from '../../composables/useMonitor'
import {
  cpuHistory,
  memHistory,
  netRxHistory,
  netTxHistory,
  gpuUtilHistory,
  gpuMemHistory,
} from '../../composables/useMonitor'

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Filler, Tooltip)

const { settings, saveSettings } = useSettings()
const { t } = useI18n()
const data = monitorData

const hasGpu = computed(() => (data.value?.gpu?.length ?? 0) > 0)

watch(hasGpu, (available) => {
  if (!available && settings.monitor.gpu) {
    settings.monitor.gpu = false
    saveSettings()
  }
})

const labels = computed(() => cpuHistory.value.map(() => ''))

const gpuColors = [
  '#76b900',
  '#00a8e8',
  '#e84040',
  '#f59e0b',
  '#8b5cf6',
  '#34d399',
  '#f472b6',
  '#fbbf24',
  '#60a5fa',
  '#a78bfa',
]

/** Read CSS variable from the document root (canvas cannot resolve var()). */
function cssVar(name: string, fallback: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback
}

// Access theme preset to create a reactive dependency — re-evaluates on theme change.
const baseOptions = computed(() => {
  void effectiveTheme.value
  const borderColor = cssVar('--border', '#3C3C3C')
  const fgMuted = cssVar('--fg-muted', '#858585')
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: 0 } as const,
    plugins: { legend: { display: false }, tooltip: { enabled: false } },
    elements: { point: { radius: 0 }, line: { tension: 0.3, borderWidth: 1.5 } },
    scales: {
      x: { display: false },
      y: {
        min: 0,
        grid: { color: borderColor },
        ticks: { color: fgMuted, font: { size: 10 } },
      },
    },
  }
})

const pctChartOptions = computed(() => ({
  ...baseOptions.value,
  scales: { ...baseOptions.value.scales, y: { ...baseOptions.value.scales.y, max: 100 } },
}))

const autoChartOptions = computed(() => ({
  ...baseOptions.value,
  scales: {
    ...baseOptions.value.scales,
    y: { ...baseOptions.value.scales.y, beginAtZero: true },
  },
}))

function fmtRate(v: number): string {
  if (v < 1024) return `${v}B/s`
  if (v < 1024 * 1024) return `${(v / 1024).toFixed(0)}K/s`
  return `${(v / 1024 / 1024).toFixed(1)}M/s`
}

function fmtBytes(b: number): string {
  if (b < 1024) return `${b}B`
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)}K`
  if (b < 1024 * 1024 * 1024) return `${(b / 1024 / 1024).toFixed(1)}M`
  return `${(b / 1024 / 1024 / 1024).toFixed(1)}G`
}

const netChartOptions = computed(() => ({
  ...baseOptions.value,
  plugins: { legend: { display: false }, tooltip: { enabled: false } },
  scales: {
    ...baseOptions.value.scales,
    y: {
      ...baseOptions.value.scales.y,
      ticks: {
        ...baseOptions.value.scales.y.ticks,
        callback: (v: number | string) => fmtRate(Number(v)),
      },
    },
  },
}))

const cpuChartData = computed(() => ({
  labels: labels.value,
  datasets: [
    {
      data: [...cpuHistory.value],
      borderColor: '#8A8A8A',
      backgroundColor: 'rgba(77,127,255,0.1)',
      fill: true,
    },
  ],
}))

const memChartData = computed(() => ({
  labels: labels.value,
  datasets: [
    {
      data: [...memHistory.value],
      borderColor: '#34d399',
      backgroundColor: 'rgba(52,211,153,0.1)',
      fill: true,
    },
  ],
}))

const netChartData = computed(() => ({
  labels: labels.value,
  datasets: [
    {
      data: [...netTxHistory.value],
      borderColor: '#f59e0b',
      backgroundColor: 'rgba(245,158,11,0.05)',
      fill: true,
    },
    {
      data: [...netRxHistory.value],
      borderColor: '#8b5cf6',
      backgroundColor: 'rgba(139,92,246,0.05)',
      fill: true,
    },
  ],
}))

const gpuChartData = computed(() => ({
  labels: labels.value,
  datasets: gpuUtilHistory.value.map((hist, i) => ({
    data: [...hist],
    borderColor: gpuColors[i % gpuColors.length],
    backgroundColor: 'transparent',
    borderWidth: 1.5,
    fill: false,
  })),
}))

const gpuMemChartData = computed(() => ({
  labels: labels.value,
  datasets: gpuMemHistory.value.map((hist, i) => ({
    data: [...hist],
    borderColor: gpuColors[i % gpuColors.length],
    backgroundColor: 'transparent',
    borderWidth: 2,
    fill: false,
  })),
}))
</script>

<style scoped>
.local-hint {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--fg-muted, #888);
  margin-bottom: 16px;
  padding: 0 2px;
}
.chart-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}
.chart-header h3 {
  font-size: 13px;
  font-weight: 600;
  color: var(--fg-muted);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin: 0;
}
.chart-wrap {
  height: 120px;
  position: relative;
}
.disk-info {
  font-size: 12px;
}
.disk-val {
  font-variant-numeric: tabular-nums;
  color: var(--fg-muted);
  font-size: 12px;
}
</style>
