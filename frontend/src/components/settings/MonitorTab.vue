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
          <input v-model="settings.monitor.cpu" type="checkbox" @change="saveSettings()" />
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
          <input v-model="settings.monitor.memory" type="checkbox" @change="saveSettings()" />
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
          <input v-model="settings.monitor.disk" type="checkbox" @change="saveSettings()" />
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
      <div v-else class="disk-info"><span class="disk-val">-</span></div>
    </div>

    <div class="settings-group">
      <div class="chart-header">
        <h3>{{ t('settings.monitor.netChart') }}</h3>
        <label class="toggle">
          <input v-model="settings.monitor.network" type="checkbox" @change="saveSettings()" />
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
          <input v-model="settings.monitor.gpu" type="checkbox" @change="saveSettings()" />
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
        <span class="disk-val">-</span>
      </div>
    </div>

    <div v-if="visiblePluginSeries.length" class="settings-group">
      <div class="chart-header">
        <h3>{{ t('settings.monitor.pluginMetrics') }}</h3>
      </div>
      <div v-for="s in visiblePluginSeries" :key="s.id" class="plugin-series-block">
        <div class="chart-header">
          <h3 class="plugin-series-title">{{ s.label }}</h3>
          <label class="toggle">
            <input
              type="checkbox"
              :checked="pluginSeriesVisible(s)"
              @change="setPluginSeriesVisible(s, ($event.target as HTMLInputElement).checked)"
            />
            <span class="toggle-track"><span class="toggle-thumb"></span></span>
          </label>
        </div>
        <div class="chart-wrap">
          <Line :data="pluginChartData(s)" :options="pluginChartOptions(s)" />
        </div>
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
import {
  baseOptions,
  pctChartOptions,
  autoChartOptions,
  netChartOptions,
  gpuColors,
  fmtBytes,
  labelsFor,
} from '../../composables/useChartOptions'
import { usePluginMonitorStore, type RegisteredSeries } from '../../stores/pluginMonitor'

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Filler, Tooltip)

const { settings, saveSettings } = useSettings()
const { t } = useI18n()
const data = monitorData
const pluginMonitor = usePluginMonitorStore()

const hasGpu = computed(() => (data.value?.gpu?.length ?? 0) > 0)

watch(hasGpu, (available) => {
  if (!available && settings.monitor.gpu) {
    settings.monitor.gpu = false
    saveSettings()
  }
})

void baseOptions

const cpuChartData = computed(() => ({
  labels: labelsFor(cpuHistory.value.length),
  datasets: [
    {
      data: [...cpuHistory.value],
      borderColor: '#8A8A8A',
      backgroundColor: 'rgba(138,138,138,0.1)',
      fill: true,
    },
  ],
}))

const memChartData = computed(() => ({
  labels: labelsFor(memHistory.value.length),
  datasets: [
    {
      data: [...memHistory.value],
      borderColor: '#98C379',
      backgroundColor: 'rgba(152,195,121,0.1)',
      fill: true,
    },
  ],
}))

const netChartData = computed(() => ({
  labels: labelsFor(netTxHistory.value.length),
  datasets: [
    {
      data: [...netTxHistory.value],
      borderColor: '#E5C07B',
      backgroundColor: 'rgba(229,192,123,0.05)',
      fill: true,
    },
    {
      data: [...netRxHistory.value],
      borderColor: '#C678DD',
      backgroundColor: 'rgba(198,120,221,0.05)',
      fill: true,
    },
  ],
}))

const gpuChartData = computed(() => ({
  labels: labelsFor(gpuUtilHistory.value[0]?.length ?? 0),
  datasets: gpuUtilHistory.value.map((hist, i) => ({
    data: [...hist],
    borderColor: gpuColors[i % gpuColors.length],
    backgroundColor: 'transparent',
    borderWidth: 1.5,
    fill: false,
  })),
}))

const gpuMemChartData = computed(() => ({
  labels: labelsFor(gpuMemHistory.value[0]?.length ?? 0),
  datasets: gpuMemHistory.value.map((hist, i) => ({
    data: [...hist],
    borderColor: gpuColors[i % gpuColors.length],
    backgroundColor: 'transparent',
    borderWidth: 2,
    fill: false,
  })),
}))

// ─── Plugin-contributed series ──────────────────────────────────────────────

const visiblePluginSeries = computed(() =>
  pluginMonitor.series.filter((s) => pluginMonitor.isConfigurable(s))
)

function pluginSeriesVisible(s: RegisteredSeries): boolean {
  const override = settings.monitor.plugin_series[s.id]
  if (override !== undefined) return override
  return s.defaultVisible ?? true
}

function setPluginSeriesVisible(s: RegisteredSeries, visible: boolean) {
  settings.monitor.plugin_series[s.id] = visible
  saveSettings()
}

function pluginChartData(s: RegisteredSeries) {
  const history = s.history
  const labels = labelsFor(history[0]?.length ?? 0)
  if (history.length === 1) {
    return {
      labels,
      datasets: [
        {
          data: [...history[0]],
          borderColor: s.color ?? '#8A8A8A',
          backgroundColor: 'rgba(138,138,138,0.1)',
          fill: true,
        },
      ],
    }
  }
  const ms = s.multiSeries?.()
  return {
    labels,
    datasets: history.map((h, i) => {
      const color = ms?.[i]?.color ?? gpuColors[i % gpuColors.length]
      return {
        label: ms?.[i]?.label,
        data: [...h],
        borderColor: color,
        backgroundColor: 'transparent',
        borderWidth: 1.5,
        fill: false,
      }
    }),
  }
}

function pluginChartOptions(s: RegisteredSeries) {
  return s.scale === 'percent' ? pctChartOptions.value : autoChartOptions.value
}
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
.plugin-series-block {
  margin-bottom: 12px;
}
.plugin-series-title {
  font-size: 12px;
  font-weight: 500;
  text-transform: none;
  letter-spacing: 0;
}
</style>
