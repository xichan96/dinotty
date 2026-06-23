<template>
  <Teleport to="body">
    <div v-if="visible" class="monitor-popover" :style="popoverStyle" ref="popoverEl">
      <!-- CPU Detail -->
      <div v-if="metric === 'cpu' && data" class="popover-content">
        <div class="popover-title">CPU</div>
        <div class="popover-chart"><Line :data="cpuChartData" :options="pctChartOptions" /></div>
        <div class="popover-row"><span>Total Usage</span><span>{{ data.cpu.usage.toFixed(1) }}%</span></div>
        <div class="popover-row"><span>Cores</span><span>{{ data.cpu.core_count.physical }}P / {{ data.cpu.core_count.logical }}L</span></div>
        <div class="popover-row"><span>Load Avg</span><span>{{ data.cpu.load_avg.map(v => v.toFixed(2)).join(' / ') }}</span></div>
        <div class="popover-divider" />
        <div class="popover-subtitle">Per Core</div>
        <div v-for="(usage, i) in data.cpu.cores" :key="i" class="popover-row">
          <span>Core {{ i }}</span>
          <span>{{ usage.toFixed(1) }}%</span>
        </div>
      </div>

      <!-- Memory Detail -->
      <div v-if="metric === 'memory' && data" class="popover-content">
        <div class="popover-title">Memory</div>
        <div class="popover-chart"><Line :data="memChartData" :options="pctChartOptions" /></div>
        <div class="popover-row"><span>Used</span><span>{{ fmtBytes(data.memory.used) }}</span></div>
        <div class="popover-row"><span>Available</span><span>{{ fmtBytes(data.memory.available) }}</span></div>
        <div class="popover-row"><span>Total</span><span>{{ fmtBytes(data.memory.total) }}</span></div>
        <div class="popover-row"><span>Usage</span><span>{{ data.memory.usage.toFixed(1) }}%</span></div>
        <div class="popover-divider" />
        <div class="popover-subtitle">Swap</div>
        <div class="popover-row"><span>Used</span><span>{{ fmtBytes(data.memory.swap_used) }}</span></div>
        <div class="popover-row"><span>Total</span><span>{{ fmtBytes(data.memory.swap_total) }}</span></div>
      </div>

      <!-- Disk Detail -->
      <div v-if="metric === 'disk' && data" class="popover-content">
        <div class="popover-title">Disk</div>
        <template v-for="(d, i) in data.disk" :key="i">
          <div v-if="i > 0" class="popover-divider" />
          <div class="popover-subtitle">{{ d.mount }}</div>
          <div class="popover-row"><span>FS</span><span>{{ d.fs_type }}</span></div>
          <div class="popover-row"><span>Used</span><span>{{ fmtBytes(d.used) }}</span></div>
          <div class="popover-row"><span>Available</span><span>{{ fmtBytes(d.available) }}</span></div>
          <div class="popover-row"><span>Total</span><span>{{ fmtBytes(d.total) }}</span></div>
          <div class="popover-row"><span>Usage</span><span>{{ d.usage.toFixed(1) }}%</span></div>
        </template>
      </div>

      <!-- Network Detail -->
      <div v-if="metric === 'network' && data" class="popover-content">
        <div class="popover-title">Network</div>
        <div class="popover-chart"><Line :data="netChartData" :options="netChartOptions" /></div>
        <template v-for="(n, i) in data.network" :key="i">
          <div v-if="i > 0" class="popover-divider" />
          <div class="popover-subtitle">{{ n.name }}</div>
          <div class="popover-row"><span>IP</span><span>{{ n.ip || '—' }}</span></div>
          <div class="popover-row"><span>↑ Rate</span><span>{{ fmtRate(n.tx_rate) }}</span></div>
          <div class="popover-row"><span>↓ Rate</span><span>{{ fmtRate(n.rx_rate) }}</span></div>
          <div class="popover-row"><span>↑ Total</span><span>{{ fmtBytes(n.tx_total) }}</span></div>
          <div class="popover-row"><span>↓ Total</span><span>{{ fmtBytes(n.rx_total) }}</span></div>
        </template>
      </div>

      <!-- GPU Detail -->
      <div v-if="metric === 'gpu' && data" class="popover-content">
        <div class="popover-title">GPU</div>
        <div class="popover-subtitle">Compute</div>
        <div class="popover-chart"><Line :data="gpuChartData" :options="pctChartOptions" /></div>
        <div class="popover-subtitle">VRAM</div>
        <div class="popover-chart"><Line :data="gpuMemChartData" :options="autoChartOptions" /></div>
        <div class="popover-divider" />
        <template v-for="(g, i) in (data.gpu ?? [])" :key="i">
          <div v-if="i > 0" class="popover-divider" />
          <div class="popover-subtitle">GPU {{ i }} · {{ g.name }}</div>
          <div class="popover-row"><span>Compute</span><span>{{ g.utilization_gpu.toFixed(0) }}%</span></div>
          <div class="popover-row"><span>VRAM</span><span>{{ fmtBytes(g.memory_used * 1024 * 1024) }} / {{ fmtBytes(g.memory_total * 1024 * 1024) }} ({{ g.memory_usage.toFixed(0) }}%)</span></div>
          <div class="popover-row"><span>Temp</span><span>{{ g.temperature.toFixed(0) }}°C</span></div>
          <div class="popover-row"><span>Power</span><span>{{ g.power_draw.toFixed(0) }}W / {{ g.power_limit.toFixed(0) }}W</span></div>
        </template>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, ref, watch, onBeforeUnmount } from 'vue'
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Filler,
} from 'chart.js'
import { Line } from 'vue-chartjs'
import type { MonitorData } from '../../composables/useMonitor'

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Filler)

const props = defineProps<{
  visible: boolean
  metric: 'cpu' | 'memory' | 'disk' | 'network' | 'gpu'
  data: MonitorData | null
  anchorRect: DOMRect | null
  cpuHistory: number[]
  memHistory: number[]
  netRxHistory: number[]
  netTxHistory: number[]
  gpuUtilHistory: number[][]
  gpuMemHistory: number[][]
}>()

const emit = defineEmits<{ close: [] }>()

const popoverEl = ref<HTMLElement>()

const baseOptions = {
  responsive: true,
  maintainAspectRatio: false,
  animation: { duration: 0 } as const,
  plugins: { legend: { display: false }, tooltip: { enabled: false } },
  elements: { point: { radius: 0 }, line: { tension: 0.3, borderWidth: 1.5 } },
  scales: {
    x: { display: false },
    y: {
      min: 0,
      grid: { color: 'rgba(255,255,255,0.06)' },
      ticks: { display: false },
    },
  },
}

const pctChartOptions = {
  ...baseOptions,
  scales: { ...baseOptions.scales, y: { ...baseOptions.scales.y, max: 100 } },
}

const autoChartOptions = {
  ...baseOptions,
  scales: {
    ...baseOptions.scales,
    y: { ...baseOptions.scales.y, beginAtZero: true },
  },
}

const netChartOptions = baseOptions

const labels = computed(() => props.cpuHistory.map(() => ''))

const cpuChartData = computed(() => ({
  labels: labels.value,
  datasets: [{
    data: [...props.cpuHistory],
    borderColor: '#8A8A8A',
    backgroundColor: 'rgba(77,127,255,0.1)',
    fill: true,
  }],
}))

const memChartData = computed(() => ({
  labels: labels.value,
  datasets: [{
    data: [...props.memHistory],
    borderColor: '#34d399',
    backgroundColor: 'rgba(52,211,153,0.1)',
    fill: true,
  }],
}))

const netChartData = computed(() => ({
  labels: props.netTxHistory.map(() => ''),
  datasets: [
    { data: [...props.netTxHistory], borderColor: '#f59e0b', backgroundColor: 'rgba(245,158,11,0.05)', fill: true },
    { data: [...props.netRxHistory], borderColor: '#8b5cf6', backgroundColor: 'rgba(139,92,246,0.05)', fill: true },
  ],
}))

const gpuColors = ['#76b900', '#00a8e8', '#e84040', '#f59e0b', '#8b5cf6', '#34d399', '#f472b6', '#fbbf24', '#60a5fa', '#a78bfa']

const gpuChartData = computed(() => {
  const len = props.gpuUtilHistory.reduce((m, a) => Math.max(m, a.length), 0)
  return {
    labels: Array(len).fill(''),
    datasets: props.gpuUtilHistory.map((hist, i) => ({
      data: [...hist],
      borderColor: gpuColors[i % gpuColors.length],
      backgroundColor: 'transparent',
      borderWidth: 1.5,
      fill: false,
    })),
  }
})

const gpuMemChartData = computed(() => {
  const len = props.gpuMemHistory.reduce((m, a) => Math.max(m, a.length), 0)
  return {
    labels: Array(len).fill(''),
    datasets: props.gpuMemHistory.map((hist, i) => ({
      data: [...hist],
      borderColor: gpuColors[i % gpuColors.length],
      backgroundColor: 'transparent',
      borderWidth: 2,
      fill: false,
    })),
  }
})

const popoverStyle = computed(() => {
  if (!props.anchorRect) return {}
  const pw = 260
  const margin = 8
  let x = props.anchorRect.left + props.anchorRect.width / 2
  const halfW = pw / 2
  if (x - halfW < margin) x = margin + halfW
  if (x + halfW > window.innerWidth - margin) x = window.innerWidth - margin - halfW
  return {
    left: `${x}px`,
    bottom: `${window.innerHeight - props.anchorRect.top + 6}px`,
    transform: 'translateX(-50%)',
    maxHeight: `${props.anchorRect.top - 12}px`,
  }
})

function onClickOutside(e: MouseEvent) {
  if (popoverEl.value && !popoverEl.value.contains(e.target as Node)) {
    emit('close')
  }
}

let clickListenerActive = false
function addClickListener() {
  if (clickListenerActive) return
  clickListenerActive = true
  setTimeout(() => document.addEventListener('click', onClickOutside), 0)
}
function removeClickListener() {
  if (!clickListenerActive) return
  clickListenerActive = false
  document.removeEventListener('click', onClickOutside)
}

onBeforeUnmount(() => {
  removeClickListener()
})

watch(() => props.visible, (v) => {
  if (v) {
    addClickListener()
  } else {
    removeClickListener()
  }
})

function fmtBytes(b: number): string {
  if (b < 1024) return `${b}B`
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)}K`
  if (b < 1024 * 1024 * 1024) return `${(b / 1024 / 1024).toFixed(1)}M`
  return `${(b / 1024 / 1024 / 1024).toFixed(1)}G`
}

function fmtRate(bytesPerSec: number): string {
  return `${fmtBytes(bytesPerSec)}/s`
}
</script>

<style scoped>
.monitor-popover {
  position: fixed;
  z-index: 9999;
  background: var(--bg-surface, #1e1e2e);
  border: 1px solid var(--border, rgba(255, 255, 255, 0.15));
  border-radius: 8px;
  padding: 12px;
  width: 260px;
  overflow-y: auto;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
  color: var(--fg, rgba(255, 255, 255, 0.85));
  font-size: 12px;
}
.popover-chart {
  height: 64px;
  margin-bottom: 8px;
  position: relative;
}
.popover-title {
  font-size: 13px;
  font-weight: 600;
  margin-bottom: 8px;
  color: var(--fg-bright, rgba(255, 255, 255, 0.95));
}
.popover-subtitle {
  font-size: 11px;
  font-weight: 500;
  color: var(--fg-muted, rgba(255, 255, 255, 0.6));
  margin: 4px 0 2px;
}
.popover-row {
  display: flex;
  justify-content: space-between;
  padding: 2px 0;
  gap: 12px;
}
.popover-row span:last-child {
  font-variant-numeric: tabular-nums;
  color: var(--fg-muted, rgba(255, 255, 255, 0.7));
}
.popover-divider {
  height: 1px;
  background: var(--border, rgba(255, 255, 255, 0.1));
  margin: 6px 0;
}
</style>
