<template>
  <div v-if="monitorSettings.enabled || warning.message.value" class="status-bar">
    <div v-if="leftItems.length" class="status-bar-left">
      <StatusBarItemRenderer
        v-for="item in leftItems"
        :key="item.id"
        :item="item"
      />
    </div>
    <div
      ref="rightEl"
      class="status-bar-right"
      :class="{ 'has-overflow-left': overflowLeft, 'has-overflow-right': overflowRight }"
      @wheel="onWheel"
      @scroll="updateOverflow"
    >
      <StatusBarItemRenderer
        v-for="item in allRightItems"
        :key="item.id"
        :item="item"
      />
    </div>
    <span v-if="warning.message.value" class="pane-warning">{{ warning.message.value }}</span>

    <MonitorPopover
      v-if="activePopover?.kind === 'system'"
      :visible="true"
      :metric="activePopover.metric"
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
    <PluginSeriesPopover
      v-else-if="activePopover?.kind === 'plugin' && activeSeries"
      :visible="true"
      :series="activeSeries"
      :anchor-rect="anchorRect"
      @close="activePopover = null"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, ref, defineAsyncComponent, onMounted, onBeforeUnmount, watch, nextTick } from 'vue'
import { monitorData } from '../../composables/useMonitor'
import {
  cpuHistory,
  memHistory,
  netRxHistory,
  netTxHistory,
  gpuUtilHistory,
  gpuMemHistory,
} from '../../composables/useMonitor'
import { useSettings } from '../../composables/useSettings'
import { usePaneWarning } from '../../composables/usePaneWarning'
import { useStatusBarItemsStore } from '../../stores/statusBarItems'
import { usePluginMonitorStore } from '../../stores/pluginMonitor'
import {
  createSystemStatusBarItems,
  type MetricKey,
} from '../../composables/useSystemStatusBarItems'
import { pluginSeriesToStatusBarItem } from '../../composables/usePluginStatusBarAdapter'
import StatusBarItemRenderer from './StatusBarItemRenderer.vue'

const MonitorPopover = defineAsyncComponent(() => import('./MonitorPopover.vue'))
const PluginSeriesPopover = defineAsyncComponent(() => import('./PluginSeriesPopover.vue'))

const data = monitorData
const { settings } = useSettings()
const warning = usePaneWarning()
const store = useStatusBarItemsStore()
const pluginMonitor = usePluginMonitorStore()

const monitorSettings = computed(
  () =>
    settings.monitor ?? {
      enabled: true,
      cpu: true,
      memory: true,
      disk: false,
      network: true,
    },
)

const leftItems = computed(() => store.leftItems)
const rightItems = computed(() => store.rightItems)

type ActivePopover =
  | { kind: 'system'; metric: MetricKey }
  | { kind: 'plugin'; seriesId: string }
  | null

const activePopover = ref<ActivePopover>(null)
const anchorRect = ref<DOMRect | null>(null)

function toggleSystemPopover(key: MetricKey, event: MouseEvent) {
  if (activePopover.value?.kind === 'system' && activePopover.value.metric === key) {
    activePopover.value = null
    return
  }
  const el = event.currentTarget as HTMLElement
  anchorRect.value = el.getBoundingClientRect()
  activePopover.value = { kind: 'system', metric: key }
}

function togglePluginPopover(seriesId: string, event: MouseEvent) {
  if (activePopover.value?.kind === 'plugin' && activePopover.value.seriesId === seriesId) {
    activePopover.value = null
    return
  }
  const el = event.currentTarget as HTMLElement
  anchorRect.value = el.getBoundingClientRect()
  activePopover.value = { kind: 'plugin', seriesId }
}

const activeSeries = computed(() => {
  const pop = activePopover.value
  if (pop?.kind !== 'plugin') return null
  return pluginMonitor.series.find((s) => s.id === pop.seriesId) ?? null
})

// Plugin series with statusText get adapted into status bar items (right side).
const pluginStatusBarItems = computed(() =>
  pluginMonitor.series
    .filter((s) => s.statusText && pluginMonitor.isVisible(s, settings.monitor.plugin_series))
    .map((s) => pluginSeriesToStatusBarItem(s, (e) => togglePluginPopover(s.id, e))),
)

// Merge system items with plugin-adapted items; system items keep their priorities,
// plugin items use priority 200 (rendered after system metrics).
const allRightItems = computed(() => {
  const sys = [...rightItems.value]
  const plugins = [...pluginStatusBarItems.value]
  return [...sys, ...plugins].sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0))
})

const rightEl = ref<HTMLElement | null>(null)
const overflowLeft = ref(false)
const overflowRight = ref(false)

function updateOverflow() {
  const el = rightEl.value
  if (!el) return
  overflowLeft.value = el.scrollLeft > 1
  overflowRight.value = el.scrollLeft + el.clientWidth < el.scrollWidth - 1
}

function onWheel(e: WheelEvent) {
  const el = rightEl.value
  if (!el) return
  if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return
  if (e.shiftKey || el.scrollWidth > el.clientWidth) {
    el.scrollLeft += e.deltaY
    e.preventDefault()
  }
}

onMounted(() => {
  store.register('system', createSystemStatusBarItems(monitorSettings, toggleSystemPopover))
  updateOverflow()
  window.addEventListener('resize', updateOverflow)
})

onBeforeUnmount(() => {
  store.unregister('system')
  window.removeEventListener('resize', updateOverflow)
})

watch(
  () => allRightItems.value.length,
  () => nextTick(updateOverflow),
)
</script>

<style scoped>
.status-bar {
  height: 24px;
  box-sizing: border-box;
  background: var(--bg, #1a1a2e);
  border-top: 1px solid var(--border);
  display: flex;
  align-items: center;
  flex-shrink: 0;
  padding: 0 12px;
  position: relative;
  z-index: 2;
  gap: 16px;
}
.status-bar-left {
  display: flex;
  gap: 8px;
  align-items: center;
  flex-shrink: 0;
}
.status-bar-right {
  display: flex;
  gap: 8px;
  align-items: center;
  flex: 1;
  min-width: 0;
  overflow-x: auto;
  scrollbar-width: none;
  -ms-overflow-style: none;
  -webkit-mask-image: linear-gradient(
    to right,
    transparent 0,
    #000 12px,
    #000 calc(100% - 12px),
    transparent 100%
  );
  mask-image: linear-gradient(
    to right,
    transparent 0,
    #000 12px,
    #000 calc(100% - 12px),
    transparent 100%
  );
  -webkit-overflow-scrolling: touch;
}
.status-bar-right::-webkit-scrollbar {
  display: none;
}
.status-bar-right.has-overflow-left:not(.has-overflow-right) {
  -webkit-mask-image: linear-gradient(
    to right,
    transparent 0,
    #000 12px,
    #000 100%
  );
  mask-image: linear-gradient(to right, transparent 0, #000 12px, #000 100%);
}
.status-bar-right.has-overflow-right:not(.has-overflow-left) {
  -webkit-mask-image: linear-gradient(
    to right,
    #000 0,
    #000 calc(100% - 12px),
    transparent 100%
  );
  mask-image: linear-gradient(
    to right,
    #000 0,
    #000 calc(100% - 12px),
    transparent 100%
  );
}
.status-bar-right:not(.has-overflow-left):not(.has-overflow-right) {
  -webkit-mask-image: none;
  mask-image: none;
}
.pane-warning {
  position: absolute;
  right: 12px;
  top: 50%;
  transform: translateY(-50%);
  font-size: 11px;
  color: var(--fg-muted);
  white-space: nowrap;
  max-width: 40%;
  overflow: hidden;
  text-overflow: ellipsis;
  pointer-events: none;
  animation: warning-fade 4s ease-in forwards;
  z-index: 3;
}
@keyframes warning-fade {
  0%,
  70% {
    opacity: 1;
  }
  100% {
    opacity: 0;
  }
}
</style>
